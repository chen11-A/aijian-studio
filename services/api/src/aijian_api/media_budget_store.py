"""Budget persistence, transactional reservation, and a pre-dispatch gate.

The existing remote authorization contract stays a zero-budget USD call hold for
``remote.source.extract``. It cannot express a work total, an episode sub-budget,
or an unknown monetary amount, so this ledger does not write authorization
snapshots, dispatch snapshots, or settlement receipts. Upstream invoices stay
with the gateway. ``provider_called`` is constrained to 0: the only dispatch
side effect is a local stub that must not open a socket.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Callable, Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Protocol, cast

from aijian_api.media_budget_policy import (
    BudgetAmount,
    BudgetAssessment,
    BudgetUsage,
    evaluate_media_budget,
)
from aijian_api.repository import StudioRepository
from aijian_api.task_ledger_models import new_id, timestamp, utc_now


class MediaBudgetError(ValueError):
    """The budget ledger rejected the operation and did not dispatch."""


class MediaBudgetNotFound(MediaBudgetError):
    """The project, episode, or reservation is not in this workspace."""


class MediaBudgetConflict(MediaBudgetError):
    """An idempotency key is already bound to a different reservation."""


class PaidCallStub(Protocol):
    def dispatch(self, reservation_id: str) -> None:
        """Accept a reserved id. Implementations must not call a provider."""


class NoPaidCallStub:
    """Default dispatch stand-in. It has no network, credential, or provider client."""

    def dispatch(self, reservation_id: str) -> None:
        return None


@dataclass(frozen=True, slots=True)
class MediaBudgetHead:
    project_id: str
    revision: int
    currency: str
    project_limit_micro: int
    episode_limits_micro: tuple[tuple[str, int], ...]


@dataclass(frozen=True, slots=True)
class MediaDispatchRequest:
    project_id: str
    idempotency_key: str
    currency: str
    amount_micro: int | None
    episode_id: str | None = None


@dataclass(frozen=True, slots=True)
class MediaDispatchDecision:
    outcome: Literal["DISPATCHED", "BLOCKED", "REPLAYED"]
    assessment: BudgetAssessment | None
    reservation_id: str | None
    provider_called: Literal[False]
    stub_invoked: bool
    display_reason: str | None = None


@dataclass(frozen=True, slots=True)
class _MeteredHold:
    outcome: Literal["RESERVED", "BLOCKED", "REPLAYED"]
    assessment: BudgetAssessment | None
    reservation_id: str | None


class MediaBudgetStore:
    def __init__(
        self,
        repository: StudioRepository,
        *,
        clock: Callable[[], datetime] = utc_now,
        ids: Callable[[str], str] = new_id,
        paid_call: PaidCallStub | None = None,
    ) -> None:
        self._repository = repository
        self._clock = clock
        self._ids = ids
        self._paid_call = paid_call if paid_call is not None else NoPaidCallStub()

    def save_budget(
        self,
        *,
        project_id: str,
        currency: str,
        project_limit_micro: int,
        episode_limits: Mapping[str, int],
    ) -> MediaBudgetHead:
        """Append a budget revision. This does not reserve, replay, or dispatch."""

        BudgetAmount(currency, project_limit_micro)
        limits = tuple(sorted(episode_limits.items()))
        for episode_id, limit in limits:
            if not isinstance(episode_id, str) or episode_id == "":
                raise ValueError("episode id is required")
            BudgetAmount(currency, limit)
        with self._transaction() as connection:
            self._require_project(connection, project_id)
            for episode_id, _limit in limits:
                self._require_episode(connection, project_id, episode_id)
            current = connection.execute(
                """
                SELECT COALESCE(MAX(revision), 0)
                FROM media_budget_revisions WHERE project_id = ?
                """,
                (project_id,),
            ).fetchone()
            revision = _required_int(None if current is None else current[0]) + 1
            now = timestamp(self._clock())
            connection.execute(
                """
                INSERT INTO media_budget_revisions (
                    project_id, revision, currency, project_limit_micro, created_at
                ) VALUES (?, ?, ?, ?, ?)
                """,
                (project_id, revision, currency, project_limit_micro, now),
            )
            connection.executemany(
                """
                INSERT INTO media_budget_episode_limits (
                    project_id, revision, episode_id, limit_micro
                ) VALUES (?, ?, ?, ?)
                """,
                [(project_id, revision, episode_id, limit) for episode_id, limit in limits],
            )
            connection.execute(
                """
                INSERT INTO media_budget_heads (project_id, revision, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(project_id) DO UPDATE SET
                    revision = excluded.revision,
                    updated_at = excluded.updated_at
                """,
                (project_id, revision, now),
            )
            head = self._head(connection, project_id)
            if head is None:
                raise MediaBudgetError("budget head was not stored")
            return head

    def read_head(self, project_id: str) -> MediaBudgetHead | None:
        with self._transaction(write=False) as connection:
            self._require_project(connection, project_id)
            return self._head(connection, project_id)

    def scope_usage(
        self, project_id: str, episode_id: str | None = None
    ) -> tuple[BudgetUsage | None, BudgetUsage | None]:
        """Return project usage, which already includes episode rows, and the optional cap."""

        with self._transaction(write=False) as connection:
            self._require_project(connection, project_id)
            if episode_id is not None:
                self._require_episode(connection, project_id, episode_id)
            return self._usages(connection, project_id, episode_id)

    def dispatch(self, request: MediaDispatchRequest) -> MediaDispatchDecision:
        """Check and reserve in one transaction, then stub-dispatch. Never calls a provider."""

        with self._transaction() as connection:
            now = timestamp(self._clock())
            hold = apply_metered_reservation(
                connection,
                request,
                reservation_id_factory=self._reservation_id,
                now_text=now,
            )
            if hold.outcome == "BLOCKED":
                from aijian_api.dispatch_billing import budget_display_reason

                status = hold.assessment.status if hold.assessment is not None else "UNCONFIGURED"
                return MediaDispatchDecision(
                    "BLOCKED",
                    hold.assessment,
                    None,
                    False,
                    False,
                    budget_display_reason(status),
                )
            if hold.reservation_id is None:
                raise MediaBudgetError("metered reservation is missing")
            if hold.outcome == "RESERVED":
                self._paid_call.dispatch(hold.reservation_id)
                connection.execute(
                    """
                    INSERT INTO media_budget_dispatch_receipts (
                        reservation_id, transport, provider_called, created_at
                    ) VALUES (?, 'STUB_NO_PAID_CALL', 0, ?)
                    """,
                    (hold.reservation_id, now),
                )
            from aijian_api.dispatch_billing import (
                ensure_paid_media_billing_record,
                require_prefixed_id,
            )

            ensure_paid_media_billing_record(
                connection,
                project_id=request.project_id,
                reservation_id=hold.reservation_id,
                record_id_factory=lambda: require_prefixed_id(self._ids("dbr"), "dbr"),
                created_at=now,
            )
            if hold.outcome == "REPLAYED":
                return MediaDispatchDecision("REPLAYED", None, hold.reservation_id, False, False)
            return MediaDispatchDecision(
                "DISPATCHED", hold.assessment, hold.reservation_id, False, True
            )

    def record_unreconciled_usage(
        self,
        *,
        project_id: str,
        idempotency_key: str,
        currency: str,
        episode_id: str | None = None,
    ) -> str:
        """Record a historical amount that is unknown. The stored amount is null, not zero."""

        key = _require_key(idempotency_key)
        BudgetAmount(currency, 0)
        with self._transaction() as connection:
            self._require_project(connection, project_id)
            if episode_id is not None:
                self._require_episode(connection, project_id, episode_id)
            head = self._head(connection, project_id)
            if head is None:
                raise MediaBudgetError("unreconciled usage requires a configured budget")
            if head.currency != currency:
                raise MediaBudgetError("unreconciled usage currency does not match the budget")
            existing = connection.execute(
                """
                SELECT * FROM media_budget_reservations
                WHERE project_id = ? AND idempotency_key = ?
                """,
                (project_id, key),
            ).fetchone()
            if existing is not None:
                same_unknown = (
                    _int(existing, "amount_known") == 0
                    and existing["amount_micro"] is None
                    and _text(existing, "currency") == currency
                    and _optional_text(existing, "episode_id") == episode_id
                    and _text(existing, "status") == "UNKNOWN"
                )
                if not same_unknown:
                    raise MediaBudgetConflict(
                        "idempotency key is already bound to a different reservation"
                    )
                return _text(existing, "reservation_id")
            reservation_id = self._reservation_id()
            now = timestamp(self._clock())
            connection.execute(
                """
                INSERT INTO media_budget_reservations (
                    reservation_id, project_id, episode_id, budget_revision,
                    idempotency_key, currency, amount_known, amount_micro, status,
                    provider_called, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, 0, NULL, 'UNKNOWN', 0, ?, ?)
                """,
                (
                    reservation_id,
                    project_id,
                    episode_id,
                    head.revision,
                    key,
                    currency,
                    now,
                    now,
                ),
            )
            return reservation_id

    def mark_outcome_unknown(self, *, project_id: str, reservation_id: str) -> None:
        """Keep a known hold reserved when the outcome cannot be reconciled."""

        with self._transaction() as connection:
            row = self._reservation(connection, project_id, reservation_id)
            status = _text(row, "status")
            if status == "UNKNOWN":
                return
            if status != "RESERVED" or _int(row, "amount_known") != 1:
                raise MediaBudgetError("only a known reserved hold can be marked unknown")
            connection.execute(
                """
                UPDATE media_budget_reservations
                SET status = 'UNKNOWN', updated_at = ?
                WHERE reservation_id = ?
                """,
                (timestamp(self._clock()), reservation_id),
            )

    def cancel(self, *, project_id: str, reservation_id: str) -> None:
        """Release a known local hold. An unknown hold stays reserved."""

        with self._transaction() as connection:
            row = self._reservation(connection, project_id, reservation_id)
            status = _text(row, "status")
            if status == "CANCELLED":
                return
            if status == "UNKNOWN" or _int(row, "amount_known") != 1:
                raise MediaBudgetError("unknown reservation cannot be released as zero")
            if status != "RESERVED":
                raise MediaBudgetError("reservation cannot be released")
            connection.execute(
                """
                UPDATE media_budget_reservations
                SET status = 'CANCELLED', updated_at = ?
                WHERE reservation_id = ?
                """,
                (timestamp(self._clock()), reservation_id),
            )

    def _reservation_id(self) -> str:
        reservation_id = self._ids("mbr")
        suffix = reservation_id.removeprefix("mbr_")
        if (
            len(reservation_id) != 36
            or not reservation_id.startswith("mbr_")
            or len(suffix) != 32
            or any(character not in "0123456789abcdef" for character in suffix)
        ):
            raise ValueError("reservation id is invalid")
        return reservation_id

    @staticmethod
    def _usages(
        connection: sqlite3.Connection,
        project_id: str,
        episode_id: str | None,
    ) -> tuple[BudgetUsage | None, BudgetUsage | None]:
        head = MediaBudgetStore._head(connection, project_id)
        if head is None:
            return None, None
        rows = connection.execute(
            """
            SELECT episode_id, status, currency, amount_known, amount_micro
            FROM media_budget_reservations
            WHERE project_id = ? AND (status <> 'CANCELLED' OR amount_known = 0)
            """,
            (project_id,),
        ).fetchall()
        project_unknown = False
        episode_unknown = False
        project_spent = 0
        project_reserved = 0
        episode_spent = 0
        episode_reserved = 0
        for row in rows:
            row_episode = _optional_text(row, "episode_id")
            in_episode = episode_id is not None and row_episode == episode_id
            amount = _optional_int(row, "amount_micro")
            status = _text(row, "status")
            priced = (
                amount is not None
                and _int(row, "amount_known") == 1
                and _text(row, "currency") == head.currency
                and status in {"RESERVED", "UNKNOWN", "SETTLED"}
            )
            if not priced:
                project_unknown = True
                episode_unknown = episode_unknown or in_episode
                continue
            assert amount is not None
            if status == "SETTLED":
                project_spent += amount
                episode_spent += amount if in_episode else 0
            else:
                project_reserved += amount
                episode_reserved += amount if in_episode else 0
        project_usage = _usage(
            head.currency,
            head.project_limit_micro,
            project_spent,
            project_reserved,
            project_unknown,
        )
        episode_usage = None
        if episode_id is not None:
            cap = dict(head.episode_limits_micro).get(episode_id)
            if cap is not None:
                episode_usage = _usage(
                    head.currency, cap, episode_spent, episode_reserved, episode_unknown
                )
        return project_usage, episode_usage

    @staticmethod
    def _head(connection: sqlite3.Connection, project_id: str) -> MediaBudgetHead | None:
        row = connection.execute(
            """
            SELECT revision.revision, revision.currency, revision.project_limit_micro
            FROM media_budget_heads AS head
            JOIN media_budget_revisions AS revision
              ON revision.project_id = head.project_id
             AND revision.revision = head.revision
            WHERE head.project_id = ?
            """,
            (project_id,),
        ).fetchone()
        if row is None:
            return None
        revision = _int(row, "revision")
        limits = connection.execute(
            """
            SELECT episode_id, limit_micro
            FROM media_budget_episode_limits
            WHERE project_id = ? AND revision = ?
            ORDER BY episode_id
            """,
            (project_id, revision),
        ).fetchall()
        return MediaBudgetHead(
            project_id,
            revision,
            _text(row, "currency"),
            _int(row, "project_limit_micro"),
            tuple((_text(limit, "episode_id"), _int(limit, "limit_micro")) for limit in limits),
        )

    def _reservation(
        self, connection: sqlite3.Connection, project_id: str, reservation_id: str
    ) -> sqlite3.Row:
        row = connection.execute(
            """
            SELECT * FROM media_budget_reservations
            WHERE project_id = ? AND reservation_id = ?
            """,
            (project_id, reservation_id),
        ).fetchone()
        if row is None:
            raise MediaBudgetNotFound("reservation was not found")
        return cast(sqlite3.Row, row)

    @contextmanager
    def _transaction(self, *, write: bool = True) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(
            self._repository.database_path, timeout=5, isolation_level=None
        )
        connection.row_factory = sqlite3.Row
        try:
            connection.execute("PRAGMA foreign_keys = ON")
            connection.execute("PRAGMA busy_timeout = 5000")
            if not write:
                connection.execute("PRAGMA query_only = ON")
            connection.execute("BEGIN IMMEDIATE" if write else "BEGIN")
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    @staticmethod
    def _require_project(connection: sqlite3.Connection, project_id: str) -> None:
        if not isinstance(project_id, str) or project_id == "":
            raise ValueError("project id is required")
        found = connection.execute("SELECT 1 FROM projects WHERE id = ?", (project_id,)).fetchone()
        if found is None:
            raise MediaBudgetNotFound("project was not found")

    @staticmethod
    def _require_episode(connection: sqlite3.Connection, project_id: str, episode_id: str) -> None:
        if not isinstance(episode_id, str) or episode_id == "":
            raise ValueError("episode id is required")
        found = connection.execute(
            "SELECT 1 FROM episodes WHERE project_id = ? AND id = ?",
            (project_id, episode_id),
        ).fetchone()
        if found is None:
            raise MediaBudgetNotFound("episode was not found")


def apply_metered_reservation(
    connection: sqlite3.Connection,
    request: MediaDispatchRequest,
    *,
    reservation_id_factory: Callable[[], str],
    now_text: str,
) -> _MeteredHold:
    """Reserve a known metered amount on the caller's open transaction."""

    key = _require_key(request.idempotency_key)
    amount = _request_amount(request.currency, request.amount_micro)
    MediaBudgetStore._require_project(connection, request.project_id)
    if request.episode_id is not None:
        MediaBudgetStore._require_episode(connection, request.project_id, request.episode_id)
    existing = connection.execute(
        """
        SELECT * FROM media_budget_reservations
        WHERE project_id = ? AND idempotency_key = ?
        """,
        (request.project_id, key),
    ).fetchone()
    if existing is not None:
        _require_same_request(existing, request)
        return _MeteredHold("REPLAYED", None, _text(existing, "reservation_id"))
    project_usage, episode_usage = MediaBudgetStore._usages(
        connection, request.project_id, request.episode_id
    )
    assessment = evaluate_media_budget(project=project_usage, episode=episode_usage, request=amount)
    if assessment.status != "WITHIN_LIMIT":
        return _MeteredHold("BLOCKED", assessment, None)
    if amount is None:
        raise MediaBudgetError("within-limit assessment without a known amount")
    head = MediaBudgetStore._head(connection, request.project_id)
    if head is None:
        raise MediaBudgetError("within-limit assessment without a budget head")
    reservation_id = reservation_id_factory()
    connection.execute(
        """
        INSERT INTO media_budget_reservations (
            reservation_id, project_id, episode_id, budget_revision,
            idempotency_key, currency, amount_known, amount_micro, status,
            provider_called, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, 'RESERVED', 0, ?, ?)
        """,
        (
            reservation_id,
            request.project_id,
            request.episode_id,
            head.revision,
            key,
            amount.currency,
            amount.micro_units,
            now_text,
            now_text,
        ),
    )
    return _MeteredHold("RESERVED", assessment, reservation_id)


def _usage(currency: str, limit: int, spent: int, reserved: int, unknown: bool) -> BudgetUsage:
    if unknown:
        return BudgetUsage(currency, limit, None, None)
    return BudgetUsage(currency, limit, spent, reserved)


def _request_amount(currency: str, amount_micro: int | None) -> BudgetAmount | None:
    if amount_micro is None:
        BudgetAmount(currency, 0)
        return None
    return BudgetAmount(currency, amount_micro)


def _require_key(value: str) -> str:
    if not isinstance(value, str) or not 1 <= len(value) <= 128:
        raise ValueError("idempotency key must be 1..128 characters")
    if any(ord(character) < 32 or ord(character) == 127 for character in value):
        raise ValueError("idempotency key must not contain control characters")
    return value


def _require_same_request(row: sqlite3.Row, request: MediaDispatchRequest) -> None:
    amount = None if request.amount_micro is None else request.amount_micro
    stored_amount = _optional_int(row, "amount_micro")
    same = (
        _optional_text(row, "episode_id") == request.episode_id
        and _text(row, "currency") == request.currency
        and ((_int(row, "amount_known") == 0 and amount is None) or stored_amount == amount)
    )
    if not same:
        raise MediaBudgetConflict("idempotency key is already bound to a different reservation")


def _text(row: sqlite3.Row, key: str) -> str:
    value = row[key]
    if not isinstance(value, str):
        raise MediaBudgetError("stored budget field is invalid")
    return value


def _optional_text(row: sqlite3.Row, key: str) -> str | None:
    value = row[key]
    if value is None:
        return None
    if not isinstance(value, str):
        raise MediaBudgetError("stored budget field is invalid")
    return value


def _int(row: sqlite3.Row, key: str) -> int:
    return _required_int(row[key])


def _optional_int(row: sqlite3.Row, key: str) -> int | None:
    value = row[key]
    if value is None:
        return None
    return _required_int(value)


def _required_int(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise MediaBudgetError("stored budget field is invalid")
    return value

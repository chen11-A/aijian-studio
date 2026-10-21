"""Classify a dispatch as subscription login or metered spend before it is queued.

GPT and Grok subscription logins keep the existing zero-budget authorization
contract and do not enter the monetary ledger. API-key and paid-media calls, and
any dispatch whose billing class is missing or unrecognized, enter that ledger.
Unknown is not treated as a subscription. This module does not open a socket or
read a live quota source; the default probe is an explicit stub.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal, NoReturn, Protocol

from aijian_api.media_budget_policy import BudgetAmount, evaluate_media_budget
from aijian_api.media_budget_store import (
    MediaBudgetConflict,
    MediaBudgetStore,
    MediaDispatchRequest,
    apply_metered_reservation,
)

BillingClass = Literal["subscription", "metered"]
ClassificationSource = Literal[
    "explicit",
    "account_kind",
    "transport_mapping",
    "unknown_as_metered",
    "conflict_as_metered",
]
_SUBSCRIPTION_KINDS = frozenset({"gpt_login", "grok_login", "chatgpt_login"})
_METERED_KINDS = frozenset({"api_key", "paid_media"})
_KNOWN_CLASSES = frozenset({"subscription", "metered"})
_BUDGET_REASONS = {
    "UNCONFIGURED": "请先设置作品预算",
    "UNKNOWN_AMOUNT": "调用金额未知，已阻断",
    "CURRENCY_MISMATCH": "预算币种不一致，已阻断",
    "INCONSISTENT_USAGE": "预算用量不一致，已阻断",
    "PROJECT_LIMIT_EXCEEDED": "超出作品预算，已阻断",
    "EPISODE_LIMIT_EXCEEDED": "超出分集预算，已阻断",
}


class DispatchBillingBlocked(ValueError):
    """The dispatch was refused before a task or a paid call was created."""

    def __init__(self, display_reason: str, *, status: str, billing_class: BillingClass) -> None:
        super().__init__(display_reason)
        self.display_reason = display_reason
        self.status = status
        self.billing_class = billing_class


@dataclass(frozen=True, slots=True)
class BillingClassification:
    billing_class: BillingClass
    account_kind: str | None
    classification_source: ClassificationSource


@dataclass(frozen=True, slots=True)
class SubscriptionAccessSnapshot:
    """Account health from a quota source. None means that fact is not known yet."""

    connected: bool | None = None
    quota_available: bool | None = None
    rate_available: bool | None = None


class SubscriptionAccessProbe(Protocol):
    def probe(
        self,
        connection: sqlite3.Connection,
        *,
        connection_id: str,
        provider_kind: str | None,
        account_kind: str | None,
    ) -> SubscriptionAccessSnapshot:
        """Report connection, quota, and rate. Must not call a provider."""


class NoSourceSubscriptionAccess:
    """No live quota source is wired. Unknown health does not block or invent a zero."""

    def probe(
        self,
        connection: sqlite3.Connection,
        *,
        connection_id: str,
        provider_kind: str | None,
        account_kind: str | None,
    ) -> SubscriptionAccessSnapshot:
        _ = (connection, connection_id, provider_kind, account_kind)
        return SubscriptionAccessSnapshot()


@dataclass(frozen=True, slots=True)
class RemoteDispatchBilling:
    connection_id: str
    endpoint_binding: str
    explicit_class: str | None
    account_kind: str | None
    currency: str | None
    amount_micro: int | None
    episode_id: str | None
    probe: SubscriptionAccessProbe


@dataclass(frozen=True, slots=True)
class BillingAuthorization:
    classification: BillingClassification
    reservation_id: str | None


def budget_display_reason(status: str) -> str:
    return _BUDGET_REASONS.get(status, "预算检查未通过，已阻断")


def classify_dispatch_billing(
    *,
    explicit_class: str | None,
    account_kind: str | None,
    endpoint_binding: str | None,
) -> BillingClassification:
    """Map a dispatch to one billing class. Unrecognized input becomes metered.

    The current text-extract transport is ``CPA_LOOPBACK_V1``. When the caller
    does not name a class or an account, that transport is the existing GPT
    login path. An explicit or unrecognized account kind overrides it. A missing
    class on any other transport is metered, not a subscription.
    """

    explicit = _optional_token(explicit_class, "billing class")
    raw_kind = _optional_token(account_kind, "billing account kind")
    canonical_kind, kind_class = _kind_class(raw_kind)
    if explicit is not None and explicit not in _KNOWN_CLASSES:
        return BillingClassification("metered", canonical_kind, "unknown_as_metered")
    if raw_kind is not None and kind_class is None:
        return BillingClassification("metered", canonical_kind, "unknown_as_metered")
    if explicit is not None and kind_class is not None and explicit != kind_class:
        return BillingClassification("metered", canonical_kind, "conflict_as_metered")
    if kind_class is not None:
        return BillingClassification(kind_class, canonical_kind, "account_kind")
    if explicit == "subscription":
        return BillingClassification("subscription", None, "explicit")
    if explicit == "metered":
        return BillingClassification("metered", None, "explicit")
    if endpoint_binding == "CPA_LOOPBACK_V1":
        return BillingClassification("subscription", "gpt_login", "transport_mapping")
    return BillingClassification("metered", None, "unknown_as_metered")


def authorize_remote_dispatch_billing(
    connection: sqlite3.Connection,
    billing: RemoteDispatchBilling,
    *,
    project_id: str,
    idempotency_key: str,
    now_text: str,
    id_factory: Callable[[str], str],
) -> BillingAuthorization:
    """Admit a subscription login, or reserve metered funds on this connection."""

    classification = classify_dispatch_billing(
        explicit_class=billing.explicit_class,
        account_kind=billing.account_kind,
        endpoint_binding=billing.endpoint_binding,
    )
    if classification.billing_class == "subscription":
        _require_subscription_access(connection, billing, classification.account_kind)
        return BillingAuthorization(classification, None)
    reservation_id = _reserve_metered(
        connection,
        billing,
        project_id=project_id,
        idempotency_key=idempotency_key,
        now_text=now_text,
        id_factory=id_factory,
    )
    return BillingAuthorization(classification, reservation_id)


def reconcile_remote_billing_replay(
    connection: sqlite3.Connection,
    billing: RemoteDispatchBilling,
    *,
    project_id: str,
    attempt_id: str,
    idempotency_key: str,
    created_at: str,
    id_factory: Callable[[str], str],
) -> None:
    """Keep a replay on the original class. A legacy row receives the class once."""

    classification = classify_dispatch_billing(
        explicit_class=billing.explicit_class,
        account_kind=billing.account_kind,
        endpoint_binding=billing.endpoint_binding,
    )
    existing = connection.execute(
        """
        SELECT billing_class, account_kind
        FROM dispatch_billing_records WHERE attempt_id = ?
        """,
        (attempt_id,),
    ).fetchone()
    if existing is None:
        insert_dispatch_billing_record(
            connection,
            record_id=id_factory("dbr"),
            project_id=project_id,
            billing_class=classification.billing_class,
            account_kind=classification.account_kind,
            classification_source=classification.classification_source,
            attempt_id=attempt_id,
            reservation_id=_metered_reservation_id(
                connection,
                project_id=project_id,
                idempotency_key=idempotency_key,
                billing_class=classification.billing_class,
            ),
            created_at=created_at,
        )
        return
    stored_kind = existing["account_kind"]
    if stored_kind is not None and not isinstance(stored_kind, str):
        raise ValueError("stored billing record is invalid")
    if (
        str(existing["billing_class"]) != classification.billing_class
        or stored_kind != classification.account_kind
    ):
        raise ValueError("idempotency key was reused with different billing class")


def insert_dispatch_billing_record(
    connection: sqlite3.Connection,
    *,
    record_id: str,
    project_id: str,
    billing_class: BillingClass,
    account_kind: str | None,
    classification_source: ClassificationSource,
    attempt_id: str | None,
    reservation_id: str | None,
    created_at: str,
    desktop_dispatch_id: str | None = None,
) -> None:
    require_prefixed_id(record_id, "dbr")
    anchors = (
        attempt_id is not None,
        reservation_id is not None,
        desktop_dispatch_id is not None,
    )
    if sum(anchors) != 1:
        raise ValueError(
            "dispatch billing record requires one attempt, reservation, or desktop dispatch"
        )
    if account_kind is not None and not 1 <= len(account_kind) <= 64:
        raise ValueError("billing account kind is invalid")
    connection.execute(
        """
        INSERT INTO dispatch_billing_records (
            record_id, project_id, billing_class, account_kind, classification_source,
            attempt_id, reservation_id, desktop_dispatch_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            record_id,
            project_id,
            billing_class,
            account_kind,
            classification_source,
            attempt_id,
            reservation_id,
            desktop_dispatch_id,
            created_at,
        ),
    )


def ensure_paid_media_billing_record(
    connection: sqlite3.Connection,
    *,
    project_id: str,
    reservation_id: str,
    record_id_factory: Callable[[], str],
    created_at: str,
) -> None:
    existing = connection.execute(
        """
        SELECT billing_class, account_kind
        FROM dispatch_billing_records WHERE reservation_id = ?
        """,
        (reservation_id,),
    ).fetchone()
    if existing is not None:
        if str(existing["billing_class"]) != "metered" or existing["account_kind"] != "paid_media":
            raise ValueError("reservation is already bound to different billing")
        return
    insert_dispatch_billing_record(
        connection,
        record_id=record_id_factory(),
        project_id=project_id,
        billing_class="metered",
        account_kind="paid_media",
        classification_source="account_kind",
        attempt_id=None,
        reservation_id=reservation_id,
        created_at=created_at,
    )


def require_prefixed_id(value: str, prefix: str) -> str:
    suffix = value.removeprefix(f"{prefix}_")
    if (
        len(value) != 36
        or not value.startswith(f"{prefix}_")
        or len(suffix) != 32
        or any(character not in "0123456789abcdef" for character in suffix)
    ):
        raise ValueError(f"{prefix} id is invalid")
    return value


def _reserve_metered(
    connection: sqlite3.Connection,
    billing: RemoteDispatchBilling,
    *,
    project_id: str,
    idempotency_key: str,
    now_text: str,
    id_factory: Callable[[str], str],
) -> str:
    if billing.currency is None or billing.amount_micro is None:
        _block_unknown_metered_amount(connection, billing, project_id=project_id)
    hold = apply_metered_reservation(
        connection,
        MediaDispatchRequest(
            project_id,
            idempotency_key,
            billing.currency,
            billing.amount_micro,
            billing.episode_id,
        ),
        reservation_id_factory=lambda: require_prefixed_id(id_factory("mbr"), "mbr"),
        now_text=now_text,
    )
    if hold.outcome == "BLOCKED":
        status = hold.assessment.status if hold.assessment is not None else "UNCONFIGURED"
        raise DispatchBillingBlocked(
            budget_display_reason(status), status=status, billing_class="metered"
        )
    if hold.outcome == "REPLAYED" or hold.reservation_id is None:
        raise MediaBudgetConflict("idempotency key is already bound to a reservation")
    return hold.reservation_id


def _block_unknown_metered_amount(
    connection: sqlite3.Connection,
    billing: RemoteDispatchBilling,
    *,
    project_id: str,
) -> NoReturn:
    if billing.currency is not None:
        BudgetAmount(billing.currency, 0)
    MediaBudgetStore._require_project(connection, project_id)
    if billing.episode_id is not None:
        MediaBudgetStore._require_episode(connection, project_id, billing.episode_id)
    project_usage, episode_usage = MediaBudgetStore._usages(
        connection, project_id, billing.episode_id
    )
    assessment = evaluate_media_budget(project=project_usage, episode=episode_usage, request=None)
    raise DispatchBillingBlocked(
        budget_display_reason(assessment.status),
        status=assessment.status,
        billing_class="metered",
    )


def _require_subscription_access(
    connection: sqlite3.Connection,
    billing: RemoteDispatchBilling,
    account_kind: str | None,
) -> None:
    provider_kind = _provider_kind(connection, billing.connection_id)
    snapshot = billing.probe.probe(
        connection,
        connection_id=billing.connection_id,
        provider_kind=provider_kind,
        account_kind=account_kind,
    )
    if not isinstance(snapshot, SubscriptionAccessSnapshot):
        raise ValueError("subscription access probe returned an invalid snapshot")
    if snapshot.connected is False:
        raise DispatchBillingBlocked(
            "订阅账号未连接", status="DISCONNECTED", billing_class="subscription"
        )
    if snapshot.quota_available is False:
        raise DispatchBillingBlocked(
            "订阅额度不可用", status="QUOTA_UNAVAILABLE", billing_class="subscription"
        )
    if snapshot.rate_available is False:
        raise DispatchBillingBlocked(
            "订阅调用频率不可用", status="RATE_UNAVAILABLE", billing_class="subscription"
        )


def _provider_kind(connection: sqlite3.Connection, connection_id: str) -> str | None:
    row = connection.execute(
        "SELECT provider_kind FROM provider_connections WHERE connection_id = ?",
        (connection_id,),
    ).fetchone()
    if row is None:
        return None
    kind = row["provider_kind"]
    if not isinstance(kind, str):
        raise ValueError("provider kind is invalid")
    return kind


def _metered_reservation_id(
    connection: sqlite3.Connection,
    *,
    project_id: str,
    idempotency_key: str,
    billing_class: BillingClass,
) -> str | None:
    if billing_class != "metered":
        return None
    row = connection.execute(
        """
        SELECT reservation_id FROM media_budget_reservations
        WHERE project_id = ? AND idempotency_key = ?
        """,
        (project_id, idempotency_key),
    ).fetchone()
    if row is None:
        return None
    return str(row["reservation_id"])


def _kind_class(kind: str | None) -> tuple[str | None, BillingClass | None]:
    if kind is None:
        return None, None
    if kind == "chatgpt_login":
        return "gpt_login", "subscription"
    if kind in _SUBSCRIPTION_KINDS:
        return kind, "subscription"
    if kind in _METERED_KINDS:
        return kind, "metered"
    return kind, None


def _optional_token(value: str | None, label: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or len(value) > 64:
        raise ValueError(f"{label} is invalid")
    if value == "":
        return None
    return value

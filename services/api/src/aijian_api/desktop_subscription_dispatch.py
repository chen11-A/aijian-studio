"""Record a desktop-held subscription login dispatch without seeing its token.

Grok and ChatGPT login calls are executed by the desktop process, which is the
only place the OAuth token is stored. This module writes the billing row first.
It does not open a socket, and it rejects any payload that is not a subscription
login so an API-key call cannot skip the monetary budget gate.
"""

from __future__ import annotations

import re
import sqlite3
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime

from aijian_api.dispatch_billing import (
    DispatchBillingBlocked,
    NoSourceSubscriptionAccess,
    RemoteDispatchBilling,
    SubscriptionAccessProbe,
    SubscriptionAccessSnapshot,
    authorize_remote_dispatch_billing,
    classify_dispatch_billing,
    insert_dispatch_billing_record,
    require_prefixed_id,
)
from aijian_api.repository import StudioRepository
from aijian_api.task_ledger_models import timestamp

_SHA = re.compile(r"^sha256:[0-9a-f]{64}$")
_KEY = re.compile(r"^[A-Za-z0-9_-]{16,80}$")
_MODEL = re.compile(r"^[^\x00-\x1f\x7f]{1,200}$")
_KIND = re.compile(r"^(gpt_login|grok_login|chatgpt_login)$")
_FAILURE = re.compile(r"^[A-Z0-9_]{1,64}$")


class DesktopSubscriptionDispatchError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True, slots=True)
class DesktopSubscriptionDispatch:
    dispatch_id: str
    record_id: str
    project_id: str
    account_kind: str
    billing_class: str
    model_id: str
    request_sha256: str
    outcome: str
    failure_code: str | None
    created: bool


@dataclass(frozen=True, slots=True)
class DesktopSubscriptionRequest:
    project_id: str
    account_kind: str
    model_id: str
    request_sha256: str
    idempotency_key: str
    connected: bool | None = None
    quota_available: bool | None = None
    rate_available: bool | None = None


def record_desktop_subscription_dispatch(
    repository: StudioRepository,
    request: DesktopSubscriptionRequest,
    *,
    now: datetime,
    id_factory: Callable[[str], str] | None = None,
    probe: SubscriptionAccessProbe | None = None,
) -> DesktopSubscriptionDispatch:
    """Insert the billing record before the desktop is allowed to call the provider."""

    _require_shape(request)
    classification = classify_dispatch_billing(
        explicit_class=None,
        account_kind=request.account_kind,
        endpoint_binding=None,
    )
    if classification.billing_class != "subscription" or classification.account_kind is None:
        raise DispatchBillingBlocked(
            "按量调用必须经过预算门，不能记成订阅登录",
            status="METERED_REQUIRES_BUDGET",
            billing_class="metered",
        )
    factory = id_factory or repository._id_factory
    now_text = timestamp(now)
    access = probe if probe is not None else NoSourceSubscriptionAccess()
    connection = repository._open()
    try:
        connection.execute("BEGIN IMMEDIATE")
        if not _project_exists(connection, request.project_id):
            raise DesktopSubscriptionDispatchError("PROJECT_NOT_FOUND", "作品不存在，未记派发")
        existing = _existing(connection, request)
        if existing is not None:
            connection.commit()
            return existing
        billing = authorize_remote_dispatch_billing(
            connection,
            RemoteDispatchBilling(
                connection_id="desktop-subscription",
                endpoint_binding="DESKTOP_SUBSCRIPTION_V1",
                explicit_class=None,
                account_kind=request.account_kind,
                currency=None,
                amount_micro=None,
                episode_id=None,
                probe=_FixedProbe(
                    SubscriptionAccessSnapshot(
                        connected=request.connected,
                        quota_available=request.quota_available,
                        rate_available=request.rate_available,
                    )
                )
                if probe is None
                else access,
            ),
            project_id=request.project_id,
            idempotency_key=request.idempotency_key,
            now_text=now_text,
            id_factory=factory,
        )
        if billing.classification.billing_class != "subscription":
            raise DispatchBillingBlocked(
                "按量调用必须经过预算门，不能记成订阅登录",
                status="METERED_REQUIRES_BUDGET",
                billing_class="metered",
            )
        if billing.reservation_id is not None:
            raise DesktopSubscriptionDispatchError(
                "SUBSCRIPTION_RESERVATION", "订阅登录不应产生货币预留"
            )
        dispatch_id = require_prefixed_id(factory("dsd"), "dsd")
        record_id = require_prefixed_id(factory("dbr"), "dbr")
        account_kind = billing.classification.account_kind
        if account_kind not in {"gpt_login", "grok_login"}:
            raise DesktopSubscriptionDispatchError("ACCOUNT_KIND", "订阅类别无效")
        connection.execute(
            """
            INSERT INTO desktop_subscription_dispatches (
                dispatch_id, project_id, account_kind, model_id, request_sha256,
                idempotency_key, outcome, failure_code, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'RECORDED', NULL, ?)
            """,
            (
                dispatch_id,
                request.project_id,
                account_kind,
                request.model_id,
                request.request_sha256,
                request.idempotency_key,
                now_text,
            ),
        )
        insert_dispatch_billing_record(
            connection,
            record_id=record_id,
            project_id=request.project_id,
            billing_class="subscription",
            account_kind=account_kind,
            classification_source=billing.classification.classification_source,
            attempt_id=None,
            reservation_id=None,
            desktop_dispatch_id=dispatch_id,
            created_at=now_text,
        )
        connection.commit()
        return DesktopSubscriptionDispatch(
            dispatch_id,
            record_id,
            request.project_id,
            account_kind,
            "subscription",
            request.model_id,
            request.request_sha256,
            "RECORDED",
            None,
            True,
        )
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def finish_desktop_subscription_dispatch(
    repository: StudioRepository,
    *,
    project_id: str,
    dispatch_id: str,
    outcome: str,
    failure_code: str | None,
) -> DesktopSubscriptionDispatch:
    """Record the desktop result. The token and the response text are not accepted."""

    require_prefixed_id(dispatch_id, "dsd")
    if outcome not in {"COMPLETED", "FAILED"}:
        raise DesktopSubscriptionDispatchError("OUTCOME", "派发结果无效")
    if outcome == "COMPLETED" and failure_code is not None:
        raise DesktopSubscriptionDispatchError("OUTCOME", "成功的派发不能带失败码")
    if outcome == "FAILED" and (failure_code is None or _FAILURE.fullmatch(failure_code) is None):
        raise DesktopSubscriptionDispatchError("OUTCOME", "失败码无效")
    connection = repository._open()
    try:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute(
            """
            SELECT dispatch.dispatch_id, dispatch.project_id, dispatch.account_kind,
                   dispatch.model_id, dispatch.request_sha256, dispatch.outcome,
                   dispatch.failure_code, billing.record_id
            FROM desktop_subscription_dispatches AS dispatch
            JOIN dispatch_billing_records AS billing
              ON billing.desktop_dispatch_id = dispatch.dispatch_id
            WHERE dispatch.dispatch_id = ? AND dispatch.project_id = ?
            """,
            (dispatch_id, project_id),
        ).fetchone()
        if row is None:
            raise DesktopSubscriptionDispatchError("NOT_FOUND", "没有这条桌面派发")
        current = str(row["outcome"])
        stored_failure = row["failure_code"]
        stored_failure = str(stored_failure) if stored_failure is not None else None
        if current == "RECORDED":
            connection.execute(
                """
                UPDATE desktop_subscription_dispatches
                SET outcome = ?, failure_code = ?
                WHERE dispatch_id = ? AND outcome = 'RECORDED'
                """,
                (outcome, failure_code, dispatch_id),
            )
            current = outcome
            stored_failure = failure_code
        elif current != outcome or stored_failure != failure_code:
            raise DesktopSubscriptionDispatchError("OUTCOME_CONFLICT", "这条派发已经记过另一个结果")
        connection.commit()
        return DesktopSubscriptionDispatch(
            str(row["dispatch_id"]),
            str(row["record_id"]),
            str(row["project_id"]),
            str(row["account_kind"]),
            "subscription",
            str(row["model_id"]),
            str(row["request_sha256"]),
            current,
            stored_failure,
            False,
        )
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


class _FixedProbe:
    def __init__(self, snapshot: SubscriptionAccessSnapshot) -> None:
        self._snapshot = snapshot

    def probe(
        self,
        connection: sqlite3.Connection,
        *,
        connection_id: str,
        provider_kind: str | None,
        account_kind: str | None,
    ) -> SubscriptionAccessSnapshot:
        _ = (connection, connection_id, provider_kind, account_kind)
        return self._snapshot


def _require_shape(request: DesktopSubscriptionRequest) -> None:
    if (
        _KIND.fullmatch(request.account_kind) is None
        or _MODEL.fullmatch(request.model_id) is None
        or _SHA.fullmatch(request.request_sha256) is None
        or _KEY.fullmatch(request.idempotency_key) is None
    ):
        raise DesktopSubscriptionDispatchError("REQUEST_INVALID", "桌面派发请求无效")
    for flag in (request.connected, request.quota_available, request.rate_available):
        if flag is not None and not isinstance(flag, bool):
            raise DesktopSubscriptionDispatchError("REQUEST_INVALID", "桌面派发请求无效")


def _project_exists(connection: sqlite3.Connection, project_id: str) -> bool:
    row = connection.execute("SELECT 1 FROM projects WHERE id = ?", (project_id,)).fetchone()
    return row is not None


def _existing(
    connection: sqlite3.Connection, request: DesktopSubscriptionRequest
) -> DesktopSubscriptionDispatch | None:
    row = connection.execute(
        """
        SELECT dispatch.dispatch_id, dispatch.project_id, dispatch.account_kind,
               dispatch.model_id, dispatch.request_sha256, dispatch.idempotency_key,
               dispatch.outcome, dispatch.failure_code, billing.record_id,
               billing.billing_class
        FROM desktop_subscription_dispatches AS dispatch
        JOIN dispatch_billing_records AS billing
          ON billing.desktop_dispatch_id = dispatch.dispatch_id
        WHERE dispatch.project_id = ? AND dispatch.idempotency_key = ?
        """,
        (request.project_id, request.idempotency_key),
    ).fetchone()
    if row is None:
        return None
    if (
        str(row["model_id"]) != request.model_id
        or str(row["request_sha256"]) != request.request_sha256
        or str(row["account_kind"])
        != classify_dispatch_billing(
            explicit_class=None,
            account_kind=request.account_kind,
            endpoint_binding=None,
        ).account_kind
    ):
        raise DesktopSubscriptionDispatchError(
            "IDEMPOTENCY_CONFLICT", "同一个幂等键不能改派发内容"
        )
    failure = row["failure_code"]
    return DesktopSubscriptionDispatch(
        str(row["dispatch_id"]),
        str(row["record_id"]),
        str(row["project_id"]),
        str(row["account_kind"]),
        str(row["billing_class"]),
        str(row["model_id"]),
        str(row["request_sha256"]),
        str(row["outcome"]),
        str(failure) if failure is not None else None,
        False,
    )

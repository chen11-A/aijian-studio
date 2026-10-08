"""Read-only call reservations and settlement evidence; never dispatch authority."""

from __future__ import annotations

import sqlite3
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from aijian_api.agent_skill_contracts import ArtifactProposalV1, canonical_sha256
from aijian_api.remote_execution_authorization import (
    _read_consumed_snapshot,
    _read_dispatch_snapshot,
)
from aijian_api.remote_settlement_contracts import (
    RemoteSettlementReceiptV1,
    RemoteSettlementVerificationV1,
    RemoteSettlementVerifier,
)


class RemoteCallAccountingError(ValueError):
    """Requested attempt or its authorization belongs to an inconsistent scope."""


class RemoteCallAccountingData(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    attempt_id: str = Field(pattern=r"^att_[0-9a-f]{32}$")
    authorization_id: str | None
    consume_revision: int | None
    calls_reserved: Literal[0, 1]
    reservation_status: Literal["NOT_RESERVED", "RESERVED"]
    transport_dispatch_status: Literal["UNVERIFIED"]
    attempt_status: str
    provider_response_id: str | None
    response_status: Literal[
        "NO_RESPONSE_RECORDED", "RESPONSE_ID_RECORDED", "REMOTE_UNKNOWN"
    ]
    cost_status: Literal["UNKNOWN", "VERIFIED"]
    actual_cost_micros: int | None
    currency: Literal["USD"] | None
    cost_evidence_status: Literal["NO_RECEIPT", "UNVERIFIED", "VERIFIED", "INVALID"]
    automatic_retry_allowed: Literal[False]


def read_call_accounting_in_connection(
    connection: sqlite3.Connection,
    *,
    project_id: str,
    attempt_id: str,
    checked_at: datetime,
    settlement_verifier: RemoteSettlementVerifier | None = None,
) -> RemoteCallAccountingData:
    """Use the caller's transaction and sqlite3.Row factory; execute SELECT only.

    CONSUME reserves one call before transport starts. Neither its presence nor
    its absence establishes whether an external request was sent. Verification
    must obey RemoteSettlementVerifier's pure, bounded, local-only contract.
    """
    if not connection.in_transaction:
        raise RemoteCallAccountingError("caller must begin a read transaction")
    if checked_at.tzinfo is None or checked_at.utcoffset() is None:
        raise RemoteCallAccountingError("checked_at must include a timezone")
    attempt = connection.execute(
        """SELECT attempt.status, attempt.provider_response_id, attempt.execution_mode
           FROM workflow_attempts AS attempt
           JOIN workflow_node_runs AS node ON node.node_run_id = attempt.node_run_id
           JOIN workflow_runs AS workflow ON workflow.workflow_run_id = node.workflow_run_id
           WHERE attempt.attempt_id = ? AND workflow.project_id = ?""",
        (attempt_id, project_id),
    ).fetchone()
    if attempt is None or attempt["execution_mode"] != "remote":
        raise RemoteCallAccountingError("remote attempt is unavailable in this project")
    consumes = connection.execute(
        """SELECT * FROM remote_execution_authorization_snapshots
           WHERE attempt_id = ? AND event_kind = 'CONSUME'""",
        (attempt_id,),
    ).fetchall()
    if len(consumes) > 1:
        raise RemoteCallAccountingError("attempt has multiple authorization consumes")
    consume = consumes[0] if consumes else None
    if consume is not None:
        try:
            snapshot, decision = _read_consumed_snapshot(
                connection, str(consume["authorization_id"])
            )
            grant = snapshot.grant_core
            if (
                grant.project_id != project_id
                or grant.authorization_id != snapshot.authorization_id
                or snapshot.revision != consume["revision"]
                or decision.binding_hash != consume["evidence_binding_hash"]
            ):
                raise ValueError("consume scope mismatch")
            dispatch_row = connection.execute(
                "SELECT project_id FROM remote_dispatch_snapshots WHERE attempt_id = ?",
                (attempt_id,),
            ).fetchone()
            if dispatch_row is None or dispatch_row["project_id"] != project_id:
                raise ValueError("consume dispatch project mismatch")
            dispatch = _read_dispatch_snapshot(
                connection, attempt_id, require_current_provider=False,
                require_current_truth=False,
            )
            if (
                decision.status != "ALLOW" or decision.code != "EVIDENCE_VERIFIED"
                or decision.binding_hash != canonical_sha256(
                    {"grant_core_hash": snapshot.grant_core_hash}
                )
                or grant.input_scope_hash != dispatch.input_scope_hash()
                or grant.operation != "remote.source.extract"
            ):
                raise ValueError("consume evidence or source binding mismatch")
            for name in (
                "connection_id", "connection_revision", "approved_model_id",
                "endpoint_binding", "transport_contract_hash", "dispatch_class",
                "requested_additional_budget_micros", "approved_currency", "policy_version",
            ):
                if getattr(grant, name) != getattr(dispatch, name):
                    raise ValueError("consume dispatch binding mismatch")
            count = connection.execute(
                """SELECT COUNT(*) FROM remote_execution_authorization_snapshots
                   WHERE authorization_id = ? AND event_kind = 'CONSUME'""",
                (snapshot.authorization_id,),
            ).fetchone()[0]
            if count != 1:
                raise ValueError("authorization has multiple consumes")
        except (ValueError, TypeError, KeyError) as error:
            raise RemoteCallAccountingError("authorization consume is inconsistent") from error
    response_id = attempt["provider_response_id"]
    response_status: Literal[
        "NO_RESPONSE_RECORDED", "RESPONSE_ID_RECORDED", "REMOTE_UNKNOWN"
    ] = (
        "REMOTE_UNKNOWN" if attempt["status"] == "REMOTE_UNKNOWN"
        else "RESPONSE_ID_RECORDED" if response_id
        else "NO_RESPONSE_RECORDED"
    )
    evidence_status, actual, currency = _read_cost(
        connection, project_id=project_id, attempt_id=attempt_id,
        consume=consume, response_id=response_id, checked_at=checked_at,
        verifier=settlement_verifier,
    )
    return RemoteCallAccountingData(
        attempt_id=attempt_id,
        authorization_id=str(consume["authorization_id"]) if consume is not None else None,
        consume_revision=int(consume["revision"]) if consume is not None else None,
        calls_reserved=1 if consume is not None else 0,
        reservation_status="RESERVED" if consume is not None else "NOT_RESERVED",
        transport_dispatch_status="UNVERIFIED",
        attempt_status=str(attempt["status"]),
        provider_response_id=response_id,
        response_status=response_status,
        cost_status="VERIFIED" if evidence_status == "VERIFIED" else "UNKNOWN",
        actual_cost_micros=actual,
        currency=currency,
        cost_evidence_status=evidence_status,
        automatic_retry_allowed=False,
    )


def _read_cost(
    connection: sqlite3.Connection,
    *,
    project_id: str,
    attempt_id: str,
    consume: sqlite3.Row | None,
    response_id: str | None,
    checked_at: datetime,
    verifier: RemoteSettlementVerifier | None,
) -> tuple[
    Literal["NO_RECEIPT", "UNVERIFIED", "VERIFIED", "INVALID"],
    int | None,
    Literal["USD"] | None,
]:
    row = connection.execute(
        "SELECT * FROM remote_settlement_receipts WHERE attempt_id = ?", (attempt_id,)
    ).fetchone()
    if row is None:
        return "NO_RECEIPT", None, None
    try:
        if consume is None:
            raise ValueError("receipt has no consume")
        receipt = RemoteSettlementReceiptV1.model_validate_json(row["receipt_json"])
        stored = RemoteSettlementVerificationV1.model_validate_json(row["verification_json"])
        payload = receipt.payload
        receipt_hash = receipt.canonical_hash()
        if (
            row["receipt_hash"] != receipt_hash
            or canonical_sha256(stored.model_dump(mode="json")) != row["verification_hash"]
            or stored.status != "VERIFIED"
            or stored.receipt_hash != receipt_hash
            or stored.checked_at > checked_at
            or payload.settled_at > checked_at
        ):
            raise ValueError("receipt hashes or verification are inconsistent")
        # Check every denormalized receipt field, not only the JSON document.
        for name in (
            "attempt_id", "authorization_id", "consume_revision", "lease_generation",
            "issuer_id", "trust_profile_id", "trust_profile_version", "receipt_id",
            "provider_response_id", "connection_id", "connection_revision", "model_id",
            "operation", "currency", "actual_micros",
        ):
            if row[name] != getattr(payload, name):
                raise ValueError("receipt columns differ from payload")
        if (
            row["settled_at"] != payload.settled_at.isoformat()
            or payload.authorization_id != consume["authorization_id"]
            or payload.consume_revision != consume["revision"]
            or payload.lease_generation != consume["lease_generation"]
            or payload.evidence_binding_hash != consume["evidence_binding_hash"]
            or payload.provider_response_id != response_id
        ):
            raise ValueError("receipt consume or response binding mismatch")
        dispatch_row = connection.execute(
            "SELECT project_id FROM remote_dispatch_snapshots WHERE attempt_id = ?",
            (attempt_id,),
        ).fetchone()
        if dispatch_row is None or dispatch_row["project_id"] != project_id:
            raise ValueError("receipt dispatch project mismatch")
        dispatch = _read_dispatch_snapshot(
            connection, attempt_id, require_current_provider=False, require_current_truth=False
        )
        if (
            payload.connection_id != dispatch.connection_id
            or payload.connection_revision != dispatch.connection_revision
            or payload.model_id != dispatch.approved_model_id
            or payload.input_scope_hash != dispatch.input_scope_hash()
            or payload.currency != dispatch.approved_currency
        ):
            raise ValueError("receipt dispatch scope mismatch")
        proposals = connection.execute(
            """SELECT project_id, proposal_json FROM agent_artifact_proposals
               WHERE producer_attempt_id = ?""", (attempt_id,),
        ).fetchall()
        if len(proposals) != 1 or proposals[0]["project_id"] != project_id:
            raise ValueError("receipt proposal is unavailable")
        proposal = ArtifactProposalV1.model_validate_json(proposals[0]["proposal_json"])
        if (
            proposal.project_id != project_id
            or proposal.cost.actual_micros != payload.actual_micros
            or proposal.cost.currency != payload.currency
        ):
            raise ValueError("receipt proposal cost mismatch")
    except (ValueError, TypeError, KeyError):
        return "INVALID", None, None
    if verifier is None:
        return "UNVERIFIED", None, None
    try:
        current = RemoteSettlementVerificationV1.model_validate(
            verifier.verify(receipt, checked_at=checked_at).model_dump(mode="json")
        )
    except Exception:
        # Verifier failures do not manufacture a zero cost or dispatch permission.
        return "UNVERIFIED", None, None
    if (
        current.status != "VERIFIED" or current.receipt_hash != receipt_hash
        or current.checked_at != checked_at
    ):
        return "UNVERIFIED", None, None
    return "VERIFIED", payload.actual_micros, payload.currency

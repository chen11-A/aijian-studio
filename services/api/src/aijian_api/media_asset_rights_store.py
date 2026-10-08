"""Append-only, version-bound human rights declarations in the workspace DB."""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import unicodedata
from datetime import datetime, timezone
from typing import Literal, cast
from uuid import uuid4

from pydantic import ValidationError

from aijian_api.media_asset_rights_contracts import (
    HumanRightsDecision,
    HumanRightsDecisionInput,
    RightsDecisionAuditData,
    RightsDecisionWriteReceipt,
    _unreadable,
)
from aijian_api.repository import StudioRepository

MAX_RIGHTS_HISTORY = 1000
_PROJECT_ID = re.compile(r"prj_[0-9a-f]{32}\Z")
_ASSET_ID = re.compile(r"asset_[0-9a-f]{32}\Z")
_VERSION_ID = re.compile(r"asv_[0-9a-f]{32}\Z")
_HASH = re.compile(r"[0-9a-f]{64}\Z")


class RightsDecisionError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        super().__init__(message)


def _canonical_hash(payload: dict[str, object]) -> str:
    encoded = json.dumps(
        payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _evidence_payload(basis_text: str, supporting_reference: str | None) -> dict[str, object]:
    # This digest proves the recorded declaration text was not changed. It is
    # not a verification of the underlying license, permission, or ownership.
    return {
        "schema_version": 1,
        "basis_text": basis_text,
        "supporting_reference": supporting_reference,
    }


def _request_payload(
    project_id: str, asset_id: str, version_id: str, expected_revision: int,
    command: HumanRightsDecisionInput, actor_id: str,
) -> dict[str, object]:
    return {
        "schema_version": 1,
        "project_id": project_id,
        "asset_id": asset_id,
        "version_id": version_id,
        "operation_id": command.operation_id,
        "expected_revision": expected_revision,
        "decision": command.decision,
        "actor_type": "human",
        "actor_id": actor_id,
        "basis_text": command.basis_text,
        "supporting_reference": command.supporting_reference,
    }


def _decision_payload(decision: RightsDecisionAuditData) -> dict[str, object]:
    payload = decision.model_dump(mode="python")
    payload.pop("decision_content_hash")
    return payload


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _audit_from_row(row: sqlite3.Row) -> RightsDecisionAuditData:
    try:
        decision = RightsDecisionAuditData(
            schema_version=row["schema_version"],
            decision_id=str(row["id"]),
            project_id=str(row["project_id"]),
            asset_id=str(row["asset_id"]),
            version_id=str(row["version_id"]),
            asset_sha256=str(row["asset_sha256"]),
            revision=row["revision"],
            previous_decision_id=(
                None if row["previous_decision_id"] is None else str(row["previous_decision_id"])
            ),
            operation_id=str(row["operation_id"]),
            request_sha256=str(row["request_sha256"]),
            decision=cast(HumanRightsDecision, str(row["decision"])),
            actor_type=cast(Literal["human"], str(row["actor_type"])),
            actor_id=str(row["actor_id"]),
            basis_text=str(row["basis_text"]),
            supporting_reference=(
                None if row["supporting_reference"] is None else str(row["supporting_reference"])
            ),
            evidence_sha256=str(row["evidence_sha256"]),
            decision_content_hash=str(row["decision_content_hash"]),
            created_at=str(row["created_at"]),
        )
        for value in (
            decision.actor_id, decision.basis_text,
            decision.supporting_reference or "", decision.created_at,
        ):
            value.encode("utf-8", errors="strict")
        return decision
    except (ValidationError, ValueError, TypeError, KeyError, IndexError, UnicodeError):
        raise RightsDecisionError("CORRUPT_HISTORY", "Rights decision history is invalid") from None


def _validated_history(
    connection: sqlite3.Connection, project_id: str, asset_id: str,
    version_id: str, asset_sha256: str,
) -> tuple[RightsDecisionAuditData, ...]:
    head = connection.execute(
        """SELECT revision, decision_id FROM media_asset_rights_heads
           WHERE project_id = ? AND asset_id = ? AND version_id = ?""",
        (project_id, asset_id, version_id),
    ).fetchone()
    rows = connection.execute(
        """SELECT * FROM media_asset_rights_decisions
           WHERE project_id = ? AND asset_id = ? AND version_id = ?
           ORDER BY revision LIMIT ?""",
        (project_id, asset_id, version_id, MAX_RIGHTS_HISTORY + 1),
    ).fetchall()
    if len(rows) > MAX_RIGHTS_HISTORY or (head is None) != (len(rows) == 0):
        raise RightsDecisionError("CORRUPT_HISTORY", "Rights decision history is incomplete")
    if not rows:
        return ()
    if head is None:
        raise RightsDecisionError("CORRUPT_HISTORY", "Rights decision head is missing")
    decisions = tuple(_audit_from_row(row) for row in rows)
    previous_id: str | None = None
    for revision, decision in enumerate(decisions, 1):
        try:
            replay_command = HumanRightsDecisionInput(
                operation_id=decision.operation_id,
                expected_revision=revision - 1,
                decision=decision.decision,
                basis_text=decision.basis_text,
                supporting_reference=decision.supporting_reference,
            )
        except ValidationError:
            raise RightsDecisionError("CORRUPT_HISTORY", "Rights evidence is invalid") from None
        if (
            decision.project_id != project_id
            or decision.asset_id != asset_id
            or decision.version_id != version_id
            or decision.asset_sha256 != asset_sha256
            or decision.revision != revision
            or decision.previous_decision_id != previous_id
            or decision.actor_id != unicodedata.normalize("NFC", decision.actor_id)
            or decision.actor_id != decision.actor_id.strip()
            or any(
                _unreadable(character, allow_layout=False) for character in decision.actor_id
            )
            or replay_command.basis_text != decision.basis_text
            or replay_command.supporting_reference != decision.supporting_reference
            or decision.evidence_sha256 != _canonical_hash(
                _evidence_payload(decision.basis_text, decision.supporting_reference)
            )
            or decision.request_sha256 != _canonical_hash(
                _request_payload(
                    project_id, asset_id, version_id, revision - 1,
                    replay_command,
                    decision.actor_id,
                )
            )
            or decision.decision_content_hash != _canonical_hash(_decision_payload(decision))
        ):
            raise RightsDecisionError("CORRUPT_HISTORY", "Rights decision audit chain is invalid")
        previous_id = decision.decision_id
    if head["revision"] != len(decisions) or str(head["decision_id"]) != previous_id:
        raise RightsDecisionError("CORRUPT_HISTORY", "Rights decision head disagrees with history")
    return decisions


class MediaAssetRightsStore:
    def __init__(self, repository: StudioRepository) -> None:
        self._repository = repository

    def append_human_decision(
        self, project_id: str, asset_id: str, version_id: str,
        command: HumanRightsDecisionInput, *, actor_id: str,
    ) -> RightsDecisionWriteReceipt:
        try:
            command = HumanRightsDecisionInput.model_validate(command.model_dump(mode="python"))
        except (AttributeError, ValidationError, ValueError, TypeError):
            raise RightsDecisionError("INVALID_INPUT", "Rights decision input is invalid") from None
        if (
            _PROJECT_ID.fullmatch(project_id) is None
            or _ASSET_ID.fullmatch(asset_id) is None
            or _VERSION_ID.fullmatch(version_id) is None
        ):
            raise RightsDecisionError("INVALID_ID", "Rights decision target is invalid")
        if not isinstance(actor_id, str):
            raise RightsDecisionError("INVALID_ACTOR", "Human actor identity is invalid")
        normalized_actor = unicodedata.normalize("NFC", actor_id)
        if (
            not 1 <= len(normalized_actor) <= 128
            or normalized_actor != normalized_actor.strip()
            or any(_unreadable(character, allow_layout=False) for character in normalized_actor)
        ):
            raise RightsDecisionError("INVALID_ACTOR", "Human actor identity is invalid")
        request_hash = _canonical_hash(_request_payload(
            project_id, asset_id, version_id, command.expected_revision,
            command, normalized_actor,
        ))
        with self._repository._connection() as connection:
            try:
                connection.execute("BEGIN IMMEDIATE")
                version = connection.execute(
                    """SELECT version.sha256 FROM media_asset_versions AS version
                       JOIN media_assets AS asset
                         ON asset.project_id = version.project_id
                        AND asset.id = version.asset_id
                       WHERE version.project_id = ? AND version.asset_id = ?
                         AND version.id = ? AND asset.deleted_at IS NULL""",
                    (project_id, asset_id, version_id),
                ).fetchone()
                if version is None:
                    raise RightsDecisionError("VERSION_NOT_FOUND", "Media version was not found")
                asset_sha256 = str(version["sha256"])
                if _HASH.fullmatch(asset_sha256) is None:
                    raise RightsDecisionError("CORRUPT_HISTORY", "Media version hash is invalid")
                history = _validated_history(
                    connection, project_id, asset_id, version_id, asset_sha256,
                )
                current_revision = len(history)
                old_operation = next(
                    (item for item in history if item.operation_id == command.operation_id), None,
                )
                if old_operation is not None:
                    if old_operation.request_sha256 != request_hash:
                        raise RightsDecisionError(
                            "OPERATION_CONFLICT", "Rights operation identity has different input",
                        )
                    connection.commit()
                    return RightsDecisionWriteReceipt(
                        decision=old_operation, replayed=True,
                        is_latest=old_operation.revision == current_revision,
                        current_revision=current_revision,
                    )
                if command.expected_revision != current_revision:
                    raise RightsDecisionError(
                        "REVISION_CONFLICT", "Rights decision was based on a stale revision",
                    )
                if current_revision >= MAX_RIGHTS_HISTORY:
                    raise RightsDecisionError("HISTORY_LIMIT", "Rights history limit was reached")
                decision = RightsDecisionAuditData(
                    schema_version=1,
                    decision_id=f"ard_{uuid4().hex}",
                    project_id=project_id,
                    asset_id=asset_id,
                    version_id=version_id,
                    asset_sha256=asset_sha256,
                    revision=current_revision + 1,
                    previous_decision_id=(history[-1].decision_id if history else None),
                    operation_id=command.operation_id,
                    request_sha256=request_hash,
                    decision=command.decision,
                    actor_type="human",
                    actor_id=normalized_actor,
                    basis_text=command.basis_text,
                    supporting_reference=command.supporting_reference,
                    evidence_sha256=_canonical_hash(_evidence_payload(
                        command.basis_text, command.supporting_reference,
                    )),
                    decision_content_hash="0" * 64,
                    created_at=_utc_now(),
                )
                decision = decision.model_copy(update={
                    "decision_content_hash": _canonical_hash(_decision_payload(decision)),
                })
                connection.execute(
                    """INSERT INTO media_asset_rights_decisions (
                           id, schema_version, project_id, asset_id, version_id, asset_sha256,
                           revision, previous_decision_id, operation_id, request_sha256,
                           decision, actor_type, actor_id, basis_text, supporting_reference,
                           evidence_sha256, decision_content_hash, created_at
                       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        decision.decision_id, 1, project_id, asset_id, version_id, asset_sha256,
                        decision.revision, decision.previous_decision_id,
                        decision.operation_id, decision.request_sha256, decision.decision,
                        decision.actor_type, decision.actor_id, decision.basis_text,
                        decision.supporting_reference, decision.evidence_sha256,
                        decision.decision_content_hash, decision.created_at,
                    ),
                )
                if history:
                    updated = connection.execute(
                        """UPDATE media_asset_rights_heads
                           SET revision = ?, decision_id = ?
                           WHERE project_id = ? AND asset_id = ? AND version_id = ?
                             AND revision = ? AND decision_id = ?""",
                        (
                            decision.revision, decision.decision_id, project_id, asset_id,
                            version_id, current_revision, history[-1].decision_id,
                        ),
                    ).rowcount
                    if updated != 1:
                        raise RightsDecisionError("REVISION_CONFLICT", "Rights head changed")
                else:
                    connection.execute(
                        """INSERT INTO media_asset_rights_heads
                           (project_id, asset_id, version_id, revision, decision_id)
                           VALUES (?, ?, ?, 1, ?)""",
                        (project_id, asset_id, version_id, decision.decision_id),
                    )
                connection.commit()
                return RightsDecisionWriteReceipt(
                    decision=decision, replayed=False,
                    is_latest=True, current_revision=decision.revision,
                )
            except sqlite3.IntegrityError:
                connection.rollback()
                raise RightsDecisionError(
                    "REVISION_CONFLICT", "Rights decision transaction conflicted",
                ) from None
            except sqlite3.OperationalError:
                connection.rollback()
                raise RightsDecisionError(
                    "WRITE_UNKNOWN", "Rights decision persistence could not be confirmed",
                ) from None
            except BaseException:
                connection.rollback()
                raise

    def get_operation_receipt(
        self, project_id: str, asset_id: str, version_id: str, operation_id: str,
    ) -> RightsDecisionWriteReceipt:
        if (
            _PROJECT_ID.fullmatch(project_id) is None
            or _ASSET_ID.fullmatch(asset_id) is None
            or _VERSION_ID.fullmatch(version_id) is None
            or re.fullmatch(r"rdop_[0-9a-f]{32}", operation_id) is None
        ):
            raise RightsDecisionError("INVALID_ID", "Rights operation identity is invalid")
        history = self.audit_history(project_id, asset_id, version_id)
        decision = next((item for item in history if item.operation_id == operation_id), None)
        if decision is None:
            raise RightsDecisionError("OPERATION_NOT_FOUND", "Rights operation was not found")
        current_revision = len(history)
        return RightsDecisionWriteReceipt(
            decision=decision, replayed=True,
            is_latest=decision.revision == current_revision,
            current_revision=current_revision,
        )

    def audit_history(
        self, project_id: str, asset_id: str, version_id: str,
    ) -> tuple[RightsDecisionAuditData, ...]:
        if (
            _PROJECT_ID.fullmatch(project_id) is None
            or _ASSET_ID.fullmatch(asset_id) is None
            or _VERSION_ID.fullmatch(version_id) is None
        ):
            raise RightsDecisionError("INVALID_ID", "Rights decision target is invalid")
        with self._repository._connection() as connection:
            connection.execute("PRAGMA query_only = ON")
            connection.execute("BEGIN")
            version = connection.execute(
                """SELECT version.sha256 FROM media_asset_versions AS version
                   JOIN media_assets AS asset
                     ON asset.project_id = version.project_id AND asset.id = version.asset_id
                   WHERE version.project_id = ? AND version.asset_id = ?
                     AND version.id = ? AND asset.deleted_at IS NULL""",
                (project_id, asset_id, version_id),
            ).fetchone()
            if version is None:
                raise RightsDecisionError("VERSION_NOT_FOUND", "Media version was not found")
            history = _validated_history(
                connection, project_id, asset_id, version_id, str(version["sha256"]),
            )
            connection.commit()
            return history

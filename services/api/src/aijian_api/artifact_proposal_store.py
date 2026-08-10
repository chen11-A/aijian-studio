"""Immutable, lease-fenced storage for Agent-produced Artifact proposals."""

import json
import re
import sqlite3
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from pydantic import ValidationError

from aijian_api.agent_skill_contracts import ArtifactProposalV1, canonical_sha256
from aijian_api.repository import StudioRepository
from aijian_api.task_ledger_models import ClaimedTask, timestamp, utc_now
from aijian_api.task_ledger_snapshots import (
    assert_attempt_snapshot_templates_match,
    canonical_snapshot_json,
    read_agent_skill_snapshot,
)

_SENSITIVE_PROPOSAL_KEY_SUFFIXES = (
    "apikey",
    "accesstoken",
    "refreshtoken",
    "privatekey",
    "signingkey",
    "password",
    "passwd",
    "secret",
    "cookie",
    "authorization",
    "credential",
    "credentials",
    "bearer",
    "auth",
    "token",
)
_NON_ALPHANUMERIC = re.compile(r"[^a-z0-9]+")


class ArtifactProposalConflictError(ValueError):
    """A proposal conflicts with its frozen attempt or immutable persisted row."""


@dataclass(frozen=True, slots=True)
class PersistedArtifactProposal:
    proposal: ArtifactProposalV1
    producer_attempt_id: str
    proposal_hash: str
    created_at: str


class ArtifactProposalStore:
    def __init__(
        self,
        database_path: Path,
        *,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._database_path = database_path
        self._clock = clock
        StudioRepository(database_path)

    def _open(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self._database_path, timeout=5, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 5000")
        return connection

    def persist(
        self,
        claim: ClaimedTask,
        proposal: ArtifactProposalV1,
    ) -> PersistedArtifactProposal:
        proposal = ArtifactProposalV1.model_validate(proposal.model_dump(mode="json"))
        proposal_payload = proposal.model_dump(mode="json")
        try:
            _reject_sensitive_proposal_fields(proposal.payload)
        except ValueError as error:
            raise ArtifactProposalConflictError(
                "proposal contains a sensitive persisted field"
            ) from error
        proposal_json = canonical_snapshot_json(proposal_payload)
        proposal_hash = canonical_sha256(proposal_payload)
        connection = self._open()
        try:
            connection.execute("BEGIN IMMEDIATE")
            now_text = timestamp(self._clock())
            snapshot = read_agent_skill_snapshot(connection, claim, now_text=now_text)
            if (
                proposal.project_id != snapshot.project_id
                or proposal.producer_agent_run_id != snapshot.agent_run_id
                or proposal.producer_skill_run_id != snapshot.skill_run_id
                or proposal.target_artifact_type != snapshot.output_artifact_type
            ):
                raise ArtifactProposalConflictError(
                    "proposal does not match the frozen attempt snapshot"
                )
            existing = connection.execute(
                """
                SELECT * FROM agent_artifact_proposals
                WHERE proposal_id = ? OR producer_attempt_id = ?
                   OR (project_id = ? AND producer_skill_run_id = ?)
                LIMIT 1
                """,
                (
                    proposal.proposal_id,
                    claim.attempt_id,
                    proposal.project_id,
                    proposal.producer_skill_run_id,
                ),
            ).fetchone()
            if existing is not None:
                persisted = decode_persisted_proposal_row(existing)
                assert_attempt_snapshot_templates_match(
                    connection,
                    persisted.producer_attempt_id,
                    claim.attempt_id,
                )
                if (
                    persisted.proposal != proposal
                    or persisted.proposal_hash != proposal_hash
                ):
                    raise ArtifactProposalConflictError(
                        "proposal identity was reused with different content"
                    )
                connection.commit()
                return persisted
            connection.execute(
                """
                INSERT INTO agent_artifact_proposals (
                    proposal_id, project_id, producer_attempt_id,
                    producer_agent_run_id, producer_skill_run_id,
                    target_artifact_type, proposal_json, proposal_hash, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    proposal.proposal_id,
                    proposal.project_id,
                    claim.attempt_id,
                    proposal.producer_agent_run_id,
                    proposal.producer_skill_run_id,
                    proposal.target_artifact_type,
                    proposal_json,
                    proposal_hash,
                    now_text,
                ),
            )
            row = connection.execute(
                "SELECT * FROM agent_artifact_proposals WHERE proposal_id = ?",
                (proposal.proposal_id,),
            ).fetchone()
            if row is None:
                raise RuntimeError("persisted proposal could not be read back")
            connection.commit()
            return decode_persisted_proposal_row(row)
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def get(self, project_id: str, proposal_id: str) -> PersistedArtifactProposal:
        connection = self._open()
        try:
            row = connection.execute(
                "SELECT * FROM agent_artifact_proposals WHERE project_id = ? AND proposal_id = ?",
                (project_id, proposal_id),
            ).fetchone()
        finally:
            connection.close()
        if row is None:
            raise LookupError("artifact proposal not found")
        return decode_persisted_proposal_row(row)


def decode_persisted_proposal_row(row: sqlite3.Row) -> PersistedArtifactProposal:
    try:
        proposal_json = str(row["proposal_json"])
        payload = json.loads(proposal_json)
        if not isinstance(payload, dict) or canonical_snapshot_json(payload) != proposal_json:
            raise ValueError("proposal JSON is not canonical")
        proposal = ArtifactProposalV1.model_validate(payload)
        _reject_sensitive_proposal_fields(proposal.payload)
        proposal_hash = str(row["proposal_hash"])
        if proposal_hash != canonical_sha256(payload):
            raise ValueError("proposal hash mismatch")
        if (
            proposal.proposal_id != str(row["proposal_id"])
            or proposal.project_id != str(row["project_id"])
            or proposal.producer_agent_run_id != str(row["producer_agent_run_id"])
            or proposal.producer_skill_run_id != str(row["producer_skill_run_id"])
            or proposal.target_artifact_type != str(row["target_artifact_type"])
        ):
            raise ValueError("proposal columns do not match the closed contract")
    except (json.JSONDecodeError, ValidationError, ValueError) as error:
        raise ArtifactProposalConflictError(
            "persisted proposal failed integrity validation"
        ) from error
    return PersistedArtifactProposal(
        proposal=proposal,
        producer_attempt_id=str(row["producer_attempt_id"]),
        proposal_hash=proposal_hash,
        created_at=str(row["created_at"]),
    )


def _reject_sensitive_proposal_fields(value: object) -> None:
    if isinstance(value, Mapping):
        for key, child in value.items():
            compact = _NON_ALPHANUMERIC.sub("", str(key).strip().lower())
            if any(compact.endswith(suffix) for suffix in _SENSITIVE_PROPOSAL_KEY_SUFFIXES):
                raise ValueError("proposal payload contains a sensitive field")
            _reject_sensitive_proposal_fields(child)
    elif isinstance(value, (list, tuple)):
        for child in value:
            _reject_sensitive_proposal_fields(child)

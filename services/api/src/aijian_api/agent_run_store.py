"""Atomic persistence for AgentRun, SkillRun and immutable ContextManifest truth."""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from pydantic import ValidationError

from aijian_api.agent_context_builder import BuiltContext, validate_built_context
from aijian_api.agent_skill_contracts import (
    AgentRunV1,
    ContextManifestV1,
    DefinitionRefV1,
    SkillRunV1,
    canonical_sha256,
)
from aijian_api.agent_skill_registry import ResolvedDelegation
from aijian_api.application_errors import ProposalRunNotFoundError
from aijian_api.repository import StudioRepository
from aijian_api.task_ledger_models import parse_datetime, timestamp, utc_now

type TransactionHook = Callable[[str], None]


class AgentRunBundleConflictError(ValueError):
    """A run bundle is inconsistent or reuses an immutable identity."""


@dataclass(frozen=True, slots=True)
class PersistedAgentRunBundle:
    agent_run: AgentRunV1
    skill_run: SkillRunV1
    context_manifest: ContextManifestV1
    agent_revision: int
    skill_revision: int
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class PersistedProposalRunEnqueueIntent:
    project_id: str
    agent_run_id: str
    request_hash: str
    payload: dict[str, object]
    intent_hash: str
    created_at: datetime


@dataclass(frozen=True, slots=True)
class PersistedAgentRunWrite:
    bundle: PersistedAgentRunBundle
    enqueue_intent: PersistedProposalRunEnqueueIntent | None
    created: bool


def _canonical_json(value: object) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
        sort_keys=True,
    )


class AgentRunStore:
    def __init__(
        self,
        database_path: Path,
        *,
        clock: Callable[[], datetime] = utc_now,
        transaction_hook: TransactionHook | None = None,
    ) -> None:
        self._database_path = database_path
        self._clock = clock
        self._transaction_hook = transaction_hook
        StudioRepository(database_path)

    def _open(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self._database_path, timeout=5, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 5000")
        return connection

    def persist_pending_bundle(
        self,
        *,
        agent_run: AgentRunV1,
        skill_run: SkillRunV1,
        built_context: BuiltContext,
        delegation: ResolvedDelegation,
    ) -> PersistedAgentRunBundle:
        return self._persist_pending_bundle(
            agent_run=agent_run,
            skill_run=skill_run,
            built_context=built_context,
            delegation=delegation,
            enqueue_intent=None,
        ).bundle

    def persist_pending_bundle_with_intent(
        self,
        *,
        agent_run: AgentRunV1,
        skill_run: SkillRunV1,
        built_context: BuiltContext,
        delegation: ResolvedDelegation,
        request_hash: str,
        intent_payload: Mapping[str, object],
    ) -> PersistedAgentRunWrite:
        if not _is_content_hash(request_hash):
            raise AgentRunBundleConflictError("request hash must be canonical SHA-256")
        return self._persist_pending_bundle(
            agent_run=agent_run,
            skill_run=skill_run,
            built_context=built_context,
            delegation=delegation,
            enqueue_intent=(request_hash, dict(intent_payload)),
        )

    def _persist_pending_bundle(
        self,
        *,
        agent_run: AgentRunV1,
        skill_run: SkillRunV1,
        built_context: BuiltContext,
        delegation: ResolvedDelegation,
        enqueue_intent: tuple[str, dict[str, object]] | None,
    ) -> PersistedAgentRunWrite:
        validate_built_context(built_context, delegation=delegation)
        context_manifest = built_context.manifest
        agent_run, skill_run, context_manifest = _validate_pending_bundle(
            agent_run,
            skill_run,
            context_manifest,
            delegation,
        )
        connection = self._open()
        try:
            connection.execute("BEGIN IMMEDIATE")
            existing = _read_bundle(connection, agent_run.project_id, agent_run.agent_run_id)
            collisions = connection.execute(
                """
                SELECT
                    EXISTS(SELECT 1 FROM skill_runs WHERE skill_run_id = ?) AS skill_exists,
                    EXISTS(SELECT 1 FROM agent_context_manifests
                           WHERE context_manifest_id = ?) AS context_exists
                """,
                (skill_run.skill_run_id, context_manifest.context_manifest_id),
            ).fetchone()
            if (
                existing is not None
                or bool(collisions["skill_exists"])
                or bool(collisions["context_exists"])
            ):
                if existing is None or not _same_bundle_identity(
                    existing,
                    agent_run,
                    skill_run,
                    context_manifest,
                ):
                    raise AgentRunBundleConflictError(
                        "run bundle reused an immutable identity with different content"
                    )
                persisted_intent = _read_enqueue_intent(
                    connection,
                    agent_run.project_id,
                    agent_run.agent_run_id,
                )
                if enqueue_intent is not None and (
                    persisted_intent is None
                    or not _same_enqueue_intent(
                        persisted_intent,
                        request_hash=enqueue_intent[0],
                        payload=enqueue_intent[1],
                    )
                ):
                    raise AgentRunBundleConflictError(
                        "run bundle reused an immutable enqueue intent with different input"
                    )
                connection.commit()
                return PersistedAgentRunWrite(existing, persisted_intent, created=False)
            now_text = timestamp(self._clock())
            connection.execute(
                """
                INSERT INTO agent_context_manifests (
                    context_manifest_id, project_id,
                    agent_definition_id, agent_definition_version,
                    skill_definition_id, skill_definition_version,
                    manifest_json, manifest_hash, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    context_manifest.context_manifest_id,
                    context_manifest.project_id,
                    context_manifest.agent_definition.definition_id,
                    context_manifest.agent_definition.version,
                    context_manifest.skill_definition.definition_id,
                    context_manifest.skill_definition.version,
                    _canonical_json(context_manifest.model_dump(mode="json")),
                    context_manifest.manifest_hash,
                    now_text,
                ),
            )
            if self._transaction_hook is not None:
                self._transaction_hook("context_persisted")
            connection.execute(
                """
                INSERT INTO agent_runs (
                    agent_run_id, project_id, agent_definition_id,
                    agent_definition_version, status, delegated_skill_run_ids_json,
                    revision, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
                """,
                (
                    agent_run.agent_run_id,
                    agent_run.project_id,
                    agent_run.agent_definition.definition_id,
                    agent_run.agent_definition.version,
                    agent_run.status,
                    _canonical_json(list(agent_run.delegated_skill_run_ids)),
                    now_text,
                    now_text,
                ),
            )
            connection.execute(
                """
                INSERT INTO skill_runs (
                    skill_run_id, project_id, agent_run_id, skill_definition_id,
                    skill_definition_version, context_manifest_id, status,
                    proposal_id, revision, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
                """,
                (
                    skill_run.skill_run_id,
                    skill_run.project_id,
                    skill_run.agent_run_id,
                    skill_run.skill_definition.definition_id,
                    skill_run.skill_definition.version,
                    skill_run.context_manifest_id,
                    skill_run.status,
                    skill_run.proposal_id,
                    now_text,
                    now_text,
                ),
            )
            if enqueue_intent is not None:
                request_hash, intent_payload = enqueue_intent
                intent_json = _canonical_json(intent_payload)
                intent_hash = canonical_sha256(intent_payload)
                connection.execute(
                    """
                    INSERT INTO proposal_run_enqueue_intents (
                        agent_run_id, project_id, request_hash,
                        intent_json, intent_hash, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        agent_run.agent_run_id,
                        agent_run.project_id,
                        request_hash,
                        intent_json,
                        intent_hash,
                        now_text,
                    ),
                )
            persisted = _read_bundle(connection, agent_run.project_id, agent_run.agent_run_id)
            if persisted is None:
                raise RuntimeError("persisted Agent run bundle could not be read back")
            persisted_intent = _read_enqueue_intent(
                connection,
                agent_run.project_id,
                agent_run.agent_run_id,
            )
            if enqueue_intent is not None and persisted_intent is None:
                raise RuntimeError("persisted Agent run enqueue intent could not be read back")
            connection.commit()
            return PersistedAgentRunWrite(persisted, persisted_intent, created=True)
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def get(self, project_id: str, agent_run_id: str) -> PersistedAgentRunBundle:
        connection = self._open()
        try:
            persisted = _read_bundle(connection, project_id, agent_run_id)
        finally:
            connection.close()
        if persisted is None:
            raise ProposalRunNotFoundError("Agent run bundle not found")
        return persisted

    def get_with_intent(self, project_id: str, agent_run_id: str) -> PersistedAgentRunWrite:
        connection = self._open()
        try:
            persisted = _read_bundle(connection, project_id, agent_run_id)
            intent = _read_enqueue_intent(connection, project_id, agent_run_id)
        finally:
            connection.close()
        if persisted is None:
            raise ProposalRunNotFoundError("Agent run bundle not found")
        if intent is None:
            raise AgentRunBundleConflictError("Agent run has no immutable enqueue intent")
        return PersistedAgentRunWrite(persisted, intent, created=False)


def _is_content_hash(value: str) -> bool:
    return (
        len(value) == 71
        and value.startswith("sha256:")
        and all(character in "0123456789abcdef" for character in value.removeprefix("sha256:"))
    )


def _read_enqueue_intent(
    connection: sqlite3.Connection,
    project_id: str,
    agent_run_id: str,
) -> PersistedProposalRunEnqueueIntent | None:
    row = connection.execute(
        """
        SELECT * FROM proposal_run_enqueue_intents
        WHERE project_id = ? AND agent_run_id = ?
        """,
        (project_id, agent_run_id),
    ).fetchone()
    if row is None:
        return None
    try:
        intent_json = str(row["intent_json"])
        payload = json.loads(intent_json)
        if not isinstance(payload, dict) or _canonical_json(payload) != intent_json:
            raise ValueError("enqueue intent JSON is not canonical")
        request_hash = str(row["request_hash"])
        intent_hash = str(row["intent_hash"])
        if (
            not _is_content_hash(request_hash)
            or intent_hash != canonical_sha256(payload)
            or str(row["project_id"]) != project_id
            or str(row["agent_run_id"]) != agent_run_id
        ):
            raise ValueError("enqueue intent identity or hash drifted")
    except (json.JSONDecodeError, TypeError, ValueError) as error:
        raise AgentRunBundleConflictError("persisted enqueue intent failed validation") from error
    return PersistedProposalRunEnqueueIntent(
        project_id=project_id,
        agent_run_id=agent_run_id,
        request_hash=request_hash,
        payload=payload,
        intent_hash=intent_hash,
        created_at=parse_datetime(str(row["created_at"])),
    )


def _same_enqueue_intent(
    persisted: PersistedProposalRunEnqueueIntent,
    *,
    request_hash: str,
    payload: Mapping[str, object],
) -> bool:
    return (
        persisted.request_hash == request_hash
        and persisted.intent_hash == canonical_sha256(payload)
        and persisted.payload == dict(payload)
    )


def _validate_pending_bundle(
    agent_run: AgentRunV1,
    skill_run: SkillRunV1,
    context_manifest: ContextManifestV1,
    delegation: ResolvedDelegation,
) -> tuple[AgentRunV1, SkillRunV1, ContextManifestV1]:
    delegation.assert_registry_resolved()
    agent_run = AgentRunV1.model_validate(agent_run.model_dump(mode="json"))
    skill_run = SkillRunV1.model_validate(skill_run.model_dump(mode="json"))
    context_manifest = ContextManifestV1.model_validate(context_manifest.model_dump(mode="json"))
    agent_ref = DefinitionRefV1(
        definition_id=delegation.agent_definition.agent_definition_id,
        version=delegation.agent_definition.version,
    )
    skill_ref = DefinitionRefV1(
        definition_id=delegation.skill_definition.skill_definition_id,
        version=delegation.skill_definition.version,
    )
    if (
        agent_run.status != "PENDING"
        or skill_run.status != "PENDING"
        or skill_run.proposal_id is not None
    ):
        raise AgentRunBundleConflictError("new Agent run bundle must be pending")
    if (
        len({agent_run.project_id, skill_run.project_id, context_manifest.project_id}) != 1
        or skill_run.agent_run_id != agent_run.agent_run_id
        or agent_run.delegated_skill_run_ids != (skill_run.skill_run_id,)
        or skill_run.context_manifest_id != context_manifest.context_manifest_id
    ):
        raise AgentRunBundleConflictError("Agent run bundle project or run chain is inconsistent")
    if (
        agent_run.agent_definition != agent_ref
        or context_manifest.agent_definition != agent_ref
        or skill_run.skill_definition != skill_ref
        or context_manifest.skill_definition != skill_ref
    ):
        raise AgentRunBundleConflictError("Agent run bundle definition resolution drifted")
    return agent_run, skill_run, context_manifest


def _read_bundle(
    connection: sqlite3.Connection,
    project_id: str,
    agent_run_id: str,
) -> PersistedAgentRunBundle | None:
    row = connection.execute(
        """
        SELECT agent.*, skill.skill_run_id,
               skill.project_id AS skill_project_id,
               skill.skill_definition_id,
               skill.skill_definition_version, skill.context_manifest_id,
               skill.status AS skill_status, skill.proposal_id,
               skill.revision AS skill_revision,
               context.project_id AS context_project_id,
               context.agent_definition_id AS context_agent_definition_id,
               context.agent_definition_version AS context_agent_definition_version,
               context.skill_definition_id AS context_skill_definition_id,
               context.skill_definition_version AS context_skill_definition_version,
               context.manifest_json, context.manifest_hash,
               context.created_at AS context_created_at
        FROM agent_runs AS agent
        JOIN skill_runs AS skill ON skill.agent_run_id = agent.agent_run_id
        JOIN agent_context_manifests AS context
          ON context.context_manifest_id = skill.context_manifest_id
        WHERE agent.project_id = ? AND agent.agent_run_id = ?
        """,
        (project_id, agent_run_id),
    ).fetchone()
    if row is None:
        return None
    try:
        delegated_json = str(row["delegated_skill_run_ids_json"])
        delegated = json.loads(delegated_json)
        if _canonical_json(delegated) != delegated_json:
            raise ValueError("delegated Skill run identifiers are not canonical")
        manifest_json = str(row["manifest_json"])
        manifest_payload = json.loads(manifest_json)
        if _canonical_json(manifest_payload) != manifest_json:
            raise ValueError("ContextManifest JSON is not canonical")
        context_manifest = ContextManifestV1.model_validate(manifest_payload)
        if (
            context_manifest.context_manifest_id != str(row["context_manifest_id"])
            or context_manifest.project_id != str(row["context_project_id"])
            or context_manifest.project_id != str(row["project_id"])
            or str(row["skill_project_id"]) != str(row["project_id"])
            or context_manifest.agent_definition.definition_id
            != str(row["context_agent_definition_id"])
            or context_manifest.agent_definition.version
            != str(row["context_agent_definition_version"])
            or context_manifest.skill_definition.definition_id
            != str(row["context_skill_definition_id"])
            or context_manifest.skill_definition.version
            != str(row["context_skill_definition_version"])
            or context_manifest.agent_definition.definition_id != str(row["agent_definition_id"])
            or context_manifest.agent_definition.version != str(row["agent_definition_version"])
            or context_manifest.skill_definition.definition_id != str(row["skill_definition_id"])
            or context_manifest.skill_definition.version != str(row["skill_definition_version"])
            or context_manifest.manifest_hash != str(row["manifest_hash"])
        ):
            raise ValueError("persisted Agent run chain identity drifted")
        agent_run = AgentRunV1(
            agent_run_id=str(row["agent_run_id"]),
            project_id=str(row["skill_project_id"]),
            agent_definition=DefinitionRefV1(
                definition_id=str(row["agent_definition_id"]),
                version=str(row["agent_definition_version"]),
            ),
            status=str(row["status"]),  # type: ignore[arg-type]
            delegated_skill_run_ids=tuple(delegated),
        )
        skill_run = SkillRunV1(
            skill_run_id=str(row["skill_run_id"]),
            project_id=str(row["project_id"]),
            agent_run_id=str(row["agent_run_id"]),
            skill_definition=DefinitionRefV1(
                definition_id=str(row["skill_definition_id"]),
                version=str(row["skill_definition_version"]),
            ),
            context_manifest_id=str(row["context_manifest_id"]),
            status=str(row["skill_status"]),  # type: ignore[arg-type]
            proposal_id=row["proposal_id"],
        )
    except (json.JSONDecodeError, ValidationError, ValueError, TypeError) as error:
        raise AgentRunBundleConflictError("persisted Agent run bundle failed validation") from error
    return PersistedAgentRunBundle(
        agent_run=agent_run,
        skill_run=skill_run,
        context_manifest=context_manifest,
        agent_revision=int(row["revision"]),
        skill_revision=int(row["skill_revision"]),
        created_at=parse_datetime(str(row["created_at"])),
        updated_at=parse_datetime(str(row["updated_at"])),
    )


def _same_bundle_identity(
    persisted: PersistedAgentRunBundle,
    agent_run: AgentRunV1,
    skill_run: SkillRunV1,
    context_manifest: ContextManifestV1,
) -> bool:
    return (
        persisted.agent_run.agent_run_id == agent_run.agent_run_id
        and persisted.agent_run.project_id == agent_run.project_id
        and persisted.agent_run.agent_definition == agent_run.agent_definition
        and persisted.agent_run.delegated_skill_run_ids == agent_run.delegated_skill_run_ids
        and persisted.skill_run.skill_run_id == skill_run.skill_run_id
        and persisted.skill_run.project_id == skill_run.project_id
        and persisted.skill_run.agent_run_id == skill_run.agent_run_id
        and persisted.skill_run.skill_definition == skill_run.skill_definition
        and persisted.skill_run.context_manifest_id == skill_run.context_manifest_id
        and persisted.context_manifest == context_manifest
    )

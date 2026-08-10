"""Atomic persistence for AgentRun, SkillRun and immutable ContextManifest truth."""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Callable
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
                connection.commit()
                return existing
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
            persisted = _read_bundle(connection, agent_run.project_id, agent_run.agent_run_id)
            if persisted is None:
                raise RuntimeError("persisted Agent run bundle could not be read back")
            connection.commit()
            return persisted
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

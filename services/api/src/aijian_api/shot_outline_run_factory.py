"""Controlled creation of the provider-free ShotOutline proposal workflow."""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from aijian_api.agent_context_builder import (
    ContextFragment,
    _mint_resolved_context_inputs,
    build_context,
)
from aijian_api.agent_run_store import (
    AgentRunBundleConflictError,
    AgentRunStore,
    PersistedAgentRunBundle,
    PersistedProposalRunEnqueueIntent,
)
from aijian_api.agent_skill_builtins import SHOT_OUTLINE_REF, SHOT_PLANNER_REF
from aijian_api.agent_skill_contracts import (
    AGENT_RUN_ID_PATTERN,
    CONTENT_HASH_PATTERN,
    CONTEXT_ID_PATTERN,
    PROJECT_ID_PATTERN,
    SKILL_RUN_ID_PATTERN,
    AgentRunV1,
    AttemptSnapshotV1,
    SkillRunV1,
    canonical_sha256,
)
from aijian_api.agent_skill_registry import AgentSkillRegistry
from aijian_api.application_errors import (
    IdempotencyKeyReusedError,
    ProposalRunInputRejectedError,
    ProposalRunNotFoundError,
)
from aijian_api.contracts import CreateProposalRunRequest
from aijian_api.repository import StudioRepository
from aijian_api.shot_outline_contracts import ShotOutlinePayloadV1
from aijian_api.source_extract_run_factory import resolve_source_extract_context
from aijian_api.task_ledger import LocalTaskLedger, QueuedTask

_WORKFLOW_DEFINITION_ID: Literal["agent-skill-shot-outline-fake-runtime"] = (
    "agent-skill-shot-outline-fake-runtime"
)
_WORKFLOW_GRAPH: dict[str, object] = {"nodes": ["shot.outline"], "runtime": "local-fake-v1"}
_WORKFLOW_DEFINITION_HASH = canonical_sha256(_WORKFLOW_GRAPH)
_CAPABILITY_HASH = canonical_sha256(
    {
        "provider_connection_id": "provider:local-fake",
        "model_id": "deterministic-fake-v1",
        "capabilities": ["LOCAL_FAKE_TEXT"],
    }
)


@dataclass(frozen=True, slots=True)
class CreatedShotOutlineRun:
    persisted: PersistedAgentRunBundle
    task: QueuedTask
    attempt: AttemptSnapshotV1
    replayed: bool


class ShotOutlineEnqueueIntentV1(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal["1.0.0"] = "1.0.0"
    project_id: str = Field(pattern=PROJECT_ID_PATTERN)
    agent_run_id: str = Field(pattern=AGENT_RUN_ID_PATTERN)
    skill_run_id: str = Field(pattern=SKILL_RUN_ID_PATTERN)
    context_manifest_id: str = Field(pattern=CONTEXT_ID_PATTERN)
    definition_id: Literal["agent-skill-shot-outline-fake-runtime"]
    definition_version: Literal[1]
    definition_hash: str = Field(pattern=CONTENT_HASH_PATTERN)
    graph: dict[str, object]
    workflow_input_hash: str = Field(pattern=CONTENT_HASH_PATTERN)
    node_key: Literal["shot.outline"]
    node_type: Literal["agent.skill.fake"]
    contract_version: Literal[1]
    input_bindings: dict[str, object]
    node_input_hash: str = Field(pattern=CONTENT_HASH_PATTERN)
    request_fingerprint: str = Field(pattern=CONTENT_HASH_PATTERN)
    execution_idempotency_key: str = Field(min_length=1, max_length=240)
    max_attempts: int = Field(strict=True, ge=1, le=2)
    task_kind: Literal["local.agent-skill.fake"]
    priority: int = Field(strict=True, ge=0, le=100)
    attempt_snapshot: dict[str, object]


def _stable_id(prefix: str, value: object) -> str:
    return f"{prefix}_{canonical_sha256(value).removeprefix('sha256:')[:32]}"


def _enqueue_from_intent(
    repository: StudioRepository,
    record: PersistedProposalRunEnqueueIntent,
    *,
    clock: Callable[[], datetime] | None,
) -> tuple[QueuedTask, AttemptSnapshotV1]:
    intent = ShotOutlineEnqueueIntentV1.model_validate(record.payload)
    if intent.project_id != record.project_id or intent.agent_run_id != record.agent_run_id:
        raise AgentRunBundleConflictError("enqueue intent is detached from Agent run truth")
    ledger = (
        LocalTaskLedger(repository.database_path, clock=clock)
        if clock
        else LocalTaskLedger(repository.database_path)
    )
    try:
        queued = ledger.enqueue_local_node(
            project_id=intent.project_id,
            definition_id=intent.definition_id,
            definition_version=intent.definition_version,
            definition_hash=intent.definition_hash,
            graph=intent.graph,
            workflow_input_hash=intent.workflow_input_hash,
            node_key=intent.node_key,
            node_type=intent.node_type,
            contract_version=intent.contract_version,
            input_bindings=intent.input_bindings,
            node_input_hash=intent.node_input_hash,
            request_fingerprint=intent.request_fingerprint,
            idempotency_key=intent.execution_idempotency_key,
            max_attempts=intent.max_attempts,
            task_kind=intent.task_kind,
            priority=intent.priority,
            available_at=record.created_at,
            attempt_snapshot_kind="agent_skill_v1",
            attempt_snapshot=intent.attempt_snapshot,
        )
    except ValueError as error:
        if str(error) == "idempotency key was reused with different workflow input":
            raise IdempotencyKeyReusedError(
                "Idempotency-Key was reused with different workflow input"
            ) from error
        raise
    return queued, AttemptSnapshotV1.model_validate(
        {"attempt_id": queued.attempt_id, **intent.attempt_snapshot}
    )


class ShotOutlineRunFactory:
    def __init__(
        self,
        repository: StudioRepository,
        registry: AgentSkillRegistry,
        *,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self._repository = repository
        self._registry = registry
        self._clock = clock

    def create(
        self,
        *,
        project_id: str,
        payload: CreateProposalRunRequest,
        idempotency_key: str,
    ) -> CreatedShotOutlineRun:
        if not idempotency_key.strip() or len(idempotency_key) > 240:
            raise ProposalRunInputRejectedError("Idempotency-Key is required and bounded")
        if (
            payload.agent_definition != SHOT_PLANNER_REF
            or payload.skill_definition != SHOT_OUTLINE_REF
        ):
            raise ProposalRunInputRejectedError("only the built-in shot.outline slice is enabled")
        client_key_hash = canonical_sha256({"value": idempotency_key})
        identity_seed = {"project_id": project_id, "client_idempotency_key_hash": client_key_hash}
        request_hash = canonical_sha256(
            {
                "project_id": project_id,
                "payload": payload.model_dump(mode="json"),
                "client_idempotency_key_hash": client_key_hash,
            }
        )
        execution_key = "proposal-run:" + canonical_sha256(identity_seed)
        agent_run_id = _stable_id("agr", {**identity_seed, "kind": "agent"})
        skill_run_id = _stable_id("skr", {**identity_seed, "kind": "skill"})
        store = AgentRunStore(self._repository.database_path)
        try:
            existing = store.get_with_intent(project_id, agent_run_id)
        except ProposalRunNotFoundError:
            existing = None
        except AgentRunBundleConflictError as error:
            raise IdempotencyKeyReusedError(
                "Idempotency-Key resolved to a run without a recoverable enqueue intent"
            ) from error
        if existing is not None:
            if (
                existing.enqueue_intent is None
                or existing.enqueue_intent.request_hash != request_hash
            ):
                raise IdempotencyKeyReusedError(
                    "Idempotency-Key was reused with different proposal run input"
                )
            queued, attempt = _enqueue_from_intent(
                self._repository, existing.enqueue_intent, clock=self._clock
            )
            return CreatedShotOutlineRun(existing.bundle, queued, attempt, True)

        self._repository.get_project(project_id)
        try:
            delegation = self._registry.resolve_delegation(
                payload.agent_definition, payload.skill_definition
            )
        except (LookupError, PermissionError, ValueError) as error:
            raise ProposalRunInputRejectedError("Agent/Skill definition is unavailable") from error
        approved, source_span = resolve_source_extract_context(
            self._repository, project_id=project_id, payload=payload
        )
        trusted_inputs = _mint_resolved_context_inputs(
            project_id=project_id,
            delegation=delegation,
            role_invariants=ContextFragment(
                ref="agent:director.shot-planner",
                version="1.0.0",
                content=(
                    "Create only a development Fake eight-shot outline; "
                    "never approve or write ArtifactVersion."
                ),
            ),
            skill_instructions=ContextFragment(
                ref="skill:shot.outline",
                version="1.0.0",
                content=(
                    "Create exactly eight source-grounded shots; local Fake has no Provider access."
                ),
            ),
            approved_artifacts=(approved,),
            source_spans=(source_span,),
            task_output_schema=ContextFragment(
                ref="schema:ShotOutlineProposal",
                version="1.0.0",
                content=json.dumps(
                    ShotOutlinePayloadV1.model_json_schema(),
                    ensure_ascii=False,
                    sort_keys=True,
                    separators=(",", ":"),
                ),
            ),
        )
        built_context = build_context(delegation=delegation, trusted_inputs=trusted_inputs)
        input_payload = {
            "project_id": project_id,
            **payload.model_dump(mode="json"),
            "context_manifest_hash": built_context.manifest.manifest_hash,
        }
        input_hash = canonical_sha256(input_payload)
        agent_run = AgentRunV1(
            agent_run_id=agent_run_id,
            project_id=project_id,
            agent_definition=payload.agent_definition,
            status="PENDING",
            delegated_skill_run_ids=(skill_run_id,),
        )
        skill_run = SkillRunV1(
            skill_run_id=skill_run_id,
            project_id=project_id,
            agent_run_id=agent_run_id,
            skill_definition=payload.skill_definition,
            context_manifest_id=built_context.manifest.context_manifest_id,
            status="PENDING",
            proposal_id=None,
        )
        fingerprint_payload = {
            "project_id": project_id,
            "agent_run_id": agent_run_id,
            "skill_run_id": skill_run_id,
            "output_artifact_type": "ShotOutline",
            "agent_definition_id": SHOT_PLANNER_REF.definition_id,
            "agent_version": SHOT_PLANNER_REF.version,
            "skill_definition_id": SHOT_OUTLINE_REF.definition_id,
            "skill_version": SHOT_OUTLINE_REF.version,
            "prompt_version": "prompt.shot-outline@1.0.0",
            "policy_version": delegation.agent_definition.default_policy_version,
            "provider_connection_id": "provider:local-fake",
            "model_id": "deterministic-fake-v1",
            "capability_snapshot_hash": _CAPABILITY_HASH,
            "input_hash": input_hash,
            "output_schema_version": "1.0.0",
            "idempotency_key": execution_key,
        }
        snapshot = AttemptSnapshotV1.model_validate(
            {
                "attempt_id": "att_" + "0" * 32,
                **fingerprint_payload,
                "attempt_fingerprint": canonical_sha256(fingerprint_payload),
            }
        )
        template = snapshot.model_dump(mode="json", exclude={"attempt_id"})
        intent = ShotOutlineEnqueueIntentV1(
            project_id=project_id,
            agent_run_id=agent_run_id,
            skill_run_id=skill_run_id,
            context_manifest_id=built_context.manifest.context_manifest_id,
            definition_id=_WORKFLOW_DEFINITION_ID,
            definition_version=1,
            definition_hash=_WORKFLOW_DEFINITION_HASH,
            graph=_WORKFLOW_GRAPH,
            workflow_input_hash=input_hash,
            node_key="shot.outline",
            node_type="agent.skill.fake",
            contract_version=1,
            input_bindings={
                "context_manifest_id": built_context.manifest.context_manifest_id,
                "source_manifest_version_id": payload.source_manifest_version_id,
                "source_document_id": payload.source_document_id,
                "source_block_id": payload.source_block_id,
                "start_byte": payload.start_byte,
                "end_byte": payload.end_byte,
            },
            node_input_hash=input_hash,
            request_fingerprint=str(template["attempt_fingerprint"]),
            execution_idempotency_key=execution_key,
            max_attempts=delegation.skill_definition.max_attempts,
            task_kind="local.agent-skill.fake",
            priority=80,
            attempt_snapshot=template,
        )
        try:
            write = store.persist_pending_bundle_with_intent(
                agent_run=agent_run,
                skill_run=skill_run,
                built_context=built_context,
                delegation=delegation,
                request_hash=request_hash,
                intent_payload=intent.model_dump(mode="json"),
            )
        except AgentRunBundleConflictError as error:
            raise IdempotencyKeyReusedError(
                "Idempotency-Key was reused with different proposal run input"
            ) from error
        if write.enqueue_intent is None:
            raise AgentRunBundleConflictError("persisted enqueue intent is missing")
        queued, attempt = _enqueue_from_intent(
            self._repository, write.enqueue_intent, clock=self._clock
        )
        return CreatedShotOutlineRun(write.bundle, queued, attempt, not write.created)

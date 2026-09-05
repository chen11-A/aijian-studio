"""Deterministic provider-free ShotOutline worker components."""

from __future__ import annotations

import hashlib
import json
import sqlite3
from collections.abc import Callable
from datetime import timedelta
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from aijian_api.agent_run_store import AgentRunStore
from aijian_api.agent_skill_builtins import SHOT_OUTLINE_REF, SHOT_PLANNER_REF
from aijian_api.agent_skill_contracts import ArtifactProposalV1, AttemptSnapshotV1, canonical_sha256
from aijian_api.artifact_proposal_store import ArtifactProposalStore
from aijian_api.contracts import CreateProposalRunRequest
from aijian_api.fake_agent_executor import FakeAgentSkillExecutor
from aijian_api.repository import StudioRepository
from aijian_api.shot_outline_contracts import validate_shot_outline_proposal
from aijian_api.shot_outline_run_factory import ShotOutlineEnqueueIntentV1
from aijian_api.source_extract_run_factory import resolve_source_extract_context
from aijian_api.task_ledger import ClaimedTask, LocalTaskLedger

_WORKER_DATABASE_TIMEOUT = timedelta(milliseconds=250)


class ShotOutlineInvocationV1(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal["1.0.0"] = "1.0.0"
    project_id: str
    agent_run_id: str
    skill_run_id: str
    attempt_id: str
    source_manifest_version_id: str
    source_document_id: str
    source_block_id: str
    start_byte: int = Field(strict=True, ge=0)
    end_byte: int = Field(strict=True, gt=0)
    source_span_id: str
    excerpt: str = Field(min_length=1, max_length=64 * 1024)


class ShotOutlineInvocationBuilder:
    def __init__(self, database_path: Path) -> None:
        self._database_path = database_path.resolve()
        self._repository = StudioRepository(
            self._database_path, connection_timeout=_WORKER_DATABASE_TIMEOUT
        )
        self._agent_run_store = AgentRunStore(
            self._database_path, connection_timeout=_WORKER_DATABASE_TIMEOUT
        )

    def __call__(self, snapshot: AttemptSnapshotV1, running: ClaimedTask) -> dict[str, object]:
        if (
            running.attempt_id != snapshot.attempt_id
            or snapshot.output_artifact_type != "ShotOutline"
        ):
            raise PermissionError("shot.outline lease is detached from its Attempt snapshot")
        persisted = self._agent_run_store.get_with_intent(
            snapshot.project_id, snapshot.agent_run_id
        )
        if persisted.enqueue_intent is None:
            raise PermissionError("shot.outline enqueue intent is missing")
        intent = ShotOutlineEnqueueIntentV1.model_validate(persisted.enqueue_intent.payload)
        template = snapshot.model_dump(mode="json", exclude={"attempt_id"})
        bundle = persisted.bundle
        if (
            intent.project_id != snapshot.project_id
            or intent.agent_run_id != snapshot.agent_run_id
            or intent.skill_run_id != snapshot.skill_run_id
            or intent.attempt_snapshot != template
            or intent.node_input_hash != snapshot.input_hash
            or intent.workflow_input_hash != snapshot.input_hash
            or intent.request_fingerprint != snapshot.attempt_fingerprint
            or intent.execution_idempotency_key != snapshot.idempotency_key
            or running.task_kind != intent.task_kind
            or bundle.agent_run.agent_definition != SHOT_PLANNER_REF
            or bundle.agent_run.status != "RUNNING"
            or bundle.skill_run.skill_definition != SHOT_OUTLINE_REF
            or bundle.skill_run.status != "RUNNING"
            or bundle.skill_run.proposal_id is not None
            or bundle.context_manifest.context_manifest_id != intent.context_manifest_id
        ):
            raise PermissionError("shot.outline truth is detached from the Attempt snapshot")
        bindings = intent.input_bindings
        request = CreateProposalRunRequest.model_validate(
            {
                "agent_definition": SHOT_PLANNER_REF.model_dump(mode="json"),
                "skill_definition": SHOT_OUTLINE_REF.model_dump(mode="json"),
                **{
                    key: bindings.get(key)
                    for key in (
                        "source_manifest_version_id",
                        "source_document_id",
                        "source_block_id",
                        "start_byte",
                        "end_byte",
                    )
                },
            }
        )
        approved, source = resolve_source_extract_context(
            self._repository, project_id=snapshot.project_id, payload=request
        )
        expected_input_hash = canonical_sha256(
            {
                "project_id": snapshot.project_id,
                **request.model_dump(mode="json"),
                "context_manifest_hash": bundle.context_manifest.manifest_hash,
            }
        )
        if expected_input_hash != snapshot.input_hash:
            raise PermissionError("shot.outline input hash is detached from frozen context")
        entries = bundle.context_manifest.entries
        if len(entries) != 5 or [entry.kind for entry in entries] != [
            "ROLE_INVARIANTS",
            "SKILL_INSTRUCTIONS",
            "APPROVED_ARTIFACT",
            "SOURCE_SPAN",
            "TASK_OUTPUT_SCHEMA",
        ]:
            raise PermissionError("shot.outline requires exactly five frozen context layers")
        source_entry = next(entry for entry in entries if entry.kind == "SOURCE_SPAN")
        approved_entry = next(entry for entry in entries if entry.kind == "APPROVED_ARTIFACT")
        excerpt_hash = f"sha256:{hashlib.sha256(source.content.encode('utf-8')).hexdigest()}"
        if (
            source_entry.ref != source.ref
            or source_entry.version != source.version
            or source_entry.content_hash != excerpt_hash
            or source_entry.byte_count != request.end_byte - request.start_byte
            or approved_entry.ref != approved.ref
            or approved_entry.version != approved.version
        ):
            raise PermissionError("shot.outline input no longer matches frozen context")
        self._validate_exact_task(intent, snapshot, running)
        invocation = ShotOutlineInvocationV1(
            project_id=snapshot.project_id,
            agent_run_id=snapshot.agent_run_id,
            skill_run_id=snapshot.skill_run_id,
            attempt_id=snapshot.attempt_id,
            source_manifest_version_id=request.source_manifest_version_id,
            source_document_id=request.source_document_id,
            source_block_id=request.source_block_id,
            start_byte=request.start_byte,
            end_byte=request.end_byte,
            source_span_id=source.ref.removeprefix("source:"),
            excerpt=source.content,
        )
        return invocation.model_dump(mode="json")

    def _validate_exact_task(
        self, intent: ShotOutlineEnqueueIntentV1, snapshot: AttemptSnapshotV1, running: ClaimedTask
    ) -> None:
        connection = sqlite3.connect(
            self._database_path, timeout=_WORKER_DATABASE_TIMEOUT.total_seconds()
        )
        connection.row_factory = sqlite3.Row
        try:
            row = connection.execute(
                """
                SELECT task.task_id, task.task_kind, task.status AS task_status,
                       attempt.status AS attempt_status, attempt.request_fingerprint,
                       node.status AS node_status, node.active_attempt_id,
                       run.project_id, run.status AS workflow_status,
                       run.input_hash AS workflow_input_hash,
                       definition.definition_id, definition.version AS definition_version,
                       definition.definition_hash, definition.graph_json,
                       node.node_key, node.node_type, node.contract_version,
                       node.input_bindings_json, node.input_hash AS node_input_hash,
                       node.max_attempts, task.priority AS task_priority
                FROM task_ledger AS task
                JOIN workflow_attempts AS attempt ON attempt.attempt_id = task.attempt_id
                JOIN workflow_node_runs AS node ON node.node_run_id = attempt.node_run_id
                JOIN workflow_runs AS run ON run.workflow_run_id = node.workflow_run_id
                JOIN workflow_definitions AS definition
                  ON definition.definition_id = run.definition_id
                 AND definition.version = run.definition_version
                WHERE task.attempt_id = ? AND task.task_id = ? AND task.task_kind = ?
                """,
                (snapshot.attempt_id, running.task_id, intent.task_kind),
            ).fetchone()
        finally:
            connection.close()
        if row is None:
            raise PermissionError("shot.outline workflow truth is detached from enqueue intent")
        try:
            graph = json.loads(str(row["graph_json"]))
            input_bindings = json.loads(str(row["input_bindings_json"]))
        except json.JSONDecodeError as error:
            raise PermissionError("shot.outline workflow truth is not canonical JSON") from error
        if (
            json.dumps(
                graph, ensure_ascii=False, allow_nan=False, separators=(",", ":"), sort_keys=True
            )
            != str(row["graph_json"])
            or json.dumps(
                input_bindings,
                ensure_ascii=False,
                allow_nan=False,
                separators=(",", ":"),
                sort_keys=True,
            )
            != str(row["input_bindings_json"])
            or graph != intent.graph
            or input_bindings != intent.input_bindings
            or str(row["workflow_input_hash"]) != intent.workflow_input_hash
            or int(row["task_priority"]) != intent.priority
        ):
            raise PermissionError("shot.outline workflow truth is detached from enqueue intent")
        if any(
            check
            for check in (
                str(row["task_status"]) != "LEASED",
                str(row["attempt_status"]) != "RUNNING",
                str(row["node_status"]) != "RUNNING",
                str(row["active_attempt_id"]) != running.attempt_id,
                str(row["project_id"]) != snapshot.project_id,
                str(row["workflow_status"]) != "ACTIVE",
                str(row["definition_id"]) != intent.definition_id,
                int(row["definition_version"]) != intent.definition_version,
                str(row["definition_hash"]) != intent.definition_hash,
                str(row["node_key"]) != intent.node_key,
                str(row["node_type"]) != intent.node_type,
                int(row["contract_version"]) != intent.contract_version,
                str(row["node_input_hash"]) != intent.node_input_hash,
                int(row["max_attempts"]) != intent.max_attempts,
                str(row["request_fingerprint"]) != intent.request_fingerprint,
            )
        ):
            raise PermissionError("shot.outline workflow truth is detached from enqueue intent")


def shot_outline_fake_skill(
    snapshot: AttemptSnapshotV1, invocation_index: int, raw_invocation: object
) -> ArtifactProposalV1:
    invocation = ShotOutlineInvocationV1.model_validate(raw_invocation)
    if (
        invocation.project_id != snapshot.project_id
        or invocation.agent_run_id != snapshot.agent_run_id
        or invocation.skill_run_id != snapshot.skill_run_id
        or invocation.attempt_id != snapshot.attempt_id
        or invocation_index < 0
    ):
        raise PermissionError("shot.outline invocation is detached from its Attempt")
    identity = {
        "attempt_fingerprint": snapshot.attempt_fingerprint,
        "invocation_index": invocation_index,
    }
    proposal_id = "prp_" + canonical_sha256({**identity, "kind": "proposal"})[7:39]
    factual_id = "clm_" + canonical_sha256({**identity, "kind": "factual"})[7:39]
    audio_id = "clm_" + canonical_sha256({**identity, "kind": "audio"})[7:39]
    camera_id = "clm_" + canonical_sha256({**identity, "kind": "camera"})[7:39]
    span_id = invocation.source_span_id
    claims = [
        {
            "claim_id": factual_id,
            "text": "所选原文片段提供本镜头的事实依据。",
            "invented": False,
            "source_span_ids": [span_id],
        },
        {
            "claim_id": audio_id,
            "text": "以克制的环境声作为开发性声音建议。",
            "invented": True,
            "source_span_ids": [span_id],
        },
        {
            "claim_id": camera_id,
            "text": "缓慢推进镜头。",
            "invented": True,
            "source_span_ids": [span_id],
        },
    ]
    payload = {
        "schema_version": "1.0.0",
        "purpose": "DEVELOPMENT_FAKE_ONLY",
        "claims": claims,
        "shots": [
            {
                "shot_id": f"sht_{ordinal:032x}",
                "ordinal": ordinal,
                "duration_ms": 3000,
                "visual_claim_ids": [factual_id],
                "audio_claim_ids": [audio_id],
                "camera_claim_ids": [camera_id],
            }
            for ordinal in range(1, 9)
        ],
    }
    quote_hash = f"sha256:{hashlib.sha256(invocation.excerpt.encode('utf-8')).hexdigest()}"
    proposal = ArtifactProposalV1.model_validate(
        {
            "schema_version": "1.0.0",
            "proposal_id": proposal_id,
            "project_id": snapshot.project_id,
            "target_artifact_type": "ShotOutline",
            "payload": payload,
            "payload_hash": canonical_sha256(payload),
            "source_spans": [
                {
                    "source_span_id": span_id,
                    "source_document_id": invocation.source_document_id,
                    "source_block_id": invocation.source_block_id,
                    "start_byte": invocation.start_byte,
                    "end_byte": invocation.end_byte,
                    "claim": "所选原文片段已作为镜头规划依据。",
                    "quote_hash": quote_hash,
                }
            ],
            "claims": claims,
            "diff": [{"op": "add", "path": "/shots", "value": "eight-shot-development-outline"}],
            "dependencies": [
                {
                    "artifact_type": "SourceManifest",
                    "version_id": invocation.source_manifest_version_id,
                    "approval_required": True,
                }
            ],
            "impacts": [{"artifact_type": "ShotOutline", "artifact_id": None, "impact": "CREATE"}],
            "cost": {"currency": "USD", "estimated_micros": 0, "actual_micros": 0},
            "confidence_basis_points": 0,
            "capability_losses": [
                {
                    "code": "local-fake.no-semantic-planning",
                    "description": "本地 Fake 不执行真实导演或 Provider 规划。",
                }
            ],
            "qc": [
                {
                    "check_id": "shot-outline.contract",
                    "status": "PASS",
                    "details": "严格八镜头开发提案已通过 O1 契约。",
                }
            ],
            "producer_agent_run_id": snapshot.agent_run_id,
            "producer_skill_run_id": snapshot.skill_run_id,
        }
    )
    validate_shot_outline_proposal(proposal)
    return proposal


def create_shot_outline_executor(
    database_path: Path,
    *,
    worker_id: str,
    lease_duration: timedelta,
    handler_timeout: timedelta,
    heartbeat_interval: timedelta,
    stop_requested: Callable[[], bool] | None = None,
) -> FakeAgentSkillExecutor:
    from aijian_api.agent_skill_builtins import built_in_agent_skill_registry

    delegation = built_in_agent_skill_registry().resolve_delegation(
        SHOT_PLANNER_REF, SHOT_OUTLINE_REF
    )
    return FakeAgentSkillExecutor(
        LocalTaskLedger(database_path, connection_timeout=_WORKER_DATABASE_TIMEOUT),
        ArtifactProposalStore(database_path, connection_timeout=_WORKER_DATABASE_TIMEOUT),
        worker_id=worker_id,
        lease_duration=lease_duration,
        handler_timeout=handler_timeout,
        heartbeat_interval=heartbeat_interval,
        handler=shot_outline_fake_skill,
        delegation=delegation,
        input_builder=ShotOutlineInvocationBuilder(database_path),
        stop_requested=stop_requested,
        isolation_backend="subprocess",
    )

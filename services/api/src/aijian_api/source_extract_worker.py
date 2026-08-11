"""Production-controlled local Fake Worker for the first source.extract slice."""

from __future__ import annotations

import hashlib
import json
import logging
import os
import secrets
import sqlite3
import threading
from collections.abc import Callable
from datetime import timedelta
from pathlib import Path
from time import monotonic
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from aijian_api.agent_run_store import AgentRunStore
from aijian_api.agent_skill_builtins import (
    SOURCE_ANALYST_REF,
    SOURCE_EXTRACT_REF,
    built_in_agent_skill_registry,
)
from aijian_api.agent_skill_contracts import ArtifactProposalV1, AttemptSnapshotV1, canonical_sha256
from aijian_api.artifact_proposal_store import ArtifactProposalStore
from aijian_api.contracts import CreateProposalRunRequest
from aijian_api.fake_agent_executor import (
    FakeAgentSkillExecutor,
    FakeSkillExecutionError,
    FakeSkillShutdownRequested,
    FakeSkillTimeoutError,
)
from aijian_api.repository import StudioRepository
from aijian_api.source_extract_run_factory import (
    SourceExtractEnqueueIntentV1,
    resolve_source_extract_context,
)
from aijian_api.task_ledger import ClaimedTask, LocalTaskLedger

_LOGGER = logging.getLogger(__name__)
_FAKE_TASK_KIND = "local.agent-skill.fake"
_WORKER_DATABASE_TIMEOUT = timedelta(milliseconds=250)


class FakeSourceExtractInvocationV1(BaseModel):
    """Closed, lease-built input copied into the isolated child process."""

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


class SourceExtractInvocationBuilder:
    def __init__(self, database_path: Path) -> None:
        self._database_path = database_path.resolve()
        self._repository = StudioRepository(
            self._database_path,
            connection_timeout=_WORKER_DATABASE_TIMEOUT,
        )
        self._agent_run_store = AgentRunStore(
            self._database_path,
            connection_timeout=_WORKER_DATABASE_TIMEOUT,
        )

    def __call__(
        self,
        snapshot: AttemptSnapshotV1,
        running: ClaimedTask,
    ) -> dict[str, object]:
        if running.attempt_id != snapshot.attempt_id:
            raise PermissionError("source.extract lease is detached from its Attempt snapshot")
        persisted = self._agent_run_store.get_with_intent(
            snapshot.project_id,
            snapshot.agent_run_id,
        )
        intent_record = persisted.enqueue_intent
        if intent_record is None:
            raise PermissionError("source.extract enqueue intent is missing")
        intent = SourceExtractEnqueueIntentV1.model_validate(intent_record.payload)
        self._validate_workflow_truth(intent, snapshot, running)
        attempt_template = snapshot.model_dump(mode="json", exclude={"attempt_id"})
        bundle = persisted.bundle
        if (
            intent.project_id != snapshot.project_id
            or intent.agent_run_id != snapshot.agent_run_id
            or intent.skill_run_id != snapshot.skill_run_id
            or intent.attempt_snapshot != attempt_template
            or intent.node_input_hash != snapshot.input_hash
            or intent.workflow_input_hash != snapshot.input_hash
            or intent.request_fingerprint != snapshot.attempt_fingerprint
            or intent.execution_idempotency_key != snapshot.idempotency_key
            or running.task_kind != intent.task_kind
            or bundle.agent_run.agent_run_id != snapshot.agent_run_id
            or bundle.agent_run.project_id != snapshot.project_id
            or bundle.agent_run.status != "RUNNING"
            or bundle.skill_run.skill_run_id != snapshot.skill_run_id
            or bundle.skill_run.project_id != snapshot.project_id
            or bundle.skill_run.agent_run_id != snapshot.agent_run_id
            or bundle.skill_run.status != "RUNNING"
            or bundle.skill_run.proposal_id is not None
            or bundle.context_manifest.context_manifest_id != intent.context_manifest_id
            or bundle.context_manifest.project_id != snapshot.project_id
            or bundle.skill_run.context_manifest_id != intent.context_manifest_id
            or bundle.agent_run.agent_definition != SOURCE_ANALYST_REF
            or bundle.skill_run.skill_definition != SOURCE_EXTRACT_REF
            or bundle.context_manifest.agent_definition != SOURCE_ANALYST_REF
            or bundle.context_manifest.skill_definition != SOURCE_EXTRACT_REF
        ):
            raise PermissionError("source.extract truth is detached from the Attempt snapshot")
        bindings = intent.input_bindings
        request = CreateProposalRunRequest.model_validate(
            {
                "agent_definition": SOURCE_ANALYST_REF.model_dump(mode="json"),
                "skill_definition": SOURCE_EXTRACT_REF.model_dump(mode="json"),
                "source_manifest_version_id": bindings.get("source_manifest_version_id"),
                "source_document_id": bindings.get("source_document_id"),
                "source_block_id": bindings.get("source_block_id"),
                "start_byte": bindings.get("start_byte"),
                "end_byte": bindings.get("end_byte"),
            }
        )
        approved, source = resolve_source_extract_context(
            self._repository,
            project_id=snapshot.project_id,
            payload=request,
        )
        expected_input_hash = canonical_sha256(
            {
                "project_id": snapshot.project_id,
                **request.model_dump(mode="json"),
                "context_manifest_hash": bundle.context_manifest.manifest_hash,
            }
        )
        if expected_input_hash != snapshot.input_hash:
            raise PermissionError("source.extract input hash is detached from frozen context")
        entries = bundle.context_manifest.entries
        if len(entries) != 5 or [entry.kind for entry in entries] != [
            "ROLE_INVARIANTS",
            "SKILL_INSTRUCTIONS",
            "APPROVED_ARTIFACT",
            "SOURCE_SPAN",
            "TASK_OUTPUT_SCHEMA",
        ]:
            raise PermissionError("source.extract requires exactly five frozen context layers")
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
            raise PermissionError("source.extract input no longer matches frozen context")
        invocation = FakeSourceExtractInvocationV1(
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

    def _validate_workflow_truth(
        self,
        intent: SourceExtractEnqueueIntentV1,
        snapshot: AttemptSnapshotV1,
        running: ClaimedTask,
    ) -> None:
        connection = sqlite3.connect(
            self._database_path,
            timeout=_WORKER_DATABASE_TIMEOUT.total_seconds(),
        )
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 250")
        try:
            connection.execute("BEGIN")
            rows = connection.execute(
                """
                SELECT definition.definition_id, definition.version AS definition_version,
                       definition.definition_hash, definition.graph_json,
                       run.project_id, run.input_hash AS workflow_input_hash,
                       run.status AS workflow_status,
                       node.node_key, node.node_type, node.contract_version,
                       node.input_bindings_json, node.input_hash AS node_input_hash,
                       node.max_attempts, node.active_attempt_id,
                       node.status AS node_status,
                       attempt.request_fingerprint, attempt.status AS attempt_status,
                       task.task_id, task.task_kind, task.priority,
                       task.status AS task_status,
                       COUNT(*) OVER () AS exact_task_count
                FROM task_ledger AS task
                JOIN workflow_attempts AS attempt
                  ON attempt.attempt_id = task.attempt_id
                JOIN workflow_node_runs AS node
                  ON node.node_run_id = attempt.node_run_id
                JOIN workflow_runs AS run
                  ON run.workflow_run_id = node.workflow_run_id
                JOIN workflow_definitions AS definition
                  ON definition.definition_id = run.definition_id
                 AND definition.version = run.definition_version
                WHERE task.attempt_id = ? AND task.task_kind = ?
                """,
                (running.attempt_id, intent.task_kind),
            ).fetchall()
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()
        if len(rows) != 1 or int(rows[0]["exact_task_count"]) != 1:
            raise PermissionError("source.extract requires one exact frozen task")
        row = rows[0]
        try:
            graph_json = str(row["graph_json"])
            input_bindings_json = str(row["input_bindings_json"])
            graph = json.loads(graph_json)
            input_bindings = json.loads(input_bindings_json)
        except json.JSONDecodeError as error:
            raise PermissionError("source.extract workflow truth is not canonical JSON") from error
        if (
            json.dumps(
                graph,
                ensure_ascii=False,
                allow_nan=False,
                separators=(",", ":"),
                sort_keys=True,
            )
            != graph_json
            or json.dumps(
                input_bindings,
                ensure_ascii=False,
                allow_nan=False,
                separators=(",", ":"),
                sort_keys=True,
            )
            != input_bindings_json
            or str(row["definition_id"]) != intent.definition_id
            or int(row["definition_version"]) != intent.definition_version
            or str(row["definition_hash"]) != intent.definition_hash
            or graph != intent.graph
            or str(row["project_id"]) != snapshot.project_id
            or str(row["workflow_input_hash"]) != intent.workflow_input_hash
            or str(row["workflow_status"]) != "ACTIVE"
            or str(row["node_key"]) != intent.node_key
            or str(row["node_type"]) != intent.node_type
            or int(row["contract_version"]) != intent.contract_version
            or input_bindings != intent.input_bindings
            or str(row["node_input_hash"]) != intent.node_input_hash
            or int(row["max_attempts"]) != intent.max_attempts
            or str(row["active_attempt_id"]) != running.attempt_id
            or str(row["node_status"]) != "RUNNING"
            or str(row["request_fingerprint"]) != intent.request_fingerprint
            or str(row["attempt_status"]) != "RUNNING"
            or str(row["task_id"]) != running.task_id
            or str(row["task_kind"]) != intent.task_kind
            or int(row["priority"]) != intent.priority
            or str(row["task_status"]) != "LEASED"
        ):
            raise PermissionError("source.extract workflow truth is detached from enqueue intent")


def source_extract_fake_skill(
    snapshot: AttemptSnapshotV1,
    invocation_index: int,
    raw_invocation: object,
) -> ArtifactProposalV1:
    """Generate a deterministic proposal without filesystem, database, or Provider access."""

    invocation = FakeSourceExtractInvocationV1.model_validate(raw_invocation)
    if (
        invocation.project_id != snapshot.project_id
        or invocation.agent_run_id != snapshot.agent_run_id
        or invocation.skill_run_id != snapshot.skill_run_id
        or invocation.attempt_id != snapshot.attempt_id
    ):
        raise PermissionError("source.extract invocation is detached from its Attempt")
    identity = {
        "attempt_fingerprint": snapshot.attempt_fingerprint,
        "invocation_index": invocation_index,
    }
    proposal_id = f"prp_{canonical_sha256({**identity, 'kind': 'proposal'})[7:39]}"
    claim_id = f"clm_{canonical_sha256({**identity, 'kind': 'claim'})[7:39]}"
    payload = {"summary": "已提取 1 条来源证据，等待人工审阅。"}
    claim = "所选原文片段已作为后续改编的来源证据。"
    quote_hash = f"sha256:{hashlib.sha256(invocation.excerpt.encode('utf-8')).hexdigest()}"
    return ArtifactProposalV1.model_validate(
        {
            "schema_version": "1.0.0",
            "proposal_id": proposal_id,
            "project_id": snapshot.project_id,
            "target_artifact_type": "SourceExtraction",
            "payload": payload,
            "payload_hash": canonical_sha256(payload),
            "source_spans": [
                {
                    "source_span_id": invocation.source_span_id,
                    "source_document_id": invocation.source_document_id,
                    "source_block_id": invocation.source_block_id,
                    "start_byte": invocation.start_byte,
                    "end_byte": invocation.end_byte,
                    "claim": claim,
                    "quote_hash": quote_hash,
                }
            ],
            "claims": [
                {
                    "claim_id": claim_id,
                    "text": claim,
                    "invented": False,
                    "source_span_ids": [invocation.source_span_id],
                }
            ],
            "diff": [{"op": "add", "path": "/source_evidence/0", "value": claim}],
            "dependencies": [
                {
                    "artifact_type": "SourceManifest",
                    "version_id": invocation.source_manifest_version_id,
                    "approval_required": True,
                }
            ],
            "impacts": [
                {
                    "artifact_type": "SourceExtraction",
                    "artifact_id": None,
                    "impact": "CREATE",
                }
            ],
            "cost": {"currency": "USD", "estimated_micros": 0, "actual_micros": 0},
            "confidence_basis_points": 9000,
            "capability_losses": [
                {
                    "code": "local-fake.no-semantic-extraction",
                    "description": "本地 Fake 仅建立证据链，不执行真实语义抽取。",
                }
            ],
            "qc": [
                {
                    "check_id": "source-span.required",
                    "status": "PASS",
                    "details": "来源坐标、UTF-8 引文和哈希均已验证。",
                }
            ],
            "producer_agent_run_id": snapshot.agent_run_id,
            "producer_skill_run_id": snapshot.skill_run_id,
        }
    )


def create_source_extract_executor(
    database_path: Path,
    *,
    worker_id: str,
    lease_duration: timedelta = timedelta(seconds=30),
    handler_timeout: timedelta = timedelta(seconds=10),
    heartbeat_interval: timedelta = timedelta(milliseconds=250),
    stop_requested: Callable[[], bool] | None = None,
) -> FakeAgentSkillExecutor:
    resolved_database = database_path.resolve()
    registry = built_in_agent_skill_registry()
    delegation = registry.resolve_delegation(SOURCE_ANALYST_REF, SOURCE_EXTRACT_REF)
    return FakeAgentSkillExecutor(
        LocalTaskLedger(
            resolved_database,
            connection_timeout=_WORKER_DATABASE_TIMEOUT,
        ),
        ArtifactProposalStore(
            resolved_database,
            connection_timeout=_WORKER_DATABASE_TIMEOUT,
        ),
        worker_id=worker_id,
        lease_duration=lease_duration,
        handler_timeout=handler_timeout,
        heartbeat_interval=heartbeat_interval,
        handler=source_extract_fake_skill,
        delegation=delegation,
        input_builder=SourceExtractInvocationBuilder(resolved_database),
        stop_requested=stop_requested,
        isolation_backend="subprocess",
    )


class LocalFakeSourceExtractWorker:
    """Single-process supervisor for the bounded provider-free source.extract slice."""

    def __init__(
        self,
        database_path: Path,
        *,
        poll_interval: timedelta = timedelta(milliseconds=100),
        recovery_interval: timedelta = timedelta(seconds=5),
        lease_duration: timedelta = timedelta(seconds=30),
        handler_timeout: timedelta = timedelta(seconds=10),
    ) -> None:
        if poll_interval <= timedelta(0) or recovery_interval <= timedelta(0):
            raise ValueError("worker intervals must be positive")
        self._database_path = database_path.resolve()
        self._poll_seconds = poll_interval.total_seconds()
        self._recovery_seconds = recovery_interval.total_seconds()
        self._stop = threading.Event()
        self._worker_id = f"local-fake-source-extract:{os.getpid()}:{secrets.token_hex(8)}"
        self._ledger = LocalTaskLedger(
            self._database_path,
            connection_timeout=_WORKER_DATABASE_TIMEOUT,
        )
        self._executor = create_source_extract_executor(
            self._database_path,
            worker_id=self._worker_id,
            lease_duration=lease_duration,
            handler_timeout=handler_timeout,
            stop_requested=self._stop.is_set,
        )
        self._thread = threading.Thread(
            target=self._run,
            name="aijian-local-fake-source-extract",
            daemon=False,
        )
        self._started = False

    @property
    def worker_id(self) -> str:
        return self._worker_id

    def start(self) -> None:
        if self._started:
            raise RuntimeError("local Fake source.extract worker was already started")
        self._started = True
        self._thread.start()

    def stop(self, *, timeout: float = 4.0) -> None:
        self._stop.set()
        if self._started:
            self._thread.join(timeout=timeout)
            if self._thread.is_alive():
                raise RuntimeError("local Fake source.extract worker did not stop in time")

    def _run(self) -> None:
        _LOGGER.info(
            "local Fake source.extract worker started", extra={"worker_id": self._worker_id}
        )
        next_recovery = 0.0
        while not self._stop.is_set():
            try:
                now = monotonic()
                if now >= next_recovery:
                    summary = self._ledger.recover_expired_local_tasks(task_kind=_FAKE_TASK_KIND)
                    _LOGGER.info(
                        "local Fake source.extract recovery completed",
                        extra={
                            "worker_id": self._worker_id,
                            "recovered": summary.recovered,
                            "requeued": summary.requeued,
                            "failed": summary.failed,
                        },
                    )
                    next_recovery = monotonic() + self._recovery_seconds
                if self._executor.run_once():
                    continue
            except FakeSkillShutdownRequested:
                break
            except Exception as error:
                _LOGGER.warning(
                    "local Fake source.extract iteration failed: %s%s",
                    type(error).__name__,
                    (
                        f" ({error})"
                        if isinstance(error, (FakeSkillTimeoutError, FakeSkillExecutionError))
                        else ""
                    ),
                    extra={
                        "worker_id": self._worker_id,
                        "error_class": type(error).__name__,
                    },
                )
            self._stop.wait(self._poll_seconds)
        _LOGGER.info(
            "local Fake source.extract worker stopped", extra={"worker_id": self._worker_id}
        )

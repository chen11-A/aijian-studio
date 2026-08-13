"""Sidecar-only recoverable Fake-media to Timeline workflow."""

from __future__ import annotations

import json
import logging
import secrets
import sqlite3
import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeoutError
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from time import monotonic

from pydantic import ValidationError

from aijian_api.artifacts import canonical_content_hash
from aijian_api.domain import ArtifactDependencyDraft
from aijian_api.fake_media_package import (
    FakeMediaPackageError,
    FakeMediaPackageGenerator,
    FakeMediaToolchainIdentityV1,
    GeneratedFakeMediaPackage,
)
from aijian_api.media_contracts import SequenceFrameRateData, SequenceTimebaseData
from aijian_api.repository import (
    AcceptedArtifactDependencyRequirement,
    ArtifactConflictError,
    ArtifactDependencyInvalidError,
    StudioRepository,
)
from aijian_api.source_manifest import SourceManifestContentV1
from aijian_api.task_ledger import ClaimedTask, LocalTaskLedger, QueuedTask
from aijian_api.timeline import TimelineAssetV1, TimelineClipV1, TimelineVersionV1

TASK_KIND = "local.timeline.assemble.fake.media.v1"
DEFINITION_ID = "phase0.fake-timeline-media"
DEFINITION_VERSION = 1
NODE_KEY = "timeline.assemble.fake.media"
_GRAPH = {"nodes": [NODE_KEY]}
_DEFINITION_HASH = canonical_content_hash(_GRAPH)
_LOGGER = logging.getLogger(__name__)


class FakeTimelineRunInputError(RuntimeError):
    """The run command is detached from accepted immutable input."""


class FakeTimelineRunConflictError(RuntimeError):
    """The requested run conflicts with existing durable state."""


class FakeTimelineRuntimeUnavailableError(RuntimeError):
    """The development-only local media runtime is not configured."""


@dataclass(frozen=True, slots=True)
class FakeTimelineRunReceipt:
    project_id: str
    source_manifest_version_id: str
    source_document_id: str
    workflow_run_id: str
    node_run_id: str
    attempt_id: str
    task_id: str
    attempt_status: str
    task_status: str
    created: bool


class FakeTimelineRunFactory:
    def __init__(
        self,
        repository: StudioRepository,
        generator: FakeMediaPackageGenerator,
    ) -> None:
        self._repository = repository
        self._generator = generator
        self._ledger = LocalTaskLedger(repository.database_path)

    def create(
        self,
        *,
        project_id: str,
        source_manifest_version_id: str,
        source_document_id: str,
        idempotency_key: str,
    ) -> FakeTimelineRunReceipt:
        replay = self._existing_receipt(
            project_id=project_id,
            idempotency_key=idempotency_key,
            source_manifest_version_id=source_manifest_version_id,
            source_document_id=source_document_id,
        )
        if replay is not None:
            return replay
        manifest_record = self._repository.get_artifact_version(
            project_id,
            "source_manifest",
            source_manifest_version_id,
        )
        if manifest_record.head.accepted_version_id != source_manifest_version_id:
            raise FakeTimelineRunInputError("Fake Timeline requires the accepted SourceManifest")
        manifest = SourceManifestContentV1.model_validate(manifest_record.version.content)
        manifest_document = next(
            (
                document
                for document in manifest.documents
                if document.source_document_id == source_document_id
            ),
            None,
        )
        if manifest_document is None:
            raise FakeTimelineRunInputError("source is not part of the accepted SourceManifest")
        source = self._repository.get_source(project_id, source_document_id)
        source_sha256 = f"sha256:{source.raw_sha256}"
        if manifest_document.raw_sha256 != source.raw_sha256:
            raise FakeTimelineRunInputError("source bytes no longer match the SourceManifest")
        try:
            toolchain = self._generator.identity
        except FakeMediaPackageError:
            raise FakeTimelineRuntimeUnavailableError from None
        input_bindings: dict[str, object] = {
            "source_manifest_version_id": source_manifest_version_id,
            "source_manifest_content_hash": manifest_record.version.content_hash,
            "source_document_id": source_document_id,
            "source_sha256": source_sha256,
            "media_toolchain": toolchain.model_dump(mode="json"),
        }
        input_hash = canonical_content_hash(input_bindings)
        request_fingerprint = canonical_content_hash(
            {
                "definition_id": DEFINITION_ID,
                "definition_version": DEFINITION_VERSION,
                "definition_hash": _DEFINITION_HASH,
                "input_hash": input_hash,
                "task_kind": TASK_KIND,
            }
        )
        try:

            def validate_frozen_input(connection: sqlite3.Connection) -> None:
                row = connection.execute(
                    """
                    SELECT version.content_json, version.content_hash,
                           head.accepted_version_id, source.raw_sha256,
                           source.project_id AS source_project_id
                    FROM artifact_versions AS version
                    JOIN artifacts AS artifact ON artifact.artifact_id = version.artifact_id
                    JOIN artifact_heads AS head ON head.artifact_id = artifact.artifact_id
                    JOIN source_documents AS source ON source.id = ?
                    WHERE artifact.project_id = ? AND artifact.artifact_type = 'source_manifest'
                      AND version.version_id = ?
                    """,
                    (source_document_id, project_id, source_manifest_version_id),
                ).fetchone()
                if row is None:
                    raise FakeTimelineRunInputError("Fake Timeline input disappeared")
                frozen_manifest = SourceManifestContentV1.model_validate_json(
                    str(row["content_json"])
                )
                frozen_document = next(
                    (
                        document
                        for document in frozen_manifest.documents
                        if document.source_document_id == source_document_id
                    ),
                    None,
                )
                if (
                    str(row["accepted_version_id"]) != source_manifest_version_id
                    or str(row["content_hash"]) != manifest_record.version.content_hash
                    or str(row["source_project_id"]) != project_id
                    or str(row["raw_sha256"]) != source.raw_sha256
                    or frozen_document is None
                    or frozen_document.raw_sha256 != source.raw_sha256
                ):
                    raise FakeTimelineRunInputError("Fake Timeline input changed before enqueue")

            queued = self._ledger.enqueue_local_node(
                project_id=project_id,
                definition_id=DEFINITION_ID,
                definition_version=DEFINITION_VERSION,
                definition_hash=_DEFINITION_HASH,
                graph=_GRAPH,
                workflow_input_hash=input_hash,
                node_key=NODE_KEY,
                node_type=NODE_KEY,
                contract_version=1,
                input_bindings=input_bindings,
                node_input_hash=input_hash,
                request_fingerprint=request_fingerprint,
                idempotency_key=idempotency_key,
                max_attempts=2,
                task_kind=TASK_KIND,
                priority=80,
                available_at=datetime.now(UTC),
                transaction_validator=validate_frozen_input,
            )
        except (ValueError, sqlite3.IntegrityError) as error:
            raise FakeTimelineRunConflictError("Fake Timeline operation was reused") from error
        return self._receipt(project_id, queued)

    def _existing_receipt(
        self,
        *,
        project_id: str,
        idempotency_key: str,
        source_manifest_version_id: str,
        source_document_id: str,
    ) -> FakeTimelineRunReceipt | None:
        with self._repository._connection() as connection:
            row = connection.execute(
                """
                SELECT key.workflow_run_id, key.node_run_id,
                       attempt.attempt_id, task.task_id,
                       attempt.status AS attempt_status, task.status AS task_status,
                       attempt.request_fingerprint,
                       definition.definition_id, definition.version AS definition_version,
                       definition.definition_hash, definition.graph_json,
                       run.input_hash AS workflow_input_hash,
                       node.node_key, node.node_type, node.contract_version,
                       node.input_hash AS node_input_hash, node.input_bindings_json,
                       task.task_kind,
                       COUNT(*) OVER (PARTITION BY attempt.attempt_id) AS exact_task_count
                FROM workflow_enqueue_keys AS key
                JOIN workflow_node_runs AS node ON node.node_run_id = key.node_run_id
                JOIN workflow_runs AS run ON run.workflow_run_id = key.workflow_run_id
                JOIN workflow_definitions AS definition
                  ON definition.definition_id = run.definition_id
                 AND definition.version = run.definition_version
                JOIN workflow_attempts AS attempt ON attempt.node_run_id = node.node_run_id
                JOIN task_ledger AS task ON task.attempt_id = attempt.attempt_id
                WHERE key.project_id = ? AND key.idempotency_key = ?
                ORDER BY attempt.attempt_number DESC, attempt.attempt_id DESC
                LIMIT 1
                """,
                (project_id, idempotency_key),
            ).fetchone()
        if row is None:
            return None
        bindings = json.loads(str(row["input_bindings_json"]))
        graph_json = str(row["graph_json"])
        graph = json.loads(graph_json)
        canonical_graph = json.dumps(
            graph,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
            sort_keys=True,
        )
        expected_input_hash = canonical_content_hash(bindings)
        expected_fingerprint = canonical_content_hash(
            {
                "definition_id": DEFINITION_ID,
                "definition_version": DEFINITION_VERSION,
                "definition_hash": _DEFINITION_HASH,
                "input_hash": expected_input_hash,
                "task_kind": TASK_KIND,
            }
        )
        try:
            FakeMediaToolchainIdentityV1.model_validate(bindings.get("media_toolchain"))
        except ValidationError as error:
            raise FakeTimelineRunConflictError(
                "Fake Timeline operation truth is invalid"
            ) from error
        if (
            bindings.get("source_manifest_version_id") != source_manifest_version_id
            or bindings.get("source_document_id") != source_document_id
            or set(bindings)
            != {
                "source_manifest_version_id",
                "source_manifest_content_hash",
                "source_document_id",
                "source_sha256",
                "media_toolchain",
            }
            or canonical_graph != graph_json
            or graph != _GRAPH
            or str(row["definition_id"]) != DEFINITION_ID
            or int(row["definition_version"]) != DEFINITION_VERSION
            or str(row["definition_hash"]) != _DEFINITION_HASH
            or str(row["workflow_input_hash"]) != expected_input_hash
            or str(row["node_key"]) != NODE_KEY
            or str(row["node_type"]) != NODE_KEY
            or int(row["contract_version"]) != 1
            or str(row["node_input_hash"]) != expected_input_hash
            or str(row["request_fingerprint"]) != expected_fingerprint
            or str(row["task_kind"]) != TASK_KIND
            or int(row["exact_task_count"]) != 1
        ):
            raise FakeTimelineRunConflictError("Fake Timeline operation input changed")
        return FakeTimelineRunReceipt(
            project_id=project_id,
            source_manifest_version_id=source_manifest_version_id,
            source_document_id=source_document_id,
            workflow_run_id=str(row["workflow_run_id"]),
            node_run_id=str(row["node_run_id"]),
            attempt_id=str(row["attempt_id"]),
            task_id=str(row["task_id"]),
            attempt_status=str(row["attempt_status"]),
            task_status=str(row["task_status"]),
            created=False,
        )

    def _receipt(self, project_id: str, queued: QueuedTask) -> FakeTimelineRunReceipt:
        with self._repository._connection() as connection:
            row = connection.execute(
                """
                SELECT attempt.status AS attempt_status, task.status AS task_status,
                       node.input_bindings_json
                FROM workflow_attempts AS attempt
                JOIN workflow_node_runs AS node ON node.node_run_id = attempt.node_run_id
                JOIN workflow_runs AS run ON run.workflow_run_id = node.workflow_run_id
                JOIN task_ledger AS task ON task.attempt_id = attempt.attempt_id
                WHERE run.project_id = ? AND run.workflow_run_id = ?
                  AND node.node_run_id = ? AND attempt.attempt_id = ? AND task.task_id = ?
                """,
                (
                    project_id,
                    queued.workflow_run_id,
                    queued.node_run_id,
                    queued.attempt_id,
                    queued.task_id,
                ),
            ).fetchone()
        if row is None:
            raise FakeTimelineRunConflictError("Fake Timeline run disappeared")
        bindings = json.loads(str(row["input_bindings_json"]))
        return FakeTimelineRunReceipt(
            project_id=project_id,
            source_manifest_version_id=str(bindings["source_manifest_version_id"]),
            source_document_id=str(bindings["source_document_id"]),
            workflow_run_id=queued.workflow_run_id,
            node_run_id=queued.node_run_id,
            attempt_id=queued.attempt_id,
            task_id=queued.task_id,
            attempt_status=str(row["attempt_status"]),
            task_status=str(row["task_status"]),
            created=queued.created,
        )


class LocalFakeTimelineWorker:
    """Single-worker provider-free runtime for exact Fake Timeline tasks."""

    def __init__(
        self,
        database_path: Path,
        generator: FakeMediaPackageGenerator,
        *,
        poll_interval_seconds: float = 0.1,
        recovery_interval_seconds: float = 5.0,
        lease_duration: timedelta = timedelta(minutes=5),
        fault_hook: Callable[[str], None] | None = None,
    ) -> None:
        if poll_interval_seconds <= 0 or recovery_interval_seconds <= 0:
            raise ValueError("worker intervals must be positive")
        self._repository = StudioRepository(
            database_path, connection_timeout=timedelta(milliseconds=250)
        )
        self._ledger = LocalTaskLedger(
            database_path, connection_timeout=timedelta(milliseconds=250)
        )
        self._generator = generator
        self._poll = poll_interval_seconds
        self._recovery = recovery_interval_seconds
        self._lease_duration = lease_duration
        self._fault_hook = fault_hook or (lambda _phase: None)
        self._active_claim: ClaimedTask | None = None
        self._stop = threading.Event()
        self._worker_id = f"local-fake-timeline:{secrets.token_hex(8)}"
        self._thread = threading.Thread(
            target=self._run,
            name="aijian-local-fake-timeline",
            daemon=False,
        )
        self._started = False

    def start(self) -> None:
        if self._started:
            raise RuntimeError("local Fake Timeline worker was already started")
        self._started = True
        self._thread.start()

    def stop(self, *, timeout: float = 4.0) -> None:
        self._stop.set()
        if self._started:
            self._thread.join(timeout)
            if self._thread.is_alive():
                raise RuntimeError("local Fake Timeline worker did not stop in time")

    def run_once(self) -> bool:
        if self._stop.is_set():
            return False
        claim = self._ledger.claim_ready_task(
            worker_id=self._worker_id,
            lease_duration=self._lease_duration,
            task_kind=TASK_KIND,
        )
        if claim is None:
            return False
        if claim.task_kind != TASK_KIND:
            raise PermissionError("Fake Timeline worker claimed an unsupported task kind")
        running = self._ledger.mark_attempt_running(claim)
        self._active_claim = running
        try:
            package, running = self._materialize(running)
            self._fault_hook("package_published")
            version_id = self._persist_timeline(running, package)
            self._fault_hook("artifact_persisted")
            if self._stop.is_set():
                return False
            self._ledger.complete_local_task(running, output_version_id=version_id)
            return True
        except FakeMediaPackageError:
            if not self._stop.is_set():
                self._ledger.fail_local_task(
                    self._active_claim or running,
                    error_code="FAKE_MEDIA_GENERATION_FAILED",
                )
            raise
        except (
            ArtifactConflictError,
            ArtifactDependencyInvalidError,
            FakeTimelineRunConflictError,
            FakeTimelineRunInputError,
            PermissionError,
            ValidationError,
            json.JSONDecodeError,
        ):
            if not self._stop.is_set():
                self._ledger.fail_local_task(
                    self._active_claim or running,
                    error_code="FAKE_TIMELINE_TRUTH_INVALID",
                )
            raise

    def _materialize(self, running: ClaimedTask) -> tuple[GeneratedFakeMediaPackage, ClaimedTask]:
        bindings = self._validate_truth(running)
        interval = min(1.0, self._lease_duration.total_seconds() / 3)
        with ThreadPoolExecutor(max_workers=1, thread_name_prefix="aijian-fake-media") as pool:
            future = pool.submit(
                self._generator.materialize,
                project_id=str(bindings["project_id"]),
                source_document_id=str(bindings["source_document_id"]),
                source_sha256=str(bindings["source_sha256"]),
                stop_requested=self._stop.is_set,
            )
            while True:
                try:
                    package = future.result(timeout=interval)
                    return package, running
                except FutureTimeoutError:
                    if self._stop.is_set():
                        continue
                    running = self._ledger.heartbeat(
                        running,
                        lease_duration=self._lease_duration,
                        lock_timeout=timedelta(seconds=interval),
                    )
                    self._active_claim = running

    def _validate_truth(self, running: ClaimedTask) -> dict[str, object]:
        with self._repository._connection() as connection:
            connection.execute("BEGIN")
            rows = connection.execute(
                """
                SELECT definition.definition_id, definition.version AS definition_version,
                       definition.definition_hash, definition.graph_json,
                       run.project_id, run.input_hash AS workflow_input_hash,
                       run.status AS run_status,
                       node.node_key, node.node_type, node.contract_version,
                       node.input_bindings_json, node.input_hash, node.max_attempts,
                       node.active_attempt_id, node.status AS node_status,
                       attempt.request_fingerprint, attempt.status AS attempt_status,
                       task.task_id, task.task_kind, task.status AS task_status,
                       COUNT(*) OVER () AS exact_task_count
                FROM task_ledger AS task
                JOIN workflow_attempts AS attempt ON attempt.attempt_id = task.attempt_id
                JOIN workflow_node_runs AS node ON node.node_run_id = attempt.node_run_id
                JOIN workflow_runs AS run ON run.workflow_run_id = node.workflow_run_id
                JOIN workflow_definitions AS definition
                  ON definition.definition_id = run.definition_id
                 AND definition.version = run.definition_version
                WHERE attempt.attempt_id = ?
                """,
                (running.attempt_id,),
            ).fetchall()
            connection.commit()
        if len(rows) != 1 or int(rows[0]["exact_task_count"]) != 1:
            raise PermissionError("Fake Timeline requires one exact task")
        row = rows[0]
        graph_json = str(row["graph_json"])
        bindings_json = str(row["input_bindings_json"])
        graph = json.loads(graph_json)
        bindings = json.loads(bindings_json)

        def canonical(value: object) -> str:
            return json.dumps(
                value,
                ensure_ascii=False,
                allow_nan=False,
                separators=(",", ":"),
                sort_keys=True,
            )

        expected_input_hash = canonical_content_hash(bindings)
        expected_fingerprint = canonical_content_hash(
            {
                "definition_id": DEFINITION_ID,
                "definition_version": DEFINITION_VERSION,
                "definition_hash": _DEFINITION_HASH,
                "input_hash": expected_input_hash,
                "task_kind": TASK_KIND,
            }
        )
        expected_keys = {
            "source_manifest_version_id",
            "source_manifest_content_hash",
            "source_document_id",
            "source_sha256",
            "media_toolchain",
        }
        if (
            canonical(graph) != graph_json
            or canonical(bindings) != bindings_json
            or set(bindings) != expected_keys
            or str(row["definition_id"]) != DEFINITION_ID
            or int(row["definition_version"]) != DEFINITION_VERSION
            or str(row["definition_hash"]) != _DEFINITION_HASH
            or graph != _GRAPH
            or str(row["workflow_input_hash"]) != expected_input_hash
            or str(row["run_status"]) != "ACTIVE"
            or str(row["node_key"]) != NODE_KEY
            or str(row["node_type"]) != NODE_KEY
            or int(row["contract_version"]) != 1
            or str(row["input_hash"]) != expected_input_hash
            or int(row["max_attempts"]) != 2
            or str(row["active_attempt_id"]) != running.attempt_id
            or str(row["node_status"]) != "RUNNING"
            or str(row["request_fingerprint"]) != expected_fingerprint
            or str(row["attempt_status"]) != "RUNNING"
            or str(row["task_id"]) != running.task_id
            or str(row["task_kind"]) != TASK_KIND
            or str(row["task_status"]) != "LEASED"
            or bindings["media_toolchain"] != self._generator.identity.model_dump(mode="json")
        ):
            raise PermissionError("Fake Timeline workflow truth is detached")
        manifest = self._repository.get_artifact_version(
            str(row["project_id"]), "source_manifest", str(bindings["source_manifest_version_id"])
        )
        if (
            manifest.head.accepted_version_id != manifest.version.id
            or manifest.version.content_hash != bindings["source_manifest_content_hash"]
        ):
            raise PermissionError("Fake Timeline SourceManifest is no longer accepted")
        source = self._repository.get_source(
            str(row["project_id"]), str(bindings["source_document_id"])
        )
        if f"sha256:{source.raw_sha256}" != bindings["source_sha256"]:
            raise PermissionError("Fake Timeline source is detached")
        return {"project_id": str(row["project_id"]), **bindings}

    def _persist_timeline(
        self,
        running: ClaimedTask,
        package: GeneratedFakeMediaPackage,
    ) -> str:
        timeline = TimelineVersionV1(
            timeline_id=f"preview-{package.manifest.source_document_id.removeprefix('src_')[:12]}",
            revision=1,
            sequence_timebase=SequenceTimebaseData(
                frame_rate=SequenceFrameRateData(num=25, den=1),
                timecode_mode="NON_DROP_FRAME",
            ),
            assets=tuple(
                TimelineAssetV1(
                    asset_id=f"fake-asset-{index:02d}",
                    source_asset_sha256=shot.preview_video.sha256,
                    source_frame_count=shot.preview_video.frame_count,
                )
                for index, shot in enumerate(package.manifest.shots, start=1)
            ),
            clips=tuple(
                TimelineClipV1(
                    clip_id=shot.shot_id,
                    asset_id=f"fake-asset-{index:02d}",
                    source_in_frame=0,
                    duration_frames=shot.duration_frames,
                )
                for index, shot in enumerate(package.manifest.shots, start=1)
            ),
        )
        manifest_version_id = str(self._validate_truth(running)["source_manifest_version_id"])
        try:
            record = self._repository.create_artifact_version(
                project_id=package.manifest.project_id,
                artifact_type="timeline",
                schema_version="1.0.0",
                content=timeline.model_dump(mode="python", exclude_computed_fields=True),
                author_actor_type="agent",
                author_actor_id="local.fake-timeline-media",
                change_summary="由本地 Fake 媒体包生成三镜头可编辑时间线",
                dependencies=(
                    ArtifactDependencyDraft(
                        upstream_version_id=manifest_version_id,
                        relationship="derived_from",
                        impact="blocking",
                    ),
                ),
                accepted_dependency_requirements=(
                    AcceptedArtifactDependencyRequirement(
                        artifact_type="source_manifest",
                        version_id=manifest_version_id,
                    ),
                ),
                producer_attempt_id=running.attempt_id,
            )
            return record.version.id
        except ArtifactConflictError:
            with self._repository._connection() as connection:
                row = connection.execute(
                    """
                    SELECT version.version_id, version.content_hash,
                           version.author_actor_type, version.author_actor_id,
                           artifact.project_id, artifact.artifact_type
                    FROM artifact_versions AS version
                    JOIN artifacts AS artifact ON artifact.artifact_id = version.artifact_id
                    WHERE version.producer_attempt_id = ?
                    """,
                    (running.attempt_id,),
                ).fetchone()
            if (
                row is None
                or str(row["project_id"]) != package.manifest.project_id
                or str(row["artifact_type"]) != "timeline"
                or str(row["content_hash"])
                != canonical_content_hash(
                    timeline.model_dump(mode="python", exclude_computed_fields=True)
                )
                or str(row["author_actor_type"]) != "agent"
                or str(row["author_actor_id"]) != "local.fake-timeline-media"
            ):
                raise
            recovered = self._repository.get_artifact_version(
                package.manifest.project_id,
                "timeline",
                str(row["version_id"]),
            )
            if (
                len(recovered.dependencies) != 1
                or recovered.dependencies[0].upstream_version_id != manifest_version_id
                or recovered.dependencies[0].relationship != "derived_from"
                or recovered.dependencies[0].impact != "blocking"
            ):
                raise
            return recovered.version.id

    def _run(self) -> None:
        next_recovery = 0.0
        while not self._stop.is_set():
            try:
                now = monotonic()
                if now >= next_recovery:
                    self._ledger.recover_expired_local_tasks(task_kind=TASK_KIND)
                    next_recovery = monotonic() + self._recovery
                if self.run_once():
                    continue
            except FakeMediaPackageError as error:
                if self._stop.is_set():
                    break
                _LOGGER.warning("local Fake Timeline generation failed: %s", type(error).__name__)
            except Exception as error:
                _LOGGER.warning("local Fake Timeline iteration failed: %s", type(error).__name__)
            self._stop.wait(self._poll)

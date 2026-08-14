"""Single-purpose story.extract orchestration over the Task Ledger."""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime
from hashlib import sha256
from pathlib import Path
from typing import cast
from uuid import UUID, uuid5

from aijian_api.application_errors import (
    StoryExtractNotFoundError,
    StoryExtractPrerequisiteError,
)
from aijian_api.artifacts import canonical_content_hash
from aijian_api.domain import (
    ArtifactDependencyDraft,
    ArtifactSourceSpanDraft,
    ArtifactVersionRecord,
    SourceDocument,
)
from aijian_api.fake_provider import FakeStoryExtractProvider
from aijian_api.provider_runtime import (
    ProviderFailureResult,
    ProviderNonRetryableError,
    ProviderProtocolError,
    ProviderRetryableError,
    ProviderSuccessResult,
    RemoteUnknownProviderError,
    TextProviderRequest,
    TextProviderSourceBlock,
    TextProviderSourceDocument,
    validate_story_extract_result,
)
from aijian_api.repository import ArtifactNotFoundError, StudioRepository
from aijian_api.source_manifest import SourceManifestContentV1
from aijian_api.story_bible import StoryBibleContentV1
from aijian_api.story_bible_drafts import resolve_story_bible_draft
from aijian_api.story_bible_validation import validate_story_bible_aggregate
from aijian_api.task_ledger import ClaimedTask, LocalTaskLedger, QueuedTask

STORY_EXTRACT_NODE_KEY = "story.extract"
STORY_EXTRACT_NODE_TYPE = "story.extract"
STORY_EXTRACT_TASK_KIND = "local.story.extract"
STORY_EXTRACT_DEFINITION_ID = "story.extract"
STORY_EXTRACT_DEFINITION_VERSION = 1
STORY_EXTRACT_CONTRACT_VERSION = 1
STORY_EXTRACT_MAX_ATTEMPTS = 2
STORY_EXTRACT_PRIORITY = 85
STORY_EXTRACT_GRAPH: dict[str, object] = {"nodes": ["story.extract"]}
STORY_EXTRACT_DEFINITION_HASH = canonical_content_hash(STORY_EXTRACT_GRAPH)
STORY_EXTRACT_INSTRUCTION = (
    "从已验收 SourceManifest 抽取可审阅的 StoryBible 草稿，且每条事实必须带精确 SourceSpan。"
)
FAKE_STORY_EXTRACT_MODEL_ID = "fake-story-v1"
FAKE_STORY_EXTRACT_TIMEOUT_MS = 30_000
FAKE_PROVIDER_CONNECTION_ID = "pcn_" + sha256(b"aijian.story.extract.fake").hexdigest()[:32]
_REQUEST_NAMESPACE = UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")


@dataclass(frozen=True, slots=True)
class StoryExtractTask:
    project_id: str
    workflow_run_id: str
    node_run_id: str
    attempt_id: str
    task_id: str
    node_status: str
    attempt_status: str
    retry_disposition: str | None
    error_code: str | None
    output_version_id: str | None
    source_manifest_version_id: str
    producer_attempt_id: str | None


class StoryExtractService:
    def __init__(
        self,
        repository: StudioRepository,
        ledger: LocalTaskLedger,
        *,
        provider: FakeStoryExtractProvider | None = None,
        provider_factory: Callable[[], FakeStoryExtractProvider] | None = None,
    ) -> None:
        self._repository = repository
        self._ledger = ledger
        self._provider = provider
        self._provider_factory = provider_factory or FakeStoryExtractProvider

    def start(
        self,
        project_id: str,
        source_manifest_version_id: str | None = None,
    ) -> StoryExtractTask:
        self._repository.get_project(project_id)
        accepted = self._require_accepted_manifest(project_id, source_manifest_version_id)
        manifest = SourceManifestContentV1.model_validate(accepted.version.content)
        documents = self._load_manifest_documents(project_id, manifest)
        input_hash = _extraction_input_hash(
            project_id, accepted.version.id, accepted.version.content_hash, manifest
        )
        request_id = uuid5(
            _REQUEST_NAMESPACE,
            f"{project_id}:{accepted.version.id}:{input_hash}",
        )
        request = build_story_extract_provider_request(
            manifest,
            documents,
            source_manifest_version_id=accepted.version.id,
            request_id=request_id,
            idempotency_key=_idempotency_key(accepted.version.id, input_hash),
        )
        queued = self._ledger.enqueue_local_node(
            project_id=project_id,
            definition_id=STORY_EXTRACT_DEFINITION_ID,
            definition_version=STORY_EXTRACT_DEFINITION_VERSION,
            definition_hash=STORY_EXTRACT_DEFINITION_HASH,
            graph=STORY_EXTRACT_GRAPH,
            workflow_input_hash=input_hash,
            node_key=STORY_EXTRACT_NODE_KEY,
            node_type=STORY_EXTRACT_NODE_TYPE,
            contract_version=STORY_EXTRACT_CONTRACT_VERSION,
            input_bindings=_input_bindings(
                accepted.version.id, accepted.version.content_hash, request
            ),
            node_input_hash=input_hash,
            request_fingerprint=provider_request_fingerprint(request),
            idempotency_key=_idempotency_key(accepted.version.id, input_hash),
            max_attempts=STORY_EXTRACT_MAX_ATTEMPTS,
            task_kind=STORY_EXTRACT_TASK_KIND,
            priority=STORY_EXTRACT_PRIORITY,
            available_at=_repository_now(self._repository),
        )
        return self._snapshot(project_id, queued.node_run_id, queued)

    def inspect(self, project_id: str, node_run_id: str) -> StoryExtractTask:
        self._repository.get_project(project_id)
        return self._snapshot(project_id, node_run_id)

    def execute_claimed_task(self, claim: ClaimedTask) -> str:
        if claim.task_kind != STORY_EXTRACT_TASK_KIND:
            raise ValueError("claimed task is not a story.extract handler")
        existing = self._output_for_attempt(claim.attempt_id)
        if existing is not None:
            return existing
        context = self._load_execution_context(claim)
        accepted = self._require_accepted_manifest(
            context.project_id,
            context.source_manifest_version_id,
        )
        if accepted.version.content_hash != context.source_manifest_content_hash:
            raise StoryExtractPrerequisiteError(
                "G1_STALE",
                "Accepted SourceManifest content no longer matches the queued extract",
            )
        manifest = SourceManifestContentV1.model_validate(accepted.version.content)
        documents = self._load_manifest_documents(context.project_id, manifest)
        request = build_story_extract_provider_request(
            manifest,
            documents,
            source_manifest_version_id=accepted.version.id,
            request_id=context.request_id,
            idempotency_key=_idempotency_key(
                accepted.version.id,
                _extraction_input_hash(
                    context.project_id,
                    accepted.version.id,
                    accepted.version.content_hash,
                    manifest,
                ),
            ),
            instruction=context.instruction,
            provider_connection_id=context.provider_connection_id,
            model_id=context.model_id,
            timeout_ms=context.timeout_ms,
        )
        if provider_request_fingerprint(request) != context.request_fingerprint:
            raise ProviderProtocolError(
                "story.extract request fingerprint does not match the attempt"
            )
        result = validate_story_extract_result(
            request, self._provider_for_claim().invoke_story_extract(request)
        )
        if isinstance(result, ProviderFailureResult):
            if result.error.code == "REMOTE_UNKNOWN":
                raise RemoteUnknownProviderError(result.error.message)
            if result.error.retryable:
                raise ProviderRetryableError(result.error.message)
            raise ProviderNonRetryableError(result.error.message, code=result.error.code)
        return self._persist_story_bible(
            claim, context.project_id, accepted.version.id, manifest, result
        )

    def _provider_for_claim(self) -> FakeStoryExtractProvider:
        return self._provider if self._provider is not None else self._provider_factory()

    def _require_accepted_manifest(
        self,
        project_id: str,
        requested_version_id: str | None,
    ) -> ArtifactVersionRecord:
        try:
            latest = self._repository.get_latest_artifact(project_id, "source_manifest")
        except ArtifactNotFoundError as error:
            raise StoryExtractPrerequisiteError(
                "G1_MISSING",
                "An accepted G1 SourceManifest is required before story.extract",
            ) from error
        accepted_version_id = latest.head.accepted_version_id
        if accepted_version_id is None:
            raise StoryExtractPrerequisiteError(
                "G1_UNACCEPTED",
                "G1 SourceManifest exists but has not been accepted",
            )
        if requested_version_id is not None and requested_version_id != accepted_version_id:
            raise StoryExtractPrerequisiteError(
                "G1_STALE",
                "story.extract requires the current accepted G1 SourceManifest version",
            )
        if accepted_version_id == latest.version.id:
            return latest
        return self._repository.get_artifact_version(
            project_id,
            "source_manifest",
            accepted_version_id,
        )

    def _load_manifest_documents(
        self,
        project_id: str,
        manifest: SourceManifestContentV1,
    ) -> tuple[SourceDocument, ...]:
        return tuple(
            self._repository.get_source(project_id, document.source_document_id)
            for document in manifest.documents
        )

    def _persist_story_bible(
        self,
        claim: ClaimedTask,
        project_id: str,
        source_manifest_version_id: str,
        manifest: SourceManifestContentV1,
        result: ProviderSuccessResult,
    ) -> str:
        previous_content: StoryBibleContentV1 | None = None
        parent_version_id: str | None = None
        expected_revision: int | None = None
        try:
            index = self._repository.get_artifact_role_index(project_id, "story_bible")
        except ArtifactNotFoundError:
            pass
        else:
            parent_version_id = index.head.latest_version_id
            expected_revision = index.head.revision
            parent = self._repository.get_artifact_version(
                project_id,
                "story_bible",
                parent_version_id,
            )
            previous_content = StoryBibleContentV1.model_validate(parent.version.content)

        def resolve_content(
            id_factory: Callable[[str], str],
        ) -> tuple[dict[str, object], tuple[ArtifactSourceSpanDraft, ...]]:
            resolved = resolve_story_bible_draft(
                result.output.content,
                tuple(result.output.source_spans),
                id_factory=id_factory,
                previous_content=previous_content,
            )
            validate_story_bible_aggregate(
                resolved.content,
                source_manifest_version_id=source_manifest_version_id,
                source_manifest=manifest,
                source_spans=resolved.source_spans,
            )
            return resolved.content.model_dump(mode="json"), resolved.source_spans

        record = self._repository.create_artifact_version(
            project_id=project_id,
            artifact_type="story_bible",
            schema_version="1.0.0",
            content=None,
            author_actor_type="system",
            author_actor_id="story.extract",
            change_summary="story.extract 生成 StoryBible 草稿",
            parent_version_id=parent_version_id,
            expected_revision=expected_revision,
            dependencies=(
                ArtifactDependencyDraft(
                    upstream_version_id=source_manifest_version_id,
                    relationship="derived_from",
                    impact="blocking",
                ),
            ),
            required_accepted_upstream_version_id=source_manifest_version_id,
            content_resolver=resolve_content,
            producer_attempt_id=claim.attempt_id,
        )
        return record.version.id

    def _snapshot(
        self,
        project_id: str,
        node_run_id: str,
        queued: QueuedTask | None = None,
    ) -> StoryExtractTask:
        row = self._load_snapshot_row(project_id, node_run_id)
        if row is None:
            raise StoryExtractNotFoundError(node_run_id)
        bindings = json.loads(str(row["input_bindings_json"]))
        source_manifest_version_id = str(bindings["source_manifest_version_id"])
        output_version_id = (
            str(row["attempt_output_version_id"])
            if row["attempt_output_version_id"] is not None
            else str(row["node_output_version_id"])
            if row["node_output_version_id"] is not None
            else None
        )
        producer_attempt_id = self._producer_attempt_id(output_version_id)
        return StoryExtractTask(
            project_id=project_id,
            workflow_run_id=str(row["workflow_run_id"]),
            node_run_id=str(row["node_run_id"]),
            attempt_id=str(queued.attempt_id if queued is not None else row["attempt_id"]),
            task_id=str(queued.task_id if queued is not None else row["task_id"]),
            node_status=str(row["node_status"]),
            attempt_status=str(row["attempt_status"]),
            retry_disposition=(
                str(row["retry_disposition"]) if row["retry_disposition"] is not None else None
            ),
            error_code=str(row["error_code"]) if row["error_code"] is not None else None,
            output_version_id=output_version_id,
            source_manifest_version_id=source_manifest_version_id,
            producer_attempt_id=producer_attempt_id,
        )

    def _load_snapshot_row(self, project_id: str, node_run_id: str) -> sqlite3.Row | None:
        connection = _open(self._repository.database_path)
        try:
            return cast(
                sqlite3.Row | None,
                connection.execute(
                    """
                SELECT run.workflow_run_id, node.node_run_id, node.status AS node_status,
                       node.input_bindings_json, node.output_version_id AS node_output_version_id,
                       attempt.attempt_id, attempt.status AS attempt_status,
                       attempt.retry_disposition, attempt.error_code,
                       attempt.output_version_id AS attempt_output_version_id,
                       task.task_id
                FROM workflow_node_runs AS node
                JOIN workflow_runs AS run ON run.workflow_run_id = node.workflow_run_id
                JOIN workflow_attempts AS attempt ON attempt.node_run_id = node.node_run_id
                JOIN task_ledger AS task ON task.attempt_id = attempt.attempt_id
                WHERE run.project_id = ? AND node.node_run_id = ?
                  AND node.node_type = ?
                ORDER BY attempt.attempt_number DESC, task.created_at DESC
                LIMIT 1
                """,
                    (project_id, node_run_id, STORY_EXTRACT_NODE_TYPE),
                ).fetchone(),
            )
        finally:
            connection.close()

    def _load_execution_context(self, claim: ClaimedTask) -> _ExecutionContext:
        connection = _open(self._repository.database_path)
        try:
            row = connection.execute(
                """
                SELECT run.project_id, node.input_bindings_json, attempt.request_fingerprint
                FROM workflow_attempts AS attempt
                JOIN workflow_node_runs AS node ON node.node_run_id = attempt.node_run_id
                JOIN workflow_runs AS run ON run.workflow_run_id = node.workflow_run_id
                WHERE attempt.attempt_id = ? AND node.node_run_id = ?
                """,
                (claim.attempt_id, claim.node_run_id),
            ).fetchone()
        finally:
            connection.close()
        if row is None:
            raise StoryExtractNotFoundError(claim.node_run_id)
        bindings = json.loads(str(row["input_bindings_json"]))
        return _ExecutionContext(
            project_id=str(row["project_id"]),
            source_manifest_version_id=str(bindings["source_manifest_version_id"]),
            source_manifest_content_hash=str(bindings["source_manifest_content_hash"]),
            request_id=UUID(str(bindings["request_id"])),
            provider_connection_id=str(bindings["provider_connection_id"]),
            model_id=str(bindings["model_id"]),
            timeout_ms=int(bindings["timeout_ms"]),
            instruction=str(bindings["instruction"]),
            request_fingerprint=str(row["request_fingerprint"]),
        )

    def _output_for_attempt(self, attempt_id: str) -> str | None:
        connection = _open(self._repository.database_path)
        try:
            row = connection.execute(
                """
                SELECT version_id FROM artifact_versions
                WHERE producer_attempt_id = ?
                """,
                (attempt_id,),
            ).fetchone()
        finally:
            connection.close()
        return None if row is None else str(row["version_id"])

    def _producer_attempt_id(self, output_version_id: str | None) -> str | None:
        if output_version_id is None:
            return None
        connection = _open(self._repository.database_path)
        try:
            row = connection.execute(
                """
                SELECT producer_attempt_id FROM artifact_versions
                WHERE version_id = ?
                """,
                (output_version_id,),
            ).fetchone()
        finally:
            connection.close()
        if row is None or row["producer_attempt_id"] is None:
            return None
        return str(row["producer_attempt_id"])


@dataclass(frozen=True, slots=True)
class _ExecutionContext:
    project_id: str
    source_manifest_version_id: str
    source_manifest_content_hash: str
    request_id: UUID
    provider_connection_id: str
    model_id: str
    timeout_ms: int
    instruction: str
    request_fingerprint: str


def build_story_extract_provider_request(
    manifest: SourceManifestContentV1,
    documents: Sequence[SourceDocument],
    *,
    source_manifest_version_id: str,
    request_id: UUID,
    idempotency_key: str,
    instruction: str | None = None,
    provider_connection_id: str = FAKE_PROVIDER_CONNECTION_ID,
    model_id: str = FAKE_STORY_EXTRACT_MODEL_ID,
    timeout_ms: int = FAKE_STORY_EXTRACT_TIMEOUT_MS,
) -> TextProviderRequest:
    sources = {document.id: document for document in documents}
    provider_documents: list[TextProviderSourceDocument] = []
    for manifest_document in manifest.documents:
        source = sources.get(manifest_document.source_document_id)
        if source is None:
            raise ValueError("Accepted SourceManifest references an unknown source document")
        if source.raw_sha256 != manifest_document.raw_sha256:
            raise ValueError("Accepted SourceManifest source hash does not match persisted source")
        source_blocks = {block.id: block for block in source.blocks}
        encoded = source.normalized_text.encode("utf-8")
        provider_blocks: list[TextProviderSourceBlock] = []
        for manifest_block in manifest_document.blocks:
            block = source_blocks.get(manifest_block.source_block_id)
            if block is None:
                raise ValueError("Accepted SourceManifest references an unknown source block")
            if (
                block.normalized_start_byte != manifest_block.start_byte
                or block.normalized_end_byte != manifest_block.end_byte
            ):
                raise ValueError(
                    "Accepted SourceManifest block range does not match persisted source"
                )
            text = encoded[manifest_block.start_byte : manifest_block.end_byte].decode("utf-8")
            provider_blocks.append(
                TextProviderSourceBlock(
                    source_block_id=manifest_block.source_block_id,
                    chapter_index=manifest_block.chapter_index,
                    start_byte=manifest_block.start_byte,
                    end_byte=manifest_block.end_byte,
                    text=text,
                )
            )
        provider_documents.append(
            TextProviderSourceDocument(
                source_document_id=manifest_document.source_document_id,
                raw_sha256=manifest_document.raw_sha256,
                filename=manifest_document.filename,
                blocks=provider_blocks,
            )
        )
    return TextProviderRequest(
        operation="story.extract",
        request_id=request_id,
        provider_connection_id=provider_connection_id,
        model_id=model_id,
        idempotency_key=idempotency_key,
        source_manifest_version_id=source_manifest_version_id,
        timeout_ms=timeout_ms,
        documents=provider_documents,
        instruction=instruction or extraction_instruction(manifest),
    )


def provider_request_fingerprint(request: TextProviderRequest) -> str:
    return canonical_content_hash(request.model_dump(mode="json"))


def extraction_instruction(manifest: SourceManifestContentV1) -> str:
    if not manifest.exclusions:
        return STORY_EXTRACT_INSTRUCTION
    return f"{STORY_EXTRACT_INSTRUCTION}\n排除：{'、'.join(manifest.exclusions)}"


def _extraction_input_hash(
    project_id: str,
    source_manifest_version_id: str,
    source_manifest_content_hash: str,
    manifest: SourceManifestContentV1,
) -> str:
    return canonical_content_hash(
        {
            "project_id": project_id,
            "source_manifest_version_id": source_manifest_version_id,
            "source_manifest_content_hash": source_manifest_content_hash,
            "scope_type": manifest.scope_type,
            "exclusions": list(manifest.exclusions),
            "documents": [
                {
                    "source_document_id": document.source_document_id,
                    "raw_sha256": document.raw_sha256,
                    "source_block_ids": [block.source_block_id for block in document.blocks],
                    "chapter_indices": sorted({block.chapter_index for block in document.blocks}),
                }
                for document in manifest.documents
            ],
        }
    )


def _idempotency_key(source_manifest_version_id: str, input_hash: str) -> str:
    return f"story.extract:{source_manifest_version_id}:{input_hash}"


def _input_bindings(
    source_manifest_version_id: str,
    source_manifest_content_hash: str,
    request: TextProviderRequest,
) -> dict[str, object]:
    return {
        "source_manifest_version_id": source_manifest_version_id,
        "source_manifest_content_hash": source_manifest_content_hash,
        "request_id": str(request.request_id),
        "provider_connection_id": request.provider_connection_id,
        "model_id": request.model_id,
        "timeout_ms": request.timeout_ms,
        "instruction": request.instruction,
    }


def _open(database_path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(database_path, timeout=5)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def _repository_now(repository: StudioRepository) -> datetime:
    return repository._clock()

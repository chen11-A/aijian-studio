import hashlib
import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Barrier
from uuid import UUID, uuid4

import pytest
from aijian_api.application_errors import (
    StoryExtractNotFoundError,
    StoryExtractPrerequisiteError,
)
from aijian_api.domain import SourceBlock, SourceDocument
from aijian_api.fake_provider import FakeStoryExtractProvider
from aijian_api.ingestion import ingest_text_file
from aijian_api.local_executor import LocalExecutor
from aijian_api.provider_runtime import (
    ProviderProtocolError,
    RemoteUnknownProviderError,
    TextProviderRequest,
    validate_story_extract_result,
)
from aijian_api.repository import StudioRepository
from aijian_api.source_manifest import SourceManifestContentV1
from aijian_api.story_extract import (
    FAKE_STORY_EXTRACT_MODEL_ID,
    STORY_EXTRACT_INSTRUCTION,
    StoryExtractService,
    build_story_extract_provider_request,
    extraction_instruction,
    provider_request_fingerprint,
)
from aijian_api.task_ledger import LocalTaskLedger
from aijian_api.workflow_tasks import (
    InvalidTaskTransitionError,
    NodeRun,
    TaskAttempt,
    TransitionEvidence,
    transition_attempt,
    transition_node,
)
from test_provider_runtime import minimal_output_payload
from test_review_repository import approve_artifact

NOW = datetime(2026, 8, 14, 10, 0, tzinfo=UTC)
SOURCE_TEXT = "第一章\n林岚来到雾城旧站。"


def _sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _open(database: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(database)
    connection.row_factory = sqlite3.Row
    return connection


def _service(
    database: Path,
    clock: list[datetime],
    *,
    provider: FakeStoryExtractProvider | None = None,
) -> tuple[StudioRepository, LocalTaskLedger, StoryExtractService]:
    repository = StudioRepository(database, clock=lambda: clock[0])
    ledger = LocalTaskLedger(database, clock=lambda: clock[0])
    service = StoryExtractService(repository, ledger, provider=provider)
    return repository, ledger, service


def _accepted_source(
    repository: StudioRepository,
    *,
    filename: str = "雾城来信.txt",
    content: str = SOURCE_TEXT,
):
    project = repository.create_project(
        name="雾城来信",
        aspect_ratio="9:16",
        target_duration_seconds=90,
        source_language="zh-CN",
    )
    source = repository.import_source(
        project.id,
        ingest_text_file(filename=filename, content=content.encode()),
    )
    manifest = repository.get_latest_artifact(project.id, "source_manifest")
    approve_artifact(repository, project, manifest, "source_manifest")
    accepted = repository.get_artifact_version(
        project.id,
        "source_manifest",
        repository.get_latest_artifact(project.id, "source_manifest").head.accepted_version_id
        or "",
    )
    return project, source, accepted


def _run_once(service: StoryExtractService, ledger: LocalTaskLedger) -> bool:
    return LocalExecutor(
        ledger,
        worker_id="worker-story",
        lease_duration=timedelta(seconds=30),
        handler=service.execute_claimed_task,
    ).run_once()


def _story_bible_versions(database: Path, project_id: str) -> list[sqlite3.Row]:
    with _open(database) as connection:
        return list(
            connection.execute(
                """
                SELECT version.version_id, version.producer_attempt_id, version.content_hash
                FROM artifact_versions AS version
                JOIN artifacts AS artifact ON artifact.artifact_id = version.artifact_id
                WHERE artifact.project_id = ? AND artifact.artifact_type = 'story_bible'
                ORDER BY version.version_number
                """,
                (project_id,),
            ).fetchall()
        )


def _workflow_counts(database: Path, project_id: str) -> tuple[int, int, int]:
    with _open(database) as connection:
        runs = connection.execute(
            "SELECT COUNT(*) FROM workflow_runs WHERE project_id = ?",
            (project_id,),
        ).fetchone()[0]
        nodes = connection.execute(
            """
            SELECT COUNT(*) FROM workflow_node_runs AS node
            JOIN workflow_runs AS run ON run.workflow_run_id = node.workflow_run_id
            WHERE run.project_id = ?
            """,
            (project_id,),
        ).fetchone()[0]
        attempts = connection.execute(
            """
            SELECT COUNT(*) FROM workflow_attempts AS attempt
            JOIN workflow_node_runs AS node ON node.node_run_id = attempt.node_run_id
            JOIN workflow_runs AS run ON run.workflow_run_id = node.workflow_run_id
            WHERE run.project_id = ?
            """,
            (project_id,),
        ).fetchone()[0]
    return int(runs), int(nodes), int(attempts)


def _hand_built_source() -> tuple[SourceDocument, SourceManifestContentV1, str]:
    text = "林岚来到雾城旧站。"
    encoded = text.encode("utf-8")
    document_id = "src_" + "a" * 32
    block_id = "srcb_" + "b" * 32
    version_id = "ver_" + "c" * 32
    raw_sha256 = _sha256(encoded)
    block = SourceBlock(
        id=block_id,
        source_document_id=document_id,
        project_id="prj_" + "d" * 32,
        ordinal=0,
        kind="paragraph",
        chapter_index=1,
        text=text,
        normalized_start_byte=0,
        normalized_end_byte=len(encoded),
        content_sha256=_sha256(encoded),
    )
    document = SourceDocument(
        id=document_id,
        project_id=block.project_id,
        filename="story.txt",
        media_type="text/plain",
        encoding="utf-8",
        byte_size=len(encoded),
        raw_sha256=raw_sha256,
        normalized_text=text,
        imported_at=NOW,
        chapter_count=1,
        blocks=(block,),
    )
    manifest = SourceManifestContentV1.model_validate(
        {
            "scope_type": "full_work",
            "documents": [
                {
                    "source_document_id": document_id,
                    "import_order": 1,
                    "filename": "story.txt",
                    "media_type": "text/plain",
                    "encoding": "utf-8",
                    "byte_size": len(encoded),
                    "raw_sha256": raw_sha256,
                    "normalized_sha256": raw_sha256,
                    "chapter_count": 1,
                    "blocks": [
                        {
                            "source_block_id": block_id,
                            "ordinal": 0,
                            "kind": "paragraph",
                            "chapter_index": 1,
                            "start_byte": 0,
                            "end_byte": len(encoded),
                            "content_sha256": block.content_sha256,
                        }
                    ],
                }
            ],
            "exclusions": [],
        }
    )
    return document, manifest, version_id


def test_provider_request_is_deterministic_and_bound_to_manifest_blocks() -> None:
    document, manifest, version_id = _hand_built_source()
    request_id = UUID("11111111-1111-1111-1111-111111111111")

    first = build_story_extract_provider_request(
        manifest,
        (document,),
        source_manifest_version_id=version_id,
        request_id=request_id,
        idempotency_key="story.extract:test",
    )
    second = build_story_extract_provider_request(
        manifest,
        (document,),
        source_manifest_version_id=version_id,
        request_id=request_id,
        idempotency_key="story.extract:test",
    )

    assert first == second
    assert first.operation == "story.extract"
    assert first.source_manifest_version_id == version_id
    assert first.model_id == FAKE_STORY_EXTRACT_MODEL_ID
    assert first.instruction.startswith(STORY_EXTRACT_INSTRUCTION)
    assert first.documents[0].source_document_id == document.id
    assert first.documents[0].raw_sha256 == document.raw_sha256
    assert first.documents[0].blocks[0].source_block_id == document.blocks[0].id
    assert first.documents[0].blocks[0].text == document.blocks[0].text
    assert first.documents[0].blocks[0].start_byte == 0
    assert first.documents[0].blocks[0].end_byte == len(document.normalized_text.encode())
    assert provider_request_fingerprint(first) == provider_request_fingerprint(second)


def test_provider_request_rejects_hash_or_block_mismatch() -> None:
    document, manifest, version_id = _hand_built_source()
    wrong_hash = document.blocks[0]
    mutated = SourceDocument(
        id=document.id,
        project_id=document.project_id,
        filename=document.filename,
        media_type=document.media_type,
        encoding=document.encoding,
        byte_size=document.byte_size,
        raw_sha256="f" * 64,
        normalized_text=document.normalized_text,
        imported_at=document.imported_at,
        chapter_count=document.chapter_count,
        blocks=(wrong_hash,),
    )
    with pytest.raises(ValueError, match="source hash"):
        build_story_extract_provider_request(
            manifest,
            (mutated,),
            source_manifest_version_id=version_id,
            request_id=uuid4(),
            idempotency_key="story.extract:mismatch",
        )


def test_missing_unaccepted_and_stale_g1_block_enqueue_without_side_effects(
    tmp_path: Path,
) -> None:
    database = tmp_path / "workspace.db"
    clock = [NOW]
    repository, _ledger, service = _service(database, clock)
    project = repository.create_project(
        name="雾城来信",
        aspect_ratio="9:16",
        target_duration_seconds=90,
        source_language="zh-CN",
    )

    with pytest.raises(StoryExtractPrerequisiteError, match="G1_MISSING") as missing:
        service.start(project.id)
    assert missing.value.code == "G1_MISSING"
    assert _workflow_counts(database, project.id) == (0, 0, 0)
    assert _story_bible_versions(database, project.id) == []

    source = repository.import_source(
        project.id,
        ingest_text_file(filename="雾城来信.txt", content=SOURCE_TEXT.encode()),
    )
    draft = repository.get_latest_artifact(project.id, "source_manifest")
    with pytest.raises(StoryExtractPrerequisiteError, match="G1_UNACCEPTED") as unaccepted:
        service.start(project.id)
    assert unaccepted.value.code == "G1_UNACCEPTED"
    assert _workflow_counts(database, project.id) == (0, 0, 0)
    assert _story_bible_versions(database, project.id) == []

    approve_artifact(repository, project, draft, "source_manifest")
    accepted = repository.get_latest_artifact(project.id, "source_manifest")
    repository.import_source(
        project.id,
        ingest_text_file(filename="续章.txt", content="第二章\n旧站重逢".encode()),
    )
    later = repository.get_latest_artifact(project.id, "source_manifest")
    approve_artifact(repository, project, later, "source_manifest")
    current = repository.get_latest_artifact(project.id, "source_manifest")
    assert current.head.accepted_version_id != accepted.version.id

    with pytest.raises(StoryExtractPrerequisiteError, match="G1_STALE") as stale:
        service.start(project.id, source_manifest_version_id=accepted.version.id)
    assert stale.value.code == "G1_STALE"
    assert _workflow_counts(database, project.id) == (0, 0, 0)
    assert _story_bible_versions(database, project.id) == []
    assert source.id


def test_repeated_and_concurrent_enqueue_is_idempotent(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    clock = [NOW]
    repository, _ledger, service = _service(database, clock)
    project, _source, accepted = _accepted_source(repository)

    first = service.start(project.id)
    second = service.start(
        project.id,
        source_manifest_version_id=accepted.version.id,
    )
    assert first == second
    assert _workflow_counts(database, project.id) == (1, 1, 1)

    barrier = Barrier(4)

    def submit(_index: int):
        local_service = StoryExtractService(
            StudioRepository(database, clock=lambda: clock[0]),
            LocalTaskLedger(database, clock=lambda: clock[0]),
        )
        barrier.wait()
        return local_service.start(project.id)

    with ThreadPoolExecutor(max_workers=4) as pool:
        queued = list(pool.map(submit, range(4)))

    assert {item.node_run_id for item in queued} == {first.node_run_id}
    assert _workflow_counts(database, project.id) == (1, 1, 1)
    assert _story_bible_versions(database, project.id) == []


def test_successful_extract_creates_one_task_attempt_and_story_bible_draft(
    tmp_path: Path,
) -> None:
    database = tmp_path / "workspace.db"
    clock = [NOW]
    repository, ledger, service = _service(database, clock)
    project, source, accepted = _accepted_source(repository)

    started = service.start(project.id)
    assert started.node_status == "PENDING"
    assert started.attempt_status == "READY"
    assert started.source_manifest_version_id == accepted.version.id
    assert started.output_version_id is None

    assert _run_once(service, ledger)
    assert not _run_once(service, ledger)

    completed = service.inspect(project.id, started.node_run_id)
    versions = _story_bible_versions(database, project.id)
    assert completed.node_status == "SUCCEEDED"
    assert completed.attempt_status == "SUCCEEDED"
    assert completed.output_version_id == versions[0]["version_id"]
    assert completed.producer_attempt_id == started.attempt_id
    assert len(versions) == 1
    assert _workflow_counts(database, project.id) == (1, 1, 1)

    record = repository.get_artifact_version(
        project.id,
        "story_bible",
        completed.output_version_id or "",
    )
    assert record.version.author_actor_type == "system"
    assert record.version.author_actor_id == "story.extract"
    assert {span.source_document_id for span in record.source_spans} == {source.id}
    encoded = source.normalized_text.encode("utf-8")
    blocks = {block.id: block for block in source.blocks}
    for span in record.source_spans:
        block = blocks[span.source_block_id]
        assert (
            block.normalized_start_byte
            <= span.start_byte
            < span.end_byte
            <= (block.normalized_end_byte)
        )
        quote = encoded[span.start_byte : span.end_byte]
        quote.decode("utf-8")
        assert span.quote_hash == f"sha256:{_sha256(quote)}"
        assert span.source_document_id == source.id
    assert any(
        dependency.upstream_version_id == accepted.version.id
        and dependency.relationship == "derived_from"
        and dependency.impact == "blocking"
        for dependency in record.dependencies
    )
    with _open(database) as connection:
        persisted = connection.execute(
            "SELECT producer_attempt_id FROM artifact_versions WHERE version_id = ?",
            (record.version.id,),
        ).fetchone()
    assert persisted is not None
    assert persisted["producer_attempt_id"] == started.attempt_id


def test_malformed_provider_result_fails_before_artifact_persistence(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    clock = [NOW]
    fixture = minimal_output_payload()
    fixture["content"]["source_scope"]["source_manifest_version_id"] = "ver_" + "f" * 32
    repository, ledger, service = _service(
        database,
        clock,
        provider=FakeStoryExtractProvider(fixture=fixture),
    )
    project, _source, _accepted = _accepted_source(repository)
    started = service.start(project.id)

    with pytest.raises(ProviderProtocolError, match="different source manifest"):
        _run_once(service, ledger)

    assert _story_bible_versions(database, project.id) == []
    inspected = service.inspect(project.id, started.node_run_id)
    assert inspected.node_status == "PENDING"
    assert inspected.attempt_status == "READY"
    assert inspected.attempt_id != started.attempt_id
    with _open(database) as connection:
        failed = connection.execute(
            "SELECT status, retry_disposition FROM workflow_attempts WHERE attempt_id = ?",
            (started.attempt_id,),
        ).fetchone()
    assert failed is not None
    assert tuple(failed) == ("FAILED", "SAFE_LOCAL_RETRY")


def test_retryable_provider_timeout_follows_legal_local_retry_path(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    clock = [NOW]
    repository, ledger, service = _service(
        database,
        clock,
        provider=FakeStoryExtractProvider(fault="timeout"),
    )
    project, _source, _accepted = _accepted_source(repository)
    started = service.start(project.id)

    with pytest.raises(RuntimeError, match="timeout"):
        _run_once(service, ledger)

    inspected = service.inspect(project.id, started.node_run_id)
    assert inspected.node_status == "PENDING"
    assert inspected.attempt_status == "READY"
    assert inspected.retry_disposition is None
    with _open(database) as connection:
        first = connection.execute(
            """
            SELECT status, retry_disposition, error_code
            FROM workflow_attempts WHERE attempt_id = ?
            """,
            (started.attempt_id,),
        ).fetchone()
    assert first is not None
    assert tuple(first) == ("FAILED", "SAFE_LOCAL_RETRY", "ProviderRetryableError")
    assert _story_bible_versions(database, project.id) == []


def test_remote_unknown_requires_reconciliation_and_cannot_return_to_ready(
    tmp_path: Path,
) -> None:
    database = tmp_path / "workspace.db"
    clock = [NOW]
    repository, ledger, service = _service(
        database,
        clock,
        provider=FakeStoryExtractProvider(fault="remote_unknown"),
    )
    project, _source, _accepted = _accepted_source(repository)
    started = service.start(project.id)

    with pytest.raises(RemoteUnknownProviderError):
        _run_once(service, ledger)

    inspected = service.inspect(project.id, started.node_run_id)
    assert inspected.node_status == "RECONCILIATION_REQUIRED"
    assert inspected.attempt_status == "FAILED"
    assert inspected.retry_disposition == "REMOTE_UNKNOWN"
    assert inspected.error_code == "REMOTE_UNKNOWN"
    assert _workflow_counts(database, project.id) == (1, 1, 1)
    assert _story_bible_versions(database, project.id) == []
    assert not _run_once(service, ledger)

    replayed = service.start(project.id)
    assert replayed.node_run_id == started.node_run_id
    assert replayed.node_status == "RECONCILIATION_REQUIRED"
    clock[0] = NOW + timedelta(seconds=31)
    summary = ledger.recover_expired_local_tasks()
    assert summary.requeued == 0
    assert service.inspect(project.id, started.node_run_id).attempt_status == "FAILED"

    reconciling = NodeRun(
        id=started.node_run_id,
        workflow_run_id=started.workflow_run_id,
        node_key="story.extract",
        node_type="story.extract",
        state="RECONCILIATION_REQUIRED",
        input_fingerprint=f"sha256:{'a' * 64}",
        idempotency_key="story.extract",
        attempt_count=1,
        max_attempts=2,
        active_attempt_id=started.attempt_id,
        output_version_id=None,
        revision=2,
        created_at=NOW,
        updated_at=NOW,
    )
    failed_node = NodeRun(
        id=started.node_run_id,
        workflow_run_id=started.workflow_run_id,
        node_key="story.extract",
        node_type="story.extract",
        state="FAILED",
        input_fingerprint=f"sha256:{'a' * 64}",
        idempotency_key="story.extract",
        attempt_count=1,
        max_attempts=2,
        active_attempt_id=started.attempt_id,
        output_version_id=None,
        revision=2,
        created_at=NOW,
        updated_at=NOW,
    )
    unknown_attempt = TaskAttempt(
        id=started.attempt_id,
        node_run_id=started.node_run_id,
        attempt_number=1,
        execution_mode="remote",
        state="REMOTE_UNKNOWN",
        input_fingerprint=f"sha256:{'a' * 64}",
        request_fingerprint=f"sha256:{'b' * 64}",
        provider_account_id="account",
        provider_idempotency_key="key",
        provider_capabilities=None,
        provider_job_id=None,
        dispatch_started_at=None,
        retry_disposition="REMOTE_UNKNOWN",
        output_version_id=None,
        revision=2,
        created_at=NOW,
        updated_at=NOW,
    )
    with pytest.raises(InvalidTaskTransitionError, match="reconciliation"):
        transition_node(reconciling, "RUNNING", now=NOW)
    with pytest.raises(InvalidTaskTransitionError, match="safe retry"):
        transition_node(
            failed_node,
            "PENDING",
            now=NOW,
            evidence=TransitionEvidence(retry_disposition="REMOTE_UNKNOWN"),
        )
    with pytest.raises(InvalidTaskTransitionError):
        transition_attempt(unknown_attempt, "READY", now=NOW)


def test_stale_claim_recovery_completes_without_duplicate_story_bible(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    clock = [NOW]
    repository, ledger, service = _service(database, clock)
    project, _source, _accepted = _accepted_source(repository)
    started = service.start(project.id)
    claim = ledger.claim_ready_task(
        worker_id="worker-crash",
        lease_duration=timedelta(seconds=30),
    )
    assert claim is not None
    ledger.mark_attempt_running(claim)
    clock[0] = NOW + timedelta(seconds=31)

    summary = ledger.recover_expired_local_tasks()
    assert (summary.recovered, summary.requeued, summary.succeeded) == (1, 1, 0)
    assert _story_bible_versions(database, project.id) == []

    recovered = service.inspect(project.id, started.node_run_id)
    assert recovered.node_status == "PENDING"
    assert recovered.attempt_status == "READY"
    assert recovered.attempt_id != started.attempt_id

    assert _run_once(service, ledger)
    versions = _story_bible_versions(database, project.id)
    assert len(versions) == 1
    completed = service.inspect(project.id, started.node_run_id)
    assert completed.node_status == "SUCCEEDED"
    assert completed.producer_attempt_id == recovered.attempt_id
    assert completed.producer_attempt_id != started.attempt_id


def test_committed_output_recovery_completes_without_rewriting_artifact(
    tmp_path: Path,
) -> None:
    database = tmp_path / "workspace.db"
    clock = [NOW]
    repository, ledger, service = _service(database, clock)
    project, _source, _accepted = _accepted_source(repository)
    started = service.start(project.id)
    claim = ledger.claim_ready_task(
        worker_id="worker-output",
        lease_duration=timedelta(seconds=30),
    )
    assert claim is not None
    running = ledger.mark_attempt_running(claim)
    output_version_id = service.execute_claimed_task(running)
    assert service.execute_claimed_task(running) == output_version_id
    first_versions = _story_bible_versions(database, project.id)
    assert len(first_versions) == 1
    assert first_versions[0]["version_id"] == output_version_id
    content_hash = first_versions[0]["content_hash"]

    clock[0] = NOW + timedelta(seconds=31)
    summary = ledger.recover_expired_local_tasks()
    assert (summary.recovered, summary.succeeded, summary.requeued) == (1, 1, 0)

    completed = service.inspect(project.id, started.node_run_id)
    versions = _story_bible_versions(database, project.id)
    assert completed.node_status == "SUCCEEDED"
    assert completed.output_version_id == output_version_id
    assert completed.producer_attempt_id == running.attempt_id
    assert len(versions) == 1
    assert versions[0]["content_hash"] == content_hash
    assert not _run_once(service, ledger)
    assert _story_bible_versions(database, project.id) == versions


def test_inspect_unknown_node_is_not_found(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    clock = [NOW]
    repository, _ledger, service = _service(database, clock)
    project, _source, _accepted = _accepted_source(repository)
    with pytest.raises(StoryExtractNotFoundError):
        service.inspect(project.id, "node_" + "f" * 32)


def test_provider_request_rejects_unknown_document_block_or_range() -> None:
    document, manifest, version_id = _hand_built_source()
    request_kwargs = {
        "source_manifest_version_id": version_id,
        "request_id": uuid4(),
        "idempotency_key": "story.extract:unknown",
    }
    with pytest.raises(ValueError, match="unknown source document"):
        build_story_extract_provider_request(manifest, (), **request_kwargs)

    missing_block = SourceDocument(
        id=document.id,
        project_id=document.project_id,
        filename=document.filename,
        media_type=document.media_type,
        encoding=document.encoding,
        byte_size=document.byte_size,
        raw_sha256=document.raw_sha256,
        normalized_text=document.normalized_text,
        imported_at=document.imported_at,
        chapter_count=document.chapter_count,
        blocks=(),
    )
    with pytest.raises(ValueError, match="unknown source block"):
        build_story_extract_provider_request(manifest, (missing_block,), **request_kwargs)

    shifted = replace(document.blocks[0], normalized_start_byte=1, normalized_end_byte=2)
    shifted_document = SourceDocument(
        id=document.id,
        project_id=document.project_id,
        filename=document.filename,
        media_type=document.media_type,
        encoding=document.encoding,
        byte_size=document.byte_size,
        raw_sha256=document.raw_sha256,
        normalized_text=document.normalized_text,
        imported_at=document.imported_at,
        chapter_count=document.chapter_count,
        blocks=(shifted,),
    )
    with pytest.raises(ValueError, match="block range"):
        build_story_extract_provider_request(manifest, (shifted_document,), **request_kwargs)


def test_extraction_instruction_includes_manifest_exclusions() -> None:
    document, manifest, _version_id = _hand_built_source()
    with_exclusions = SourceManifestContentV1.model_validate(
        {**manifest.model_dump(mode="json"), "exclusions": ["附录"]}
    )
    assert extraction_instruction(manifest) == STORY_EXTRACT_INSTRUCTION
    assert "附录" in extraction_instruction(with_exclusions)


def test_start_uses_current_accepted_manifest_when_a_newer_draft_exists(
    tmp_path: Path,
) -> None:
    database = tmp_path / "workspace.db"
    clock = [NOW]
    repository, _ledger, service = _service(database, clock)
    project, _source, accepted = _accepted_source(repository)
    repository.import_source(
        project.id,
        ingest_text_file(filename="续章.txt", content="第二章\n旧站重逢".encode()),
    )
    latest = repository.get_latest_artifact(project.id, "source_manifest")
    assert latest.head.accepted_version_id == accepted.version.id
    assert latest.version.id != accepted.version.id

    started = service.start(project.id)
    assert started.source_manifest_version_id == accepted.version.id


def test_execute_rejects_wrong_task_kind_and_refused_provider(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    clock = [NOW]
    repository, ledger, service = _service(
        database,
        clock,
        provider=FakeStoryExtractProvider(fault="refused"),
    )
    project, _source, _accepted = _accepted_source(repository)
    started = service.start(project.id)
    claim = ledger.claim_ready_task(
        worker_id="worker-refused",
        lease_duration=timedelta(seconds=30),
    )
    assert claim is not None
    running = ledger.mark_attempt_running(claim)
    with pytest.raises(ValueError, match="not a story.extract"):
        service.execute_claimed_task(replace(running, task_kind="local.execute"))
    with pytest.raises(ProviderProtocolError, match="refused"):
        service.execute_claimed_task(running)
    assert service.inspect(project.id, started.node_run_id).output_version_id is None


def test_execute_rejects_stale_bindings_and_missing_context(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    clock = [NOW]
    repository, ledger, service = _service(database, clock)
    project, _source, _accepted = _accepted_source(repository)
    started = service.start(project.id)
    claim = ledger.claim_ready_task(
        worker_id="worker-stale",
        lease_duration=timedelta(seconds=30),
    )
    assert claim is not None
    running = ledger.mark_attempt_running(claim)
    with sqlite3.connect(database) as connection:
        bindings = connection.execute(
            "SELECT input_bindings_json FROM workflow_node_runs WHERE node_run_id = ?",
            (started.node_run_id,),
        ).fetchone()[0]
        payload = json.loads(bindings)
        payload["source_manifest_content_hash"] = f"sha256:{'f' * 64}"
        connection.execute(
            "UPDATE workflow_node_runs SET input_bindings_json = ? WHERE node_run_id = ?",
            (json.dumps(payload), started.node_run_id),
        )
        connection.commit()
    with pytest.raises(StoryExtractPrerequisiteError, match="G1_STALE"):
        service.execute_claimed_task(running)

    missing = replace(running, attempt_id="att_" + "f" * 32, node_run_id="node_" + "f" * 32)
    with pytest.raises(StoryExtractNotFoundError):
        service.execute_claimed_task(missing)


def test_execute_rejects_request_fingerprint_drift(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    clock = [NOW]
    repository, ledger, service = _service(database, clock)
    _project, _source, _accepted = _accepted_source(repository)
    started = service.start(_project.id)
    claim = ledger.claim_ready_task(
        worker_id="worker-fingerprint",
        lease_duration=timedelta(seconds=30),
    )
    assert claim is not None
    running = ledger.mark_attempt_running(claim)
    with sqlite3.connect(database) as connection:
        connection.execute(
            "UPDATE workflow_attempts SET request_fingerprint = ? WHERE attempt_id = ?",
            (f"sha256:{'f' * 64}", started.attempt_id),
        )
        connection.commit()
    with pytest.raises(ProviderProtocolError, match="fingerprint"):
        service.execute_claimed_task(running)


def test_successful_extract_can_append_to_an_existing_story_bible(tmp_path: Path) -> None:
    database = tmp_path / "workspace.db"
    clock = [NOW]
    repository, ledger, service = _service(database, clock)
    project, source, accepted = _accepted_source(repository)
    from aijian_api.domain import ArtifactDependencyDraft
    from test_story_bible import valid_story_bible_payload

    repository.create_artifact_version(
        project_id=project.id,
        artifact_type="story_bible",
        schema_version="1.0.0",
        content=valid_story_bible_payload(),
        author_actor_type="human",
        author_actor_id="local-user",
        change_summary="人工草稿",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=accepted.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
        required_accepted_upstream_version_id=accepted.version.id,
    )
    service.start(project.id)
    assert _run_once(service, ledger)
    versions = _story_bible_versions(database, project.id)
    assert len(versions) == 2
    assert source.id


def test_validate_story_extract_result_is_the_runtime_contract() -> None:
    document, manifest, version_id = _hand_built_source()
    request = build_story_extract_provider_request(
        manifest,
        (document,),
        source_manifest_version_id=version_id,
        request_id=UUID("11111111-1111-1111-1111-111111111111"),
        idempotency_key="story.extract:contract",
    )
    assert isinstance(request, TextProviderRequest)
    result = FakeStoryExtractProvider().invoke_story_extract(request)
    assert validate_story_extract_result(request, result) is result

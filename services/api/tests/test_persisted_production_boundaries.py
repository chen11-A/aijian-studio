"""Persisted readback keeps confirmation, accounting and export rules closed."""

import sqlite3
from datetime import UTC, datetime
from pathlib import Path

import pytest
from aijian_api.episode_script_confirmation_contracts import CreateEpisodeScriptConfirmationRequest
from aijian_api.episode_script_confirmation_store import (
    EpisodeScriptConfirmationConflictError,
    EpisodeScriptConfirmationNotFoundError,
    EpisodeScriptConfirmationStorageError,
    EpisodeScriptConfirmationStore,
)
from aijian_api.episode_script_contracts import CreateEpisodeScriptVersionRequest
from aijian_api.episode_script_store import EpisodeScriptStore
from aijian_api.media_asset_probe_store import MediaAssetProbeEvidenceError, _selected_row
from aijian_api.media_toolchain import MediaToolchain
from aijian_api.product_export_contracts import (
    ProductExportClaimRequest,
    ProductExportOperationData,
)
from aijian_api.product_export_schema import PRODUCT_EXPORT_MIGRATION
from aijian_api.product_export_single_video_service import (
    ProductExportExecutionError,
    ProductExportSingleVideoService,
)
from aijian_api.product_export_store import (
    ProductExportStateError,
    ProductExportStore,
    _read_operation,
)
from aijian_api.product_export_windows_job import ProductExportJobManager
from aijian_api.remote_call_accounting import read_call_accounting_in_connection
from aijian_api.repository import StudioRepository
from pydantic import ValidationError
from test_draft_export_runtime import fixture as assembly_fixture
from test_episode_script_dependency_integrity import script_with_dependency_order

PROJECT = "prj_" + "1" * 32
EPISODE = "ep_" + "2" * 32
OPERATION = "peop_" + "3" * 32
STAMP = "2026-10-08T12:00:00+00:00"
HASH = "sha256:" + "4" * 64


def operation_fields() -> dict[str, str | int | None]:
    return {
        "project_id": PROJECT,
        "episode_id": EPISODE,
        "operation_id": OPERATION,
        "request_hash": HASH,
        "request_json": "{}",
        "assembly_artifact_id": "art_" + "5" * 32,
        "assembly_version_id": "ver_" + "6" * 32,
        "assembly_content_hash": HASH,
        "assembly_head_revision": 1,
        "render_plan_hash": HASH,
        "render_plan_json": "{}",
        "output_target_identity": "synthetic-output",
        "inputs_sealed_at": STAMP,
        "media_input_count": 1,
        "subtitle_input_count": 0,
        "status": "CLAIMED",
        "progress_phase": "QUEUED",
        "progress_frames": 0,
        "total_frames": 24,
        "cancel_requested_at": None,
        "unknown_reason": None,
        "created_at": STAMP,
        "updated_at": STAMP,
        "started_at": None,
        "finished_at": None,
        "reconciled_at": None,
    }


def insert_operation(connection: sqlite3.Connection, fields: dict[str, str | int | None]) -> None:
    columns = ", ".join(fields)
    placeholders = ", ".join("?" for _ in fields)
    connection.execute(
        f"INSERT INTO product_export_operations ({columns}) VALUES ({placeholders})",
        tuple(fields.values()),
    )


@pytest.mark.parametrize(
    ("status", "phase"),
    [
        ("CLAIMED", "QUEUED"),
        ("RUNNING", "ENCODING"),
        ("RUNNING", "VERIFYING"),
        ("UNKNOWN", "ENCODING"),
        ("CANCELLED", "QUEUED"),
        ("SUCCEEDED", "VERIFYING"),
    ],
)
def test_exact_persisted_export_statuses_and_verified_receipt(status: str, phase: str) -> None:
    with sqlite3.connect(":memory:") as connection:
        connection.row_factory = sqlite3.Row
        # Use the production DDL; no claim or encoder is invoked by this readback fixture.
        connection.execute(PRODUCT_EXPORT_MIGRATION[0])
        connection.execute(PRODUCT_EXPORT_MIGRATION[3])
        fields = operation_fields()
        fields.update(
            status=status,
            progress_phase=phase,
            started_at=STAMP if status in {"RUNNING", "SUCCEEDED"} else None,
            finished_at=STAMP if status in {"UNKNOWN", "CANCELLED", "SUCCEEDED"} else None,
            cancel_requested_at=STAMP if status == "CANCELLED" else None,
            unknown_reason="PROCESS_INTERRUPTED" if status == "UNKNOWN" else None,
        )
        insert_operation(connection, fields)
        if status == "SUCCEEDED":
            connection.execute(
                "INSERT INTO product_export_outputs VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (PROJECT, OPERATION, "/synthetic/result.mp4", "7" * 64, 32, "{}", HASH, STAMP),
            )
        read = _read_operation(connection, PROJECT, OPERATION)
        assert read.status == status and read.progress_phase == phase
        assert read.assembly.head_revision == 1 and read.total_frames == 24
        assert read.unknown_reason == fields["unknown_reason"]
        assert (read.output is not None) == (status == "SUCCEEDED")
        if read.output is not None:
            assert read.output.byte_size == 32 and read.output.sha256 == "7" * 64


@pytest.mark.parametrize(("column", "value"), [("status", "READY"), ("progress_phase", "DONE")])
def test_corrupt_export_literals_are_rejected_instead_of_reinterpreted(
    column: str, value: str
) -> None:
    with sqlite3.connect(":memory:") as connection:
        connection.row_factory = sqlite3.Row
        connection.execute(PRODUCT_EXPORT_MIGRATION[0])
        connection.execute("PRAGMA ignore_check_constraints = ON")
        fields = operation_fields()
        fields[column] = value
        insert_operation(connection, fields)
        with pytest.raises(ValidationError, match=column):
            _read_operation(connection, PROJECT, OPERATION)


def test_success_without_verified_output_receipt_is_rejected() -> None:
    with sqlite3.connect(":memory:") as connection:
        connection.row_factory = sqlite3.Row
        connection.execute(PRODUCT_EXPORT_MIGRATION[0])
        connection.execute(PRODUCT_EXPORT_MIGRATION[3])
        fields = operation_fields()
        fields.update(status="SUCCEEDED", progress_phase="VERIFYING", started_at=STAMP)
        fields["finished_at"] = STAMP
        insert_operation(connection, fields)
        with pytest.raises(ProductExportStateError) as caught:
            _read_operation(connection, PROJECT, OPERATION)
        assert caught.value.code == "CORRUPT_RECEIPT"


def test_interrupted_export_never_restarts_and_cancellation_requires_a_signal(
    tmp_path: Path,
) -> None:
    repository, project, episode, _asset, assembly = assembly_fixture(tmp_path)
    fields = operation_fields()
    fields.update(
        project_id=project,
        episode_id=episode,
        assembly_artifact_id=assembly.artifact_id,
        assembly_version_id=assembly.version_id,
        assembly_content_hash=assembly.content_hash,
        assembly_head_revision=assembly.head_revision,
        inputs_sealed_at=None,
    )
    with repository._connection() as connection:
        insert_operation(connection, fields)
        connection.commit()
    store = ProductExportStore(repository)
    # An unsealed input snapshot must never become an encoding operation.
    with pytest.raises(ProductExportStateError) as rights:
        store.mark_running(project, OPERATION)
    assert rights.value.code == "ASSEMBLY_CHANGED"
    assert store.get(project, OPERATION).status == "CLAIMED"
    assert store.mark_interrupted_unknown() == 1
    recovered = store.get(project, OPERATION)
    assert recovered.status == "UNKNOWN" and recovered.unknown_reason == "PROCESS_INTERRUPTED"
    assert recovered.output is None and recovered.started_at is None
    assert store.mark_interrupted_unknown() == 0
    with pytest.raises(ProductExportStateError) as cancellation:
        store.mark_cancelled(project, OPERATION)
    assert cancellation.value.code == "NO_CANCEL_REQUEST"
    assert store.request_cancel(project, OPERATION).status == "UNKNOWN"
    cancelled = store.mark_cancelled(project, OPERATION)
    assert cancelled.status == "CANCELLED" and cancelled.reconciled_at is not None
    assert store.request_cancel(project, OPERATION) == cancelled


@pytest.mark.parametrize(
    ("status", "response_id", "response_status"),
    [
        ("RUNNING", None, "NO_RESPONSE_RECORDED"),
        ("RUNNING", "synthetic-response", "RESPONSE_ID_RECORDED"),
        ("REMOTE_UNKNOWN", None, "REMOTE_UNKNOWN"),
        ("REMOTE_UNKNOWN", "synthetic-response", "REMOTE_UNKNOWN"),
    ],
)
def test_remote_uncertainty_keeps_response_precedence_and_cost_unknown(
    status: str, response_id: str | None, response_status: str
) -> None:
    with sqlite3.connect(":memory:") as connection:
        connection.row_factory = sqlite3.Row
        connection.executescript(
            """
            CREATE TABLE workflow_runs(workflow_run_id TEXT, project_id TEXT);
            CREATE TABLE workflow_node_runs(node_run_id TEXT, workflow_run_id TEXT);
            CREATE TABLE workflow_attempts(
                attempt_id TEXT, node_run_id TEXT, status TEXT,
                provider_response_id TEXT, execution_mode TEXT
            );
            CREATE TABLE remote_execution_authorization_snapshots(attempt_id TEXT, event_kind TEXT);
            CREATE TABLE remote_settlement_receipts(attempt_id TEXT);
            """
        )
        attempt_id = "att_" + "8" * 32
        connection.execute("INSERT INTO workflow_runs VALUES ('workflow', ?)", (PROJECT,))
        connection.execute("INSERT INTO workflow_node_runs VALUES ('node', 'workflow')")
        connection.execute(
            "INSERT INTO workflow_attempts VALUES (?, 'node', ?, ?, 'remote')",
            (attempt_id, status, response_id),
        )
        connection.commit()
        connection.execute("PRAGMA query_only = ON")
        connection.execute("BEGIN")
        accounting = read_call_accounting_in_connection(
            connection, project_id=PROJECT, attempt_id=attempt_id, checked_at=datetime.now(UTC)
        )
        assert accounting.response_status == response_status
        assert accounting.provider_response_id == response_id
        assert accounting.attempt_status == status
        assert accounting.reservation_status == "NOT_RESERVED" and accounting.calls_reserved == 0
        assert accounting.transport_dispatch_status == "UNVERIFIED"
        assert accounting.cost_status == "UNKNOWN" and accounting.actual_cost_micros is None
        assert accounting.cost_evidence_status == "NO_RECEIPT"
        assert accounting.currency is None and accounting.automatic_retry_allowed is False


def test_confirmation_readback_replay_and_stale_head_keep_exact_binding(tmp_path: Path) -> None:
    repository, project, episode, script, _brief, _source = script_with_dependency_order(
        tmp_path, True
    )
    store = EpisodeScriptConfirmationStore(repository)
    absent = store.get_status(project_id=project, episode_id=episode)
    assert absent.confirmation is None and not absent.current
    with pytest.raises(EpisodeScriptConfirmationNotFoundError):
        store.get_status(project_id=project, episode_id=episode, confirmation_id="esc_" + "0" * 32)
    payload = CreateEpisodeScriptConfirmationRequest(
        version_id=script.version_id,
        expected_content_hash=script.content_hash,
        expected_head_revision=script.head_revision,
        confirm=True,
    )
    confirmed, replayed = store.confirm(
        project_id=project,
        episode_id=episode,
        payload=payload,
        idempotency_key="receipt",
        actor_id="synthetic-reviewer",
    )
    assert confirmed.current and not replayed and confirmed.confirmation is not None
    repeated, replayed = store.confirm(
        project_id=project,
        episode_id=episode,
        payload=payload,
        idempotency_key="receipt",
        actor_id="synthetic-reviewer",
    )
    assert replayed and repeated == confirmed
    with pytest.raises(EpisodeScriptConfirmationConflictError):
        store.confirm(
            project_id=project,
            episode_id=episode,
            payload=payload.model_copy(update={"expected_head_revision": script.head_revision + 1}),
            idempotency_key="receipt",
            actor_id="synthetic-reviewer",
        )
    updated, _ = EpisodeScriptStore(StudioRepository(repository.database_path)).write(
        project_id=project,
        episode_id=episode,
        payload=CreateEpisodeScriptVersionRequest(
            content=script.content,
            parent_version_id=script.version_id,
            expected_revision=script.head_revision,
            change_summary="New unconfirmed version",
        ),
        idempotency_key="script-next",
        actor_id="synthetic-reviewer",
    )
    stale = store.get_status(
        project_id=project,
        episode_id=episode,
        confirmation_id=confirmed.confirmation.confirmation_id,
    )
    assert not stale.current and stale.confirmation == confirmed.confirmation
    assert stale.latest_version_id == updated.version_id


@pytest.mark.parametrize("reader", ["head", "latest_receipt", "selected_receipt"])
def test_confirmation_rejects_non_row_factory_at_the_storage_boundary(
    tmp_path: Path, reader: str
) -> None:
    repository, project, episode, script, _brief, _source = script_with_dependency_order(
        tmp_path, False
    )
    store = EpisodeScriptConfirmationStore(repository)
    status, _ = store.confirm(
        project_id=project,
        episode_id=episode,
        payload=CreateEpisodeScriptConfirmationRequest(
            version_id=script.version_id,
            expected_content_hash=script.content_hash,
            expected_head_revision=script.head_revision,
            confirm=True,
        ),
        idempotency_key="receipt",
        actor_id="synthetic-reviewer",
    )
    assert status.confirmation is not None
    with sqlite3.connect(repository.database_path) as connection:
        with pytest.raises(EpisodeScriptConfirmationStorageError, match="row"):
            if reader == "head":
                store._head(connection, project, episode)
            else:
                store._receipt(
                    connection,
                    project,
                    episode,
                    status.confirmation.confirmation_id if reader == "selected_receipt" else None,
                )


def test_media_selection_rejects_non_row_factory_before_using_metadata() -> None:
    with sqlite3.connect(":memory:") as connection:
        connection.executescript(
            """
            CREATE TABLE media_assets(project_id TEXT, id TEXT, deleted_at TEXT);
            CREATE TABLE media_asset_versions(
                project_id TEXT, asset_id TEXT, id TEXT, sha256 TEXT, byte_size INTEGER, kind TEXT
            );
            INSERT INTO media_assets VALUES ('project', 'asset', NULL);
            INSERT INTO media_asset_versions
            VALUES ('project', 'asset', 'version', 'hash', 1, 'video');
            """
        )
        with pytest.raises(MediaAssetProbeEvidenceError) as caught:
            _selected_row(connection, "project", "asset", "version")
        assert caught.value.code == "MEDIA_RECORD_CORRUPT"


@pytest.mark.parametrize("outcome", ["CLAIMED", "RUNNING", "UNKNOWN", "CANCELLED", "READ_FAILED"])
def test_worker_failure_readback_preserves_terminal_uncertainty_without_retry(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, outcome: str
) -> None:
    with sqlite3.connect(":memory:") as connection:
        connection.row_factory = sqlite3.Row
        connection.execute(PRODUCT_EXPORT_MIGRATION[0])
        insert_operation(connection, operation_fields())
        operation = _read_operation(connection, PROJECT, OPERATION)
    request = ProductExportClaimRequest.model_validate(
        {
            "operation_id": OPERATION,
            "assembly": operation.assembly,
            "media_rights": (),
            "spec": {
                "container": "MP4",
                "width": 160,
                "height": 90,
                "frame_rate_num": 24,
                "frame_rate_den": 1,
                "video_codec": "H264",
                "audio_codec": "AAC",
            },
            "output_relative_path": "synthetic.mp4",
        }
    )
    tools = MediaToolchain(
        profile_id="synthetic-tools",
        version="1.0.0",
        ffmpeg_path=tmp_path / "not-run-ffmpeg",
        ffprobe_path=tmp_path / "not-run-ffprobe",
        ffmpeg_sha256="a" * 64,
        ffprobe_sha256="b" * 64,
        configuration_flags=(),
        license_class="LGPL",
        spdx_license="LGPL-2.1-or-later",
        distribution_status="DEVELOPMENT_ONLY",
    )
    service = ProductExportSingleVideoService(
        StudioRepository(tmp_path / "worker.db"), tools, tmp_path, ProductExportJobManager()
    )
    failure = KeyboardInterrupt("synthetic worker interruption")
    readback_failure = LookupError("synthetic unavailable receipt")
    calls = 0

    def execute(*args: object, **kwargs: object) -> ProductExportOperationData:
        nonlocal calls
        calls += 1
        raise failure

    def readback(*args: object) -> ProductExportOperationData:
        if outcome == "READ_FAILED":
            raise readback_failure
        return operation.model_copy(update={"status": outcome})

    monkeypatch.setattr(service._coordinator, "execute_claimed", execute)
    monkeypatch.setattr(service._coordinator, "get", readback)
    service._run_claimed(operation, request)
    assert calls == 1
    if outcome in {"CLAIMED", "RUNNING", "READ_FAILED"}:
        expected = readback_failure if outcome == "READ_FAILED" else failure
        assert service._unresolved_failures[(PROJECT, OPERATION)] is expected
        with pytest.raises(ProductExportExecutionError) as caught:
            service.join_workers()
        assert caught.value.code == "WORKER_RECEIPT_UNCERTAIN"
        assert caught.value.__cause__ is expected
    else:
        assert service._unresolved_failures == {}
        service.join_workers()
    assert calls == 1

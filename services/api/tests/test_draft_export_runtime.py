"""Real saved assembly boundary and durable cancellation/recovery tests."""

import hashlib
import json
import struct
import sys
import threading
import time
import zlib
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest
from aijian_api.draft_export_contracts import CreateDraftExportRequest
from aijian_api.draft_export_runtime import DraftExportError, DraftExportRuntime, _snapshot, _target
from aijian_api.episode_media_assembly_contracts import (
    CreateEpisodeMediaAssemblyVersionRequest,
    EpisodeMediaAssemblyContentV1,
)
from aijian_api.episode_media_assembly_store import EpisodeMediaAssemblyStore
from aijian_api.media_asset_rights_contracts import HumanRightsDecisionInput
from aijian_api.media_asset_rights_store import MediaAssetRightsStore
from aijian_api.media_asset_store import MediaAssetStore
from aijian_api.media_toolchain import discover_media_toolchain, load_media_toolchain_lock
from aijian_api.product_export_windows_job import ProductExportJobManager
from aijian_api.repository import StudioRepository
from pydantic import ValidationError


def fixture(tmp_path: Path):
    repository = StudioRepository(tmp_path / "workspace.db")
    project = repository.create_project(
        name="Synthetic draft",
        aspect_ratio="16:9",
        target_duration_seconds=30,
        source_language="zh-CN",
    )
    episode = repository.list_episodes(project.id)[0]

    def chunk(kind, data):
        return (
            struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
        )

    image = tmp_path / "owned-synthetic.png"
    image.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", 16, 16, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress((b"\0" + b"\xff\0\0" * 16) * 16))
        + chunk(b"IEND", b"")
    )
    asset = MediaAssetStore(repository).import_local(project.id, image)
    media = {
        "asset_id": asset.id,
        "asset_version_id": asset.latest_version.id,
        "sha256": asset.latest_version.sha256,
    }
    content = EpisodeMediaAssemblyContentV1.model_validate(
        {
            "project_id": project.id,
            "episode_id": episode.id,
            "sequence_timebase": {
                "frame_rate": {"num": 24, "den": 1},
                "timecode_mode": "NON_DROP_FRAME",
            },
            "canvas_width": 160,
            "canvas_height": 90,
            "total_frames": 24,
            "visual_segments": [
                {
                    "segment_id": "seg_a",
                    "media_kind": "image",
                    "media": media,
                    "start_frame": 0,
                    "end_frame": 24,
                }
            ],
        }
    )
    assembly = EpisodeMediaAssemblyStore(repository).create_version(
        project.id,
        episode.id,
        CreateEpisodeMediaAssemblyVersionRequest(content=content, change_summary="Synthetic QA"),
        author_actor_id="synthetic-user",
    )
    return repository, project.id, episode.id, asset, assembly


def toolchain():
    root = Path(__file__).resolve().parents[3]
    if sys.platform == "win32":
        return discover_media_toolchain(
            load_media_toolchain_lock(root / "config/media-toolchain-lock.json"),
        )
    return discover_media_toolchain(
        load_media_toolchain_lock(root / "config/draft-media-toolchain-linux-dev-lock.json"),
        explicit_root=Path("/usr/bin"),
    )


def request_for(assembly, path):
    return CreateDraftExportRequest(
        operation_id="dmp_" + uuid4().hex,
        assembly_version_id=assembly.version_id,
        assembly_content_hash=assembly.content_hash,
        rights_declaration="OWNED_OR_SYNTHETIC",
        output_path=str(path),
    )


def runtime_for(repository):
    return DraftExportRuntime(
        repository,
        toolchain,
        ProductExportJobManager() if sys.platform == "win32" else None,
    )


def wait_final(runtime, project, episode, operation):
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        result = runtime.get(project, episode, operation)
        if result.status not in {"QUEUED", "RUNNING", "VERIFYING"}:
            return result
        time.sleep(0.05)
    raise AssertionError("draft worker did not finish")


def test_requires_explicit_owned_declaration_and_safe_path(tmp_path):
    with pytest.raises(ValidationError):
        CreateDraftExportRequest(
            operation_id="dmp_" + "a" * 32,
            assembly_version_id="ver_" + "b" * 32,
            assembly_content_hash="sha256:" + "c" * 64,
            output_path=str(tmp_path / "draft.mp4"),
        )
    for value in ["relative.mp4", str(tmp_path / "../draft.mp4"), str(tmp_path / "draft.m3u8")]:
        with pytest.raises(DraftExportError):
            _target(value)
    (tmp_path / "link").symlink_to(tmp_path, target_is_directory=True)
    with pytest.raises(DraftExportError):
        _target(str(tmp_path / "link/draft.mp4"))


def test_restricted_and_hash_conflict_never_launch(tmp_path):
    repository, project, episode, asset, assembly = fixture(tmp_path)
    runtime = DraftExportRuntime(repository, lambda: pytest.fail("must reject before tools"))
    request = request_for(assembly, tmp_path / "DRAFT.mp4")
    with pytest.raises(DraftExportError, match="version/hash"):
        runtime.submit(
            project,
            episode,
            request.model_copy(update={"assembly_content_hash": "sha256:" + "0" * 64}),
        )
    MediaAssetRightsStore(repository).append_human_decision(
        project,
        asset.id,
        asset.latest_version.id,
        HumanRightsDecisionInput(
            operation_id="rdop_" + uuid4().hex,
            expected_revision=0,
            decision="RESTRICTED",
            basis_text="Synthetic restriction for boundary test",
        ),
        actor_id="synthetic-user",
    )
    with pytest.raises(DraftExportError, match="Restricted"):
        runtime.submit(project, episode, request)
    assert runtime.list(project, episode) == []
    assert not (tmp_path / "DRAFT.mp4").exists()


def test_real_encode_receipt_reopen_original_provenance_and_no_overwrite(tmp_path):
    repository, project, episode, asset, assembly = fixture(tmp_path)
    runtime = runtime_for(repository)
    request = request_for(assembly, tmp_path / "DRAFT.mp4")
    queued = runtime.submit(project, episode, request)
    assert queued.status == "QUEUED" and queued.output_path is None
    result = wait_final(runtime, project, episode, request.operation_id)
    assert result.status == "SUCCEEDED", result
    assert result.output_bytes > 0 and len(result.output_sha256) == 64
    assert Path(result.output_path).stat().st_nlink == 1
    assert runtime.submit(project, episode, request).output_sha256 == result.output_sha256
    with pytest.raises(DraftExportError, match="new filename"):
        runtime.submit(project, episode, request_for(assembly, tmp_path / "DRAFT.mp4"))
    runtime.join_workers()
    reopened = DraftExportRuntime(StudioRepository(repository.database_path), toolchain)
    assert reopened.get(project, episode, request.operation_id).status == "SUCCEEDED"
    assert reopened.list(project, episode)[0].assembly_version_id == assembly.version_id
    with repository._connection() as connection:
        row = connection.execute("SELECT provenance_json FROM draft_export_jobs").fetchone()
        provenance = json.loads(row[0])
        assert provenance["assembly"]["media_checks"][0]["rights_status"] == "PENDING_REVIEW"
        assert provenance["toolchain"]["distribution_status"] == "DEVELOPMENT_ONLY"
        assert (
            connection.execute("SELECT COUNT(*) FROM media_asset_rights_decisions").fetchone()[0]
            == 0
        )
    Path(result.output_path).unlink()
    assert reopened.get(project, episode, request.operation_id).status == "FAILED"


def test_active_worker_stays_busy_and_finished_cleanup_keeps_overwrite(tmp_path, monkeypatch):
    from aijian_api import draft_export_encoder
    from aijian_api.product_export_output_verify import VerifiedProductOutput

    repository, project, episode, _asset, assembly = fixture(tmp_path)
    tools = SimpleNamespace(
        profile_id="synthetic",
        version="0",
        ffmpeg_sha256="a" * 64,
        ffprobe_sha256="b" * 64,
        distribution_status="DEVELOPMENT_ONLY",
    )
    runtime = DraftExportRuntime(repository, lambda: tools)
    entered = threading.Event()
    release_encode = threading.Event()

    def blocked_encode(*_args, stop_requested, **_kwargs):
        entered.set()
        assert release_encode.wait(5)
        raise DraftExportError("CANCELLED", "Cancelled synthetic operation")

    monkeypatch.setattr(draft_export_encoder, "encode_draft", blocked_encode)
    running = request_for(assembly, tmp_path / "RUNNING.mp4")
    runtime.submit(project, episode, running)
    assert entered.wait(5)
    with pytest.raises(DraftExportError, match="Wait for or cancel"):
        runtime.submit(project, episode, request_for(assembly, tmp_path / "OTHER.mp4"))
    release_encode.set()
    runtime._workers[running.operation_id].join(5)
    assert not runtime._workers[running.operation_id].is_alive()

    cleanup = threading.Event()
    release_cleanup = threading.Event()
    original_remove = DraftExportRuntime._remove_reservation

    def hold_cleanup(self, target, operation):
        if not cleanup.is_set():
            cleanup.set()
            assert release_cleanup.wait(5)
        return original_remove(target, operation)

    monkeypatch.setattr(DraftExportRuntime, "_remove_reservation", hold_cleanup)

    def finished_encode(_assembly, _sources, temporary, _tools, **_kwargs):
        payload = b"\x00\x00\x00\x14ftypisom\x00\x00\x02\x00"
        Path(temporary).write_bytes(payload)
        return VerifiedProductOutput(
            str(temporary),
            hashlib.sha256(payload).hexdigest(),
            len(payload),
            "{}",
            "sha256:" + "ab" * 32,
            "now",
        )

    monkeypatch.setattr(draft_export_encoder, "encode_draft", finished_encode)
    done = request_for(assembly, tmp_path / "DRAFT.mp4")
    runtime.submit(project, episode, done)
    result = wait_final(runtime, project, episode, done.operation_id)
    assert result.status == "SUCCEEDED", result
    assert cleanup.wait(5)
    assert runtime._workers[done.operation_id].is_alive()
    with pytest.raises(DraftExportError, match="new filename"):
        runtime.submit(project, episode, request_for(assembly, tmp_path / "DRAFT.mp4"))
    release_cleanup.set()
    runtime._workers[done.operation_id].join(5)
    assert not runtime._workers[done.operation_id].is_alive()


def test_cancel_is_durable_and_never_publishes(tmp_path, monkeypatch):
    from aijian_api import draft_export_encoder

    repository, project, episode, _asset, assembly = fixture(tmp_path)
    entered = threading.Event()

    def blocked(*args, stop_requested, **kwargs):
        entered.set()
        while not stop_requested():
            time.sleep(0.02)
        raise DraftExportError("CANCELLED", "Cancelled synthetic operation")

    monkeypatch.setattr(draft_export_encoder, "encode_draft", blocked)
    runtime = DraftExportRuntime(repository, toolchain)
    request = request_for(assembly, tmp_path / "DRAFT.mp4")
    runtime.submit(project, episode, request)
    assert entered.wait(5)
    runtime.cancel(project, episode, request.operation_id)
    assert wait_final(runtime, project, episode, request.operation_id).status == "CANCELLED"
    runtime.join_workers()
    reopened = DraftExportRuntime(repository, toolchain)
    assert reopened.get(project, episode, request.operation_id).status == "CANCELLED"
    assert not (tmp_path / "DRAFT.mp4").exists()


def test_recovery_marks_active_unknown_without_retry(tmp_path, monkeypatch):
    repository, project, episode, _asset, assembly = fixture(tmp_path)
    # Version discovery uses subprocess reader threads on Windows. Freeze the
    # verified tools before suppressing only the export worker's startup.
    verified_tools = toolchain()
    runtime = DraftExportRuntime(repository, lambda: verified_tools)
    monkeypatch.setattr(threading.Thread, "start", lambda self: None)
    request = request_for(assembly, tmp_path / "DRAFT.mp4")
    assert runtime.submit(project, episode, request).status == "QUEUED"
    recovered = DraftExportRuntime(repository, lambda: pytest.fail("must never restart"))
    assert recovered.get(project, episode, request.operation_id).status == "INTERRUPTED"
    assert recovered.submit(project, episode, request).status == "INTERRUPTED"


def test_snapshot_checks_original_bytes_and_cancellation(tmp_path):
    import hashlib

    source = tmp_path / "source"
    source.write_bytes(b"synthetic bytes")
    with pytest.raises(DraftExportError, match="saved hash"):
        _snapshot(source, tmp_path / "copied", "0" * 64, source.stat().st_size, lambda: False)
    with pytest.raises(DraftExportError, match="cancelled"):
        _snapshot(
            source,
            None,
            hashlib.sha256(source.read_bytes()).hexdigest(),
            source.stat().st_size,
            lambda: True,
        )


@pytest.mark.parametrize("change", ["target", "original", "rights"])
def test_change_after_encode_cannot_publish_false_success(tmp_path, monkeypatch, change):
    from aijian_api import draft_export_encoder

    repository, project, episode, asset, assembly = fixture(tmp_path)
    target = tmp_path / "DRAFT.mp4"
    real_encode = draft_export_encoder.encode_draft

    def changed_after_encode(*args, **kwargs):
        result = real_encode(*args, **kwargs)
        if change == "target":
            target.write_bytes(b"existing user file must not be clobbered")
        elif change == "original":
            digest = asset.latest_version.sha256
            original = tmp_path / "media-assets" / "blobs" / digest[:2] / digest
            original.write_bytes(b"corrupted original")
        else:
            MediaAssetRightsStore(repository).append_human_decision(
                project,
                asset.id,
                asset.latest_version.id,
                HumanRightsDecisionInput(
                    operation_id="rdop_" + uuid4().hex,
                    expected_revision=0,
                    decision="RESTRICTED",
                    basis_text="Synthetic restriction before publication",
                ),
                actor_id="synthetic-user",
            )
        return result

    monkeypatch.setattr(draft_export_encoder, "encode_draft", changed_after_encode)
    runtime = runtime_for(repository)
    request = request_for(assembly, target)
    runtime.submit(project, episode, request)
    result = wait_final(runtime, project, episode, request.operation_id)
    assert result.status == "FAILED", result
    assert result.output_path is None and result.output_sha256 is None
    if change == "target":
        assert target.read_bytes() == b"existing user file must not be clobbered"
    else:
        assert not target.exists()
    runtime.join_workers()


def test_readback_waits_for_timed_out_submission_before_definite_absence(tmp_path):
    repository, project, episode, _asset, assembly = fixture(tmp_path)
    entering = threading.Event()
    proceed = threading.Event()

    def delayed_tools():
        entering.set()
        assert proceed.wait(10)
        return toolchain()

    runtime = DraftExportRuntime(repository, delayed_tools)
    request = request_for(assembly, tmp_path / "DRAFT.mp4")
    submit = threading.Thread(target=runtime.submit, args=(project, episode, request))
    submit.start()
    assert entering.wait(5)
    readback = []
    reader = threading.Thread(
        target=lambda: readback.append(runtime.get(project, episode, request.operation_id))
    )
    reader.start()
    time.sleep(0.1)
    assert reader.is_alive() and readback == []
    proceed.set()
    submit.join(5)
    reader.join(5)
    assert len(readback) == 1 and readback[0].operation_id == request.operation_id
    wait_final(runtime, project, episode, request.operation_id)
    runtime.join_workers()

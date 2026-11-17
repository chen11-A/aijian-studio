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


class _CleanupResource:
    def unlink(self, missing_ok: bool = False) -> None:
        raise OSError("cleanup unlink failed")


class DraftGuardSession:
    """Release every gate, then join every worker actually registered on the runtime.

    Each join is isolated: one failure is recorded and the remaining workers are still
    waited on. A resource is removed only after its worker's exit is confirmed. Unscoped
    fixture resources stay when any worker is unconfirmed. Cleanup errors keep a body
    assertion as the primary error and attach a note. With no body error, a cleanup
    failure is raised and not swallowed.
    """

    def __init__(self, runtime: DraftExportRuntime) -> None:
        self.runtime = runtime
        self.gates: list[threading.Event] = []
        self.resources: list[object] = []
        self._bound: list[tuple[int, object]] = []
        self._join_faults: dict[int, BaseException] = {}

    def gate(self) -> tuple[threading.Event, threading.Event]:
        entered = threading.Event()
        release = threading.Event()
        self.gates.append(release)
        return entered, release

    def bind(self, worker: threading.Thread, resource: object) -> None:
        self._bound.append((id(worker), resource))

    def fail_join(self, worker: threading.Thread, error: BaseException) -> None:
        self._join_faults[id(worker)] = error

    def __enter__(self) -> "DraftGuardSession":
        return self

    def __exit__(self, exc_type: object, exc: BaseException | None, tb: object) -> bool:
        errors: list[BaseException] = []

        def guard(action) -> None:
            try:
                action()
            except Exception as error:
                errors.append(error)

        for gate in self.gates:
            guard(gate.set)
        with self.runtime._lock:
            workers = tuple(self.runtime._workers.values())
        confirmed: set[int] = set()
        for worker in workers:

            def join_one(worker: threading.Thread = worker) -> None:
                fault = self._join_faults.get(id(worker))
                if fault is not None:
                    raise fault
                worker.join()
                if worker.is_alive():
                    raise RuntimeError("draft worker still alive after join")

            before = len(errors)
            guard(join_one)
            if len(errors) == before:
                confirmed.add(id(worker))
        for owner, resource in self._bound:
            if owner not in confirmed:
                continue
            guard(lambda resource=resource: resource.unlink(missing_ok=True))
        if len(confirmed) == len(workers):
            for resource in self.resources:
                guard(lambda resource=resource: resource.unlink(missing_ok=True))
        if exc is not None:
            for error in errors:
                try:
                    exc.add_note(f"draft test cleanup: {type(error).__name__}: {error}")
                except Exception:
                    pass
            return False
        if len(errors) == 1:
            raise errors[0]
        if errors:
            raise ExceptionGroup("draft test cleanup failed", errors)
        return False


def _mp4_payload() -> bytes:
    return b"\x00\x00\x00\x14ftypisom\x00\x00\x02\x00"


def _verified(temporary: Path, payload: bytes):
    from aijian_api.product_export_output_verify import VerifiedProductOutput

    return VerifiedProductOutput(
        str(temporary),
        hashlib.sha256(payload).hexdigest(),
        len(payload),
        "{}",
        "sha256:" + "ab" * 32,
        "now",
    )


def test_live_cleanup_keeps_other_targets_busy_and_existing_names_exact(tmp_path, monkeypatch):
    from aijian_api import draft_export_encoder, draft_export_runtime

    repository, project, episode, _asset, assembly = fixture(tmp_path)
    tools = SimpleNamespace(
        profile_id="synthetic",
        version="0",
        ffmpeg_sha256="a" * 64,
        ffprobe_sha256="b" * 64,
        distribution_status="DEVELOPMENT_ONLY",
    )
    runtime = DraftExportRuntime(repository, lambda: tools)
    busy = "Wait for or cancel the current local draft export"
    exists = "Choose a new filename; draft export never overwrites files"
    with DraftGuardSession(runtime) as session:
        entered, release_encode = session.gate()

        def blocked_encode(*_args, stop_requested, **_kwargs):
            entered.set()
            release_encode.wait()
            raise DraftExportError("CANCELLED", "Cancelled synthetic operation")

        monkeypatch.setattr(draft_export_encoder, "encode_draft", blocked_encode)
        running = request_for(assembly, tmp_path / "RUNNING.mp4")
        session.resources.append(tmp_path / "RUNNING.mp4")
        runtime.submit(project, episode, running)
        assert entered.wait(5)
        with pytest.raises(DraftExportError, match=f"^{busy}$"):
            runtime.submit(project, episode, request_for(assembly, tmp_path / "OTHER.mp4"))
        release_encode.set()
        with runtime._lock:
            running_worker = runtime._workers[running.operation_id]
        running_worker.join()
        assert not running_worker.is_alive()

        def assert_cleanup_isolation(operation: str, final_name: str, status: str) -> None:
            final_path = tmp_path / final_name
            temp_path = tmp_path / f".{operation}.partial.mp4"
            worker = runtime._workers[operation]
            try:
                assert worker.is_alive()
                other = tmp_path / f"other-{status}.mp4"
                session.resources.append(other)
                with pytest.raises(DraftExportError, match=f"^{busy}$"):
                    runtime.submit(project, episode, request_for(assembly, other))
                assert not other.exists()
                if temp_path.exists():
                    before = temp_path.read_bytes()
                    with pytest.raises(DraftExportError, match=f"^{exists}$"):
                        runtime.submit(project, episode, request_for(assembly, temp_path))
                    assert temp_path.read_bytes() == before
                else:
                    with pytest.raises(DraftExportError, match=f"^{busy}$"):
                        runtime.submit(project, episode, request_for(assembly, temp_path))
                    assert not temp_path.exists()
                if final_path.exists():
                    with pytest.raises(DraftExportError, match=f"^{exists}$"):
                        runtime.submit(project, episode, request_for(assembly, final_path))
            finally:
                release_cleanup.set()
            with runtime._lock:
                current = tuple(runtime._workers.values())
            for current_worker in current:
                current_worker.join()
            marker = b"owned-after-cleanup"
            temp_path.write_bytes(marker)
            session.resources.append(temp_path)
            assert temp_path.read_bytes() == marker

        def fail_encode(*_args, **_kwargs):
            raise DraftExportError("SOURCE_UNAVAILABLE", "Selected media version no longer exists")

        def cancel_encode(*_args, **_kwargs):
            raise DraftExportError("CANCELLED", "Draft export was cancelled")

        for status, encode in (("FAILED", fail_encode), ("CANCELLED", cancel_encode)):
            cleanup_entered, release_cleanup = session.gate()

            def hold_cleanup(cleanup_entered=cleanup_entered, release_cleanup=release_cleanup):
                cleanup_entered.set()
                release_cleanup.wait()

            monkeypatch.setattr(draft_export_runtime, "_before_draft_cleanup", hold_cleanup)
            monkeypatch.setattr(draft_export_encoder, "encode_draft", encode)
            request = request_for(assembly, tmp_path / f"{status}.mp4")
            session.resources.append(tmp_path / f"{status}.mp4")
            runtime.submit(project, episode, request)
            result = wait_final(runtime, project, episode, request.operation_id)
            assert result.status == status, result
            assert cleanup_entered.wait(5)
            temp_path = tmp_path / f".{request.operation_id}.partial.mp4"
            temp_path.write_bytes(b"still-owned-by-cleanup")
            session.resources.append(temp_path)
            assert_cleanup_isolation(request.operation_id, f"{status}.mp4", status)

        cleanup_entered, release_cleanup = session.gate()

        def hold_success_cleanup() -> None:
            cleanup_entered.set()
            release_cleanup.wait()

        def finished_encode(_assembly, _sources, temporary, _tools, **_kwargs):
            payload = _mp4_payload()
            Path(temporary).write_bytes(payload)
            return _verified(Path(temporary), payload)

        monkeypatch.setattr(draft_export_runtime, "_before_draft_cleanup", hold_success_cleanup)
        monkeypatch.setattr(draft_export_encoder, "encode_draft", finished_encode)
        done = request_for(assembly, tmp_path / "DRAFT.mp4")
        session.resources.append(tmp_path / "DRAFT.mp4")
        runtime.submit(project, episode, done)
        result = wait_final(runtime, project, episode, done.operation_id)
        assert result.status == "SUCCEEDED", result
        assert cleanup_entered.wait(5)
        assert_cleanup_isolation(done.operation_id, "DRAFT.mp4", "SUCCEEDED")

        interrupted, release_interrupted = session.gate()

        def hold_interrupted_cleanup() -> None:
            interrupted.set()
            release_interrupted.wait()

        def interrupted_hash(path: Path):
            from aijian_api.product_export_output_verify import _guarded_file_hash

            digest, size = _guarded_file_hash(path)
            if path.name == "INTERRUPTED.mp4":
                raise DraftExportError("OUTPUT_CHANGED", "Published output changed before receipt")
            return digest, size

        monkeypatch.setattr(draft_export_runtime, "_before_draft_cleanup", hold_interrupted_cleanup)
        monkeypatch.setattr(draft_export_runtime, "_guarded_file_hash", interrupted_hash)
        monkeypatch.setattr(draft_export_encoder, "encode_draft", finished_encode)
        broken = request_for(assembly, tmp_path / "INTERRUPTED.mp4")
        session.resources.append(tmp_path / "INTERRUPTED.mp4")
        runtime.submit(project, episode, broken)
        result = wait_final(runtime, project, episode, broken.operation_id)
        assert result.status == "INTERRUPTED", result
        assert interrupted.wait(5)
        release_cleanup = release_interrupted
        assert_cleanup_isolation(broken.operation_id, "INTERRUPTED.mp4", "INTERRUPTED")


def _guarded_failed_export(tmp_path, monkeypatch):
    from aijian_api import draft_export_encoder, draft_export_runtime

    repository, project, episode, _asset, assembly = fixture(tmp_path)
    tools = SimpleNamespace(
        profile_id="synthetic",
        version="0",
        ffmpeg_sha256="a" * 64,
        ffprobe_sha256="b" * 64,
        distribution_status="DEVELOPMENT_ONLY",
    )
    runtime = DraftExportRuntime(repository, lambda: tools)

    def fail_encode(*_args, **_kwargs):
        raise DraftExportError("SOURCE_UNAVAILABLE", "Selected media version no longer exists")

    monkeypatch.setattr(draft_export_encoder, "encode_draft", fail_encode)
    return draft_export_runtime, runtime, project, episode, assembly


def test_cleanup_failure_before_gate_enter_still_joins(tmp_path, monkeypatch):
    module, runtime, project, episode, assembly = _guarded_failed_export(tmp_path, monkeypatch)
    request = request_for(assembly, tmp_path / "BEFORE.mp4")
    saved: BaseException | None = None
    try:
        with DraftGuardSession(runtime) as session:
            entered, release = session.gate()

            def hold(entered=entered, release=release) -> None:
                entered.set()
                release.wait()

            monkeypatch.setattr(module, "_before_draft_cleanup", hold)
            runtime.submit(project, episode, request)
            raise AssertionError("before entered")
    except AssertionError as error:
        saved = error
    assert saved is not None and str(saved) == "before entered"
    assert not runtime._workers[request.operation_id].is_alive()


def test_cleanup_write_failure_still_joins(tmp_path, monkeypatch):
    module, runtime, project, episode, assembly = _guarded_failed_export(tmp_path, monkeypatch)
    request = request_for(assembly, tmp_path / "WRITE.mp4")
    saved: BaseException | None = None
    try:
        with DraftGuardSession(runtime) as session:
            entered, release = session.gate()

            def hold(entered=entered, release=release) -> None:
                entered.set()
                release.wait()

            monkeypatch.setattr(module, "_before_draft_cleanup", hold)
            runtime.submit(project, episode, request)
            assert entered.wait(5)
            blocker = tmp_path / "not-a-directory"
            blocker.write_bytes(b"x")
            (blocker / "owned").write_bytes(b"data")
    except OSError as error:
        saved = error
    assert saved is not None and isinstance(saved, OSError)
    assert not runtime._workers[request.operation_id].is_alive()


def test_unexpected_submit_worker_is_joined_from_runtime(tmp_path, monkeypatch):
    module, runtime, project, episode, assembly = _guarded_failed_export(tmp_path, monkeypatch)
    request = request_for(assembly, tmp_path / "EXTRA.mp4")
    saved: BaseException | None = None
    try:
        with DraftGuardSession(runtime) as session:
            entered, release = session.gate()

            def hold(entered=entered, release=release) -> None:
                entered.set()
                release.wait()

            monkeypatch.setattr(module, "_before_draft_cleanup", hold)
            with pytest.raises(DraftExportError, match="^absent$"):
                runtime.submit(project, episode, request)
    except BaseException as error:
        saved = error
    assert saved is not None and "DID NOT RAISE" in str(saved)
    assert not runtime._workers[request.operation_id].is_alive()


def test_cleanup_unlink_note_keeps_the_assertion_and_production_unlink(tmp_path, monkeypatch):
    module, runtime, project, episode, assembly = _guarded_failed_export(tmp_path, monkeypatch)
    request = request_for(assembly, tmp_path / "NOTE.mp4")
    saved: BaseException | None = None
    owned = tmp_path / f".{request.operation_id}.partial.mp4"
    try:
        with DraftGuardSession(runtime) as session:
            entered, release = session.gate()

            def hold(entered=entered, release=release) -> None:
                entered.set()
                release.wait()

            monkeypatch.setattr(module, "_before_draft_cleanup", hold)
            runtime.submit(project, episode, request)
            assert entered.wait(5)
            owned.write_bytes(b"owned-during-cleanup")
            session.resources.append(_CleanupResource())
            raise AssertionError("contract failed")
    except AssertionError as error:
        saved = error
    assert saved is not None and str(saved) == "contract failed"
    assert any("cleanup unlink failed" in note for note in saved.__notes__)
    assert not runtime._workers[request.operation_id].is_alive()
    assert not owned.exists()


def test_cleanup_unlink_failure_raises_when_the_body_succeeds(tmp_path, monkeypatch):
    module, runtime, project, episode, assembly = _guarded_failed_export(tmp_path, monkeypatch)
    request = request_for(assembly, tmp_path / "SUCCESS.mp4")
    with pytest.raises(OSError, match="cleanup unlink failed"):
        with DraftGuardSession(runtime) as session:
            entered, release = session.gate()

            def hold(entered=entered, release=release) -> None:
                entered.set()
                release.wait()

            monkeypatch.setattr(module, "_before_draft_cleanup", hold)
            runtime.submit(project, episode, request)
            assert entered.wait(5)
            session.resources.append(_CleanupResource())
    assert not runtime._workers[request.operation_id].is_alive()


def test_join_error_settles_the_next_worker_and_keeps_unconfirmed_files(tmp_path, monkeypatch):
    module, runtime, project, episode, assembly = _guarded_failed_export(tmp_path, monkeypatch)
    first = request_for(assembly, tmp_path / "FIRST.mp4")
    second = request_for(assembly, tmp_path / "SECOND.mp4")
    owned = tmp_path / f".{second.operation_id}.partial.mp4"
    first_file = tmp_path / "first-fixture"
    second_file = tmp_path / "second-fixture"
    kept = tmp_path / "unscoped-fixture"
    saved: BaseException | None = None
    try:
        with DraftGuardSession(runtime) as session:
            entered, release = session.gate()

            def hold(entered=entered, release=release) -> None:
                entered.set()
                release.wait()

            monkeypatch.setattr(module, "_before_draft_cleanup", hold)
            runtime.submit(project, episode, first)
            assert entered.wait(5)
            release.set()
            first_worker = runtime._workers[first.operation_id]
            first_worker.join()
            assert not first_worker.is_alive()

            entered_next, release_next = session.gate()

            def hold_next(entered_next=entered_next, release_next=release_next) -> None:
                entered_next.set()
                release_next.wait()

            monkeypatch.setattr(module, "_before_draft_cleanup", hold_next)
            runtime.submit(project, episode, second)
            assert entered_next.wait(5)
            owned.write_bytes(b"owned-during-cleanup")
            first_file.write_bytes(b"first")
            second_file.write_bytes(b"second")
            kept.write_bytes(b"kept")
            second_worker = runtime._workers[second.operation_id]
            session.bind(first_worker, first_file)
            session.bind(second_worker, second_file)
            session.resources.append(kept)
            session.fail_join(first_worker, OSError("join failed"))
            raise AssertionError("contract failed")
    except AssertionError as error:
        saved = error
    assert saved is not None and str(saved) == "contract failed"
    assert any("join failed" in note for note in saved.__notes__)
    assert not runtime._workers[second.operation_id].is_alive()
    assert not owned.exists()
    assert first_file.read_bytes() == b"first"
    assert not second_file.exists()
    assert kept.read_bytes() == b"kept"


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

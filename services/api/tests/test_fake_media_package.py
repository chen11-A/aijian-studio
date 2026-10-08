from __future__ import annotations

import hashlib
import json
import multiprocessing
import os
import shutil
import subprocess
import time
import wave
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import aijian_api.fake_media_package as fake_media_package_module
import pytest
from aijian_api.fake_media_package import (
    FRAME_COUNT,
    STAGING_GRACE_SECONDS,
    FakeMediaPackageError,
    FakeMediaPackageGenerator,
    FakeMediaPackageRequestV1,
    FakeMediaPackageV1,
    FakePreviewVideoFileV1,
    FakeShotMediaV1,
    GeneratedFakeMediaPackage,
    _parse_proc_start_ticks,
)
from aijian_api.media_contracts import SequenceTimebaseData
from aijian_api.media_toolchain import (
    discover_media_toolchain,
    load_media_toolchain_lock,
)
from aijian_api.timeline import TimelineAssetV1, TimelineClipV1, TimelineVersionV1
from aijian_api.timeline_export import (
    TimelineExportPurpose,
    TimelineMediaBinding,
    export_timeline_mp4,
)

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
PROJECT_ID = "prj_0123456789abcdef0123456789abcdef"
SOURCE_ID = "src_0123456789abcdef0123456789abcdef"
SOURCE_HASH = "sha256:" + "42" * 32


def _toolchain():
    return discover_media_toolchain(_lock())


def _lock():
    return load_media_toolchain_lock(REPOSITORY_ROOT / "config" / "media-toolchain-lock.json")


def _generator(workspace: Path, **kwargs) -> FakeMediaPackageGenerator:
    return FakeMediaPackageGenerator.from_locked_tool_root(
        workspace,
        _lock(),
        _toolchain().ffmpeg_path.parent,
        **kwargs,
    )


def _request_payload() -> dict[str, object]:
    return {
        "project_id": PROJECT_ID,
        "source_document_id": SOURCE_ID,
        "source_sha256": SOURCE_HASH,
        "frame_rate": {"num": 25, "den": 1},
        "shots": [
            {"shot_id": f"fake-shot-{index:02d}", "duration_frames": 125} for index in range(1, 4)
        ],
    }


def test_proc_starttime_parser_handles_process_names_with_spaces_and_parentheses() -> None:
    fields_after_comm = ["S", *[str(index) for index in range(4, 22)], "987654", "0"]
    payload = f"123 (worker name (phase)) {' '.join(fields_after_comm)}"

    assert _parse_proc_start_ticks(payload) == 987654


def _child_generate(workspace: str, start_event, result_queue) -> None:
    start_event.wait(timeout=30)
    try:
        generated = _generator(Path(workspace)).materialize(
            project_id=PROJECT_ID,
            source_document_id=SOURCE_ID,
            source_sha256=SOURCE_HASH,
        )
        result_queue.put(("ok", str(generated.root), generated.manifest.request_hash))
    except Exception as error:  # pragma: no cover - reported to the parent process
        result_queue.put(("error", type(error).__name__, str(error)))


def _child_crash(workspace: str, phase: str) -> None:
    def fault_hook(current_phase: str) -> None:
        if current_phase == phase:
            os._exit(73)

    _generator(Path(workspace), fault_hook=fault_hook).materialize(
        project_id=PROJECT_ID,
        source_document_id=SOURCE_ID,
        source_sha256=SOURCE_HASH,
    )


def _child_pause_before_publish(workspace: str, phase: str, reached, release, result_queue) -> None:
    def fault_hook(current_phase: str) -> None:
        if current_phase == phase:
            reached.set()
            if not release.wait(timeout=120):
                raise RuntimeError("test release timed out")

    try:
        generated = _generator(Path(workspace), fault_hook=fault_hook).materialize(
            project_id=PROJECT_ID,
            source_document_id=SOURCE_ID,
            source_sha256=SOURCE_HASH,
        )
        result_queue.put(("ok", generated.manifest.request_hash))
    except Exception as error:  # pragma: no cover - reported to the parent process
        result_queue.put(("error", type(error).__name__, str(error)))


@pytest.mark.parametrize(
    "mutate",
    [
        lambda payload: payload.update({"api_key": "forbidden"}),
        lambda payload: payload.update({"frame_rate": {"num": 24, "den": 1}}),
        lambda payload: payload.update({"shots": payload["shots"][:2]}),
        lambda payload: payload.update(
            {
                "shots": [
                    payload["shots"][0],
                    payload["shots"][0],
                    payload["shots"][2],
                ]
            }
        ),
    ],
)
def test_request_contract_fails_closed_on_non_phase0_inputs(mutate) -> None:
    payload = _request_payload()
    mutate(payload)

    with pytest.raises(ValueError):
        FakeMediaPackageRequestV1.model_validate(payload)


def test_materializes_three_verified_fake_shots_and_replays_without_rewriting(
    tmp_path: Path,
) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    generator = _generator(workspace)

    first = generator.materialize(
        project_id=PROJECT_ID,
        source_document_id=SOURCE_ID,
        source_sha256=SOURCE_HASH,
    )

    assert first.manifest.project_id == PROJECT_ID
    assert first.manifest.source_document_id == SOURCE_ID
    assert first.manifest.source_sha256 == SOURCE_HASH
    assert first.manifest.frame_rate.num == 25
    assert first.manifest.frame_rate.den == 1
    assert first.manifest.frame_count_per_shot == 125
    assert first.manifest.audio_sample_rate_hz == 48_000
    assert first.manifest.capability_losses == (
        "FAKE_IMAGE_NO_SEMANTIC_GENERATION",
        "STATIC_FRAME_NO_MOTION_GENERATION",
        "PLACEHOLDER_TONE_NO_SPEECH_OR_VOICE_IDENTITY",
    )
    assert first.manifest.recipe_version == "phase0.fake-media-recipe.v1"
    assert first.manifest.ffmpeg_sha256 == "sha256:" + _toolchain().ffmpeg_sha256
    assert first.manifest.ffprobe_sha256 == "sha256:" + _toolchain().ffprobe_sha256
    assert len(first.manifest.shots) == 3

    mtimes: dict[Path, int] = {}
    for index, shot in enumerate(first.manifest.shots, start=1):
        assert shot.shot_id == f"fake-shot-{index:02d}"
        assert shot.duration_frames == FRAME_COUNT
        assert shot.capability_losses == first.manifest.capability_losses
        assert shot.preview_video.role == "EDITING_PREVIEW"
        assert shot.preview_video.container == "webm"
        assert shot.preview_video.frame_count == FRAME_COUNT
        assert shot.preview_video.frame_rate == first.manifest.frame_rate
        assert shot.preview_video.audio_sample_rate_hz == 48_000
        assert shot.preview_video.audio_channels == 1
        assert shot.preview_video.audio_sample_count == 240_000
        assert shot.still_image.role == "STORYBOARD_STILL"
        assert shot.still_image.media_type == "image/png"
        assert shot.scratch_voice.role == "SCRATCH_VOICE"
        assert shot.scratch_voice.media_type == "audio/wav"
        assert shot.scratch_voice.sample_count == 240_000
        assert shot.preview_video.sha256.startswith("sha256:")
        assert shot.still_image.sha256.startswith("sha256:")
        assert shot.scratch_voice.sha256.startswith("sha256:")
        video = first.resolve(shot.preview_video)
        image = first.resolve(shot.still_image)
        voice = first.resolve(shot.scratch_voice)
        assert video.suffix == ".webm"
        assert video.read_bytes()[:4] == b"\x1aE\xdf\xa3"
        assert image.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
        assert voice.read_bytes()[:4] == b"RIFF"
        mtimes[video] = video.stat().st_mtime_ns
        mtimes[image] = image.stat().st_mtime_ns
        mtimes[voice] = voice.stat().st_mtime_ns

    replay = generator.materialize(
        project_id=PROJECT_ID,
        source_document_id=SOURCE_ID,
        source_sha256=SOURCE_HASH,
    )

    assert replay.manifest == first.manifest
    assert replay.root == first.root
    assert {path: path.stat().st_mtime_ns for path in mtimes} == mtimes


def test_same_frozen_input_is_byte_deterministic_across_clean_workspaces(tmp_path: Path) -> None:
    roots = (tmp_path / "first", tmp_path / "second")
    for root in roots:
        root.mkdir()
    generated = [
        _generator(root).materialize(
            project_id=PROJECT_ID,
            source_document_id=SOURCE_ID,
            source_sha256=SOURCE_HASH,
        )
        for root in roots
    ]

    assert generated[0].manifest == generated[1].manifest
    assert [shot.preview_video.sha256 for shot in generated[0].manifest.shots] == [
        shot.preview_video.sha256 for shot in generated[1].manifest.shots
    ]


def test_concurrent_same_identity_publishes_one_complete_package(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    generator = _generator(workspace)

    def generate():
        return generator.materialize(
            project_id=PROJECT_ID,
            source_document_id=SOURCE_ID,
            source_sha256=SOURCE_HASH,
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = tuple(pool.map(lambda _: generate(), range(2)))

    assert results[0].root == results[1].root
    assert results[0].manifest == results[1].manifest
    assert not list(results[0].root.parent.glob(".aijian-fake-media-*"))


def test_two_spawned_processes_converge_on_one_complete_package(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    context = multiprocessing.get_context("spawn")
    start_event = context.Event()
    result_queue = context.Queue()
    processes = tuple(
        context.Process(
            target=_child_generate,
            args=(str(workspace), start_event, result_queue),
        )
        for _ in range(2)
    )
    for process in processes:
        process.start()
    start_event.set()
    results = tuple(result_queue.get(timeout=120) for _ in processes)
    for process in processes:
        process.join(timeout=120)
        assert process.exitcode == 0

    assert all(result[0] == "ok" for result in results)
    assert results[0][1:] == results[1][1:]
    final = Path(results[0][1])
    assert final.is_dir()
    assert not list(final.parent.glob(".aijian-fake-media-*"))


@pytest.mark.parametrize("phase", ["shots_generated", "before_publish", "after_publish"])
def test_process_crash_recovers_to_one_complete_package(
    tmp_path: Path,
    phase: str,
) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    context = multiprocessing.get_context("spawn")
    process = context.Process(target=_child_crash, args=(str(workspace), phase))
    process.start()
    process.join(timeout=120)
    assert process.exitcode == 73

    recovered = _generator(workspace).materialize(
        project_id=PROJECT_ID,
        source_document_id=SOURCE_ID,
        source_sha256=SOURCE_HASH,
    )

    assert len(recovered.manifest.shots) == 3
    assert not list(recovered.root.parent.glob(".aijian-fake-media-*"))


@pytest.mark.parametrize("phase", ["lease_still_active", "after_staging_lease_removed"])
def test_late_process_does_not_delete_an_active_staging_lease(tmp_path: Path, phase: str) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    context = multiprocessing.get_context("spawn")
    reached = context.Event()
    release = context.Event()
    result_queue = context.Queue()
    first = context.Process(
        target=_child_pause_before_publish,
        args=(str(workspace), phase, reached, release, result_queue),
    )
    first.start()
    assert reached.wait(timeout=120)
    time.sleep(STAGING_GRACE_SECONDS + 0.2)
    with ThreadPoolExecutor(max_workers=1) as pool:
        second_future = pool.submit(
            _generator(workspace).materialize,
            project_id=PROJECT_ID,
            source_document_id=SOURCE_ID,
            source_sha256=SOURCE_HASH,
        )
        time.sleep(0.2)
        assert list((workspace / "fake-media" / "v1" / PROJECT_ID).glob(".aijian-fake-media-*"))
        release.set()
        second = second_future.result(timeout=120)
    first.join(timeout=120)
    assert first.exitcode == 0

    assert result_queue.get(timeout=5) == ("ok", second.manifest.request_hash)
    assert not list(second.root.parent.glob(".aijian-fake-media-*"))


def test_existing_final_junction_outside_workspace_is_rejected(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    generated = _generator(workspace).materialize(
        project_id=PROJECT_ID,
        source_document_id=SOURCE_ID,
        source_sha256=SOURCE_HASH,
    )
    outside = tmp_path / "outside-package"
    shutil.move(generated.root, outside)
    completed = subprocess.run(
        ["cmd", "/c", "mklink", "/J", str(generated.root), str(outside)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    if completed.returncode != 0:
        pytest.skip("Windows junction creation is unavailable")

    try:
        with pytest.raises(FakeMediaPackageError, match="unsafe path"):
            _generator(workspace).materialize(
                project_id=PROJECT_ID,
                source_document_id=SOURCE_ID,
                source_sha256=SOURCE_HASH,
            )
    finally:
        os.rmdir(generated.root)


def test_existing_shot_junction_outside_package_is_rejected(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    generated = _generator(workspace).materialize(
        project_id=PROJECT_ID,
        source_document_id=SOURCE_ID,
        source_sha256=SOURCE_HASH,
    )
    shot_root = generated.root / "shot-01"
    outside = tmp_path / "outside-shot"
    shutil.move(shot_root, outside)
    completed = subprocess.run(
        ["cmd", "/c", "mklink", "/J", str(shot_root), str(outside)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    if completed.returncode != 0:
        pytest.skip("Windows junction creation is unavailable")

    try:
        with pytest.raises(FakeMediaPackageError, match="unsafe path"):
            _generator(workspace).materialize(
                project_id=PROJECT_ID,
                source_document_id=SOURCE_ID,
                source_sha256=SOURCE_HASH,
            )
    finally:
        os.rmdir(shot_root)


def test_existing_media_symlink_outside_package_is_rejected(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    generated = _generator(workspace).materialize(
        project_id=PROJECT_ID,
        source_document_id=SOURCE_ID,
        source_sha256=SOURCE_HASH,
    )
    media = generated.resolve(generated.manifest.shots[0].preview_video)
    outside = tmp_path / "outside-preview.webm"
    shutil.move(media, outside)
    try:
        os.symlink(outside, media)
    except OSError:
        pytest.skip("Windows file symlink creation is unavailable")

    try:
        with pytest.raises(FakeMediaPackageError, match="unsafe path"):
            _generator(workspace).materialize(
                project_id=PROJECT_ID,
                source_document_id=SOURCE_ID,
                source_sha256=SOURCE_HASH,
            )
    finally:
        media.unlink()


def test_rechecks_locked_binary_hash_before_materialization(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    generator = _generator(workspace)
    monkeypatch.setattr(
        fake_media_package_module,
        "_binary_sha256",
        lambda _path: "0" * 64,
    )

    with pytest.raises(FakeMediaPackageError, match="changed after discovery"):
        generator.materialize(
            project_id=PROJECT_ID,
            source_document_id=SOURCE_ID,
            source_sha256=SOURCE_HASH,
        )

    assert list(workspace.iterdir()) == []


def test_tool_root_junction_is_rejected_before_discovery(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    tool_root = _toolchain().ffmpeg_path.parent
    junction = tmp_path / "tool-junction"
    completed = subprocess.run(
        ["cmd", "/c", "mklink", "/J", str(junction), str(tool_root)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    if completed.returncode != 0:
        pytest.skip("Windows junction creation is unavailable")

    try:
        with pytest.raises(FakeMediaPackageError, match="reparse point"):
            FakeMediaPackageGenerator.from_locked_tool_root(workspace, _lock(), junction)
    finally:
        os.rmdir(junction)


def test_remote_tool_root_is_rejected_before_discovery(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()

    with pytest.raises(FakeMediaPackageError, match="absolute local path"):
        FakeMediaPackageGenerator.from_locked_tool_root(
            workspace,
            _lock(),
            Path(r"\\server\share\ffmpeg"),
        )


def test_preview_byte_hashes_bind_directly_to_the_existing_timeline_export(
    tmp_path: Path,
) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    generated = _generator(workspace).materialize(
        project_id=PROJECT_ID,
        source_document_id=SOURCE_ID,
        source_sha256=SOURCE_HASH,
    )
    assets = tuple(
        TimelineAssetV1(
            asset_id=f"fake-asset-{index:02d}",
            source_asset_sha256=shot.preview_video.sha256,
            source_frame_count=shot.preview_video.frame_count,
        )
        for index, shot in enumerate(generated.manifest.shots, start=1)
    )
    timeline = TimelineVersionV1(
        timeline_id="fake-media-package-export",
        revision=1,
        sequence_timebase=SequenceTimebaseData(
            frame_rate=generated.manifest.frame_rate,
            timecode_mode="NON_DROP_FRAME",
        ),
        assets=assets,
        clips=tuple(
            TimelineClipV1(
                clip_id=f"fake-shot-{index:02d}",
                asset_id=asset.asset_id,
                source_in_frame=0,
                duration_frames=FRAME_COUNT,
            )
            for index, asset in enumerate(assets, start=1)
        ),
    )
    bindings = tuple(
        TimelineMediaBinding(
            editing_asset_sha256=shot.preview_video.sha256,
            path=generated.resolve(shot.preview_video),
        )
        for shot in generated.manifest.shots
    )
    for shot, binding in zip(generated.manifest.shots, bindings, strict=True):
        with binding.path.open("rb") as stream:
            independent_hash = "sha256:" + hashlib.file_digest(stream, "sha256").hexdigest()
        assert independent_hash == shot.preview_video.sha256

    exported = export_timeline_mp4(
        timeline,
        bindings,
        (workspace / "fake-package-export.mp4").resolve(),
        _toolchain(),
        purpose=TimelineExportPurpose.DEVELOPMENT_EVIDENCE,
    )

    assert exported.probe.video.width == 1080
    assert exported.probe.video.height == 1920
    assert len(exported.probe.video.frames) == FRAME_COUNT * 3
    assert exported.probe.audio is not None
    assert exported.probe.audio.sample_rate_hz == 48_000


def test_rename_failure_leaves_no_visible_or_staged_package(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    generator = _generator(workspace)

    def fail_rename(_source: Path, _destination: Path) -> None:
        raise OSError("injected rename failure")

    monkeypatch.setattr(fake_media_package_module, "_publish_directory", fail_rename)
    with pytest.raises(FakeMediaPackageError, match="could not be published"):
        generator.materialize(
            project_id=PROJECT_ID,
            source_document_id=SOURCE_ID,
            source_sha256=SOURCE_HASH,
        )

    package_root = workspace / "fake-media" / "v1" / PROJECT_ID
    assert {path.name for path in package_root.iterdir()} == {".publish.lock"}


def test_rejects_direct_or_non_development_toolchain_before_creating_files(
    tmp_path: Path,
) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    with pytest.raises(FakeMediaPackageError, match="locked tool root"):
        FakeMediaPackageGenerator(workspace, _toolchain())
    lock = _lock()
    non_development_profile = lock.profiles[0].model_copy(
        update={"distribution_status": "RELEASE_REVIEW_REQUIRED"}
    )
    non_development_lock = lock.model_copy(update={"profiles": (non_development_profile,)})
    with pytest.raises(FakeMediaPackageError, match="development evidence"):
        FakeMediaPackageGenerator.from_locked_tool_root(
            workspace,
            non_development_lock,
            _toolchain().ffmpeg_path.parent,
        )

    assert list(workspace.iterdir()) == []


def test_existing_corrupt_package_fails_closed_without_overwriting(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    generator = _generator(workspace)
    generated = generator.materialize(
        project_id=PROJECT_ID,
        source_document_id=SOURCE_ID,
        source_sha256=SOURCE_HASH,
    )
    video = generated.resolve(generated.manifest.shots[0].preview_video)
    original_mtime = video.stat().st_mtime_ns
    video.write_bytes(b"corrupt")
    corrupt_mtime = video.stat().st_mtime_ns

    with pytest.raises(FakeMediaPackageError, match="existing fake media package is invalid"):
        generator.materialize(
            project_id=PROJECT_ID,
            source_document_id=SOURCE_ID,
            source_sha256=SOURCE_HASH,
        )

    assert video.read_bytes() == b"corrupt"
    assert video.stat().st_mtime_ns == corrupt_mtime
    assert corrupt_mtime != original_mtime


@pytest.mark.parametrize(
    ("project_id", "source_document_id", "source_sha256"),
    [
        ("../escape", SOURCE_ID, SOURCE_HASH),
        (PROJECT_ID, "../escape", SOURCE_HASH),
        (PROJECT_ID, SOURCE_ID, "sha256:ABC"),
    ],
)
def test_rejects_untrusted_identity_before_creating_files(
    tmp_path: Path,
    project_id: str,
    source_document_id: str,
    source_sha256: str,
) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    generator = _generator(workspace)

    with pytest.raises((FakeMediaPackageError, ValueError)):
        generator.materialize(
            project_id=project_id,
            source_document_id=source_document_id,
            source_sha256=source_sha256,
        )

    assert list(workspace.iterdir()) == []


def test_manifest_rejects_noncanonical_extra_fields(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    generator = _generator(workspace)
    generated = generator.materialize(
        project_id=PROJECT_ID,
        source_document_id=SOURCE_ID,
        source_sha256=SOURCE_HASH,
    )
    manifest_path = generated.root / "manifest.json"
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    payload["api_key"] = "must-not-be-accepted"
    manifest_path.write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(FakeMediaPackageError, match="existing fake media package is invalid"):
        generator.materialize(
            project_id=PROJECT_ID,
            source_document_id=SOURCE_ID,
            source_sha256=SOURCE_HASH,
        )


def _preview_payload(shot_number: int = 1) -> dict[str, object]:
    return {
        "relative_path": f"shot-{shot_number:02d}/preview.webm",
        "sha256": "sha256:" + "ab" * 32,
        "byte_size": 1,
        "frame_rate": {"num": 25, "den": 1},
    }


def _shot_media_payload(shot_number: int) -> dict[str, object]:
    shot_directory = f"shot-{shot_number:02d}"
    return {
        "shot_id": f"fake-shot-{shot_number:02d}",
        "still_image": {
            "relative_path": f"{shot_directory}/still.png",
            "sha256": "sha256:" + "01" * 32,
            "byte_size": 1,
        },
        "scratch_voice": {
            "relative_path": f"{shot_directory}/scratch-voice.wav",
            "sha256": "sha256:" + "02" * 32,
            "byte_size": 1,
        },
        "preview_video": _preview_payload(shot_number),
    }


def _media_package_payload() -> dict[str, object]:
    return {
        "package_id": "fmp_" + "ab" * 16,
        "request_hash": "sha256:" + "03" * 32,
        "project_id": PROJECT_ID,
        "source_document_id": SOURCE_ID,
        "source_sha256": SOURCE_HASH,
        "toolchain_profile_id": "test-profile",
        "toolchain_version": "1.0.0",
        "ffmpeg_sha256": "sha256:" + "04" * 32,
        "ffprobe_sha256": "sha256:" + "05" * 32,
        "frame_rate": {"num": 25, "den": 1},
        "shots": [_shot_media_payload(index) for index in range(1, 4)],
    }


def test_preview_contract_rejects_a_non_25_fps_preview() -> None:
    payload = _preview_payload()
    payload["frame_rate"] = {"num": 24, "den": 1}

    with pytest.raises(ValueError, match="fake editing preview must use 25 fps CFR"):
        FakePreviewVideoFileV1.model_validate(payload)


def test_shot_contract_rejects_media_from_another_shot() -> None:
    payload = _shot_media_payload(1)
    preview = payload["preview_video"]
    assert isinstance(preview, dict)
    preview["relative_path"] = "shot-02/preview.webm"

    with pytest.raises(ValueError, match="fake media file paths must match their shot"):
        FakeShotMediaV1.model_validate(payload)


@pytest.mark.parametrize(
    "case",
    ("frame-rate", "shot-order"),
)
def test_package_contract_rejects_invalid_phase0_metadata(case: str) -> None:
    payload = _media_package_payload()
    shots = payload["shots"]
    assert isinstance(shots, list)
    if case == "frame-rate":
        payload["frame_rate"] = {"num": 24, "den": 1}
        message = "fake media package must use the Phase 0 25 fps timebase"
    elif case == "shot-order":
        payload["shots"] = [shots[1], shots[0], shots[2]]
        message = "fake media package shots must be complete and ordered"

    with pytest.raises(ValueError, match=message):
        FakeMediaPackageV1.model_validate(payload)


def test_generated_package_resolve_rejects_missing_and_escaping_media(tmp_path: Path) -> None:
    root = tmp_path / "package"
    root.mkdir()
    manifest = FakeMediaPackageV1.model_validate(_media_package_payload())
    generated = GeneratedFakeMediaPackage(root=root, manifest=manifest)
    preview = FakePreviewVideoFileV1.model_validate(_preview_payload())

    with pytest.raises(FakeMediaPackageError, match="path is unavailable"):
        generated.resolve(preview)

    outside = tmp_path / "outside.webm"
    outside.write_bytes(b"outside")
    escaped_preview = preview.model_copy(update={"relative_path": "../outside.webm"})
    with pytest.raises(FakeMediaPackageError, match="path escapes its package"):
        generated.resolve(escaped_preview)


@pytest.mark.parametrize(
    ("case", "workspace"),
    [
        ("relative", Path("relative-workspace")),
        ("missing", None),
        ("file", None),
    ],
    ids=("relative-workspace", "missing-workspace", "file-workspace"),
)
def test_locked_generator_rejects_unsafe_workspace_roots(
    tmp_path: Path,
    case: str,
    workspace: Path | None,
) -> None:
    if case == "missing":
        workspace = tmp_path / "missing-workspace"
        message = "fake media workspace is unavailable"
    elif case == "file":
        workspace = tmp_path / "workspace-file"
        workspace.write_bytes(b"not-a-directory")
        message = "fake media workspace must be a local directory"
    else:
        assert workspace is not None
        message = "fake media workspace must be an absolute local path"

    with pytest.raises(FakeMediaPackageError, match=message):
        FakeMediaPackageGenerator.from_locked_tool_root(
            workspace,
            _lock(),
            _toolchain().ffmpeg_path.parent,
        )


@pytest.mark.parametrize(
    "case",
    ("relative", "missing", "file"),
)
def test_locked_generator_rejects_unsafe_tool_roots(tmp_path: Path, case: str) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    if case == "relative":
        tool_root = Path("relative-tool-root")
        message = "media tool root must be an absolute local path"
    elif case == "missing":
        tool_root = tmp_path / "missing-tool-root"
        message = "media tool root is unavailable"
    else:
        tool_root = tmp_path / "tool-root-file"
        tool_root.write_bytes(b"not-a-directory")
        message = "media tool root must be a local directory"

    with pytest.raises(FakeMediaPackageError, match=message):
        FakeMediaPackageGenerator.from_locked_tool_root(workspace, _lock(), tool_root)


@pytest.mark.parametrize("case", ("empty", "over-limit"))
def test_materialize_rejects_invalid_existing_media_files(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    case: str,
) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    generator = _generator(workspace)
    generated = generator.materialize(
        project_id=PROJECT_ID,
        source_document_id=SOURCE_ID,
        source_sha256=SOURCE_HASH,
    )
    image = generated.resolve(generated.manifest.shots[0].still_image)
    if case == "empty":
        image.write_bytes(b"")
        message = "fake media file is empty"
    else:
        monkeypatch.setattr(fake_media_package_module, "MAX_MEDIA_FILE_BYTES", 1)
        message = "fake media file exceeds the size limit"

    with pytest.raises(FakeMediaPackageError, match=message):
        generator.materialize(
            project_id=PROJECT_ID,
            source_document_id=SOURCE_ID,
            source_sha256=SOURCE_HASH,
        )

    assert image.exists()


def test_materialize_stops_before_creating_a_package(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    generator = _generator(workspace)

    with pytest.raises(FakeMediaPackageError, match="Fake media generation was interrupted"):
        generator.materialize(
            project_id=PROJECT_ID,
            source_document_id=SOURCE_ID,
            source_sha256=SOURCE_HASH,
            stop_requested=lambda: True,
        )

    assert list(workspace.iterdir()) == []


def _workspace_tree_snapshot(workspace: Path) -> tuple[tuple[object, ...], ...]:
    entries: list[tuple[object, ...]] = [("directory", ".")]
    paths = sorted(workspace.rglob("*"), key=lambda path: path.relative_to(workspace).as_posix())
    for path in paths:
        relative_path = path.relative_to(workspace).as_posix()
        if path.is_dir():
            entries.append(("directory", relative_path))
            continue
        digest = hashlib.sha256()
        byte_size = 0
        with path.open("rb") as stream:
            while chunk := stream.read(1024 * 1024):
                digest.update(chunk)
                byte_size += len(chunk)
        entries.append(("file", relative_path, byte_size, digest.hexdigest()))
    return tuple(entries)


def test_existing_package_verification_stops_and_rejects_unexpected_files(
    tmp_path: Path,
) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    generator = _generator(workspace)
    generated = generator.materialize(
        project_id=PROJECT_ID,
        source_document_id=SOURCE_ID,
        source_sha256=SOURCE_HASH,
    )
    root_before = generated.root
    workspace_before = _workspace_tree_snapshot(workspace)
    stop_calls = 0

    def stop_during_verification() -> bool:
        nonlocal stop_calls
        stop_calls += 1
        # Permit setup callbacks, then interrupt at existing-package shot verification
        # before its media probes can reuse this callback.
        return stop_calls == 3

    with pytest.raises(FakeMediaPackageError, match="verification was interrupted"):
        generator.materialize(
            project_id=PROJECT_ID,
            source_document_id=SOURCE_ID,
            source_sha256=SOURCE_HASH,
            stop_requested=stop_during_verification,
        )

    assert stop_calls == 3
    assert generated.root == root_before
    assert generated.root.is_dir()
    assert _workspace_tree_snapshot(workspace) == workspace_before

    unexpected_shot_file = generated.root / "shot-01" / "unexpected.tmp"
    unexpected_shot_file.write_bytes(b"unexpected")
    with pytest.raises(FakeMediaPackageError, match="existing fake media package is invalid"):
        generator.materialize(
            project_id=PROJECT_ID,
            source_document_id=SOURCE_ID,
            source_sha256=SOURCE_HASH,
        )
    assert _workspace_tree_snapshot(workspace) != workspace_before
    unexpected_shot_file.unlink()
    assert _workspace_tree_snapshot(workspace) == workspace_before

    unexpected_root_file = generated.root / "unexpected-root.tmp"
    unexpected_root_file.write_bytes(b"unexpected")
    with pytest.raises(FakeMediaPackageError, match="existing fake media package is invalid"):
        generator.materialize(
            project_id=PROJECT_ID,
            source_document_id=SOURCE_ID,
            source_sha256=SOURCE_HASH,
        )
    assert _workspace_tree_snapshot(workspace) != workspace_before
    unexpected_root_file.unlink()
    assert _workspace_tree_snapshot(workspace) == workspace_before


def test_public_package_model_copy_rechecks_capabilities_and_unique_paths() -> None:
    package = FakeMediaPackageV1.model_validate(_media_package_payload())
    assert len(package.shots) == 3
    # model_copy deliberately constructs invalid instances after initial Pydantic validation.
    incomplete_capabilities = package.shots[0].model_copy(update={"capability_losses": ()})
    capability_mismatch = package.model_copy(
        update={"shots": (incomplete_capabilities, *package.shots[1:])}
    )

    with pytest.raises(
        ValueError,
        match="fake media capability losses must be explicit on every shot",
    ):
        capability_mismatch.require_phase0_media_contract()

    duplicate_preview = package.shots[1].preview_video.model_copy(
        update={"relative_path": package.shots[0].preview_video.relative_path}
    )
    duplicate_shot = package.shots[1].model_copy(update={"preview_video": duplicate_preview})
    duplicate_paths = package.model_copy(
        update={"shots": (package.shots[0], duplicate_shot, package.shots[2])}
    )

    with pytest.raises(ValueError, match="fake media package paths must be unique"):
        duplicate_paths.require_phase0_media_contract()


@pytest.mark.parametrize(
    ("payload", "message"),
    [
        ("123 (worker", "invalid proc stat process name"),
        ("123 (worker) S " + " ".join("0" for _ in range(18)), "no starttime field"),
        (
            "123 (worker) S " + " ".join([*("0" for _ in range(18)), "0"]),
            "starttime must be positive",
        ),
    ],
    ids=("missing-closing-parenthesis", "missing-starttime", "nonpositive-starttime"),
)
def test_process_recovery_proc_stat_seam_rejects_invalid_layouts(
    payload: str,
    message: str,
) -> None:
    with pytest.raises(ValueError, match=message):
        fake_media_package_module._parse_proc_start_ticks(payload)


def test_process_recovery_clock_tick_seam_bounds_and_parses_output(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class Completed:
        def __init__(self, stdout: bytes) -> None:
            self.stdout = stdout

    monkeypatch.setattr(
        fake_media_package_module.subprocess,
        "run",
        lambda *_args, **_kwargs: Completed(b"x" * 33),
    )
    with pytest.raises(FakeMediaPackageError, match="POSIX clock ticks are unavailable"):
        fake_media_package_module._clock_ticks_per_second()

    monkeypatch.setattr(
        fake_media_package_module.subprocess,
        "run",
        lambda *_args, **_kwargs: Completed(b"250\n"),
    )
    assert fake_media_package_module._clock_ticks_per_second() == 250


def test_process_recovery_lease_reader_requires_canonical_existing_files(
    tmp_path: Path,
) -> None:
    missing = tmp_path / "missing-lease.json"
    assert fake_media_package_module._read_active_lease(missing, tmp_path) is None

    canonical_path = fake_media_package_module._write_staging_lease(tmp_path)
    canonical_lease = fake_media_package_module._read_active_lease(canonical_path, tmp_path)
    assert canonical_lease is not None
    assert canonical_lease.pid == os.getpid()

    payload = json.loads(canonical_path.read_text(encoding="utf-8"))
    canonical_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    assert fake_media_package_module._read_active_lease(canonical_path, tmp_path) is None


def test_process_recovery_cleanup_rejects_a_publish_lease_without_staging_prefix(
    tmp_path: Path,
) -> None:
    malformed_lease = tmp_path / f"wrong-name{fake_media_package_module.PUBLISH_LEASE_SUFFIX}"
    malformed_lease.write_bytes(b"{}")

    with pytest.raises(FakeMediaPackageError, match="fake media publish lease name is invalid"):
        fake_media_package_module._cleanup_stale_staging_in_lock(tmp_path)

    assert malformed_lease.exists()


def test_process_recovery_cleanup_keeps_active_and_removes_inactive_publish_lease(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    staging_root = tmp_path / f"{fake_media_package_module.STAGING_PREFIX}standalone"
    publish_lease = fake_media_package_module._write_publish_lease(tmp_path, staging_root)
    sentinel = tmp_path / "unrelated.txt"
    sentinel.write_bytes(b"keep")

    monkeypatch.setattr(fake_media_package_module, "_process_is_active", lambda *_args: True)
    fake_media_package_module._cleanup_stale_staging_in_lock(tmp_path)
    assert publish_lease.exists()
    assert sentinel.read_bytes() == b"keep"

    monkeypatch.setattr(fake_media_package_module, "_process_is_active", lambda *_args: False)
    fake_media_package_module._cleanup_stale_staging_in_lock(tmp_path)
    assert not publish_lease.exists()
    assert sentinel.read_bytes() == b"keep"


def test_process_recovery_cleanup_keeps_staging_with_an_active_publish_lease(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    staging_root = tmp_path / f"{fake_media_package_module.STAGING_PREFIX}publishing"
    staging_root.mkdir()
    sentinel = staging_root / "sentinel.txt"
    sentinel.write_bytes(b"keep")
    publish_lease = fake_media_package_module._write_publish_lease(tmp_path, staging_root)
    monkeypatch.setattr(fake_media_package_module, "_process_is_active", lambda *_args: True)

    fake_media_package_module._cleanup_stale_staging_in_lock(tmp_path)

    assert staging_root.is_dir()
    assert sentinel.read_bytes() == b"keep"
    assert publish_lease.exists()


def test_process_recovery_cleanup_keeps_staging_with_an_active_canonical_lease(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    staging_root = tmp_path / f"{fake_media_package_module.STAGING_PREFIX}leased"
    staging_root.mkdir()
    staging_lease = fake_media_package_module._write_staging_lease(staging_root)
    monkeypatch.setattr(fake_media_package_module, "_process_is_active", lambda *_args: True)

    fake_media_package_module._cleanup_stale_staging_in_lock(tmp_path)

    assert staging_root.is_dir()
    assert staging_lease.exists()


def test_process_recovery_cleanup_keeps_recent_and_removes_old_unleased_staging(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    recent_staging = tmp_path / f"{fake_media_package_module.STAGING_PREFIX}recent"
    old_staging = tmp_path / f"{fake_media_package_module.STAGING_PREFIX}old"
    recent_staging.mkdir()
    old_staging.mkdir()
    recent_sentinel = recent_staging / "recent.txt"
    old_sentinel = old_staging / "old.txt"
    root_sentinel = tmp_path / "unrelated.txt"
    recent_sentinel.write_bytes(b"recent")
    old_sentinel.write_bytes(b"old")
    root_sentinel.write_bytes(b"keep")
    recent_before = _workspace_tree_snapshot(recent_staging)
    root_names_before = {path.name for path in tmp_path.iterdir()}
    old_mtime_ns = time.time_ns() - int(
        (fake_media_package_module.STAGING_GRACE_SECONDS + 2) * 1_000_000_000
    )
    os.utime(old_staging, ns=(old_mtime_ns, old_mtime_ns))
    monkeypatch.setattr(fake_media_package_module, "_process_is_active", lambda *_args: False)

    fake_media_package_module._cleanup_stale_staging_in_lock(tmp_path)

    assert {path.name for path in tmp_path.iterdir()} == root_names_before - {old_staging.name}
    assert recent_staging.is_dir()
    assert recent_sentinel.read_bytes() == b"recent"
    assert _workspace_tree_snapshot(recent_staging) == recent_before
    assert not old_staging.exists()
    assert not old_sentinel.exists()
    assert root_sentinel.read_bytes() == b"keep"


@pytest.fixture(scope="module")
def existing_package_base(tmp_path_factory: pytest.TempPathFactory):
    workspace = tmp_path_factory.mktemp("fake-media-existing-base") / "workspace"
    workspace.mkdir()
    generated = _generator(workspace).materialize(
        project_id=PROJECT_ID,
        source_document_id=SOURCE_ID,
        source_sha256=SOURCE_HASH,
    )
    return (
        workspace,
        generated.root.relative_to(workspace),
        _workspace_tree_snapshot(workspace),
    )


def _copy_existing_package(
    tmp_path: Path,
    existing_package_base: tuple[Path, Path, tuple[tuple[object, ...], ...]],
) -> tuple[Path, Path, tuple[tuple[object, ...], ...]]:
    base_workspace, package_relative_path, base_snapshot = existing_package_base
    assert _workspace_tree_snapshot(base_workspace) == base_snapshot
    workspace = tmp_path / "workspace"
    shutil.copytree(base_workspace, workspace)
    assert _workspace_tree_snapshot(workspace) == base_snapshot
    return workspace, workspace / package_relative_path, base_snapshot


def _rewrite_manifest_from_payload(package_root: Path, payload: dict[str, object]) -> bytes:
    manifest_path = package_root / "manifest.json"
    original = manifest_path.read_bytes()
    manifest = FakeMediaPackageV1.model_validate(payload)
    manifest_path.write_bytes(
        fake_media_package_module._canonical_json(manifest.model_dump(mode="json"))
    )
    return original


def _refresh_manifest_media_identity(
    package_root: Path,
    *,
    shot_index: int,
    media_key: str,
) -> bytes:
    manifest_path = package_root / "manifest.json"
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    shots = payload["shots"]
    assert isinstance(shots, list)
    shot = shots[shot_index]
    assert isinstance(shot, dict)
    media = shot[media_key]
    assert isinstance(media, dict)
    relative_path = media["relative_path"]
    assert isinstance(relative_path, str)
    path = package_root / relative_path
    with path.open("rb") as stream:
        sha256 = "sha256:" + hashlib.file_digest(stream, "sha256").hexdigest()
    media["sha256"] = sha256
    media["byte_size"] = path.stat().st_size
    return _rewrite_manifest_from_payload(package_root, payload)


@pytest.mark.parametrize(
    ("case", "message"),
    [
        ("oversized", "existing fake media package is invalid"),
        ("noncanonical", "existing fake media package is invalid"),
        ("identity-mismatch", "existing fake media package is invalid"),
    ],
    ids=("manifest-size-limit", "manifest-noncanonical", "manifest-identity-mismatch"),
)
def test_public_existing_package_rejects_manifest_integrity_drift(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    existing_package_base: tuple[Path, Path, tuple[tuple[object, ...], ...]],
    case: str,
    message: str,
) -> None:
    workspace, package_root, baseline_snapshot = _copy_existing_package(
        tmp_path,
        existing_package_base,
    )
    manifest_path = package_root / "manifest.json"
    original = manifest_path.read_bytes()
    try:
        if case == "oversized":
            monkeypatch.setattr(fake_media_package_module, "MAX_MANIFEST_BYTES", 1)
        else:
            payload = json.loads(original)
            if case == "noncanonical":
                manifest = FakeMediaPackageV1.model_validate(payload)
                manifest_path.write_text(
                    json.dumps(manifest.model_dump(mode="json"), indent=2),
                    encoding="utf-8",
                )
            else:
                payload["source_document_id"] = "src_" + "24" * 16
                _rewrite_manifest_from_payload(package_root, payload)

        with pytest.raises(FakeMediaPackageError, match=message):
            _generator(workspace).materialize(
                project_id=PROJECT_ID,
                source_document_id=SOURCE_ID,
                source_sha256=SOURCE_HASH,
            )
    finally:
        manifest_path.write_bytes(original)

    assert _workspace_tree_snapshot(workspace) == baseline_snapshot


def test_public_existing_package_rejects_png_contract_drift(
    tmp_path: Path,
    existing_package_base: tuple[Path, Path, tuple[tuple[object, ...], ...]],
) -> None:
    workspace, package_root, baseline_snapshot = _copy_existing_package(
        tmp_path,
        existing_package_base,
    )
    image = package_root / "shot-01" / "still.png"
    original_image = image.read_bytes()
    try:
        changed = bytearray(original_image)
        changed[16:20] = (1).to_bytes(4, "big")
        image.write_bytes(changed)
        original_manifest = _refresh_manifest_media_identity(
            package_root,
            shot_index=0,
            media_key="still_image",
        )
        try:
            with pytest.raises(
                FakeMediaPackageError,
                match="fake still image does not match its contract",
            ):
                _generator(workspace).materialize(
                    project_id=PROJECT_ID,
                    source_document_id=SOURCE_ID,
                    source_sha256=SOURCE_HASH,
                )
        finally:
            (package_root / "manifest.json").write_bytes(original_manifest)
    finally:
        image.write_bytes(original_image)

    assert _workspace_tree_snapshot(workspace) == baseline_snapshot


def test_public_existing_package_rejects_wav_contract_drift(
    tmp_path: Path,
    existing_package_base: tuple[Path, Path, tuple[tuple[object, ...], ...]],
) -> None:
    workspace, package_root, baseline_snapshot = _copy_existing_package(
        tmp_path,
        existing_package_base,
    )
    voice = package_root / "shot-01" / "scratch-voice.wav"
    original_voice = voice.read_bytes()
    try:
        with wave.open(str(voice), "wb") as stream:
            stream.setnchannels(2)
            stream.setsampwidth(2)
            stream.setframerate(48_000)
            stream.writeframes(b"\0\0\0\0")
        original_manifest = _refresh_manifest_media_identity(
            package_root,
            shot_index=0,
            media_key="scratch_voice",
        )
        try:
            with pytest.raises(
                FakeMediaPackageError,
                match="fake scratch voice does not match its contract",
            ):
                _generator(workspace).materialize(
                    project_id=PROJECT_ID,
                    source_document_id=SOURCE_ID,
                    source_sha256=SOURCE_HASH,
                )
        finally:
            (package_root / "manifest.json").write_bytes(original_manifest)
    finally:
        voice.write_bytes(original_voice)

    assert _workspace_tree_snapshot(workspace) == baseline_snapshot


def test_public_existing_package_rejects_preview_contract_drift(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    existing_package_base: tuple[Path, Path, tuple[tuple[object, ...], ...]],
) -> None:
    workspace, package_root, baseline_snapshot = _copy_existing_package(
        tmp_path,
        existing_package_base,
    )
    preview = package_root / "shot-01" / "preview.webm"
    real_probe = fake_media_package_module.probe_local_media

    def probe_with_wrong_width(*args: object, **kwargs: object):
        probe = real_probe(*args, **kwargs)
        if Path(args[0]) == preview:
            return probe.model_copy(
                update={"video": probe.video.model_copy(update={"width": probe.video.width - 1})}
            )
        return probe

    monkeypatch.setattr(fake_media_package_module, "probe_local_media", probe_with_wrong_width)
    with pytest.raises(
        FakeMediaPackageError,
        match="fake preview video does not match its contract",
    ):
        _generator(workspace).materialize(
            project_id=PROJECT_ID,
            source_document_id=SOURCE_ID,
            source_sha256=SOURCE_HASH,
        )

    assert _workspace_tree_snapshot(workspace) == baseline_snapshot


def test_staging_verification_seam_rejects_a_noncanonical_lease(
    tmp_path: Path,
    existing_package_base: tuple[Path, Path, tuple[tuple[object, ...], ...]],
) -> None:
    _, base_package_relative_path, _ = existing_package_base
    project_root = tmp_path / "project"
    project_root.mkdir()
    base_workspace = existing_package_base[0]
    staging_root = project_root / f"{fake_media_package_module.STAGING_PREFIX}verification"
    shutil.copytree(base_workspace / base_package_relative_path, staging_root)
    manifest = FakeMediaPackageV1.model_validate_json((staging_root / "manifest.json").read_bytes())
    expected = {
        key: getattr(manifest, key)
        for key in (
            "package_id",
            "request_hash",
            "project_id",
            "source_document_id",
            "source_sha256",
            "toolchain_profile_id",
            "toolchain_version",
            "ffmpeg_sha256",
            "ffprobe_sha256",
            "purpose",
        )
    }
    lease_path = fake_media_package_module._write_staging_lease(staging_root)
    lease_payload = json.loads(lease_path.read_text(encoding="utf-8"))
    lease_path.write_text(json.dumps(lease_payload, indent=2), encoding="utf-8")

    with pytest.raises(FakeMediaPackageError, match="fake media staging lease is invalid"):
        fake_media_package_module._verify_package(
            staging_root,
            expected,
            _toolchain(),
            project_root=project_root,
            allow_active_staging_lease=True,
        )

    assert lease_path.exists()


def test_private_binary_hash_seam_rejects_a_directory(tmp_path: Path) -> None:
    with pytest.raises(FakeMediaPackageError, match="media tool binary path is unsafe"):
        fake_media_package_module._binary_sha256(tmp_path)


def test_private_internal_directory_seam_rejects_a_file(tmp_path: Path) -> None:
    workspace_file = tmp_path / "workspace-file"
    workspace_file.write_bytes(b"not-a-directory")
    with pytest.raises(FakeMediaPackageError, match="fake media storage directory is unsafe"):
        fake_media_package_module._require_internal_directory(workspace_file, tmp_path)


def test_private_ffmpeg_seam_terminates_when_stop_is_requested(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    toolchain = _toolchain()

    class StoppedProcess:
        def __init__(self) -> None:
            self.returncode: int | None = None
            self.terminate_calls = 0
            self.wait_calls = 0

        def poll(self) -> int | None:
            return None

        def terminate(self) -> None:
            self.terminate_calls += 1
            self.returncode = -15

        def wait(self, timeout: float | None = None) -> int:
            del timeout
            self.wait_calls += 1
            return -15

    stopped = StoppedProcess()
    monkeypatch.setattr(
        fake_media_package_module.subprocess,
        "Popen",
        lambda *_args, **_kwargs: stopped,
    )
    with pytest.raises(FakeMediaPackageError, match="locked FFmpeg generation was interrupted"):
        fake_media_package_module._run_ffmpeg(toolchain, [], lambda: True)
    assert stopped.terminate_calls == 1
    assert stopped.wait_calls == 1
    assert stopped.returncode == -15


def test_private_ffmpeg_seam_rejects_a_nonzero_exit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    toolchain = _toolchain()

    class FailedProcess:
        returncode = 1

        def poll(self) -> int:
            return self.returncode

    monkeypatch.setattr(
        fake_media_package_module.subprocess,
        "Popen",
        lambda *_args, **_kwargs: FailedProcess(),
    )
    with pytest.raises(FakeMediaPackageError, match="locked FFmpeg failed to generate Fake media"):
        fake_media_package_module._run_ffmpeg(toolchain, [], lambda: False)


def test_private_constructor_seam_requires_a_locked_toolchain(tmp_path: Path) -> None:
    toolchain = _toolchain()
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    with pytest.raises(FakeMediaPackageError, match="requires a locked toolchain"):
        FakeMediaPackageGenerator(
            workspace,
            toolchain,
            _construction_token=fake_media_package_module._LOCKED_CONSTRUCTION_TOKEN,
        )

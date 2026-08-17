from __future__ import annotations

import hashlib
import json
import multiprocessing
import os
import shutil
import subprocess
import time
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

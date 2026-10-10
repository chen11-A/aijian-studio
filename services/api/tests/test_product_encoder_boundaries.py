"""Product encoder process substitute tests; never execute a binary or real media."""

import hashlib
import io
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from aijian_api import product_export_encoder as encoder
from aijian_api.media_toolchain import MediaToolchain
from aijian_api.product_export_render_plan import ProductExportRenderPlan
from aijian_api.product_timeline_export_contracts import ProductExportSpec


@pytest.fixture
def boundary(tmp_path, monkeypatch):
    tool = tmp_path / "synthetic-tool.bin"
    source = tmp_path / "synthetic-source.bin"
    output = tmp_path / "temporary.mp4"
    tool.write_bytes(b"synthetic-tool")
    source.write_bytes(b"synthetic-source")
    tool_hash = hashlib.sha256(tool.read_bytes()).hexdigest()
    tools = MediaToolchain(
        profile_id="synthetic",
        version="1.0.0",
        ffmpeg_path=tool,
        ffprobe_path=tool,
        ffmpeg_sha256=tool_hash,
        ffprobe_sha256=tool_hash,
        configuration_flags=(),
        license_class="LGPL",
        spdx_license="LGPL-2.1-or-later",
        distribution_status="DEVELOPMENT_ONLY",
    )
    plan = ProductExportRenderPlan(
        assembly_content_hash="sha256:" + "a" * 64,
        source_asset_id="asset_" + "b" * 32,
        source_version_id="asv_" + "c" * 32,
        source_sha256=hashlib.sha256(source.read_bytes()).hexdigest(),
        source_probe_sha256="d" * 64,
        toolchain_profile_id=tools.profile_id,
        ffmpeg_sha256=tool_hash,
        ffprobe_sha256=tool_hash,
        total_frames=125,
        has_audio=True,
        spec=ProductExportSpec(
            container="MP4",
            width=1080,
            height=1920,
            frame_rate_num=25,
            frame_rate_den=1,
            video_codec="H264",
            audio_codec="AAC",
        ),
    )
    process = Mock(
        stdout=io.BytesIO(b"frame=125\n"), stderr=io.BytesIO(b"synthetic log\n"), returncode=0
    )
    process.poll.return_value = 0

    def spawn(*args, **kwargs):
        output.write_bytes(b"NOT AN MP4 - synthetic process output")
        return process

    manager = Mock(spawn=Mock(side_effect=spawn))

    class Reader:
        def __init__(self, target, **kwargs):
            self.target = target

        def start(self):
            self.target()

        def join(self, **kwargs):
            pass

        def is_alive(self):
            return False

    monkeypatch.setattr(encoder, "threading", SimpleNamespace(Thread=Reader))
    return SimpleNamespace(
        plan=plan,
        source=source,
        output=output,
        tools=tools,
        process=process,
        manager=manager,
        reader=Reader,
    )


def run(boundary, **kwargs):
    return encoder.run_local_encoder(
        boundary.plan,
        boundary.source,
        boundary.output,
        boundary.tools,
        job_manager=boundary.manager,
        on_progress=kwargs.pop("on_progress", lambda _: None),
        stop_requested=kwargs.pop("stop_requested", lambda: False),
        **kwargs,
    )


@pytest.mark.parametrize("has_audio", [True, False])
def test_success_returns_process_evidence_not_a_verified_mp4(boundary, has_audio):
    boundary.plan = boundary.plan.model_copy(update={"has_audio": has_audio})
    result = run(boundary)
    assert result.exit_code == 0
    assert result.progress_frames == 125
    assert result.stderr_sha256 == hashlib.sha256(b"synthetic log\n").hexdigest()
    arguments = boundary.manager.spawn.call_args.args[1]
    assert ("-an" in arguments) is not has_audio
    assert arguments[-1] == str(boundary.output)
    boundary.manager.spawn.assert_called_once()
    boundary.manager.release.assert_called_once_with(boundary.process)


@pytest.mark.parametrize("timeout", [None, "1", True, 0, -1, float("nan"), float("inf"), 3601])
def test_invalid_timeout_does_not_launch(boundary, timeout):
    with pytest.raises(encoder.ProductExportEncoderError) as caught:
        run(boundary, timeout_seconds=timeout)
    assert caught.value.code == "PLAN_OR_TOOLCHAIN_INVALID"
    boundary.manager.spawn.assert_not_called()


@pytest.mark.parametrize("field", ["ffmpeg_sha256", "ffprobe_sha256", "toolchain_profile_id"])
def test_changed_plan_toolchain_identity_never_launches(boundary, field):
    boundary.plan = boundary.plan.model_copy(update={field: "changed"})
    with pytest.raises(encoder.ProductExportEncoderError) as caught:
        run(boundary)
    assert caught.value.code == "PLAN_OR_TOOLCHAIN_INVALID"
    boundary.manager.spawn.assert_not_called()


@pytest.mark.parametrize(
    ("change", "code"),
    [
        ("missing-source", "PATH_UNSAFE"),
        ("relative-output", "PATH_UNSAFE"),
        ("existing-output", "PATH_UNSAFE"),
        ("tool-changed", "TOOLCHAIN_CHANGED"),
        ("tool-missing", "TOOLCHAIN_UNAVAILABLE"),
        ("source-empty", "SOURCE_SIZE"),
        ("source-changed", "SOURCE_CHANGED"),
        ("source-open", "SOURCE_UNAVAILABLE"),
    ],
)
def test_source_and_tool_boundaries_fail_before_process(boundary, monkeypatch, change, code):
    if change == "missing-source":
        boundary.source.unlink()
    elif change == "relative-output":
        boundary.output = type(boundary.output)("relative.mp4")
    elif change == "existing-output":
        boundary.output.write_bytes(b"must not overwrite")
    elif change == "tool-changed":
        boundary.tools.ffmpeg_path.write_bytes(b"changed")
    elif change == "tool-missing":
        boundary.tools.ffmpeg_path.unlink()
    elif change.startswith("source-") and change != "source-open":
        boundary.source.write_bytes(b"" if change == "source-empty" else b"changed")
    else:
        original = encoder._open_local_source

        def opened(path):
            if path.name == boundary.source.name:
                raise OSError("synthetic source failure")
            return original(path)

        monkeypatch.setattr(encoder, "_open_local_source", opened)
    with pytest.raises(encoder.ProductExportEncoderError) as caught:
        run(boundary)
    assert caught.value.code == code
    boundary.manager.spawn.assert_not_called()


def test_source_hash_deadline_never_dispatches(boundary, monkeypatch):
    clock = iter([0, 121])
    monkeypatch.setattr(encoder, "time", SimpleNamespace(monotonic=lambda: next(clock)))
    with pytest.raises(encoder.ProductExportEncoderError) as caught:
        run(boundary)
    assert caught.value.code == "SOURCE_HASH_TIMEOUT"
    boundary.manager.spawn.assert_not_called()


def test_cancellation_before_dispatch_has_no_process_to_release(boundary):
    with pytest.raises(encoder.ProductExportEncoderError) as caught:
        run(boundary, stop_requested=lambda: True)
    assert caught.value.code == "CANCELLED"
    boundary.manager.spawn.assert_not_called()
    boundary.manager.release.assert_not_called()


@pytest.mark.parametrize("failure", ["cancel", "timeout", "nonzero", "output-missing"])
def test_execution_failure_stops_and_releases_the_same_job(boundary, monkeypatch, failure):
    if failure in {"cancel", "timeout"}:
        boundary.process.poll.return_value = None
    if failure == "nonzero":
        boundary.process.returncode = 7
    if failure == "output-missing":
        boundary.manager.spawn.side_effect = None
        boundary.manager.spawn.return_value = boundary.process
    clock = iter([0, 0, 3601])
    monkeypatch.setattr(encoder, "time", SimpleNamespace(monotonic=lambda: next(clock)))
    decisions = iter([False, failure == "cancel"])
    with pytest.raises(encoder.ProductExportEncoderError) as caught:
        run(boundary, stop_requested=lambda: next(decisions))
    assert (
        caught.value.code
        == {
            "cancel": "CANCELLED",
            "timeout": "TIMEOUT",
            "nonzero": "ENCODER_FAILED",
            "output-missing": "OUTPUT_MISSING",
        }[failure]
    )
    assert boundary.process.terminate.call_count >= 1
    boundary.manager.release.assert_called_once_with(boundary.process)
    boundary.manager.spawn.assert_called_once()


def test_launch_failure_is_closed_and_not_retried(boundary):
    boundary.manager.spawn.side_effect = encoder.ProductExportJobError("synthetic")
    with pytest.raises(encoder.ProductExportEncoderError) as caught:
        run(boundary)
    assert caught.value.code == "JOB_LAUNCH_FAILED"
    boundary.manager.spawn.assert_called_once()
    boundary.manager.release.assert_not_called()


@pytest.mark.parametrize("reader_index", [0, 1])
@pytest.mark.parametrize("mode", ["start", "stalled"])
def test_partial_reader_start_or_stall_always_releases_job(
    boundary, monkeypatch, reader_index, mode
):
    readers = [boundary.reader(target=lambda: None), boundary.reader(target=lambda: None)]
    target = readers[reader_index]
    if mode == "start":
        target.start = Mock(side_effect=RuntimeError("synthetic thread failure"))
    else:
        target.is_alive = lambda: True
    monkeypatch.setattr(encoder, "threading", SimpleNamespace(Thread=Mock(side_effect=readers)))
    with pytest.raises(RuntimeError) as caught:
        run(boundary)
    if mode == "stalled":
        assert caught.value.code == "PIPE_STALLED"
    else:
        assert str(caught.value) == "synthetic thread failure"
    boundary.process.terminate.assert_called_once()
    boundary.manager.release.assert_called_once_with(boundary.process)


@pytest.mark.parametrize("field", ["st_dev", "st_ino", "st_size", "st_mtime_ns"])
def test_source_metadata_change_after_process_is_not_success(boundary, monkeypatch, field):
    actual = boundary.source.stat()
    values = {
        key: getattr(actual, key)
        for key in ["st_dev", "st_ino", "st_size", "st_mtime_ns", "st_mode"]
    }
    changed = SimpleNamespace(**{**values, field: values[field] + 1})
    monkeypatch.setattr(
        encoder,
        "os",
        SimpleNamespace(fstat=Mock(side_effect=[actual, changed]), environ={"PATH": "synthetic"}),
    )
    with pytest.raises(encoder.ProductExportEncoderError) as caught:
        run(boundary)
    assert caught.value.code == "SOURCE_CHANGED"
    boundary.process.terminate.assert_called_once()
    boundary.manager.release.assert_called_once_with(boundary.process)


def test_progress_filters_invalid_values_and_limits_buffer_without_regression(boundary):
    stderr = b"x" * (encoder.MAX_STDERR_BYTES + 10)
    boundary.process.stderr = io.BytesIO(stderr)
    boundary.process.stdout = io.BytesIO(
        b"ignored\nframe=bad\nframe=-1\nframe=999\n"
        + b"frame="
        + b"1" * 130
        + b"\n"
        + b"frame=10\nframe=5\n" * 40
    )
    boundary.process.poll.side_effect = [None, None, 0]
    progress = []
    result = run(boundary, on_progress=progress.append)
    assert progress == [10]
    assert result.progress_frames == 10
    assert result.stderr_bytes == stderr[: encoder.MAX_STDERR_BYTES]
    assert result.stderr_sha256 == hashlib.sha256(stderr).hexdigest()


def test_environment_is_allowlisted_at_launch(boundary, monkeypatch):
    monkeypatch.setattr(
        encoder,
        "os",
        SimpleNamespace(
            fstat=encoder.os.fstat,
            environ={"PATH": "synthetic", "UNRELATED_SECRET": "not-forwarded"},
        ),
    )
    run(boundary)
    assert boundary.manager.spawn.call_args.kwargs["env"] == {"PATH": "synthetic"}


@pytest.mark.parametrize("exception", [OSError(), RuntimeError(), ValueError()])
def test_directory_resolution_failure_fails_closed(monkeypatch, exception):
    monkeypatch.setattr(encoder, "managed_local_io_path", Mock(side_effect=exception))
    assert encoder._plain_directory(None) is False

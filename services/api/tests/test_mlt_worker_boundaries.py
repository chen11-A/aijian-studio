"""Offline MLT boundary regressions; synthetic files and no native processes."""

import hashlib
import io
import subprocess
from contextlib import ExitStack
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from aijian_api import mlt_execution_worker as worker
from test_mlt_execution_receipt import fixture, synthetic_processes


def run(task, runtime, verifier, **kwargs):
    return worker.run_mlt_engineering_task(
        task,
        runtime,
        verifier,
        on_progress=kwargs.pop("on_progress", lambda _: None),
        stop_requested=kwargs.pop("stop_requested", lambda: False),
        revalidate_selection=kwargs.pop("revalidate_selection", lambda *_: None),
        **kwargs,
    )


@pytest.mark.parametrize("timeout", [True, None, "1", 0, -1, float("nan"), float("inf"), 3601])
def test_invalid_deadline_rejected_before_any_file_or_process_access(timeout, monkeypatch):
    validate = Mock(side_effect=AssertionError("must not access files"))
    monkeypatch.setattr(worker, "_validate_task", validate)
    with pytest.raises(worker.MltExecutionError) as caught:
        run(None, None, None, timeout_seconds=timeout)
    assert caught.value.code == "INVALID_TIMEOUT"
    validate.assert_not_called()


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("scope", "PRODUCT"),
        ("plan", None),
        ("execution_plan_hash", "sha256:" + "f" * 64),
        ("assembly_artifact_id", "unexpected"),
        ("assembly_version_id", "unexpected"),
        ("assembly_content_hash", "unexpected"),
        ("qa_origin_files", ()),
        ("total_frames", 126),
        ("expect_audio", False),
        ("operation_id", "eteop_invalid"),
    ],
)
def test_invalid_engineering_task_cannot_launch(tmp_path, monkeypatch, field, value):
    task, runtime, verifier = fixture(tmp_path)
    launches, _ = synthetic_processes(monkeypatch, task)
    with pytest.raises(worker.MltExecutionError) as caught:
        run(replace(task, **{field: value}), runtime, verifier)
    assert caught.value.code == "PLAN_OR_TOOLCHAIN_INVALID"
    assert launches == []


@pytest.mark.parametrize(
    ("field", "value"),
    [("scope", "PRODUCT"), ("runtime_files", ()), ("expected_version", "7.40")],
)
def test_invalid_runtime_cannot_launch(tmp_path, monkeypatch, field, value):
    task, runtime, verifier = fixture(tmp_path)
    launches, _ = synthetic_processes(monkeypatch, task)
    with pytest.raises(worker.MltExecutionError) as caught:
        run(task, replace(runtime, **{field: value}), verifier)
    assert caught.value.code == "PLAN_OR_TOOLCHAIN_INVALID"
    assert launches == []


@pytest.mark.parametrize("phase", range(1, 7))
def test_cancellation_at_each_dispatch_or_verification_boundary(tmp_path, monkeypatch, phase):
    task, runtime, verifier = fixture(tmp_path)
    launches, _ = synthetic_processes(monkeypatch, task)
    decisions = iter([False] * (phase - 1) + [True])
    with pytest.raises(worker.MltExecutionError) as caught:
        run(task, runtime, verifier, stop_requested=lambda: next(decisions))
    assert caught.value.code == "CANCELLED"
    assert len(launches) == (0 if phase <= 4 else 1)


@pytest.mark.parametrize("callback", [None, Mock(return_value=False), Mock(side_effect=OSError)])
def test_selection_authority_failure_cannot_launch(tmp_path, monkeypatch, callback):
    task, runtime, verifier = fixture(tmp_path)
    launches, _ = synthetic_processes(monkeypatch, task)
    with pytest.raises(worker.MltExecutionError) as caught:
        run(task, runtime, verifier, revalidate_selection=callback)
    assert caught.value.code == (
        "SELECTION_REVALIDATION_MISSING" if callback is None else "SELECTION_REVALIDATION_FAILED"
    )
    assert not launches


@pytest.mark.parametrize("field", ["ffmpeg_sha256", "ffprobe_sha256", "distribution_status"])
def test_verifier_mismatch_never_queries_or_renders(tmp_path, monkeypatch, field):
    task, runtime, verifier = fixture(tmp_path)
    launches, _ = synthetic_processes(monkeypatch, task)
    probe = Mock(side_effect=AssertionError("must not query"))
    monkeypatch.setattr(worker.subprocess, "run", probe)
    with pytest.raises(worker.MltExecutionError) as caught:
        run(task, runtime, replace(verifier, **{field: "wrong"}))
    assert caught.value.code == "VERIFIER_TOOLCHAIN_MISMATCH"
    assert not launches
    probe.assert_not_called()


@pytest.mark.parametrize("invalid_lock", [True, False])
def test_verifier_lock_is_validated_separately_from_file_hash(tmp_path, monkeypatch, invalid_lock):
    task, _, verifier = fixture(tmp_path)
    if invalid_lock:
        task.generation_lock.path.write_bytes(b"not JSON")
    else:
        verifier = replace(verifier, version="9.9.9")
    with pytest.raises(worker.MltExecutionError) as caught:
        worker._verify_verifier_toolchain(task, verifier)
    assert caught.value.code == (
        "VERIFIER_LOCK_INVALID" if invalid_lock else "VERIFIER_LOCK_MISMATCH"
    )


@pytest.mark.parametrize("change", ["duplicate", "extra", "missing", "unavailable"])
def test_complete_runtime_inventory_cannot_drift(tmp_path, change):
    _, runtime, _ = fixture(tmp_path)
    if change == "duplicate":
        runtime = replace(runtime, runtime_files=(runtime.melt, *runtime.runtime_files))
    elif change == "extra":
        (runtime.installation_root / "unexpected.bin").write_bytes(b"synthetic")
    elif change == "missing":
        runtime.runtime_files[0].path.unlink()
    else:
        runtime = replace(runtime, installation_root=tmp_path / "missing")
    with pytest.raises(worker.MltExecutionError) as caught:
        worker._verify_runtime_inventory(runtime)
    assert (
        caught.value.code
        == {
            "duplicate": "RUNTIME_MANIFEST_INVALID",
            "extra": "RUNTIME_UNLISTED_FILE",
            "missing": "RUNTIME_UNLISTED_FILE",
            "unavailable": "RUNTIME_UNAVAILABLE",
        }[change]
    )


@pytest.mark.parametrize(
    "mode", ["oserror", "timeout", "nonzero", "wrong-version", "missing-service"]
)
def test_failed_runtime_probe_never_launches_render(tmp_path, monkeypatch, mode):
    task, runtime, verifier = fixture(tmp_path)
    launches, _ = synthetic_processes(monkeypatch, task)

    def probe(command, **kwargs):
        assert kwargs["shell"] is False
        if mode == "oserror":
            raise OSError("synthetic")
        if mode == "timeout":
            raise subprocess.TimeoutExpired(command, 5)
        if "-version" in command:
            body = b"melt 7.40.0" if mode != "wrong-version" else b"melt 7.41.0"
        else:
            body = b"consumers:\n - avformat\n...\nignored\n"
        return subprocess.CompletedProcess(command, 1 if mode == "nonzero" else 0, body)

    monkeypatch.setattr(worker.subprocess, "run", probe)
    with pytest.raises(worker.MltExecutionError) as caught:
        run(task, runtime, verifier)
    assert (
        caught.value.code
        == {
            "oserror": "MLT_VERSION_UNAVAILABLE",
            "timeout": "MLT_VERSION_UNAVAILABLE",
            "nonzero": "MLT_VERSION_MISMATCH",
            "wrong-version": "MLT_VERSION_MISMATCH",
            "missing-service": "MLT_SERVICE_UNAVAILABLE",
        }[mode]
    )
    assert launches == []


class ImmediateReader:
    def __init__(self, *, target, **kwargs):
        self.target = target

    def start(self):
        self.target()

    def join(self, **kwargs):
        pass

    def is_alive(self):
        return False


@pytest.mark.parametrize(
    ("mode", "code"),
    [
        ("launch", "MLT_LAUNCH_FAILED"),
        ("pipe", "MLT_PIPE_UNAVAILABLE"),
        ("exit", "MLT_EXIT_NONZERO"),
        ("stalled", "MLT_PIPE_STALLED"),
        ("cancel", "CANCELLED"),
        ("timeout", "TIMEOUT"),
    ],
)
def test_runtime_failure_cleans_up_without_retry(tmp_path, monkeypatch, mode, code):
    task, runtime, verifier = fixture(tmp_path)
    synthetic_processes(monkeypatch, task)
    process = Mock()
    process.returncode = 3 if mode == "exit" else 0
    process.stdout = None if mode == "pipe" else io.BytesIO(b"synthetic log\n")
    process.poll.side_effect = [None, None, 0] if mode in {"cancel", "timeout"} else None
    process.poll.return_value = 0
    launch = (
        Mock(side_effect=OSError("synthetic")) if mode == "launch" else Mock(return_value=process)
    )
    monkeypatch.setattr(worker.subprocess, "Popen", launch)
    reader = ImmediateReader
    if mode == "stalled":

        class StalledReader(ImmediateReader):
            def is_alive(self):
                return True

        reader = StalledReader
    monkeypatch.setattr(worker, "threading", SimpleNamespace(Thread=reader))
    stops = iter([False] * 4 + [mode == "cancel"])
    clock = iter([0, 0, 0, 3601])
    monkeypatch.setattr(worker, "time", SimpleNamespace(monotonic=lambda: next(clock)))
    with pytest.raises(worker.MltExecutionError) as caught:
        run(task, runtime, verifier, stop_requested=lambda: next(stops))
    assert caught.value.code == code
    assert launch.call_count == 1
    if mode in {"cancel", "timeout"}:
        process.terminate.assert_called_once()


@pytest.mark.parametrize("phase", [1, 2])
def test_deadline_expired_before_render_never_dispatches(tmp_path, monkeypatch, phase):
    task, runtime, verifier = fixture(tmp_path)
    launches, _ = synthetic_processes(monkeypatch, task)
    clock = iter([0] + [0] * (phase - 1) + [3601])
    monkeypatch.setattr(worker, "time", SimpleNamespace(monotonic=lambda: next(clock)))
    with pytest.raises(worker.MltExecutionError) as caught:
        run(task, runtime, verifier)
    assert caught.value.code == "TIMEOUT"
    assert not launches


def test_progress_is_monotonic_and_bounded_and_log_is_capped(tmp_path, monkeypatch):
    task, runtime, verifier = fixture(tmp_path)
    synthetic_processes(monkeypatch, task)
    body = b"x" * (worker.MAX_LOG_BYTES + 1) + b"\n"
    body += b"Current Frame: 999, percentage: 100\n"
    body += b"Current Frame: 10, percentage: 8\n" * 70
    process = Mock(stdout=io.BytesIO(body), returncode=0)
    process.poll.side_effect = [None, None, 0]
    monkeypatch.setattr(worker.subprocess, "Popen", Mock(return_value=process))
    monkeypatch.setattr(worker, "threading", SimpleNamespace(Thread=ImmediateReader))
    progress = []
    evidence = run(task, runtime, verifier, on_progress=progress.append)
    assert progress == [10]
    assert evidence.maximum_progress_frame == 10
    assert evidence.log_excerpt == body[: worker.MAX_LOG_BYTES]
    assert evidence.log_sha256 == hashlib.sha256(body).hexdigest()


@pytest.mark.parametrize("error", [OSError(), subprocess.TimeoutExpired("synthetic", 10)])
def test_service_query_failure_is_not_retried(tmp_path, monkeypatch, error):
    _, runtime, _ = fixture(tmp_path)
    query = Mock(side_effect=error)
    monkeypatch.setattr(worker.subprocess, "run", query)
    with pytest.raises(worker.MltExecutionError) as caught:
        worker._verify_runtime_services(runtime, {})
    assert caught.value.code == "MLT_SERVICE_QUERY_FAILED"
    assert query.call_count == 1


@pytest.mark.parametrize(
    "mode", ["exited", "terminate", "timeout", "oserror-live", "oserror-exited"]
)
def test_stop_handles_already_exited_and_failed_termination(mode):
    process = Mock()
    process.poll.side_effect = (
        [0] if mode == "exited" else [None, 0 if mode.endswith("exited") else None]
    )
    if mode == "timeout":
        process.wait.side_effect = [subprocess.TimeoutExpired("synthetic", 2), 0]
    elif mode.startswith("oserror"):
        process.terminate.side_effect = OSError("synthetic")
    worker._stop(process)
    assert process.terminate.call_count == (mode != "exited")
    assert process.kill.call_count == (mode in {"timeout", "oserror-live"})


@pytest.mark.parametrize("mode", ["hash", "empty", "missing", "unsafe-hash", "unsafe-path"])
def test_resource_identity_cannot_accept_invalid_bytes(tmp_path, mode):
    path = tmp_path / "resource.bin"
    path.write_bytes(b"synthetic")
    digest = hashlib.sha256(b"synthetic").hexdigest()
    if mode == "hash":
        path.write_bytes(b"changed")
    elif mode == "empty":
        path.write_bytes(b"")
    elif mode == "missing":
        path.unlink()
    elif mode == "unsafe-hash":
        digest = "invalid"
    elif mode == "unsafe-path":
        path = type(path)("relative.bin")
    with ExitStack() as stack, pytest.raises(worker.MltExecutionError) as caught:
        worker._hold_verified_file(stack, worker.MltFileIdentity(path, digest))
    assert (
        caught.value.code
        == {
            "hash": "RESOURCE_CHANGED",
            "empty": "RESOURCE_SIZE",
            "missing": "RESOURCE_UNAVAILABLE",
            "unsafe-hash": "RESOURCE_UNSAFE",
            "unsafe-path": "RESOURCE_UNSAFE",
        }[mode]
    )


@pytest.mark.parametrize("field", ["st_dev", "st_ino", "st_size", "st_mtime_ns"])
@pytest.mark.parametrize("phase", ["hash", "readback"])
def test_open_resource_identity_change_is_detected(tmp_path, monkeypatch, field, phase):
    task, _, _ = fixture(tmp_path)
    item = task.resources[0]
    actual = item.path.stat()
    values = {
        key: getattr(actual, key)
        for key in ["st_dev", "st_ino", "st_size", "st_mtime_ns", "st_mode"]
    }
    changed = SimpleNamespace(**{**values, field: values[field] + 1})
    with ExitStack() as stack:
        stream = worker._hold_verified_file(stack, item)
        fstat = (
            Mock(side_effect=[actual, changed]) if phase == "hash" else Mock(return_value=changed)
        )
        monkeypatch.setattr(worker, "os", SimpleNamespace(fstat=fstat))
        with pytest.raises(worker.MltExecutionError) as caught:
            if phase == "hash":
                worker._hold_verified_file(stack, item)
            else:
                worker._verify_open_files(((item, stream),), frozenset())
        assert caught.value.code == "RESOURCE_CHANGED"


def test_open_resource_unavailable_is_sanitized(tmp_path, monkeypatch):
    task, _, _ = fixture(tmp_path)
    item = task.resources[0]
    with ExitStack() as stack:
        stream = worker._hold_verified_file(stack, item)
        monkeypatch.setattr(
            worker, "os", SimpleNamespace(fstat=Mock(side_effect=OSError("private")))
        )
        with pytest.raises(worker.MltExecutionError) as caught:
            worker._verify_open_files(((item, stream),), frozenset({item.path}))
        assert caught.value.code == "RESOURCE_CHANGED"
        assert "private" not in str(caught.value)


@pytest.mark.parametrize("exception", [OSError("private"), ValueError("private")])
def test_managed_path_failure_is_rejected_before_open(tmp_path, monkeypatch, exception):
    task, _, _ = fixture(tmp_path)
    monkeypatch.setattr(worker, "managed_local_io_path", Mock(side_effect=exception))
    assert worker._managed_directory(tmp_path) is False
    with ExitStack() as stack, pytest.raises(worker.MltExecutionError) as caught:
        worker._hold_verified_file(stack, task.xml, managed=True)
    assert caught.value.code == "RESOURCE_UNSAFE"


@pytest.mark.parametrize("exception", [OSError(), RuntimeError()])
def test_unreadable_directory_fails_closed(exception):
    path = Mock()
    path.is_absolute.side_effect = exception
    assert worker._plain_directory(path) is False


@pytest.mark.parametrize("mode", ["overlap", "conflict"])
def test_tool_resource_overlap_and_conflicting_hashes_never_launch(tmp_path, monkeypatch, mode):
    task, runtime, verifier = fixture(tmp_path)
    launches, _ = synthetic_processes(monkeypatch, task)
    extra = runtime.melt if mode == "overlap" else replace(task.xml, sha256="f" * 64)
    task = replace(task, resources=(*task.resources, extra))
    with pytest.raises(worker.MltExecutionError) as caught:
        run(task, runtime, verifier)
    assert caught.value.code == "DUPLICATE_RESOURCE"
    assert not launches

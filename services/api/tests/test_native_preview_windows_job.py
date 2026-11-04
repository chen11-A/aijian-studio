"""Controlled kernel adapter/real threads only. These are not Windows API or process tests."""

import ctypes
import io
import queue
import threading
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from aijian_api import native_preview_windows_job as native
from aijian_api import product_export_windows_job as win
from test_external_media_process import _job_api


class Kernel:
    def __init__(self, query=True, close=True):
        self.query, self.close = query, close
        self.closed = []
        self.cancelled = []
        self.killed = []

    def TerminateJobObject(self, job, _code):
        self.killed.append(job)
        return True

    def CancelSynchronousIo(self, handle):
        self.cancelled.append(handle)
        return True

    def QueryInformationJobObject(self, _job, _kind, pointer, _size, _count):
        ctypes.cast(pointer, ctypes.POINTER(win._Accounting)).contents.ActiveProcesses = 0
        return self.query

    def CloseHandle(self, handle):
        self.closed.append(handle)
        return self.close


def started_owner(kernel):
    job = native.NativeWindowsJob(lambda *_: None)
    job._api, job._job = kernel, 17
    job._started = job._start_settled = True
    return job


def test_prestart_cancel_refuses_late_start_without_any_native_access(monkeypatch):
    monkeypatch.setattr(native, "sys", SimpleNamespace(platform="win32"))
    job = native.NativeWindowsJob(lambda *_: None)
    monkeypatch.setattr(job, "_start", lambda *_: pytest.fail("Cancelled start must not dispatch"))
    job.request_stop()
    with pytest.raises(native.NativeJobError):
        job.start(Path("host"), io.BytesIO(), Path("cwd"), {})
    assert not job._started


def test_zero_active_cannot_release_pending_start_or_late_partial_owner(monkeypatch):
    monkeypatch.setattr(native, "sys", SimpleNamespace(platform="win32"))
    job = native.NativeWindowsJob(lambda *_: None)
    kernel = Kernel()
    entered = threading.Event()
    settle = threading.Event()

    def partial(*_args):
        job._api, job._job = kernel, 17
        entered.set()
        assert settle.wait(3)

    monkeypatch.setattr(job, "_start", partial)
    thread = threading.Thread(target=lambda: job.start(Path("host"), io.BytesIO(), Path("cwd"), {}))
    thread.start()
    assert entered.wait(3)
    try:
        with pytest.raises(native.NativeJobError, match="pending"):
            job.stop_and_wait(0.01)
        assert kernel.closed == [] and not job._start_settled and not job._released
    finally:
        settle.set()
        thread.join(3)
    assert not thread.is_alive() and job._start_settled
    job.stop_and_wait(1)
    assert job._released and kernel.closed == [17] and kernel.killed


def test_job_zero_and_cancel_request_are_insufficient_until_pipe_worker_join():
    kernel = Kernel()
    job = started_owner(kernel)
    entered = threading.Event()
    finish = threading.Event()
    thread = threading.Thread(target=lambda: (entered.set(), finish.wait(3)))
    job._workers.append(thread)
    job._io_threads[123] = 71
    thread.start()
    assert entered.wait(3)
    try:
        with pytest.raises(native.NativeJobError, match="join"):
            job.stop_and_wait(0.01)
        assert not job._released and kernel.closed == [] and kernel.cancelled
    finally:
        finish.set()
        thread.join(3)
        job._io_threads.clear()
    job.stop_and_wait(1)
    assert job._released and kernel.closed == [17]


@pytest.mark.parametrize("fault", ["query", "close"])
def test_unknown_kernel_receipt_retains_owner_handles(fault):
    kernel = Kernel(query=fault != "query", close=fault != "close")
    job = started_owner(kernel)
    with pytest.raises(native.NativeJobError):
        job.stop_and_wait(0.01)
    assert not job._released and job._job == 17


def test_non_windows_cannot_reach_native_api(monkeypatch):
    monkeypatch.setattr(native, "sys", SimpleNamespace(platform="linux"))
    monkeypatch.setattr(native, "_api", lambda: pytest.fail("Non-Windows must not reach kernel"))
    job = native.NativeWindowsJob(lambda *_: None)
    with pytest.raises(native.NativeJobError, match="Windows"):
        job.start(Path("host"), io.BytesIO(), Path("cwd"), {})
    assert not job._started and job._api is None


def test_root_exit_observation_waits_for_reader_tail_drain_before_emission():
    kernel = Kernel()
    kernel.WaitForSingleObject = lambda *_: 0
    events = []
    finish = threading.Event()
    entered = threading.Event()
    job = started_owner(kernel)
    job._output = lambda kind, data: events.append((kind, data))

    def reader():
        entered.set()
        assert finish.wait(3)
        job._output("stdout", b"tail-status")

    tail = threading.Thread(target=reader)
    job._readers.append(tail)
    job._workers.append(tail)
    tail.start()
    assert entered.wait(3)
    observer = threading.Thread(target=job._observe_exit)
    observer.start()
    try:
        assert events == []
    finally:
        finish.set()
        tail.join(3)
        observer.join(3)
    assert not observer.is_alive() and events == [("stdout", b"tail-status"), ("exit", b"")]
    job.stop_and_wait(1)


def test_joined_worker_with_unknown_original_thread_handle_close_cannot_release():
    kernel = Kernel(close=False)
    kernel.GetCurrentProcess = lambda: 1
    kernel.GetCurrentThread = lambda: -2

    def duplicate(_process, _thread, _target, pointer, _access, _inherit, _flags):
        ctypes.cast(pointer, ctypes.POINTER(native.wintypes.HANDLE)).contents.value = 91
        return True

    kernel.DuplicateHandle = duplicate
    job = started_owner(kernel)
    worker = job._worker(lambda: None)
    worker.join(3)
    assert not worker.is_alive() and job._io_threads == {91: 91}
    with pytest.raises(native.NativeJobError, match="thread handles"):
        job.stop_and_wait(0.1)
    assert not job._released and job._job == 17 and 17 not in kernel.closed


def test_reader_delivers_bounded_chunks_and_refuses_overflow(monkeypatch):
    events = []
    job = native.NativeWindowsJob(lambda *event: events.append(event))
    chunks = iter([b"ab", b"cd", b""])
    monkeypatch.setattr(native.os, "read", lambda *_: next(chunks))
    job._read(123, "stdout", 4)
    assert events == [("stdout", b"ab"), ("stdout", b"cd")]
    chunks = iter([b"abc", b"de"])
    with pytest.raises(native.NativeJobError, match="byte limit"):
        job._read(123, "stderr", 4)
    assert events[-1] == ("stderr", b"abc")
    job.request_stop()
    job._read(123, "stdout", 4)


@pytest.mark.parametrize("fault", ["zero", "exception", "cancel-between-chunks"])
def test_writer_failure_marks_completion_without_claiming_success(monkeypatch, fault):
    job = native.NativeWindowsJob(lambda *_: None)
    request = native._Write(b"packet")
    job._writes.put_nowait(request)
    writes = []

    def write(_fd, data):
        writes.append(data)
        if fault == "exception":
            raise OSError("controlled pipe failure")
        if fault == "zero":
            return 0
        job._closing.set()
        return 1

    monkeypatch.setattr(native.os, "write", write)
    job._write(123)
    assert writes == [b"packet"] and request.done.is_set()
    assert request.error is not None and job._closing.is_set()


def test_writer_reassembles_partial_writes_and_signals_completion(monkeypatch):
    job = native.NativeWindowsJob(lambda *_: None)
    request = native._Write(b"abcdef")
    job._writes.put_nowait(request)
    writes = []

    def write(_fd, data):
        writes.append(data)
        if len(data) <= 2:
            job._closing.set()
        return min(2, len(data))

    monkeypatch.setattr(native.os, "write", write)
    job._write(123)
    assert writes == [b"abcdef", b"cdef", b"ef"]
    assert request.done.is_set() and request.error is None


def test_writer_empty_queue_observes_cancellation(monkeypatch):
    job = native.NativeWindowsJob(lambda *_: None)

    def empty(*_args, **_kwargs):
        job._closing.set()
        raise queue.Empty

    monkeypatch.setattr(job._writes, "get", empty)
    job._write(123)
    assert job._closing.is_set()


@pytest.mark.parametrize("state", ["pending", "closing", "released"])
def test_public_write_requires_live_settled_owner(state):
    job = native.NativeWindowsJob(lambda *_: None)
    job._start_settled = state != "pending"
    job._released = state == "released"
    if state == "closing":
        job._closing.set()
    with pytest.raises(native.NativeJobError, match="not writable"):
        job.write(b"control")
    assert job._writes.empty()


@pytest.mark.parametrize("outcome", ["success", "timeout", "error"])
def test_public_write_requires_completed_successful_receipt(monkeypatch, outcome):
    job = native.NativeWindowsJob(lambda *_: None)
    job._start_settled = True
    request = SimpleNamespace(
        done=SimpleNamespace(wait=lambda timeout: outcome != "timeout"),
        error=OSError("controlled write failure") if outcome == "error" else None,
    )
    monkeypatch.setattr(native, "_Write", lambda packet: request)
    if outcome == "success":
        job.write(b"control")
        assert not job._closing.is_set()
    else:
        with pytest.raises(native.NativeJobError):
            job.write(b"control")
        if outcome == "timeout":
            assert job._closing.is_set()
    assert job._writes.get_nowait() is request


def test_exit_observer_rejects_unknown_wait_result():
    kernel = Kernel()
    kernel.WaitForSingleObject = lambda *_: 0xFFFFFFFF
    job = started_owner(kernel)
    with pytest.raises(native.NativeJobError, match="exit is unknown"):
        job._observe_exit()
    assert not job._released


def test_exit_observer_timeout_is_not_an_exit_receipt():
    kernel = Kernel()
    events = []
    job = started_owner(kernel)
    job._output = lambda *event: events.append(event)

    def timeout(*_args):
        job._closing.set()
        return 0x102

    kernel.WaitForSingleObject = timeout
    job._observe_exit()
    assert events == [] and not job._released


def test_stop_before_start_is_idempotent_and_permanently_closes_owner():
    job = native.NativeWindowsJob(lambda *_: None)
    job.stop_and_wait(0)
    job.stop_and_wait(0)
    assert job._released and job._closing.is_set() and not job._started


def test_stop_rejects_unsettled_start_even_without_a_job():
    job = native.NativeWindowsJob(lambda *_: None)
    job._started = True
    with pytest.raises(native.NativeJobError, match="start is still pending"):
        job.stop_and_wait(0)
    assert not job._released


def test_stop_retains_nonzero_job_activity():
    kernel = Kernel()

    def active(_job, _kind, pointer, _size, _count):
        ctypes.cast(pointer, ctypes.POINTER(win._Accounting)).contents.ActiveProcesses = 1
        return True

    kernel.QueryInformationJobObject = active
    job = started_owner(kernel)
    with pytest.raises(native.NativeJobError, match="zero-active"):
        job.stop_and_wait(0)
    assert not job._released and job._job == 17 and kernel.closed == []


@pytest.mark.parametrize("close", [True, False])
def test_original_process_handles_must_close_before_job_release(close):
    kernel = Kernel(close=close)
    job = started_owner(kernel)
    job._process.hThread, job._process.hProcess = 31, 32
    if close:
        job.stop_and_wait(1)
        assert kernel.closed == [31, 32, 17]
        assert job._released and job._process.hThread is job._process.hProcess is None
    else:
        with pytest.raises(native.NativeJobError, match="process handle"):
            job.stop_and_wait(1)
        assert kernel.closed == [31] and job._process.hThread == 31
        assert not job._released and job._job == 17


@pytest.mark.parametrize("fault", ["duplicate", "run", "already-closing", "none"])
def test_worker_retains_and_closes_its_original_handle(monkeypatch, fault):
    kernel = Kernel()
    kernel.GetCurrentProcess = lambda: 1
    kernel.GetCurrentThread = lambda: -2

    def duplicate(_process, _thread, _target, pointer, _access, _inherit, _flags):
        if fault == "duplicate":
            return False
        ctypes.cast(pointer, ctypes.POINTER(native.wintypes.HANDLE)).contents.value = 91
        return True

    kernel.DuplicateHandle = duplicate
    job = started_owner(kernel)
    calls = []

    def run():
        calls.append("ran")
        if fault == "run":
            raise OSError("controlled worker error")

    if fault == "already-closing":
        job._closing.set()
    worker = job._worker(run)
    worker.join(3)
    assert not worker.is_alive() and job._io_threads == {}
    assert calls == ([] if fault in {"duplicate", "already-closing"} else ["ran"])
    assert job._closing.is_set() == (fault != "none")
    assert len(kernel.closed) == (0 if fault == "duplicate" else 1)


@pytest.mark.parametrize(
    "fault",
    [
        "none",
        "job",
        "limits",
        "size",
        "initialize",
        "attributes",
        "create",
        "outside-job",
        "resume",
        "thread-close",
        "cancel-create",
        "cancel-resume",
    ],
)
def test_controlled_start_retains_every_partial_resource_until_stop(monkeypatch, tmp_path, fault):
    _, executable, events = _job_api(monkeypatch, tmp_path)
    api = win._api()
    api.TerminateJobObject = Mock(return_value=True)
    native_os = native.os
    monkeypatch.setattr(
        native,
        "os",
        SimpleNamespace(
            dup=native_os.dup,
            pipe=native_os.pipe,
            close=native_os.close,
            set_handle_inheritable=native_os.set_inheritable,
        ),
    )
    monkeypatch.setattr(native, "sys", SimpleNamespace(platform="win32"))
    monkeypatch.setattr(native, "_api", lambda: api)
    job = native.NativeWindowsJob(lambda *_: None)
    worker = Mock(return_value=SimpleNamespace(is_alive=lambda: False))
    monkeypatch.setattr(job, "_worker", worker)
    if fault in {"job", "limits", "create", "outside-job", "resume", "thread-close"}:
        method = {
            "job": "CreateJobObjectW",
            "limits": "SetInformationJobObject",
            "create": "CreateProcessW",
            "outside-job": "IsProcessInJob",
            "resume": "ResumeThread",
            "thread-close": "CloseHandle",
        }[fault]
        monkeypatch.setattr(api, method, Mock(return_value=0))
    if fault == "size":
        monkeypatch.setattr(api, "InitializeProcThreadAttributeList", Mock(return_value=False))
    if fault == "initialize":
        initialize = api.InitializeProcThreadAttributeList
        monkeypatch.setattr(
            api,
            "InitializeProcThreadAttributeList",
            lambda attrs, *args: initialize(attrs, *args) if attrs is None else False,
        )
    if fault in {"attributes", "cancel-create"}:

        def attribute(*_args):
            if fault == "cancel-create":
                job.request_stop()
                return True
            return False

        monkeypatch.setattr(api, "UpdateProcThreadAttribute", attribute)
    if fault == "cancel-resume":
        membership = api.IsProcessInJob

        def cancel(*args):
            job.request_stop()
            return membership(*args)

        monkeypatch.setattr(api, "IsProcessInJob", cancel)
    path = tmp_path / "opening.bin"
    path.write_bytes(b"controlled opening")
    with path.open("rb") as opening:
        if fault == "none":
            job.start(executable, opening, tmp_path, {"AIVORA_TEST": "yes"})
            assert events.index(("create",)) < events.index(("resume",))
            assert worker.call_count == 4 and len(job._fds) == 3
        else:
            with pytest.raises(native.NativeJobError):
                job.start(executable, opening, tmp_path, {})
            worker.assert_not_called()
        assert job._start_settled and job._started and not job._released
        # A controlled close failure must not prevent this fixture from cleaning
        # its real local pipe descriptors once the failure has been observed.
        if fault == "thread-close":
            with pytest.raises(native.NativeJobError, match="handle close"):
                job.stop_and_wait(1)
            assert not job._released and job._process.hThread
            monkeypatch.setattr(api, "CloseHandle", Mock(return_value=True))
        job.stop_and_wait(1)
        assert job._released and job._fds == set() and not job._job
        assert not opening.closed


@pytest.mark.parametrize("env", [{"": "x"}, {"A=B": "x"}, {"A\0": "x"}, {"A": "x\0"}])
def test_native_environment_is_rejected_before_any_kernel_access(monkeypatch, env):
    import sys

    monkeypatch.setattr(native, "sys", SimpleNamespace(platform="win32"))
    monkeypatch.setitem(sys.modules, "msvcrt", SimpleNamespace())
    monkeypatch.setattr(native, "_api", lambda: pytest.fail("No native dispatch is allowed"))
    job = native.NativeWindowsJob(lambda *_: None)
    with pytest.raises(native.NativeJobError, match="environment"):
        job.start(Path("host"), io.BytesIO(), Path("cwd"), env)
    assert job._start_settled and job._api is None and job._fds == set()


def test_native_adapter_declares_exact_io_handle_signatures(monkeypatch):
    api = SimpleNamespace(
        **{
            name: Mock()
            for name in (
                "GetCurrentThread",
                "GetCurrentProcess",
                "DuplicateHandle",
                "CancelSynchronousIo",
            )
        }
    )
    monkeypatch.setattr(win, "_api", lambda: api)
    assert native._api() is api
    assert api.GetCurrentThread.restype is native.wintypes.HANDLE
    assert api.GetCurrentThread.argtypes == []
    assert len(api.DuplicateHandle.argtypes) == 7
    assert api.CancelSynchronousIo.argtypes == [native.wintypes.HANDLE]


def test_direct_start_boundary_still_rejects_non_windows(monkeypatch):
    monkeypatch.setattr(native, "sys", SimpleNamespace(platform="linux"))
    job = native.NativeWindowsJob(lambda *_: None)
    with pytest.raises(native.NativeJobError, match="Windows"):
        job._start(Path("host"), io.BytesIO(), Path("cwd"), {})
    assert job._api is None


def test_stop_waits_for_job_zero_before_releasing_handles(monkeypatch):
    kernel = Kernel()
    active_counts = iter([1, 0])

    def query(_job, _kind, pointer, _size, _count):
        ctypes.cast(pointer, ctypes.POINTER(win._Accounting)).contents.ActiveProcesses = next(
            active_counts
        )
        return True

    kernel.QueryInformationJobObject = query
    sleep = Mock()
    monkeypatch.setattr(native, "time", SimpleNamespace(monotonic=lambda: 10, sleep=sleep))
    job = started_owner(kernel)
    job.stop_and_wait(1)
    sleep.assert_called_once_with(0.01)
    assert job._released and kernel.closed == [17]

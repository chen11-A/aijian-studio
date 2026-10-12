"""Controlled kernel adapter/real threads only. These are not Windows API or process tests."""

import ctypes
import io
import threading
from pathlib import Path
from types import SimpleNamespace

import pytest
from aijian_api import native_preview_windows_job as native
from aijian_api import product_export_windows_job as win


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

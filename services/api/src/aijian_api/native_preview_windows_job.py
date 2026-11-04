"""Sidecar-owned native MLT process, original handles and joined pipe workers.

Source only: no admitted release currently reaches this Windows API boundary.
The opening is an immutable held disk handle; control/stdout/stderr are pipes.
Unlike a launch-then-write pair, no delayed opening write can escape admission.
"""

from __future__ import annotations

import ctypes
import os
import queue
import subprocess
import sys
import threading
import time
from collections.abc import Callable, Mapping
from ctypes import wintypes
from dataclasses import dataclass, field
from pathlib import Path
from typing import BinaryIO

from aijian_api import product_export_windows_job as win

# Separate exact-reviewed MLT policy. Do not lower the old FFmpeg Microsoft-only gate.
_NATIVE_MITIGATION = (1 << 52) | (1 << 56) | (1 << 60)
_ACTIVE_PROCESS_LIMIT = 0x00000008


class NativeJobError(OSError):
    """Ownership or process/worker termination is unconfirmed."""


def _api() -> ctypes.CDLL:
    api = win._api()
    signatures = {
        "GetCurrentThread": (wintypes.HANDLE, []),
        "GetCurrentProcess": (wintypes.HANDLE, []),
        "DuplicateHandle": (
            wintypes.BOOL,
            [
                wintypes.HANDLE,
                wintypes.HANDLE,
                wintypes.HANDLE,
                ctypes.POINTER(wintypes.HANDLE),
                wintypes.DWORD,
                wintypes.BOOL,
                wintypes.DWORD,
            ],
        ),
        "CancelSynchronousIo": (wintypes.BOOL, [wintypes.HANDLE]),
    }
    for name, (restype, args) in signatures.items():
        function = getattr(api, name)
        function.restype, function.argtypes = restype, args
    return api


@dataclass(slots=True)
class _Write:
    packet: bytes
    done: threading.Event = field(default_factory=threading.Event)
    error: BaseException | None = None


class NativeWindowsJob:
    """Register this owner before start; retain it even when start raises.

    start and stop serialize on the same lock. Zero Job activity alone cannot
    release a pending start, reader, writer or root observer. No PID reopening,
    subprocess fallback, shell, PATH/plugin environment or exit-event proof.
    """

    def __init__(self, output: Callable[[str, bytes], None]) -> None:
        self._output = output
        self._lock = threading.RLock()
        self._io_lock = threading.RLock()
        self._api: ctypes.CDLL | None = None
        self._job: int | None = None
        self._process = win._ProcessInfo()
        self._fds: set[int] = set()
        self._workers: list[threading.Thread] = []
        self._readers: list[threading.Thread] = []
        self._io_threads: dict[int, int] = {}
        self._closing = threading.Event()
        self._writes: queue.Queue[_Write] = queue.Queue(maxsize=1)
        self._started = False
        self._start_settled = False
        self._released = False

    def start(self, executable: Path, opening: BinaryIO, cwd: Path, env: Mapping[str, str]) -> None:
        if sys.platform != "win32":
            raise NativeJobError("Windows owned native host is required")
        with self._lock:
            if self._started or self._closing.is_set() or self._released:
                raise NativeJobError("Native owner cannot start again")
            self._started = True  # Before any Windows/partial-start action.
            try:
                self._start(executable, opening, cwd, env)
            finally:
                if self._closing.is_set() and self._api is not None and self._job:
                    self._api.TerminateJobObject(self._job, 73)
                self._start_settled = True

    def _start(
        self, executable: Path, opening: BinaryIO, cwd: Path, env: Mapping[str, str]
    ) -> None:
        if sys.platform != "win32":
            raise NativeJobError("Windows owned native host is required")
        import msvcrt

        if any(not k or "=" in k or "\0" in k or "\0" in v for k, v in env.items()):
            raise NativeJobError("Invalid native environment")
        api = self._api = _api()
        self._job = api.CreateJobObjectW(None, None)
        if not self._job:
            raise NativeJobError("Cannot create native Job")
        limits = win._ExtendedLimit()
        limits.BasicLimitInformation.LimitFlags = win._KILL_ON_JOB_CLOSE | _ACTIVE_PROCESS_LIMIT
        limits.BasicLimitInformation.ActiveProcessLimit = 1
        if not api.SetInformationJobObject(
            self._job, 9, ctypes.byref(limits), ctypes.sizeof(limits)
        ):
            raise NativeJobError("Cannot seal native Job limits")
        opening.seek(0)
        opening_fd = os.dup(opening.fileno())
        self._fds.add(opening_fd)
        command_read, command_write = os.pipe()
        self._fds.update((command_read, command_write))
        stdout_read, stdout_write = os.pipe()
        self._fds.update((stdout_read, stdout_write))
        stderr_read, stderr_write = os.pipe()
        self._fds.update((stderr_read, stderr_write))
        inherited = [
            msvcrt.get_osfhandle(fd)
            for fd in (opening_fd, command_read, stdout_write, stderr_write)
        ]
        attributes: ctypes.Array[ctypes.c_char] | None = None
        attributes_ready = False
        try:
            for handle in inherited:
                os.set_handle_inheritable(handle, True)
            size = ctypes.c_size_t()
            api.InitializeProcThreadAttributeList(None, 3, 0, ctypes.byref(size))
            if not size.value:
                raise NativeJobError("Cannot size native startup attributes")
            attributes = ctypes.create_string_buffer(size.value)
            if not api.InitializeProcThreadAttributeList(attributes, 3, 0, ctypes.byref(size)):
                raise NativeJobError("Cannot initialize native startup attributes")
            attributes_ready = True
            handles = (wintypes.HANDLE * 4)(*inherited)
            jobs = (wintypes.HANDLE * 1)(self._job)
            mitigation = ctypes.c_uint64(_NATIVE_MITIGATION)
            for key, value in (
                (win._HANDLE_LIST, handles),
                (win._JOB_LIST, jobs),
                (win._MITIGATION_POLICY, mitigation),
            ):
                if not api.UpdateProcThreadAttribute(
                    attributes, 0, key, ctypes.byref(value), ctypes.sizeof(value), None, None
                ):
                    raise NativeJobError("Cannot bind native handles/Job/mitigation")
            startup = win._StartupInfoEx()
            startup.StartupInfo.cb = ctypes.sizeof(startup)
            startup.StartupInfo.dwFlags = win._STARTF_USESTDHANDLES
            startup.StartupInfo.hStdInput = inherited[0]
            startup.StartupInfo.hStdOutput = inherited[2]
            startup.StartupInfo.hStdError = inherited[3]
            startup.lpAttributeList = ctypes.cast(attributes, ctypes.c_void_p)
            command = subprocess.list2cmdline([str(executable), f"--control-pipe={inherited[1]}"])
            environment = "\0".join(f"{k}={v}" for k, v in sorted(env.items())) + "\0\0"
            if self._closing.is_set():
                raise NativeJobError("Native start was cancelled before dispatch")
            if not api.CreateProcessW(
                str(executable),
                ctypes.create_unicode_buffer(command),
                None,
                None,
                True,
                win._CREATE_SUSPENDED
                | win._CREATE_UNICODE_ENVIRONMENT
                | win._EXTENDED_STARTUPINFO_PRESENT
                | win._CREATE_NO_WINDOW,
                ctypes.create_unicode_buffer(environment),
                str(cwd),
                ctypes.byref(startup),
                ctypes.byref(self._process),
            ):
                raise NativeJobError("Cannot create pre-resume Job-bound native process")
            in_job = wintypes.BOOL()
            if (
                not api.IsProcessInJob(self._process.hProcess, self._job, ctypes.byref(in_job))
                or not in_job.value
            ):
                raise NativeJobError("Native process is outside its original Job")
            # Close parent copies of child-only handles before native code runs.
            for handle in inherited:
                os.set_handle_inheritable(handle, False)
            inherited.clear()
            for fd in (opening_fd, command_read, stdout_write, stderr_write):
                os.close(fd)
                self._fds.remove(fd)
            if self._closing.is_set():
                raise NativeJobError("Native start was cancelled before resume")
            if api.ResumeThread(self._process.hThread) != 1:
                raise NativeJobError("Native suspended thread did not resume exactly once")
            if not api.CloseHandle(self._process.hThread):
                raise NativeJobError("Native primary thread handle did not close")
            self._process.hThread = None
            self._readers.append(self._worker(lambda: self._read(stdout_read, "stdout", 2_097_152)))
            self._readers.append(self._worker(lambda: self._read(stderr_read, "stderr", 65_536)))
            self._worker(lambda: self._write(command_write))
            self._worker(self._observe_exit)
        finally:
            for handle in inherited:
                os.set_handle_inheritable(handle, False)
            if attributes_ready:
                api.DeleteProcThreadAttributeList(attributes)
            # All fds, Job and any partial process stay owned until stop_and_wait.

    def _worker(self, run: Callable[[], None]) -> threading.Thread:
        def owned() -> None:
            api = self._api
            assert api is not None
            actual = wintypes.HANDLE()
            key = 0
            try:
                if not api.DuplicateHandle(
                    api.GetCurrentProcess(),
                    api.GetCurrentThread(),
                    api.GetCurrentProcess(),
                    ctypes.byref(actual),
                    0,
                    False,
                    2,
                ):
                    raise NativeJobError("Cannot retain original IO thread handle")
                key = int(actual.value or 0)
                with self._io_lock:
                    self._io_threads[key] = int(actual.value or 0)
                if not self._closing.is_set():
                    run()
            except BaseException:
                self.request_stop()
            finally:
                with self._io_lock:
                    # Failed close remains an owned handle and prevents a stop proof.
                    if actual.value and api.CloseHandle(actual):
                        self._io_threads.pop(key, None)

        worker = threading.Thread(target=owned, name="aivora-native-owned-io", daemon=True)
        self._workers.append(worker)  # Register before the worker can start or fail.
        worker.start()
        return worker

    def _read(self, fd: int, stream: str, limit: int) -> None:
        total = 0
        while not self._closing.is_set():
            data = os.read(fd, 4096)
            if not data:
                return
            total += len(data)
            if total > limit:
                raise NativeJobError("Native pipe exceeds its lifetime byte limit")
            self._output(stream, data)

    def _write(self, fd: int) -> None:
        while not self._closing.is_set():
            try:
                request = self._writes.get(timeout=0.05)
            except queue.Empty:
                continue
            try:
                remaining = request.packet
                while remaining:
                    if self._closing.is_set():
                        raise NativeJobError("Native writer is stopping")
                    count = os.write(fd, remaining[:4096])
                    if count <= 0:
                        raise NativeJobError("Native write did not advance")
                    remaining = remaining[count:]
            except BaseException as error:
                request.error = error
                self.request_stop()
            finally:
                request.done.set()

    def write(self, packet: bytes) -> None:
        if not self._start_settled or self._closing.is_set() or self._released:
            raise NativeJobError("Native process is not writable")
        request = _Write(packet)
        self._writes.put_nowait(request)
        if not request.done.wait(10):
            self.request_stop()
            raise NativeJobError("Native write completion is unknown")
        if request.error is not None:
            raise NativeJobError("Native write failed") from request.error

    def _observe_exit(self) -> None:
        assert self._api is not None
        while not self._closing.is_set():
            state = self._api.WaitForSingleObject(self._process.hProcess, 100)
            if state == 0:
                # Root exit can precede pipe drain. Deliver all already written
                # status bytes before the root observation, or valid tail bytes
                # would poison main's ended session and unrelated owners.
                for reader in self._readers:
                    while reader.is_alive():
                        if self._closing.is_set():
                            return
                        reader.join(0.05)
                self._output("exit", b"")  # Root observation only; never a release proof.
                return
            if state != 0x102:
                raise NativeJobError("Native root exit is unknown")

    def request_stop(self) -> None:
        self._closing.set()
        api = self._api
        if api is None:
            return
        # Cancellation may occur during start. The start/stop lock prevents any
        # zero-active result from releasing that still-pending start path.
        if self._lock.acquire(blocking=False):
            try:
                if self._job:
                    api.TerminateJobObject(self._job, 73)
            finally:
                self._lock.release()
        with self._io_lock:
            for handle in self._io_threads.values():
                api.CancelSynchronousIo(handle)
        # Cancellation requests are not completion or release receipts.

    def stop_and_wait(self, timeout: float = 30) -> None:
        deadline = time.monotonic() + timeout
        self.request_stop()
        if not self._lock.acquire(timeout=max(0, deadline - time.monotonic())):
            raise NativeJobError("Native start/stop ownership lock is still pending")
        try:
            if self._released:
                return
            if self._started and not self._start_settled:
                raise NativeJobError("Native start is still pending")
            while any(worker.is_alive() for worker in self._workers):
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise NativeJobError("Native pipe workers did not join")
                self.request_stop()
                for worker in self._workers:
                    if worker.is_alive():
                        worker.join(min(0.05, remaining))
            with self._io_lock:
                if self._io_threads:
                    raise NativeJobError("Native IO thread handles remain unconfirmed")
            if self._job:
                assert self._api is not None
                while True:
                    active = win._Accounting()
                    if not self._api.QueryInformationJobObject(
                        self._job, 1, ctypes.byref(active), ctypes.sizeof(active), None
                    ):
                        raise NativeJobError("Native Job activity is unconfirmed")
                    if active.ActiveProcesses == 0:
                        break
                    if time.monotonic() >= deadline:
                        raise NativeJobError("Native Job zero-active ownership is unconfirmed")
                    time.sleep(0.01)
            for fd in tuple(self._fds):
                os.close(fd)
                self._fds.remove(fd)
            if self._api is not None:
                for name in ("hThread", "hProcess"):
                    handle = getattr(self._process, name)
                    if handle:
                        if not self._api.CloseHandle(handle):
                            raise NativeJobError("Native process handle close is unconfirmed")
                        setattr(self._process, name, None)
                if self._job:
                    if not self._api.CloseHandle(self._job):
                        raise NativeJobError("Native Job handle close is unconfirmed")
                    self._job = None
            self._released = True
        finally:
            self._lock.release()

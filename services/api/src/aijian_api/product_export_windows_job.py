"""Windows process boundary for a future formal product export executor.

CreateProcess assigns the child to a private kill-on-close Job Object before
its suspended primary thread can run. This module is not connected to the
product export encoder or the engineering MLT worker.
"""

from __future__ import annotations

import ctypes
import math
import os
import subprocess
import threading
import time
from collections.abc import Mapping, Sequence
from ctypes import wintypes
from pathlib import Path
from typing import BinaryIO

_KILL_ON_JOB_CLOSE = 0x00002000
_JOB_EXTENDED_LIMIT_INFORMATION = 9
_JOB_BASIC_ACCOUNTING_INFORMATION = 1
_HANDLE_LIST = 0x00020002
_JOB_LIST = 0x0002000D
_MITIGATION_POLICY = 0x00020007
# Microsoft-signed DLLs, no remote/low-label images, prefer System32.
# Official constants and per-child startup semantics:
# https://learn.microsoft.com/windows/win32/api/processthreadsapi/
# nf-processthreadsapi-updateprocthreadattribute
_EXTERNAL_MEDIA_MITIGATION = (1 << 44) | (1 << 52) | (1 << 56) | (1 << 60)
_STARTF_USESTDHANDLES = 0x00000100
_CREATE_SUSPENDED = 0x00000004
_CREATE_UNICODE_ENVIRONMENT = 0x00000400
_EXTENDED_STARTUPINFO_PRESENT = 0x00080000
_CREATE_NO_WINDOW = 0x08000000
_WAIT_OBJECT_0 = 0
_WAIT_TIMEOUT = 0x00000102
_WAIT_FAILED = 0xFFFFFFFF


class _BasicLimit(ctypes.Structure):
    _fields_ = [
        ("PerProcessUserTimeLimit", ctypes.c_int64),
        ("PerJobUserTimeLimit", ctypes.c_int64),
        ("LimitFlags", wintypes.DWORD),
        ("MinimumWorkingSetSize", ctypes.c_size_t),
        ("MaximumWorkingSetSize", ctypes.c_size_t),
        ("ActiveProcessLimit", wintypes.DWORD),
        ("Affinity", ctypes.c_size_t),
        ("PriorityClass", wintypes.DWORD),
        ("SchedulingClass", wintypes.DWORD),
    ]


class _IoCounters(ctypes.Structure):
    _fields_ = [(name, ctypes.c_uint64) for name in (
        "ReadOperationCount", "WriteOperationCount", "OtherOperationCount",
        "ReadTransferCount", "WriteTransferCount", "OtherTransferCount",
    )]


class _ExtendedLimit(ctypes.Structure):
    _fields_ = [
        ("BasicLimitInformation", _BasicLimit),
        ("IoInfo", _IoCounters),
        ("ProcessMemoryLimit", ctypes.c_size_t),
        ("JobMemoryLimit", ctypes.c_size_t),
        ("PeakProcessMemoryUsed", ctypes.c_size_t),
        ("PeakJobMemoryUsed", ctypes.c_size_t),
    ]


class _Accounting(ctypes.Structure):
    _fields_ = [
        ("TotalUserTime", ctypes.c_int64),
        ("TotalKernelTime", ctypes.c_int64),
        ("ThisPeriodTotalUserTime", ctypes.c_int64),
        ("ThisPeriodTotalKernelTime", ctypes.c_int64),
        ("TotalPageFaultCount", wintypes.DWORD),
        ("TotalProcesses", wintypes.DWORD),
        ("ActiveProcesses", wintypes.DWORD),
        ("TotalTerminatedProcesses", wintypes.DWORD),
    ]


class _StartupInfo(ctypes.Structure):
    _fields_ = [
        ("cb", wintypes.DWORD),
        ("lpReserved", wintypes.LPWSTR),
        ("lpDesktop", wintypes.LPWSTR),
        ("lpTitle", wintypes.LPWSTR),
        ("dwX", wintypes.DWORD),
        ("dwY", wintypes.DWORD),
        ("dwXSize", wintypes.DWORD),
        ("dwYSize", wintypes.DWORD),
        ("dwXCountChars", wintypes.DWORD),
        ("dwYCountChars", wintypes.DWORD),
        ("dwFillAttribute", wintypes.DWORD),
        ("dwFlags", wintypes.DWORD),
        ("wShowWindow", wintypes.WORD),
        ("cbReserved2", wintypes.WORD),
        ("lpReserved2", ctypes.c_void_p),
        ("hStdInput", wintypes.HANDLE),
        ("hStdOutput", wintypes.HANDLE),
        ("hStdError", wintypes.HANDLE),
    ]


class _StartupInfoEx(ctypes.Structure):
    _fields_ = [("StartupInfo", _StartupInfo), ("lpAttributeList", ctypes.c_void_p)]


class _ProcessInfo(ctypes.Structure):
    _fields_ = [
        ("hProcess", wintypes.HANDLE),
        ("hThread", wintypes.HANDLE),
        ("dwProcessId", wintypes.DWORD),
        ("dwThreadId", wintypes.DWORD),
    ]


class ProductExportJobError(OSError):
    """A process could not be launched or observed under the private job."""


def _api() -> ctypes.WinDLL:
    if os.name != "nt":
        raise ProductExportJobError("Windows Job Objects are required")
    api = ctypes.WinDLL("kernel32", use_last_error=True)
    signatures = {
        "CreateJobObjectW": (wintypes.HANDLE, [ctypes.c_void_p, wintypes.LPCWSTR]),
        "SetInformationJobObject": (wintypes.BOOL, [
            wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD,
        ]),
        "InitializeProcThreadAttributeList": (wintypes.BOOL, [
            ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD,
            ctypes.POINTER(ctypes.c_size_t),
        ]),
        "UpdateProcThreadAttribute": (wintypes.BOOL, [
            ctypes.c_void_p, wintypes.DWORD, ctypes.c_size_t,
            ctypes.c_void_p, ctypes.c_size_t, ctypes.c_void_p, ctypes.c_void_p,
        ]),
        "DeleteProcThreadAttributeList": (None, [ctypes.c_void_p]),
        "CreateProcessW": (wintypes.BOOL, [
            wintypes.LPCWSTR, wintypes.LPWSTR, ctypes.c_void_p, ctypes.c_void_p,
            wintypes.BOOL, wintypes.DWORD, ctypes.c_void_p, wintypes.LPCWSTR,
            ctypes.c_void_p, ctypes.POINTER(_ProcessInfo),
        ]),
        "IsProcessInJob": (wintypes.BOOL, [
            wintypes.HANDLE, wintypes.HANDLE, ctypes.POINTER(wintypes.BOOL),
        ]),
        "ResumeThread": (wintypes.DWORD, [wintypes.HANDLE]),
        "QueryInformationJobObject": (wintypes.BOOL, [
            wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD,
            ctypes.POINTER(wintypes.DWORD),
        ]),
        "WaitForSingleObject": (wintypes.DWORD, [wintypes.HANDLE, wintypes.DWORD]),
        "GetExitCodeProcess": (wintypes.BOOL, [
            wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD),
        ]),
        "TerminateJobObject": (wintypes.BOOL, [wintypes.HANDLE, wintypes.UINT]),
        "TerminateProcess": (wintypes.BOOL, [wintypes.HANDLE, wintypes.UINT]),
        "CloseHandle": (wintypes.BOOL, [wintypes.HANDLE]),
    }
    for name, (restype, argtypes) in signatures.items():
        function = getattr(api, name)
        function.restype = restype
        function.argtypes = argtypes
    return api


def _winerror(stage: str) -> ProductExportJobError:
    return ProductExportJobError(ctypes.get_last_error(), stage)


class ProductExportJobProcess:
    """Own the only non-inheritable job handle and the exact process handle."""

    def __init__(
        self, api: ctypes.WinDLL, job: int, process: int, pid: int,
        stdout: BinaryIO, stderr: BinaryIO, command: str,
    ) -> None:
        self._api = api
        self._job = job
        self._process = process
        self.pid = pid  # Informational only; never reopen by PID.
        self.stdout = stdout
        self.stderr = stderr
        self._command = command
        self.returncode: int | None = None

    def _active_processes(self) -> int:
        accounting = _Accounting()
        length = wintypes.DWORD()
        if not self._api.QueryInformationJobObject(
            self._job, _JOB_BASIC_ACCOUNTING_INFORMATION,
            ctypes.byref(accounting), ctypes.sizeof(accounting),
            ctypes.byref(length),
        ):
            raise _winerror("Cannot read export job membership")
        return int(accounting.ActiveProcesses)

    def poll(self) -> int | None:
        if self.returncode is not None:
            return self.returncode
        status = self._api.WaitForSingleObject(self._process, 0)
        if status == _WAIT_TIMEOUT:
            return None
        if status != _WAIT_OBJECT_0:
            raise _winerror("Cannot wait for export process")
        if self._active_processes() != 0:
            return None
        code = wintypes.DWORD()
        if not self._api.GetExitCodeProcess(self._process, ctypes.byref(code)):
            raise _winerror("Cannot read export process exit status")
        self.returncode = ctypes.c_int32(code.value).value
        return self.returncode

    def wait(self, timeout: float | None = None) -> int:
        deadline = None if timeout is None else time.monotonic() + timeout
        while True:
            result = self.poll()
            if result is not None:
                return result
            if timeout is not None and deadline is not None and time.monotonic() >= deadline:
                raise subprocess.TimeoutExpired(self._command, timeout)
            time.sleep(0.05)

    def terminate(self) -> None:
        if self._job and not self._api.TerminateJobObject(self._job, 1):
            raise _winerror("Cannot terminate export job")

    def close(self) -> None:
        if not self._job:
            return
        try:
            if self.poll() is None:
                self.terminate()
                self.wait(timeout=2.0)
        finally:
            # The final job handle closes even if termination or waiting
            # failed. KILL_ON_JOB_CLOSE then prevents an orphaned descendant.
            self._api.CloseHandle(self._job)
            self._api.CloseHandle(self._process)
            self._job = 0
            self._process = 0
            self.stdout.close()
            self.stderr.close()

    def __enter__(self) -> ProductExportJobProcess:
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()


class ProductExportJobManager:
    """Own every export job in one sidecar until its worker releases it.

    The sidecar must hold the workspace owner lock while this manager exists.
    Shutdown first blocks new launches, then terminates and waits for every
    tracked job to have zero active processes. Worker threads subsequently
    release their process handles before the workspace lock is released.
    """

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._processes: set[ProductExportJobProcess] = set()
        self._closing = False
        self._uncertain = False

    def spawn(
        self, executable: Path, arguments: Sequence[str], *,
        cwd: Path, env: Mapping[str, str], hardened_external_media: bool = False,
    ) -> ProductExportJobProcess:
        with self._lock:
            if self._closing:
                raise ProductExportJobError("Export job manager is shutting down")
            try:
                if hardened_external_media:
                    process = spawn_product_export_job(
                        executable, arguments, cwd=cwd, env=env, hardened_external_media=True,
                    )
                else:
                    process = spawn_product_export_job(executable, arguments, cwd=cwd, env=env)
            except BaseException:
                # A failure after CreateProcess may have required forced
                # teardown; no startup recovery may assume it was harmless.
                self._uncertain = True
                raise
            self._processes.add(process)
            return process

    def release(self, process: ProductExportJobProcess) -> None:
        with self._lock:
            if process not in self._processes:
                raise ProductExportJobError("Export job is not owned by this manager")
            try:
                process.close()
            except BaseException:
                self._uncertain = True
                raise
            finally:
                self._processes.remove(process)

    def shutdown_and_wait(self, timeout_seconds: float = 10.0) -> None:
        """Stop all managed descendants before workspace ownership is freed."""
        if (
            isinstance(timeout_seconds, bool)
            or not isinstance(timeout_seconds, int | float)
            or not math.isfinite(timeout_seconds)
            or timeout_seconds <= 0
        ):
            raise ProductExportJobError("Invalid export job shutdown timeout")
        deadline = time.monotonic() + timeout_seconds
        with self._lock:
            self._closing = True
            failure = False
            for process in tuple(self._processes):
                try:
                    process.terminate()
                except ProductExportJobError:
                    failure = True
            for process in tuple(self._processes):
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    failure = True
                    break
                try:
                    process.wait(timeout=remaining)
                except (subprocess.TimeoutExpired, ProductExportJobError):
                    failure = True
            self._uncertain = self._uncertain or failure
            if self._uncertain:
                raise ProductExportJobError("Export jobs did not stop cleanly before shutdown")


def spawn_product_export_job(
    executable: Path,
    arguments: Sequence[str],
    *,
    cwd: Path,
    env: Mapping[str, str],
    hardened_external_media: bool = False,
) -> ProductExportJobProcess:
    """Start suspended, already in a kill-on-close job, then resume.

    The caller must close the returned process after all output readers have
    joined. No release path may fall back to subprocess.Popen on failure.
    """
    if (
        os.name != "nt" or not executable.is_absolute() or not executable.is_file()
        or not cwd.is_absolute() or not cwd.is_dir()
        or any(not isinstance(arg, str) or "\0" in arg for arg in arguments)
        or any(
            not key or "=" in key or "\0" in key or "\0" in value
            for key, value in env.items()
        )
    ):
        raise ProductExportJobError("Invalid Windows export process inputs")
    import msvcrt

    api = _api()
    job = api.CreateJobObjectW(None, None)
    if not job:
        raise _winerror("Cannot create private export job")
    fds: set[int] = set()
    inherited: list[int] = []
    attribute_list: ctypes.Array[ctypes.c_char] | None = None
    attributes_ready = False
    process = _ProcessInfo()
    returned = False
    try:
        limits = _ExtendedLimit()
        limits.BasicLimitInformation.LimitFlags = _KILL_ON_JOB_CLOSE
        if not api.SetInformationJobObject(
            job, _JOB_EXTENDED_LIMIT_INFORMATION,
            ctypes.byref(limits), ctypes.sizeof(limits),
        ):
            raise _winerror("Cannot set kill-on-close export job limit")
        stdin_fd = os.open(os.devnull, os.O_RDONLY)
        fds.add(stdin_fd)
        stdout_read, stdout_write = os.pipe()
        fds.update((stdout_read, stdout_write))
        stderr_read, stderr_write = os.pipe()
        fds.update((stderr_read, stderr_write))
        inherited = [
            msvcrt.get_osfhandle(stdin_fd),
            msvcrt.get_osfhandle(stdout_write),
            msvcrt.get_osfhandle(stderr_write),
        ]
        for handle in inherited:
            os.set_handle_inheritable(handle, True)
        size = ctypes.c_size_t()
        attribute_count = 3 if hardened_external_media else 2
        api.InitializeProcThreadAttributeList(None, attribute_count, 0, ctypes.byref(size))
        if not size.value:
            raise _winerror("Cannot size export process attributes")
        attribute_list = ctypes.create_string_buffer(size.value)
        if not api.InitializeProcThreadAttributeList(
            attribute_list, attribute_count, 0, ctypes.byref(size),
        ):
            raise _winerror("Cannot initialize export process attributes")
        attributes_ready = True
        handles = (wintypes.HANDLE * len(inherited))(*inherited)
        jobs = (wintypes.HANDLE * 1)(job)
        if not api.UpdateProcThreadAttribute(
            attribute_list, 0, _HANDLE_LIST, handles, ctypes.sizeof(handles),
            None, None,
        ):
            raise _winerror("Cannot restrict inherited export handles")
        if not api.UpdateProcThreadAttribute(
            attribute_list, 0, _JOB_LIST, jobs, ctypes.sizeof(jobs), None, None,
        ):
            raise _winerror("Cannot bind export job at process creation")
        mitigation = ctypes.c_uint64(_EXTERNAL_MEDIA_MITIGATION)
        if hardened_external_media and not api.UpdateProcThreadAttribute(
            attribute_list, 0, _MITIGATION_POLICY, ctypes.byref(mitigation),
            ctypes.sizeof(mitigation), None, None,
        ):
            raise _winerror("Cannot restrict external media image loading")
        startup = _StartupInfoEx()
        startup.StartupInfo.cb = ctypes.sizeof(startup)
        startup.StartupInfo.dwFlags = _STARTF_USESTDHANDLES
        startup.StartupInfo.hStdInput = inherited[0]
        startup.StartupInfo.hStdOutput = inherited[1]
        startup.StartupInfo.hStdError = inherited[2]
        startup.lpAttributeList = ctypes.cast(attribute_list, ctypes.c_void_p)
        command = subprocess.list2cmdline([str(executable), *arguments])
        command_buffer = ctypes.create_unicode_buffer(command)
        environment = "\0".join(
            f"{key}={value}"
            for key, value in sorted(env.items(), key=lambda item: item[0].casefold())
        ) + "\0\0"
        environment_buffer = ctypes.create_unicode_buffer(environment)
        if not api.CreateProcessW(
            str(executable), command_buffer, None, None, True,
            _CREATE_SUSPENDED | _CREATE_UNICODE_ENVIRONMENT
            | _EXTENDED_STARTUPINFO_PRESENT | _CREATE_NO_WINDOW,
            environment_buffer, str(cwd), ctypes.byref(startup),
            ctypes.byref(process),
        ):
            raise _winerror("Cannot create job-bound export process")
        # Drop all parent copies of child handles before any encoder byte runs.
        for handle in inherited:
            os.set_handle_inheritable(handle, False)
        inherited.clear()
        for fd in (stdin_fd, stdout_write, stderr_write):
            os.close(fd)
            fds.remove(fd)
        in_job = wintypes.BOOL()
        if not api.IsProcessInJob(process.hProcess, job, ctypes.byref(in_job)) or not in_job.value:
            raise _winerror("Export process is not in the private job")
        if api.ResumeThread(process.hThread) != 1:
            raise _winerror("Cannot resume job-bound export process")
        stdout = os.fdopen(stdout_read, "rb", buffering=0)
        fds.remove(stdout_read)
        try:
            stderr = os.fdopen(stderr_read, "rb", buffering=0)
            fds.remove(stderr_read)
        except BaseException:
            stdout.close()
            raise
        api.CloseHandle(process.hThread)
        process.hThread = None
        result = ProductExportJobProcess(
            api, job, process.hProcess, int(process.dwProcessId),
            stdout, stderr, command,
        )
        returned = True
        return result
    finally:
        for handle in inherited:
            try:
                os.set_handle_inheritable(handle, False)
            except OSError:
                pass  # Closing the owning file descriptor still closes it.
        for fd in fds:
            try:
                os.close(fd)
            except OSError:
                pass
        if attributes_ready and attribute_list is not None:
            api.DeleteProcThreadAttributeList(attribute_list)
        if not returned:
            if process.hProcess:
                api.TerminateProcess(process.hProcess, 1)
                api.WaitForSingleObject(process.hProcess, 2000)
                api.CloseHandle(process.hProcess)
            if process.hThread:
                api.CloseHandle(process.hThread)
            api.CloseHandle(job)

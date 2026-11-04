"""Handle and shutdown policy tests; no native process is created."""

import ctypes
import io
import subprocess
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from aijian_api import product_export_windows_job as jobs
from test_external_media_process import _job_api


@pytest.mark.parametrize(
    "method,message",
    [
        ("CreateJobObjectW", "create private"),
        ("SetInformationJobObject", "kill-on-close"),
        ("CreateProcessW", "create job-bound"),
        ("IsProcessInJob", "not in the private job"),
        ("ResumeThread", "resume job-bound"),
    ],
)
def test_launch_failure_closes_owned_handles_without_fallback(
    monkeypatch, tmp_path, method, message
):
    _, executable, events = _job_api(monkeypatch, tmp_path)
    api = jobs._api()
    api.TerminateProcess = Mock(return_value=True)
    monkeypatch.setattr(api, method, Mock(return_value=0))
    monkeypatch.setattr(jobs, "_api", lambda: api)
    with pytest.raises(jobs.ProductExportJobError, match=message):
        jobs.spawn_product_export_job(executable, (), cwd=tmp_path, env={})
    assert ("resume",) not in events
    if method != "CreateJobObjectW":
        assert events.count(("close", 100)) == 1
    if method in {"IsProcessInJob", "ResumeThread"}:
        api.TerminateProcess.assert_called_once_with(101, 1)
        assert events.count(("close", 101)) == 1
        assert events.count(("close", 102)) == 1
    else:
        api.TerminateProcess.assert_not_called()


@pytest.mark.parametrize("stage", ["size", "initialize", "handles", "job"])
def test_attribute_failure_closes_job_before_any_child_starts(monkeypatch, tmp_path, stage):
    _, executable, events = _job_api(monkeypatch, tmp_path)
    api = jobs._api()
    initial = api.InitializeProcThreadAttributeList
    if stage == "size":
        api.InitializeProcThreadAttributeList = Mock(return_value=False)
    elif stage == "initialize":
        api.InitializeProcThreadAttributeList = lambda attrs, *args: (
            initial(attrs, *args) if attrs is None else False
        )
    else:
        rejected = jobs._HANDLE_LIST if stage == "handles" else jobs._JOB_LIST
        api.UpdateProcThreadAttribute = lambda attrs, flags, attribute, *args: attribute != rejected
    monkeypatch.setattr(jobs, "_api", lambda: api)
    with pytest.raises(jobs.ProductExportJobError):
        jobs.spawn_product_export_job(executable, (), cwd=tmp_path, env={})
    assert ("create",) not in events
    assert events.count(("close", 100)) == 1


@pytest.mark.parametrize(
    "field,value",
    [
        ("executable", Path("relative.exe")),
        ("cwd", Path("relative")),
        ("arguments", ("bad\0arg",)),
        ("arguments", (1,)),
        ("env", {"": "value"}),
        ("env", {"A=B": "value"}),
        ("env", {"A\0": "value"}),
        ("env", {"A": "bad\0value"}),
    ],
)
def test_invalid_launch_input_does_not_create_job(monkeypatch, tmp_path, field, value):
    _, executable, events = _job_api(monkeypatch, tmp_path)
    payload = {"executable": executable, "arguments": (), "cwd": tmp_path, "env": {}}
    payload[field] = value
    with pytest.raises(jobs.ProductExportJobError, match="inputs"):
        jobs.spawn_product_export_job(**payload)
    assert not events


def process_with_fake_api():
    api = Mock()
    api.WaitForSingleObject.return_value = jobs._WAIT_OBJECT_0
    api.QueryInformationJobObject.side_effect = lambda job, kind, accounting, size, written: True

    def exit_code(process, code):
        ctypes.cast(code, ctypes.POINTER(jobs.wintypes.DWORD)).contents.value = 0xFFFFFFFF
        return True

    api.GetExitCodeProcess.side_effect = exit_code
    process = jobs.ProductExportJobProcess(
        api, 100, 101, 999, io.BytesIO(), io.BytesIO(), "synthetic"
    )
    return process, api


def test_poll_waits_for_descendants_then_caches_signed_exit_code():
    process, api = process_with_fake_api()
    api.WaitForSingleObject.return_value = jobs._WAIT_TIMEOUT
    assert process.poll() is None
    api.WaitForSingleObject.return_value = jobs._WAIT_OBJECT_0

    def descendants(job, kind, accounting, size, written):
        ctypes.cast(accounting, ctypes.POINTER(jobs._Accounting)).contents.ActiveProcesses = 1
        return True

    api.QueryInformationJobObject.side_effect = descendants
    assert process.poll() is None
    api.GetExitCodeProcess.assert_not_called()
    api.QueryInformationJobObject.side_effect = lambda *args: True
    assert process.poll() == -1
    assert process.poll() == -1
    api.GetExitCodeProcess.assert_called_once()
    process.close()
    process.close()
    assert api.CloseHandle.call_count == 2
    assert process.stdout.closed and process.stderr.closed


@pytest.mark.parametrize(
    "method", ["WaitForSingleObject", "QueryInformationJobObject", "GetExitCodeProcess"]
)
def test_poll_failure_still_closes_both_handles_and_streams(method):
    process, api = process_with_fake_api()
    target = getattr(api, method)
    target.side_effect = None
    target.return_value = jobs._WAIT_FAILED if method == "WaitForSingleObject" else False
    with pytest.raises(jobs.ProductExportJobError):
        process.close()
    assert [call.args[0] for call in api.CloseHandle.call_args_list] == [100, 101]
    assert process.stdout.closed and process.stderr.closed
    process.close()
    assert api.CloseHandle.call_count == 2


def test_close_termination_failure_does_not_leak_handles():
    process, api = process_with_fake_api()
    api.WaitForSingleObject.return_value = jobs._WAIT_TIMEOUT
    api.TerminateJobObject.return_value = False
    with pytest.raises(jobs.ProductExportJobError, match="terminate"):
        process.close()
    assert api.CloseHandle.call_count == 2
    process.terminate()
    api.TerminateJobObject.assert_called_once()


def test_wait_timeout_is_bounded_without_real_sleep(monkeypatch):
    process, api = process_with_fake_api()
    api.WaitForSingleObject.return_value = jobs._WAIT_TIMEOUT
    monkeypatch.setattr(
        jobs, "time", SimpleNamespace(monotonic=Mock(side_effect=[0, 0, 2]), sleep=Mock())
    )
    with pytest.raises(subprocess.TimeoutExpired):
        process.wait(timeout=1)
    jobs.time.sleep.assert_called_once_with(0.05)
    api.WaitForSingleObject.return_value = jobs._WAIT_OBJECT_0
    with process as entered:
        assert entered is process
        assert process.wait() == -1
    assert process.stdout.closed


@pytest.mark.parametrize("value", [True, "1", 0, -1, float("nan"), float("inf")])
def test_manager_rejects_invalid_shutdown_deadline(value):
    with pytest.raises(jobs.ProductExportJobError, match="timeout"):
        jobs.ProductExportJobManager().shutdown_and_wait(value)


@pytest.mark.parametrize("failure", [None, "spawn", "close", "terminate", "wait", "deadline"])
def test_manager_retains_uncertain_shutdown_and_refuses_new_work(monkeypatch, tmp_path, failure):
    process = Mock()
    spawn = Mock(return_value=process)
    monkeypatch.setattr(jobs, "spawn_product_export_job", spawn)
    manager = jobs.ProductExportJobManager()
    if failure == "spawn":
        spawn.side_effect = jobs.ProductExportJobError("synthetic spawn failure")
        with pytest.raises(jobs.ProductExportJobError):
            manager.spawn(tmp_path / "synthetic.exe", (), cwd=tmp_path, env={})
    else:
        assert manager.spawn(tmp_path / "synthetic.exe", (), cwd=tmp_path, env={}) is process
    if failure in {"close", "terminate", "wait"}:
        getattr(process, failure).side_effect = jobs.ProductExportJobError("synthetic failure")
    if failure == "close":
        with pytest.raises(jobs.ProductExportJobError):
            manager.release(process)
        with pytest.raises(jobs.ProductExportJobError, match="not owned"):
            manager.release(process)
    if failure == "deadline":
        monkeypatch.setattr(jobs, "time", SimpleNamespace(monotonic=Mock(side_effect=[0, 2])))
    if failure is None:
        manager.shutdown_and_wait(1)
        process.terminate.assert_called_once()
        process.wait.assert_called_once()
        manager.release(process)
        process.close.assert_called_once()
    else:
        with pytest.raises(jobs.ProductExportJobError, match="did not stop cleanly"):
            manager.shutdown_and_wait(1)
    with pytest.raises(jobs.ProductExportJobError, match="shutting down"):
        manager.spawn(tmp_path / "synthetic.exe", (), cwd=tmp_path, env={})
    assert spawn.call_count == 1

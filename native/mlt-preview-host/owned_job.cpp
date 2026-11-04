// SPDX-License-Identifier: Apache-2.0
#include "owned_job.hpp"
#include <array>
#include <stdexcept>
#include <vector>

namespace aivora {
static void must(bool value) { if (!value) throw std::runtime_error("Owned MLT job boundary refused"); }
struct ScopedHandle {
  HANDLE value = nullptr;
  ~ScopedHandle() { if (value) CloseHandle(value); }
};
OwnedJob::~OwnedJob() {
  // Final process death closes this non-inheritable kill-on-close job even after a failed wait.
  // Application-side release proof remains false until zero_active() is observed.
  bool confirmed = false;
  if (job_) {
    TerminateJobObject(job_, 72);
    try { confirmed = zero_active(); } catch (...) { /* Ownership remains unknown. */ }
    CloseHandle(job_);
  } else confirmed = true;
  // Last-resort destruction is not a cleanup receipt. Keep sealed handles until owner-process
  // exit when zero-active cannot be proved, rather than unsealing files beside a late child.
  if (!confirmed) (void)launch_.release();
  for (HANDLE h : {process_, input_, output_, errors_}) if (h) CloseHandle(h);
}
void OwnedJob::start() {
  must(launch_ != nullptr);
  const auto& executable = launch_->executable(); const auto& cwd = launch_->cwd();
  must(!job_ && !process_ && !executable.empty() && !cwd.empty() &&
       executable.find(L'"') == std::wstring::npos && executable.find(L'\0') == std::wstring::npos);
  job_ = CreateJobObjectW(nullptr, nullptr); must(job_ != nullptr);
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
  limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_ACTIVE_PROCESS;
  limits.BasicLimitInformation.ActiveProcessLimit = 1; // This host never starts encoders or other children.
  must(SetInformationJobObject(job_, JobObjectExtendedLimitInformation, &limits, sizeof(limits)));
  SECURITY_ATTRIBUTES attributes{sizeof(SECURITY_ATTRIBUTES), nullptr, TRUE};
  ScopedHandle child_input, child_output, child_errors;
  must(CreatePipe(&child_input.value, &input_, &attributes, 0));
  must(CreatePipe(&output_, &child_output.value, &attributes, 0));
  must(CreatePipe(&errors_, &child_errors.value, &attributes, 0));
  for (HANDLE h : {input_, output_, errors_}) must(SetHandleInformation(h, HANDLE_FLAG_INHERIT, 0));
  SIZE_T bytes = 0;
  InitializeProcThreadAttributeList(nullptr, 3, 0, &bytes); must(bytes > 0);
  std::vector<unsigned char> memory(bytes);
  auto list = reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(memory.data());
  must(InitializeProcThreadAttributeList(list, 3, 0, &bytes));
  struct ListCleanup { LPPROC_THREAD_ATTRIBUTE_LIST value; ~ListCleanup() { DeleteProcThreadAttributeList(value); } } cleanup{list};
  std::array<HANDLE, 3> inherited{child_input.value, child_output.value, child_errors.value};
  must(UpdateProcThreadAttribute(list, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST, inherited.data(),
                                 sizeof(inherited), nullptr, nullptr));
  must(UpdateProcThreadAttribute(list, 0, PROC_THREAD_ATTRIBUTE_JOB_LIST, &job_, sizeof(job_), nullptr, nullptr));
  DWORD64 mitigation = PROCESS_CREATION_MITIGATION_POLICY_IMAGE_LOAD_NO_REMOTE_ALWAYS_ON |
    PROCESS_CREATION_MITIGATION_POLICY_IMAGE_LOAD_NO_LOW_LABEL_ALWAYS_ON |
    PROCESS_CREATION_MITIGATION_POLICY_IMAGE_LOAD_PREFER_SYSTEM32_ALWAYS_ON;
  must(UpdateProcThreadAttribute(list, 0, PROC_THREAD_ATTRIBUTE_MITIGATION_POLICY,
                                 &mitigation, sizeof(mitigation), nullptr, nullptr));
  // Do not weaken existing ffmpeg Microsoft's-signed-DLL policy. This separate admitted host
  // needs exact held third-party DLLs and switches loader directories before loading MLT.
  wchar_t windows[32768]{}; UINT length = GetWindowsDirectoryW(windows, 32768);
  must(length > 0 && length < 32768);
  std::wstring system(windows, length), env;
  auto entry = [&](const std::wstring& key, const std::wstring& value) {
    env += key + L"=" + value; env.push_back(L'\0');
  };
  entry(L"PATH", system + L"\\System32");
  entry(L"SystemRoot", system);
  entry(L"TEMP", cwd); entry(L"TMP", cwd); entry(L"windir", system); env.push_back(L'\0');
  std::wstring command = L"\"" + executable + L"\"";
  STARTUPINFOEXW startup{}; startup.StartupInfo.cb = sizeof(startup);
  startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
  startup.StartupInfo.hStdInput = child_input.value;
  startup.StartupInfo.hStdOutput = child_output.value;
  startup.StartupInfo.hStdError = child_errors.value; startup.lpAttributeList = list;
  PROCESS_INFORMATION process{};
  must(CreateProcessW(executable.c_str(), command.data(), nullptr, nullptr, TRUE,
       CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT | EXTENDED_STARTUPINFO_PRESENT | CREATE_NO_WINDOW,
       env.data(), cwd.c_str(), &startup.StartupInfo, &process));
  process_ = process.hProcess; ScopedHandle thread{process.hThread};
  BOOL actual = FALSE;
  // Both Job and restricted handle list were applied atomically at CreateProcess, before byte one.
  must(IsProcessInJob(process_, job_, &actual) && actual);
  // Child pipe ends are still held by scoped guards, so any early error remains an owned job.
  must(ResumeThread(thread.value) == 1);
}
bool OwnedJob::zero_active() const {
  if (!job_) return true;
  JOBOBJECT_BASIC_ACCOUNTING_INFORMATION info{};
  must(QueryInformationJobObject(job_, JobObjectBasicAccountingInformation, &info, sizeof(info), nullptr));
  return info.ActiveProcesses == 0;
}
bool OwnedJob::kill_and_wait(DWORD timeout_ms) {
  must(timeout_ms > 0 && timeout_ms <= 30000);
  if (zero_active()) return true;
  must(TerminateJobObject(job_, 72));
  const auto deadline = GetTickCount64() + timeout_ms;
  while (!zero_active()) {
    if (GetTickCount64() >= deadline) return false;
    Sleep(10);
  }
  // Native bridge additionally joins its bounded stdout/stderr readers before resolving.
  return true;
}
}

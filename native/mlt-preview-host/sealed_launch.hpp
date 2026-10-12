// SPDX-License-Identifier: Apache-2.0
#pragma once
#include <windows.h>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace aivora {
struct SealedLaunchFile { std::wstring path; std::string sha256; uint32_t byte_size; };
// Private trusted binding only. Full profile, PE closure, license/source admission and fresh
// SQLite source checks must precede acquire. This does not admit a user-supplied manifest.
class SealedLaunch {
  std::vector<HANDLE> handles_;
  std::wstring executable_, cwd_;
  SealedLaunch() = default;
  void directory(const std::wstring& path);
  void file(const SealedLaunchFile& value);
public:
  SealedLaunch(const SealedLaunch&) = delete;
  SealedLaunch& operator=(const SealedLaunch&) = delete;
  ~SealedLaunch();
  static std::unique_ptr<SealedLaunch> acquire(const std::wstring& executable,
    const std::wstring& protected_private_cwd, const std::vector<SealedLaunchFile>& files);
  const std::wstring& executable() const { return executable_; }
  const std::wstring& cwd() const { return cwd_; }
};
}

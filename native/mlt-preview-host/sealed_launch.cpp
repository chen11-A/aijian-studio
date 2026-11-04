// SPDX-License-Identifier: Apache-2.0
#include "sealed_launch.hpp"
#include <bcrypt.h>
#include <algorithm>
#include <cwctype>
#include <filesystem>
#include <map>
#include <stdexcept>

namespace aivora {
namespace {
void require(bool value) { if (!value) throw std::runtime_error("Owned MLT sealed launch refused"); }
bool local(const std::wstring& path) {
  if (path.size() < 3 || path.size() > 240 || !((path[0] >= L'A' && path[0] <= L'Z') ||
    (path[0] >= L'a' && path[0] <= L'z')) || path[1] != L':' || path[2] != L'\\') return false;
  size_t start = 3;
  while (start < path.size()) {
    auto end = path.find(L'\\', start); if (end == std::wstring::npos) end = path.size();
    auto part = path.substr(start, end - start);
    if (part.empty() || part.back() == L'.' || part.back() == L' ') return false;
    for (auto c : part) if (c < 32 || c == 127 || std::wstring(L"/:*?\"<>|").find(c) != std::wstring::npos) return false;
    auto base = part.substr(0, part.find(L'.'));
    std::transform(base.begin(), base.end(), base.begin(), [](wchar_t c) { return static_cast<wchar_t>(towupper(c)); });
    if (base == L"CON" || base == L"PRN" || base == L"AUX" || base == L"NUL" ||
      base == L"CONIN$" || base == L"CONOUT$" || (base.size() == 4 &&
      (base.substr(0, 3) == L"COM" || base.substr(0, 3) == L"LPT") &&
      std::wstring(L"0123456789¹²³").find(base[3]) != std::wstring::npos)) return false;
    start = end + 1;
  }
  return path.size() == 3 || path.back() != L'\\';
}
struct Handle {
  HANDLE value;
  ~Handle() { if (value != INVALID_HANDLE_VALUE && value != nullptr) CloseHandle(value); }
  HANDLE release() { auto result = value; value = nullptr; return result; }
};
void final_path(HANDLE value, const std::wstring& expected) {
  wchar_t actual[32768]{}; auto length = GetFinalPathNameByHandleW(value, actual, 32768, FILE_NAME_NORMALIZED);
  require(length > 4 && length < 32768 && std::wstring(actual).rfind(L"\\\\?\\", 0) == 0 &&
    _wcsicmp(actual + 4, expected.c_str()) == 0);
}
}
SealedLaunch::~SealedLaunch() { for (auto value : handles_) CloseHandle(value); }
void SealedLaunch::directory(const std::wstring& path) {
  require(local(path)); auto kind = GetDriveTypeW(path.substr(0, 3).c_str());
  require(kind == DRIVE_FIXED || kind == DRIVE_REMOVABLE);
  Handle held{CreateFileW(path.c_str(), 0x81, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
    FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr)};
  BY_HANDLE_FILE_INFORMATION info{};
  require(GetFileInformationByHandle(held.value, &info) &&
    (info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) && !(info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT));
  final_path(held.value, path); handles_.push_back(held.release());
}
void SealedLaunch::file(const SealedLaunchFile& value) {
  require(local(value.path) && value.path.size() > 3 && value.byte_size > 0 && value.byte_size <= 512 * 1024 * 1024 &&
    value.sha256.size() == 64 && std::all_of(value.sha256.begin(), value.sha256.end(),
    [](char c) { return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'); }));
  Handle held{CreateFileW(value.path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
    FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_SEQUENTIAL_SCAN, nullptr)};
  BY_HANDLE_FILE_INFORMATION info{};
  require(GetFileInformationByHandle(held.value, &info) && GetFileType(held.value) == FILE_TYPE_DISK &&
    !(info.dwFileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)) &&
    info.nNumberOfLinks == 1 && info.nFileSizeHigh == 0 && info.nFileSizeLow == value.byte_size);
  final_path(held.value, value.path);
  BCRYPT_ALG_HANDLE algorithm = nullptr; BCRYPT_HASH_HANDLE hash = nullptr;
  require(BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0) >= 0);
  struct Algorithm { BCRYPT_ALG_HANDLE value; ~Algorithm() { BCryptCloseAlgorithmProvider(value, 0); } } ac{algorithm};
  require(BCryptCreateHash(algorithm, &hash, nullptr, 0, nullptr, 0, 0) >= 0);
  struct Hash { BCRYPT_HASH_HANDLE value; ~Hash() { BCryptDestroyHash(value); } } hc{hash};
  std::vector<unsigned char> buffer(1024 * 1024); uint64_t total = 0;
  for (;;) {
    DWORD read = 0; require(ReadFile(held.value, buffer.data(), static_cast<DWORD>(buffer.size()), &read, nullptr));
    if (!read) break; total += read;
    require(total <= value.byte_size && BCryptHashData(hash, buffer.data(), read, 0) >= 0);
  }
  unsigned char digest[32]{}; require(total == value.byte_size && BCryptFinishHash(hash, digest, 32, 0) >= 0);
  std::string hex; const char* digits = "0123456789abcdef";
  for (auto byte : digest) { hex += digits[byte >> 4]; hex += digits[byte & 15]; }
  require(hex == value.sha256); handles_.push_back(held.release());
}
std::unique_ptr<SealedLaunch> SealedLaunch::acquire(const std::wstring& executable,
 const std::wstring& cwd, const std::vector<SealedLaunchFile>& files) {
  require(local(executable) && executable.size() > 3 && local(cwd) && cwd.size() > 3 &&
    files.size() >= 6 && files.size() <= 288);
  auto result = std::unique_ptr<SealedLaunch>(new SealedLaunch());
  result->executable_ = executable; result->cwd_ = cwd;
  std::map<std::wstring, bool> directories, names; bool found = false; uint64_t total = 0;
  auto parents = [&](const std::filesystem::path& path) {
    std::vector<std::filesystem::path> chain;
    for (auto p = path; !p.empty(); p = p.parent_path()) {
      chain.push_back(p); if (p == p.root_path()) break;
    }
    for (auto p = chain.rbegin(); p != chain.rend(); ++p) {
      auto spelling = p->wstring();
      if (!directories.contains(spelling)) { require(directories.size() < 4096); result->directory(spelling); directories.emplace(spelling, true); }
    }
  };
  parents(std::filesystem::path(cwd));
  for (const auto& value : files) {
    auto key = value.path; std::transform(key.begin(), key.end(), key.begin(),
      [](wchar_t c) { return static_cast<wchar_t>(towlower(c)); });
    require(!names.contains(key)); names.emplace(key, true);
    total += value.byte_size; require(total <= 4ULL * 1024 * 1024 * 1024);
    parents(std::filesystem::path(value.path).parent_path()); result->file(value);
    if (_wcsicmp(value.path.c_str(), executable.c_str()) == 0) found = true;
  }
  require(found); return result;
}
}

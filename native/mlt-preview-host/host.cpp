// SPDX-License-Identifier: Apache-2.0
// Source-only Windows host. Not built, installed, launched or admitted by this change.
#include <windows.h>
#include <bcrypt.h>
#include <framework/mlt.h>
#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <cwctype>
#include <cstdio>
#include <filesystem>
#include <limits>
#include <map>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

namespace aivora {
constexpr uint32_t wire_version = 1, max_packet = 131072, no_frame = 0xffffffff;
struct Failure : std::runtime_error { using std::runtime_error::runtime_error; };
void require(bool yes) { if (!yes) throw Failure("Native preview boundary refused"); }
struct Handle {
  HANDLE value = INVALID_HANDLE_VALUE;
  explicit Handle(HANDLE h) : value(h) { require(h && h != INVALID_HANDLE_VALUE); }
  ~Handle() { if (value && value != INVALID_HANDLE_VALUE) CloseHandle(value); }
  Handle(const Handle&) = delete;
  Handle& operator=(const Handle&) = delete;
};
std::wstring wide(const std::string& value) {
  require(!value.empty() && value.size() <= 16384 && value.find('\0') == std::string::npos);
  int n = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(),
                             static_cast<int>(value.size()), nullptr, 0);
  require(n > 0);
  std::wstring result(static_cast<size_t>(n), L'\0');
  require(MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(),
          static_cast<int>(value.size()), result.data(), n) == n);
  return result;
}
bool local_path(const std::wstring& path) {
  if (path.size() < 4 || path.size() > 240 || path[1] != L':' || path[2] != L'\\' ||
      !((path[0] >= L'A' && path[0] <= L'Z') || (path[0] >= L'a' && path[0] <= L'z')))
    return false;
  size_t first = 3;
  for (size_t i = 3; i <= path.size(); ++i) {
    if (i == path.size() || path[i] == L'\\') {
      if (i == first || path[i-1] == L'.' || path[i-1] == L' ') return false;
      auto part = path.substr(first, i - first);
      std::transform(part.begin(), part.end(), part.begin(), [](wchar_t c) {
        return static_cast<wchar_t>(towupper(c));
      });
      const auto base = part.substr(0, part.find(L'.'));
      if (base == L"CON" || base == L"PRN" || base == L"AUX" || base == L"NUL" ||
          base == L"CONIN$" || base == L"CONOUT$" ||
          (base.size() == 4 && (base.substr(0, 3) == L"COM" || base.substr(0, 3) == L"LPT") &&
           (base[3] >= L'0' && base[3] <= L'9'))) return false;
      first = i + 1;
    } else if (path[i] < 32 || path[i] == 127 ||
               std::wstring(L"/:*?\"<>|").find(path[i]) != std::wstring::npos) return false;
  }
  return true;
}
bool hex_hash(const std::string& value) {
  return value.size() == 64 && std::all_of(value.begin(), value.end(), [](char c) {
    return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f');
  });
void read_exact(HANDLE pipe, void* data, size_t length) {
  auto* next = static_cast<unsigned char*>(data);
  while (length) {
    DWORD count = 0;
    require(ReadFile(pipe, next, static_cast<DWORD>(length), &count, nullptr) && count > 0);
    next += count; length -= count;
  }
}
void write_exact(HANDLE pipe, const void* data, size_t length) {
  auto* next = static_cast<const unsigned char*>(data);
  while (length) {
    DWORD count = 0;
    require(WriteFile(pipe, next, static_cast<DWORD>(length), &count, nullptr) && count > 0);
    next += count; length -= count;
  }
}
struct Reader {
  std::vector<unsigned char> bytes;
  size_t offset = 0;
  explicit Reader(HANDLE pipe) {
    uint32_t size = 0; read_exact(pipe, &size, 4);
    require(size >= 8 && size <= max_packet);
    bytes.resize(size); read_exact(pipe, bytes.data(), size);
    require(u32() == wire_version);
  }
  uint32_t u32() {
    require(offset + 4 <= bytes.size());
    uint32_t value = 0;
    for (size_t i = 0; i < 4; ++i) value |= static_cast<uint32_t>(bytes[offset+i]) << (i*8);
    offset += 4; return value;
  }
  std::string text() {
    auto size = u32(); require(size <= 16384 && offset + size <= bytes.size());
    std::string value(reinterpret_cast<char*>(bytes.data() + offset), size);
    offset += size;
    if (!value.empty()) (void)wide(value); // Validate complete UTF-8, no embedded NUL.
    return value;
  }
  void end() { require(offset == bytes.size()); }
};
struct Writer {
  std::vector<unsigned char> bytes;
  void u32(uint32_t value) {
    for (int i = 0; i < 4; ++i) bytes.push_back(static_cast<unsigned char>(value >> (i*8)));
  }
  void text(const std::string& value) {
    require(value.size() <= 16384); u32(static_cast<uint32_t>(value.size()));
    bytes.insert(bytes.end(), value.begin(), value.end());
  }
  void send(HANDLE pipe) {
    require(bytes.size() <= max_packet);
    uint32_t size = static_cast<uint32_t>(bytes.size());
    write_exact(pipe, &size, 4); write_exact(pipe, bytes.data(), bytes.size());
  }
};
struct File { std::string path, hash; uint32_t size; };
File read_file(Reader& reader) {
  File file{reader.text(), reader.text(), reader.u32()};
  require(local_path(wide(file.path)) && hex_hash(file.hash) && file.size > 0 &&
          file.size <= 512 * 1024 * 1024);
  return file;
}
struct Clip { File file; uint32_t start, end, in, source_frames; };
struct Opening {
  std::string session, open_id, identity, expiry, profile, framework, modules, data;
  uint32_t generation, width, height, fps_num, fps_den, frames;
  std::vector<File> runtime;
  std::vector<Clip> clips;
};
Opening opening(Reader& reader) {
  require(reader.u32() == 1);
  Opening x;
  x.session = reader.text(); x.generation = reader.u32(); x.open_id = reader.text();
  x.identity = reader.text(); x.expiry = reader.text(); x.profile = reader.text();
  x.framework = reader.text(); x.modules = reader.text(); x.data = reader.text();
  require(x.session.size() == 36 && x.session.rfind("pvs_", 0) == 0 &&
          x.open_id.size() == 36 && x.open_id.rfind("pvo_", 0) == 0 && x.generation > 0 &&
          x.identity.size() <= 4096 && x.profile.rfind("sha256:", 0) == 0 &&
          hex_hash(x.profile.substr(7)));
  uint32_t count = reader.u32(); require(count > 0 && count <= 256);
  for (uint32_t i = 0; i < count; ++i) x.runtime.push_back(read_file(reader));
  x.width = reader.u32(); x.height = reader.u32(); x.fps_num = reader.u32();
  x.fps_den = reader.u32(); x.frames = reader.u32(); count = reader.u32();
  require(x.width > 0 && x.width <= 1920 && x.height > 0 && x.height <= 1920 &&
          x.fps_num > 0 && x.fps_num <= 240000 && x.fps_den > 0 && x.fps_den <= 10000 &&
          static_cast<uint64_t>(x.fps_num) <= static_cast<uint64_t>(x.fps_den) * 120 &&
          x.frames > 0 && static_cast<uint64_t>(x.frames) * x.fps_den <=
          static_cast<uint64_t>(x.fps_num) * 1800 && count > 0 && count <= 32);
  uint32_t prior = 0;
  for (uint32_t i = 0; i < count; ++i) {
    Clip clip{read_file(reader), reader.u32(), reader.u32(), reader.u32(), reader.u32()};
    require(clip.start >= prior && clip.end > clip.start && clip.end <= x.frames &&
            static_cast<uint64_t>(clip.in) + clip.end - clip.start <= clip.source_frames &&
            clip.source_frames <= static_cast<uint32_t>(std::numeric_limits<int>::max()));
    prior = clip.end; x.clips.push_back(clip);
  }
  reader.end(); return x;
}
struct HeldFiles {
  std::vector<std::unique_ptr<Handle>> handles;
  std::map<std::wstring, std::pair<std::string, uint32_t>> known;
  void directory(const std::filesystem::path& path) {
    auto spelling = path.wstring();
    require((spelling.size() == 3 && spelling[1] == L':' && spelling[2] == L'\\') || local_path(spelling));
    const auto drive = spelling.substr(0, 3);
    const auto kind = GetDriveTypeW(drive.c_str());
    require(kind == DRIVE_FIXED || kind == DRIVE_REMOVABLE);
    auto held = std::make_unique<Handle>(CreateFileW(spelling.c_str(), 0x81, FILE_SHARE_READ,
      nullptr, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
    BY_HANDLE_FILE_INFORMATION info{};
    require(GetFileInformationByHandle(held->value, &info) &&
            (info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) &&
            !(info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT));
    wchar_t actual[32768]{};
    DWORD length = GetFinalPathNameByHandleW(held->value, actual, 32768, FILE_NAME_NORMALIZED);
    require(length > 4 && length < 32768 && std::wstring(actual).rfind(L"\\\\?\\", 0) == 0 &&
            _wcsicmp(actual + 4, spelling.c_str()) == 0);
    handles.push_back(std::move(held));
  }
  void protect(const File& file) {
    auto path = wide(file.path);
    auto key = path;
    std::transform(key.begin(), key.end(), key.begin(), [](wchar_t c) { return static_cast<wchar_t>(towlower(c)); });
    if (known.contains(key)) { require(known.at(key) == std::make_pair(file.hash, file.size)); return; }
    std::filesystem::path at(path);
    std::vector<std::filesystem::path> parents;
    for (auto p = at.parent_path(); !p.empty(); p = p.parent_path()) {
      parents.push_back(p); if (p == p.root_path()) break;
    }
    for (auto p = parents.rbegin(); p != parents.rend(); ++p) directory(*p);
    auto held = std::make_unique<Handle>(CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ,
      nullptr, OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_SEQUENTIAL_SCAN, nullptr));
    BY_HANDLE_FILE_INFORMATION info{};
    require(GetFileInformationByHandle(held->value, &info) && GetFileType(held->value) == FILE_TYPE_DISK &&
            !(info.dwFileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)) &&
            info.nNumberOfLinks == 1 && info.nFileSizeHigh == 0 && info.nFileSizeLow == file.size);
    wchar_t actual[32768]{};
    DWORD length = GetFinalPathNameByHandleW(held->value, actual, 32768, FILE_NAME_NORMALIZED);
    require(length > 4 && length < 32768 && std::wstring(actual).rfind(L"\\\\?\\", 0) == 0 &&
            _wcsicmp(actual + 4, path.c_str()) == 0);
    BCRYPT_ALG_HANDLE algorithm = nullptr;
    BCRYPT_HASH_HANDLE hash = nullptr;
    require(BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0) >= 0);
    struct AlgorithmCleanup { BCRYPT_ALG_HANDLE value; ~AlgorithmCleanup() { BCryptCloseAlgorithmProvider(value, 0); } } ac{algorithm};
    require(BCryptCreateHash(algorithm, &hash, nullptr, 0, nullptr, 0, 0) >= 0);
    struct HashCleanup { BCRYPT_HASH_HANDLE value; ~HashCleanup() { BCryptDestroyHash(value); } } hc{hash};
    std::vector<unsigned char> block(1024 * 1024);
    uint64_t total = 0;
    for (;;) {
      DWORD n = 0; require(ReadFile(held->value, block.data(), static_cast<DWORD>(block.size()), &n, nullptr));
      if (!n) break;
      total += n; require(total <= file.size && BCryptHashData(hash, block.data(), n, 0) >= 0);
    }
    unsigned char digest[32]{}; require(total == file.size && BCryptFinishHash(hash, digest, 32, 0) >= 0);
    std::string hex; const char* digits = "0123456789abcdef";
    for (auto c : digest) { hex += digits[c >> 4]; hex += digits[c & 15]; }
    require(hex == file.hash);
    known.emplace(key, std::make_pair(file.hash, file.size)); handles.push_back(std::move(held));
  }
};
// A pre-resume owning launcher must establish the actual Job. The host verifies that fact;
// its watchdog/EOF are defense in depth and never replace parent-side Job ownership.
void require_job() {
  BOOL in_job = FALSE;
  require(IsProcessInJob(GetCurrentProcess(), nullptr, &in_job) && in_job);
}
uint64_t expiry_remaining(const std::string& expiry) {
  SYSTEMTIME time{}; unsigned y, mon, d, h, m, s, ms;
  require(expiry.size() == 24 && expiry[4] == '-' && expiry[7] == '-' && expiry[10] == 'T' &&
          expiry[13] == ':' && expiry[16] == ':' && expiry[19] == '.' && expiry[23] == 'Z');
  for (size_t i = 0; i < expiry.size(); ++i) {
    if (i != 4 && i != 7 && i != 10 && i != 13 && i != 16 && i != 19 && i != 23)
      require(expiry[i] >= '0' && expiry[i] <= '9');
  }
  require(sscanf_s(expiry.c_str(), "%4u-%2u-%2uT%2u:%2u:%2u.%3uZ",
          &y, &mon, &d, &h, &m, &s, &ms) == 7);
  time.wYear = static_cast<WORD>(y); time.wMonth = static_cast<WORD>(mon); time.wDay = static_cast<WORD>(d);
  time.wHour = static_cast<WORD>(h); time.wMinute = static_cast<WORD>(m); time.wSecond = static_cast<WORD>(s);
  time.wMilliseconds = static_cast<WORD>(ms);
  FILETIME expires{}, now{}; require(SystemTimeToFileTime(&time, &expires)); GetSystemTimeAsFileTime(&now);
  ULARGE_INTEGER end{}, current{}; end.LowPart = expires.dwLowDateTime; end.HighPart = expires.dwHighDateTime;
  current.LowPart = now.dwLowDateTime; current.HighPart = now.dwHighDateTime;
  require(end.QuadPart > current.QuadPart);
  auto remaining = (end.QuadPart - current.QuadPart) / 10000;
  require(remaining > 0 && remaining <= 3600000); return remaining;
}
// Dynamic API imports keep third-party DLLs out of executable startup. All exact files are
// held before loading; the launcher additionally validates the reviewed PE dependency closure.
struct Api {
  HMODULE library;
  std::vector<HMODULE> modules;
#define AIVORA_API(name) decltype(&name) name##_fn = nullptr
  AIVORA_API(mlt_factory_init); AIVORA_API(mlt_factory_close);
  AIVORA_API(mlt_factory_producer); AIVORA_API(mlt_factory_consumer);
  AIVORA_API(mlt_profile_init); AIVORA_API(mlt_profile_close);
  AIVORA_API(mlt_playlist_new); AIVORA_API(mlt_playlist_close); AIVORA_API(mlt_playlist_blank);
  AIVORA_API(mlt_playlist_append_io); AIVORA_API(mlt_playlist_producer); AIVORA_API(mlt_playlist_service);
  AIVORA_API(mlt_producer_close); AIVORA_API(mlt_producer_properties); AIVORA_API(mlt_producer_seek);
  AIVORA_API(mlt_producer_set_speed); AIVORA_API(mlt_producer_get_length);
  AIVORA_API(mlt_consumer_close); AIVORA_API(mlt_consumer_properties); AIVORA_API(mlt_consumer_connect);
  AIVORA_API(mlt_consumer_start); AIVORA_API(mlt_consumer_stop); AIVORA_API(mlt_consumer_purge);
  AIVORA_API(mlt_consumer_is_stopped); AIVORA_API(mlt_properties_set_int); AIVORA_API(mlt_properties_get);
  AIVORA_API(mlt_properties_get_int); AIVORA_API(mlt_frame_properties); AIVORA_API(mlt_events_register);
  AIVORA_API(mlt_events_listen); AIVORA_API(mlt_events_disconnect);
  AIVORA_API(mlt_event_data_to_frame); AIVORA_API(mlt_frame_get_position);
#undef AIVORA_API
  explicit Api(const std::string& path) {
    library = LoadLibraryExW(wide(path).c_str(), nullptr, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_SYSTEM32);
    require(library != nullptr);
    // Required source patch is part of the reviewed profile. Plain upstream MLT is refused:
    // an empty/held directory is not sufficient to stop late unlisted plugin creation.
    auto revision = reinterpret_cast<int (*)(void)>(GetProcAddress(library, "aivora_mlt_explicit_repository_revision"));
    require(revision && revision() == 2);
#define AIVORA_LOAD(name) name##_fn = reinterpret_cast<decltype(&name)>(GetProcAddress(library, #name)); require(name##_fn != nullptr)
    AIVORA_LOAD(mlt_factory_init); AIVORA_LOAD(mlt_factory_close);
    AIVORA_LOAD(mlt_factory_producer); AIVORA_LOAD(mlt_factory_consumer);
    AIVORA_LOAD(mlt_profile_init); AIVORA_LOAD(mlt_profile_close);
    AIVORA_LOAD(mlt_playlist_new); AIVORA_LOAD(mlt_playlist_close); AIVORA_LOAD(mlt_playlist_blank);
    AIVORA_LOAD(mlt_playlist_append_io); AIVORA_LOAD(mlt_playlist_producer); AIVORA_LOAD(mlt_playlist_service);
    AIVORA_LOAD(mlt_producer_close); AIVORA_LOAD(mlt_producer_properties); AIVORA_LOAD(mlt_producer_seek);
    AIVORA_LOAD(mlt_producer_set_speed); AIVORA_LOAD(mlt_producer_get_length);
    AIVORA_LOAD(mlt_consumer_close); AIVORA_LOAD(mlt_consumer_properties); AIVORA_LOAD(mlt_consumer_connect);
    AIVORA_LOAD(mlt_consumer_start); AIVORA_LOAD(mlt_consumer_stop); AIVORA_LOAD(mlt_consumer_purge);
    AIVORA_LOAD(mlt_consumer_is_stopped); AIVORA_LOAD(mlt_properties_set_int); AIVORA_LOAD(mlt_properties_get);
    AIVORA_LOAD(mlt_properties_get_int); AIVORA_LOAD(mlt_frame_properties); AIVORA_LOAD(mlt_events_register);
    AIVORA_LOAD(mlt_events_listen); AIVORA_LOAD(mlt_events_disconnect);
    AIVORA_LOAD(mlt_event_data_to_frame); AIVORA_LOAD(mlt_frame_get_position);
#undef AIVORA_LOAD
  }
  void register_modules(mlt_repository repository, const Opening& x) {
    auto directory = std::filesystem::path(wide(x.modules));
    for (const auto* name : {L"core", L"avformat", L"sdl2"}) {
      const File* selected = nullptr;
      for (const auto& file : x.runtime) {
        auto path = std::filesystem::path(wide(file.path));
        auto base = path.filename().wstring();
        if (path.parent_path() == directory &&
            (base == std::wstring(L"mlt") + name + L".dll" ||
             base == std::wstring(L"libmlt") + name + L".dll")) {
          require(selected == nullptr); selected = &file;
        }
      }
      require(selected != nullptr);
      auto module = LoadLibraryExW(wide(selected->path).c_str(), nullptr,
        LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_USER_DIRS | LOAD_LIBRARY_SEARCH_SYSTEM32);
      require(module != nullptr); modules.push_back(module);
      auto callback = reinterpret_cast<void (*)(mlt_repository)>(GetProcAddress(module, "mlt_register"));
      require(callback != nullptr); callback(repository);
    }
  }
  ~Api() { for (auto module : modules) FreeLibrary(module); FreeLibrary(library); }
};
struct Playback {
  Api& api; const Opening& opened;
  mlt_profile profile = nullptr; mlt_playlist playlist = nullptr; mlt_consumer consumer = nullptr;
  bool factory = false;
  std::atomic<uint32_t> shown{no_frame};
  std::atomic<bool> decoder_failed{false};
  std::mutex mutex; std::condition_variable frames;
  uint32_t state = 0;
  static void frame_shown(mlt_properties, void* opaque, mlt_event_data event) {
    auto* self = static_cast<Playback*>(opaque);
    auto frame = self->api.mlt_event_data_to_frame_fn(event);
    if (!frame) return;
    auto position = self->api.mlt_frame_get_position_fn(frame);
    if (position < 0 || position >= static_cast<mlt_position>(self->opened.frames)) return;
    const auto index = static_cast<uint32_t>(position);
    const bool selected = std::any_of(self->opened.clips.begin(), self->opened.clips.end(), [&](const Clip& clip) {
      return clip.start <= index && index < clip.end;
    });
    if (selected && self->api.mlt_properties_get_int_fn(self->api.mlt_frame_properties_fn(frame), "test_image")) {
      self->decoder_failed.store(true); self->shown.store(no_frame); self->frames.notify_all(); return;
    }
    self->shown.store(static_cast<uint32_t>(position)); self->frames.notify_all();
  }
  Playback(Api& a, const Opening& x) : api(a), opened(x) {
    try {
      auto repository = api.mlt_factory_init_fn(x.modules.c_str()); require(repository != nullptr); factory = true;
      api.register_modules(repository, x);
      profile = api.mlt_profile_init_fn(nullptr); require(profile != nullptr);
      profile->frame_rate_num = static_cast<int>(x.fps_num); profile->frame_rate_den = static_cast<int>(x.fps_den);
      profile->width = static_cast<int>(x.width); profile->height = static_cast<int>(x.height);
      profile->progressive = 1; profile->sample_aspect_num = profile->sample_aspect_den = 1;
      profile->display_aspect_num = static_cast<int>(x.width); profile->display_aspect_den = static_cast<int>(x.height);
      profile->colorspace = 709; profile->is_explicit = 1;
      playlist = api.mlt_playlist_new_fn(profile); require(playlist != nullptr);
      uint32_t position = 0;
      for (const auto& clip : x.clips) {
        if (clip.start > position) require(api.mlt_playlist_blank_fn(playlist, static_cast<mlt_position>(clip.start-position-1)) == 0);
        auto producer = api.mlt_factory_producer_fn(profile, "avformat", clip.file.path.c_str()); require(producer != nullptr);
        try {
          auto properties = api.mlt_producer_properties_fn(producer);
          require(api.mlt_properties_set_int_fn(properties, "audio_index", -1) == 0);
          require(api.mlt_properties_set_int_fn(properties, "set.test_audio", 1) == 0);
          require(api.mlt_producer_get_length_fn(producer) >= static_cast<mlt_position>(clip.in + clip.end - clip.start));
          require(api.mlt_playlist_append_io_fn(playlist, producer, static_cast<mlt_position>(clip.in),
            static_cast<mlt_position>(clip.in + clip.end - clip.start - 1)) == 0);
        } catch (...) { api.mlt_producer_close_fn(producer); throw; }
        api.mlt_producer_close_fn(producer); position = clip.end;
      }
      if (position < x.frames) require(api.mlt_playlist_blank_fn(playlist, static_cast<mlt_position>(x.frames-position-1)) == 0);
      consumer = api.mlt_factory_consumer_fn(profile, "sdl2", nullptr); require(consumer != nullptr);
      auto properties = api.mlt_consumer_properties_fn(consumer);
      const char* service = api.mlt_properties_get_fn(properties, "mlt_service");
      require(service && std::string(service) == "sdl2"); // Reject factory fallback to SDL1.
      require(api.mlt_properties_set_int_fn(properties, "audio_off", 1) == 0);
      require(api.mlt_properties_set_int_fn(properties, "video_off", 0) == 0);
      require(api.mlt_properties_set_int_fn(properties, "real_time", 1) == 0);
      require(api.mlt_properties_set_int_fn(properties, "terminate_on_pause", 0) == 0);
      // 7.40.0's register implementation returns 1 even after successful registration.
      // The actual listener object below is the success proof, rather than that return value.
      (void)api.mlt_events_register_fn(properties, "aivora-consumer-frame-presented");
      require(api.mlt_events_listen_fn(properties, this, "aivora-consumer-frame-presented", &frame_shown) != nullptr);
      require(api.mlt_consumer_connect_fn(consumer, api.mlt_playlist_service_fn(playlist)) == 0);
      seek(0); state = 0;
    } catch (...) { clear(); throw; }
  }
  void clear() {
    if (consumer) {
      api.mlt_consumer_stop_fn(consumer);
      api.mlt_events_disconnect_fn(api.mlt_consumer_properties_fn(consumer), this);
      api.mlt_consumer_close_fn(consumer); consumer = nullptr;
    }
    if (playlist) { api.mlt_playlist_close_fn(playlist); playlist = nullptr; }
    if (profile) { api.mlt_profile_close_fn(profile); profile = nullptr; }
    if (factory) { api.mlt_factory_close_fn(); factory = false; }
  }
  ~Playback() { clear(); }
  void seek(uint32_t target) {
    require(target < opened.frames);
    require(api.mlt_consumer_stop_fn(consumer) == 0); api.mlt_consumer_purge_fn(consumer);
    auto producer = api.mlt_playlist_producer_fn(playlist);
    require(api.mlt_producer_set_speed_fn(producer, 0) == 0 && api.mlt_producer_seek_fn(producer, static_cast<mlt_position>(target)) == 0);
    shown.store(no_frame); require(api.mlt_consumer_start_fn(consumer) == 0);
    std::unique_lock lock(mutex);
    require(frames.wait_for(lock, std::chrono::seconds(2), [&] { return decoder_failed.load() || shown.load() == target; }));
    require(!decoder_failed.load());
    state = 2; // Only native consumer observation establishes the requested shown frame.
  }
  void act(uint32_t kind, uint32_t target) {
    require(!decoder_failed.load());
    if (kind == 0) { if (api.mlt_consumer_is_stopped_fn(consumer)) throw Failure("Native window stopped"); return; }
    if (kind == 1) {
      require(api.mlt_producer_set_speed_fn(api.mlt_playlist_producer_fn(playlist), 1) == 0); state = 1;
    } else if (kind == 2) { auto at = shown.load(); require(at != no_frame); seek(at); }
    else if (kind == 3) seek(target);
    else if (kind == 4) { require(api.mlt_consumer_stop_fn(consumer) == 0); shown.store(no_frame); state = 3; }
    else throw Failure("Unsupported native operation");
  }
  void status(HANDLE pipe, uint32_t sequence, uint32_t generation) {
    Writer w; w.u32(wire_version); w.u32(2); w.u32(sequence); w.text(opened.session); w.u32(generation);
    w.text(opened.open_id); w.text(opened.identity); w.text(opened.expiry); w.u32(state); w.u32(shown.load()); w.send(pipe);
  }
};
int run(HANDLE control, bool frozen_opening) {
  require_job();
  require(SetDefaultDllDirectories(LOAD_LIBRARY_SEARCH_SYSTEM32 | LOAD_LIBRARY_SEARCH_USER_DIRS));
  HANDLE input = GetStdHandle(STD_INPUT_HANDLE), output = GetStdHandle(STD_OUTPUT_HANDLE);
  require(GetFileType(input) == (frozen_opening ? FILE_TYPE_DISK : FILE_TYPE_PIPE) &&
          GetFileType(output) == FILE_TYPE_PIPE && GetFileType(control) == FILE_TYPE_PIPE &&
          (!frozen_opening || (control != input && control != output &&
            control != GetStdHandle(STD_ERROR_HANDLE))));
  std::atomic<uint64_t> deadline{GetTickCount64() + 10000};
  // Monotonic watchdog kills a hung parser/decoder/pipe too. It never synthesizes frames.
  std::jthread watchdog([&](std::stop_token stopped) {
    while (!stopped.stop_requested()) {
      if (GetTickCount64() >= deadline.load()) TerminateProcess(GetCurrentProcess(), 70);
      Sleep(25);
    }
  });
  Reader first(input); auto x = opening(first);
  if (frozen_opening) {
    LARGE_INTEGER size{};
    require(GetFileSizeEx(input, &size) && size.QuadPart == static_cast<LONGLONG>(first.bytes.size()) + 4);
  }
  deadline.store(GetTickCount64() + expiry_remaining(x.expiry));
  HeldFiles held;
  for (const auto& file : x.runtime) held.protect(file);
  for (const auto& clip : x.clips) held.protect(clip.file);
  auto framework = std::filesystem::path(wide(x.framework));
  require(local_path(framework.wstring()) && local_path(wide(x.modules)) && local_path(wide(x.data)));
  require(std::any_of(x.runtime.begin(), x.runtime.end(), [&](const File& f) { return f.path == x.framework; }));
  auto cookie = AddDllDirectory(framework.parent_path().c_str()); require(cookie != nullptr);
  struct DllDirectoryCleanup { DLL_DIRECTORY_COOKIE value; ~DllDirectoryCleanup() { RemoveDllDirectory(value); } } dc{cookie};
  // Sanitized trusted launcher environment has no provider credentials or user PATH/plugin flags.
  require(_putenv_s("MLT_DATA", x.data.c_str()) == 0 &&
          _putenv_s("AIVORA_MLT_EXPLICIT_MODULES", "1") == 0 &&
          _putenv_s("MLT_CONSUMER_ANTE_POST_ALLOWED", "0") == 0);
  Api api(x.framework); Playback playback(api, x); playback.status(output, 0, x.generation);
  uint32_t last_sequence = 0, current_generation = x.generation;
  std::map<std::string, std::vector<unsigned char>> journal;
  for (uint32_t count = 0; count < 1024; ++count) {
    Reader next(control); require(next.u32() == 3);
    uint32_t sequence = next.u32(), generation = next.u32(), kind = next.u32();
    auto id = next.text(); uint32_t frame = next.u32(); next.end();
    require(sequence > last_sequence && kind <= 4 &&
      (kind == 0 ? generation == current_generation :
        (current_generation < std::numeric_limits<uint32_t>::max() && generation == current_generation + 1)) &&
      ((kind == 0 && id.empty()) || (kind != 0 && id.size() == 36 && id.rfind("pvc_", 0) == 0)) &&
      (kind == 3 ? frame < x.frames : frame == 0));
    last_sequence = sequence;
    // The main adapter prevents replay. Host also refuses any repeated mutation ID; never executes twice.
    if (kind != 0) { require(journal.size() < 256 && !journal.contains(id)); journal.emplace(id, next.bytes); }
    if (kind != 0) current_generation = generation;
    playback.act(kind, frame); playback.status(output, sequence, current_generation);
    if (kind == 4) return 0;
  }
  throw Failure("Native command limit exhausted");
}
} // namespace aivora
int main(int argc, char** argv) {
  try {
    // Production sidecar passes one inherited command pipe handle. The initial
    // OPEN already exists in an immutable held disk handle before CreateProcess.
    // Legacy source-only anonymous-stdin wire remains compatible when argc=1.
    if (argc == 1) return aivora::run(GetStdHandle(STD_INPUT_HANDLE), false);
    aivora::require(argc == 2);
    const std::string option(argv[1]), prefix("--control-pipe=");
    aivora::require(option.rfind(prefix, 0) == 0 && option.size() > prefix.size() && option.size() <= 40);
    const auto digits = option.substr(prefix.size());
    aivora::require(std::all_of(digits.begin(), digits.end(), [](char c) { return c >= '0' && c <= '9'; }));
    const auto value = std::stoull(digits);
    aivora::require(value > 0 && value <= std::numeric_limits<uintptr_t>::max());
    return aivora::run(reinterpret_cast<HANDLE>(static_cast<uintptr_t>(value)), true);
  }
  catch (...) { return 71; } // No paths, media, credentials or diagnostics on the status pipe.
}

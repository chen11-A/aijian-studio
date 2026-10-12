cmake_minimum_required(VERSION 3.24)
project(aivora_mlt_preview_host LANGUAGES CXX)

# SOURCE ONLY. No FetchContent, download, install, or runtime profile admission.
# Supply the reviewed MLT 7.40.0 headers and matching pthread headers explicitly.
if(NOT WIN32 OR NOT MSVC OR NOT CMAKE_SIZEOF_VOID_P EQUAL 8)
  message(FATAL_ERROR "This source target requires reviewed Windows x64 MSVC inputs")
endif()
if(NOT DEFINED AIVORA_MLT_INCLUDE_DIR OR NOT DEFINED AIVORA_PTHREAD_INCLUDE_DIR)
  message(FATAL_ERROR "Explicit reviewed MLT/pthread include roots are required")
endif()
add_executable(aivora-mlt-preview-host host.cpp)
target_compile_features(aivora-mlt-preview-host PRIVATE cxx_std_20)
target_include_directories(aivora-mlt-preview-host PRIVATE
  "${AIVORA_MLT_INCLUDE_DIR}" "${AIVORA_PTHREAD_INCLUDE_DIR}")
set_property(TARGET aivora-mlt-preview-host PROPERTY MSVC_RUNTIME_LIBRARY "MultiThreaded")
target_compile_definitions(aivora-mlt-preview-host PRIVATE
  WIN32_LEAN_AND_MEAN NOMINMAX UNICODE _UNICODE _WIN32_WINNT=0x0A00)
target_compile_options(aivora-mlt-preview-host PRIVATE /W4 /WX /permissive- /guard:cf /utf-8)
target_link_options(aivora-mlt-preview-host PRIVATE /DYNAMICBASE /NXCOMPAT /HIGHENTROPYVA /guard:cf /MANIFEST:NO)
target_link_libraries(aivora-mlt-preview-host PRIVATE bcrypt)
add_library(aivora-owned-mlt-job STATIC owned_job.cpp sealed_launch.cpp)
target_compile_features(aivora-owned-mlt-job PRIVATE cxx_std_20)
set_property(TARGET aivora-owned-mlt-job PROPERTY MSVC_RUNTIME_LIBRARY "MultiThreaded")
target_compile_definitions(aivora-owned-mlt-job PRIVATE
  WIN32_LEAN_AND_MEAN NOMINMAX UNICODE _UNICODE _WIN32_WINNT=0x0A00)
target_compile_options(aivora-owned-mlt-job PRIVATE /W4 /WX /permissive- /guard:cf /utf-8)
target_link_libraries(aivora-owned-mlt-job PRIVATE bcrypt)
# No MLT/SDL/FFmpeg import libraries. System-only startup precedes held-file validation
# and explicit dynamic loading. Actual PE import closure and binary SHA remain unverified.

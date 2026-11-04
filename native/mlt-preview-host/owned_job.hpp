// SPDX-License-Identifier: Apache-2.0
#pragma once
#include <windows.h>
#include <string>
#include <utility>
#include "sealed_launch.hpp"

namespace aivora {
// Main-only native bridge owns this object BEFORE start(). start failure does not prove cleanup;
// retain object and sealed files until kill_and_wait() confirms zero active processes.
// Renderer, HTTP and arbitrary user paths must never construct this ownership bridge.
class OwnedJob {
  std::unique_ptr<SealedLaunch> launch_;
  HANDLE job_ = nullptr, process_ = nullptr, input_ = nullptr, output_ = nullptr, errors_ = nullptr;
public:
  explicit OwnedJob(std::unique_ptr<SealedLaunch> launch) : launch_(std::move(launch)) {}
  OwnedJob(const OwnedJob&) = delete;
  OwnedJob& operator=(const OwnedJob&) = delete;
  ~OwnedJob();
  // The owned sealed files outlive every partial start/unknown termination. No bare path start.
  void start();
  HANDLE input() const { return input_; }
  HANDLE output() const { return output_; }
  HANDLE errors() const { return errors_; }
  bool zero_active() const;
  // Never equate root exit, sent signal, EOF or a UI terminal state with this proof.
  bool kill_and_wait(DWORD timeout_ms);
};
}

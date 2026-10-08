# External local media tools: development/DRAFT only

This is a source checkpoint for later Windows acceptance, not a verified installed
feature or a change to the already-passing `ce1a2a4` DEVELOPMENT_CORE delivery.
No FFmpeg files are copied, downloaded, bundled or redistributed by this feature.
No formal export, licence, product release or real-AI approval is added.

## Selection and capability

Settings → 本地媒体工具 · DRAFT opens a native main-owned directory picker.
Renderer IPC takes no path arguments. Main checks the original window, frame,
document and authenticated client before and after asynchronous work. Navigation,
renderer destruction, duplicate actions, cancellation, timeouts and unknown
mutation responses fail closed. Settings-card cleanup invokes a path-free native
cancellation that revokes only a still-unconfirmed selection. The native dialog
may remain open until the user closes it; its late result is then discarded.
Already-submitted settings cannot be rolled back by this cancellation and are
read back instead. Unknown mutations are read back, never replayed.

Authenticated routes are `GET /api/v1/local-media-toolchain/status` and
`PUT`/`DELETE /api/v1/local-media-toolchain/selection`. The PUT directory is supplied
by native main, never a renderer preference. Strict native and renderer decoders
are tested with the same serialized Pydantic fixtures. These routes are absent from
the unauthenticated/public app.

Only the existing `windows-x86_64-gyan-full-8.1.2-dev` profile is accepted:

- FFmpeg: `ad8f211bc894755e0061c55ab280ae00e8d3d4f15a8cc4372b24cfa247b5942e`
- FFprobe: `9df3b0b5275e830961df6d94e1f7a71121a7abd5ff708e9fec8a0b6084a55015`
- Version 8.1.2, static full build, GPL-3.0-or-later, DEVELOPMENT_ONLY

The installed lock must agree with these fixed identities. Tool hashes, matching
version/configuration and actual libx264/AAC/filter listings are checked before a
selection is accepted. No arbitrary lock file, newer version, launcher alias, URL,
PATH or frozen environment override can admit another pair.

The record contains only the directory and pinned profile/hash identity, never a
saved readiness boolean. Windows supplies LocalAppData through an OS folder API;
the file is `Aivora/machine-settings/local-media-toolchain.json`, outside the
project workspace and portable backup. Invalid new selection preserves the old
record. Clear removes the selection record, not the external tools. Workspace
schema stays 38. Every status request revalidates actual files, and every real job
admission revalidates again. Each admitted job keeps immutable tool paths; later
settings changes affect subsequent jobs only.

One service supplies both selected-video probe and DRAFT export/continuous saved
composition preview. The original production asset page exposes an exact-version
video probe action and a persisted-evidence read action through authenticated
main/preload/client IPC. Evidence is matched against project, asset, version,
original hash and byte size. The nested source identity retains the backend's
`sha256:` prefix. Unknown probe writes are only reconciled by reading the same
version; an inconclusive/404 read retains a navigation-persistent retry lock.
Another probe requires an explicit user recovery acknowledgement. Existing
development fallback discovery remains available
when no selection exists. `BUNDLED` means a frozen runtime's admitted bundled pair;
`DEVELOPMENT_OVERRIDE` identifies the existing explicit unfrozen root-and-lock
configuration, and `DEVELOPMENT_LOCAL` means other unfrozen local discovery.
The latter two are labelled “开发环境指定工具” and “开发环境本地工具”, without
asserting that the installer contains FFmpeg. Frozen legacy environment overrides
remain rejected even when a
valid selection exists. Formal ProductExport discovery remains bundled-only and
its release allowlist stays closed.

The renderer shares status, request deduplication and mutation locking across
settings/probe/preview/export. It refreshes on entry/focus or explicit request,
without periodic per-panel hashing. Readiness never follows bridge presence or
the build-profile flag. New actions fail closed on unknown status; existing
verified output viewing remains available. The development-core artwork exclusions
are unchanged.

## Execution boundary

`external_media_process.py` uses only Python stdlib; no build-only PE package is
needed in the frozen runtime. It rejects UNC/device paths, traversal, aliases,
ambiguous names, network/unknown volumes, junctions/reparse points, hard-linked
executables and unexpected app-local DLL/manifest inputs. Both exact executable
hashes and bounded x64 PE import/delay-import tables are checked before either
image can execute.

Windows ancestor directory and executable handles remain live through the whole
child process lifetime, denying writes/deletes. Each launch rechecks the same pair.
Static imports are restricted to the observed Windows system/API-set dependencies.
Selected images run under the existing private kill-on-close Job Object, assigned
before the suspended child resumes. A per-child opt-in process mitigation requires
Microsoft-signed DLLs, prefers System32, and rejects remote/low-integrity image
loads; unsupported policy fails closed, with no weaker retry. Defaults for existing
formal callers are unchanged. See Microsoft's [process creation attributes](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute)
and [file sharing semantics](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew).

A fresh protected-DACL directory beneath OS-known LocalAppData holds the process
cwd and temp files. Before creation, the held parent volume must advertise
FILE_PERSISTENT_ACLS; before any resource write or process use, the held new
directory must pass a second volume check and actual security-descriptor readback:
present/protected DACL and only the expected inheritable owner-rights/SYSTEM
full-access ACEs. This avoids treating successful directory creation on FAT/exFAT
as proof of privacy. Existing user directory permissions are not changed.
See [volume flags](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getvolumeinformationbyhandlew)
and [handle-based security readback](https://learn.microsoft.com/en-us/windows/win32/api/aclapi/nf-aclapi-getsecurityinfo).
Only OS-derived SYSTEMROOT/WINDIR/SYSTEMDRIVE and the private
TEMP/TMP are passed. Parent PATH, COMSPEC, FFREPORT, profile, credential and loader
environment variables are not inherited. Subtitle resources are prepared inside
this private session for external DRAFT work. Stdout+stderr are bounded; stderr on
real probe calls is rejected, including a nominal zero exit. Timeout, cancellation
and failure close the exact job and descendants. Existing source/output hashes,
rights declaration, restricted-rights refusal, saved assembly identity, no-overwrite,
literal subtitle restrictions and immutable DRAFT receipts remain in force.

Host-safe mocks and static PE inspection cannot establish actual Windows locking,
DACL, mitigation, loader or export behavior. The native acceptance plan below is a
mandatory next gate before describing this feature as usable on Windows.

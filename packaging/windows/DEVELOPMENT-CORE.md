# AIVORA Dev Core — Windows x64 development installer

This unsigned development build is a limited core desktop installer, not a
completed media-production release. The development product identity and user
data directory are separate from the future AIVORA release.

## Operating-system prerequisite

This profile requires Windows 10 or later, x64, consistent with the
[exact Electron 43.2.0 platform boundary](https://github.com/electron/electron/blob/v43.2.0/README.md#platform-support).
The installer fails closed when the Windows major-version registry value is
missing or below 10; the frozen development sidecar checks the runtime OS too.
Neither check establishes support for every Windows build or edition.

Windows supplies the Universal CRT. Microsoft's
[UCRT deployment guidance](https://learn.microsoft.com/en-us/cpp/windows/universal-crt-deployment?view=msvc-170#local-deployment)
states that Windows 10/11 use the system UCRT even when an application-local copy
exists. Pinned PyInstaller 6.22.3 `depend/dylib.py` describes the same boundary.
The development-only freeze therefore omits only the 43 reviewed UCRT/API-set
names in `system-ucrt-inputs.json`, after checking their actual source is the
Windows system directory or an x64 Windows SDK UCRT directory. A new name or
unclassified origin aborts; VCRuntime and all other dependencies remain subject
to the exact-input distribution check.

The frozen receipt records every native input origin/hash and each omitted
file's PE version/hash. The installed smoke checks the real sidecar's loaded
`ucrtbase.dll` resolves to Windows System32 and records its version/hash and OS
build. This is checked execution evidence, not a redistribution permission for
Microsoft files. No OS runtime is downloaded or installed by this installer.

## Available scope

- Local projects, episodes, text-source import, editable scripts and manual
  creative/storyboard records, with local persistence
- Original media byte import and supported source playback, without treating an
  unprobed audio/video file as validated editing input
- Existing original interface layout, with neutral build-only placeholders for
  reference artwork whose redistribution provenance is unresolved

## Explicit limitations

- FFmpeg/FFprobe command-line tools are not included. New composition rendering
  and DRAFT MP4 export are unavailable. This is not the full MP4-capable installer.
- Real AI sign-in/inference is not established by this build or its synthetic CI
  smoke. No account, credential, provider configuration or user workspace is
  bundled. Real authorization and any provider costs remain user decisions.
- No signing certificate is used. Windows may warn about unsigned software;
  do not disable security protections to install it.
- Existing recognized AIVORA or Dev Core installation/data causes installation
  to stop. Upgrade backup/restore is not implemented or claimed. Uninstall is
  intended to preserve the user workspace; data cleanup is a separate action.
- Hosted-runner installation and native smoke are bounded engineering evidence,
  not clean standard-user, all-Windows-version or full user-workflow acceptance.

## Provenance and evidence

`DEV-CORE-INPUTS.json` binds one source commit to each staged file SHA. The
installer checksum is in `INSTALL-RESULT.json` and `SHA256SUMS`. The artifact is
uploaded only after Windows sidecar startup/persistence and actual installed
Electron save/reopen checks, a fail-closed reinstallation check and an uninstall
data-preservation check pass. No formal GitHub Release is created.

The app includes available component license texts and explicit dependency-input
inventories under `resources/licenses`. Those inventories must not be described
as a legal opinion or as formal release approval. Formal media release still
requires the original reviewed-source/NOTICE/profile gates. The development
pipeline does not alter them.

The second preparation checkpoint pins the exact Python companion licence texts
and maps native DLL/PYD bytes back to the original verified archives. A complete
mapping is a factual material-hash check, not whole-installer legal approval.
The development installer now uses a small first-party NSIS script with only
core/zlib instructions. It does not embed StdUtils, Nsis7z, UAC or other NSIS
resource plug-ins. The exact core compiler and its supplied COPYING text are
pinned; Electron's own supplied licence texts must also remain intact. The final
gate regenerates the script and rechecks its input-file, installer and licence
hashes. Unknown native bytes or missing material still block binary upload while
native build/tests and bounded non-binary diagnostic evidence can proceed.

Installation refuses recognized existing installation/data and occupied target
directories. Uninstall removes only the enumerated program files and then empty
directories. User-created files not in that list are retained; the Windows
synthetic acceptance specifically verifies that behavior and workspace retention.

The workflow is restricted to `codex/windows-installer-dev-20261008`, uses the
standard Windows hosted runner with a 35-minute job timeout and one-day artifact
retention, and never uploads tool caches, workspaces, credentials or test profiles.

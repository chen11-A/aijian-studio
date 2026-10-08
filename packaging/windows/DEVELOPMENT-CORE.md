# AIVORA Dev Core — Windows x64 development installer

This unsigned development build is a limited core desktop installer, not a
completed media-production release. The development product identity and user
data directory are separate from the future AIVORA release.

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

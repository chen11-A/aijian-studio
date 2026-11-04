# Windows development-core installer: actual runner checkpoint

## Verified result

The [Windows development-core workflow run](https://github.com/chen11-A/aijian-studio/actions/runs/37768980374)
completed successfully for source candidate
`ce1a2a4d368f24626e7d940d974e85723a90162a`, on Windows Server build 26100.
This supersedes the earlier **not-run** status for this limited development
pipeline, not the formal Windows release acceptance checklist.

- Installer: `AIVORA-Dev-Core-0.1.0-dev.core-win-x64.exe`
- Size: **189,832,110 bytes** (181.04 MiB)
- SHA256: `7a93c77e79d7eaceb902222f4db212a9c7102cd4d40ce13338d127ac4f160059`
- Actual Windows frozen-sidecar creation, authenticated project/source/episode
  persistence, process shutdown and fresh-process exact readback: **PASS**
- Installer construction and fresh per-user installation: **PASS**
- Installed Electron startup, exact packaged-byte verification, sandboxed IPC,
  synthetic save, full shutdown/relaunch and exact readback: **PASS**
- Existing-install/data retry: **safely aborted**
- Uninstall removed installed application files and preserved the synthetic
  workspace and an additional user-created file: **PASS**
- Exact native-input and shipped licence-material verification: **PASS**

Both artifact-upload steps were deliberately disabled. There is **no downloadable
installer artifact from this run**. The checksum above identifies the tested
ephemeral output, not an available download. Delivery needs an authorized rebuild
with storage-cost scope resolved; its resulting installer needs its own tested
checksum and receipt.

## Native-input boundary

The final frozen inventory contains 25 exact pinned Python native inputs, six
exact pinned wheel native inputs and one generated sidecar executable bound to
the source/freezer receipt: **32 files, zero unknown native inputs**.

Earlier inherited runner search paths collected 43 extra UCRT/API-set files.
The development freeze now restricts subprocess PATH to pinned Python, Windows
System32 and Windows. In the successful run none of those 43 incidental files
was collected, so no source-origin allowlist expansion was needed. The exact
origin of the earlier incidental copies was not established and is not inferred
from their names.

The actual installed-sidecar smoke required its loaded `ucrtbase.dll` to resolve
to Windows System32. The detailed module version/hash receipt was generated but
was not in this run's selected log-output list. Windows 10+ is an explicit
development installer/runtime prerequisite, consistent with the
[pinned Electron platform boundary](https://github.com/electron/electron/blob/v43.2.0/README.md#platform-support)
and [Microsoft's system-UCRT behavior](https://learn.microsoft.com/en-us/cpp/windows/universal-crt-deployment?view=msvc-170#local-deployment).
This does not approve redistribution of Microsoft files or establish support for
every Windows 10/11 build.

The two earlier installed-smoke failures did **not** prove missing declaration
files. The harness supplied POSIX paths to an ASAR library whose Windows traversal
uses native separators. Full local builder output contained all 91 exact staged
application files; a real-ASAR Windows-path regression and subsequent actual
Windows run confirmed the normalized-path correction. Hash checks were retained.

## Remaining acceptance and delivery requirements

1. Resolve zero-extra-cost artifact storage or obtain explicit cost approval;
   rebuild, retain and deliver the tested installer plus checksum/evidence.
2. Test installation, startup, actual workflows and uninstall on clean standard
   user Windows 10/11 desktops. A hosted Windows Server runner is not that evidence.
3. Implement and verify upgrade backup/restore before allowing existing-data
   upgrades. Current development installers intentionally abort instead.
4. Complete the separate media licensing/source/NOTICE and release-approval gates
   before distributing encoders. This core build has no FFmpeg/FFprobe, no new
   composition rendering and no DRAFT MP4 export.
5. Complete real user-authorized AI login/inference acceptance separately. No real
   account, credentials or provider calls were used for this checkpoint.
6. Resolve formal release input approvals, signing and the existing media-profile
   schema mismatch. No release gate was bypassed and no formal Release was made.

The builder remains unsigned. Source UI/theme and source artwork remain intact;
only this limited build substitutes neutral placeholders for unresolved artwork.

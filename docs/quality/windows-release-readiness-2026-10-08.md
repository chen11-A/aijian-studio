# Windows release readiness — 2026-10-08, 08:50 UTC

Windows preparation can continue while real AI sign-in is blocked. Local editing,
subtitle rendering, saved-composition preview, packaging closure and data safety
do not require a provider account. An AI-enabled release still needs its own
authorized sign-in/inference acceptance; synthetic checks do not establish it.

This review uses the current `repair/runtime-baseline` working tree over
`63c76db96ac64fb3dc960af6bda139aed3a6ec10`, including uncommitted changes.
It does not adopt the September c19 snapshot as the current candidate. No Windows
program, installer, signing tool or user computer was operated in this review.

## Completed cross-platform preparation

- Reproduced and fixed an actual rebuild failure: the contracts builder compiled
  five declared modules but required exactly seven files. It now derives the
  exact module list from validated public source exports and requires precisely
  eleven files for today's five modules. Unexpected emitted files and unsafe
  source-export paths still fail. The two new contracts currently contain types;
  the demonstrated failure was package construction, not a proven desktop
  startup failure caused by their absence.
- Added `scripts/build-desktop-runtime.mjs`. It compiles only main/preload and
  their dependency closure into a new directory, builds the contracts package,
  copies the canonical runtime metadata and rejects test artifacts. Static
  CommonJS resolution may leave the application tree only for Node built-ins or
  Electron. Existing shared development `dist` is untouched.
- The new builder records the same `candidate_head` used by existing staging,
  input-source hashes and every output SHA/destination. Source or HEAD changes
  during the build abort it. Its JSON is preparation evidence, not a replacement
  for the approved release-input manifest or independent Electron smoke receipt.
- An isolated Linux build emitted **79 desktop JS files, 11 contracts files and
  one app package file**. The graph resolved 80 reachable JS files. Real Node
  CJS and ESM loads passed for all five package exports. No Electron or Windows
  execution is implied.
- `packaging/windows/audit-readiness.py` is a read-only, offline audit. All 40
  pinned prerequisite files rehashed successfully: **386,949,852 bytes**. The
  four prerequisite source-lock bindings, isolated npm package/lock versions,
  workspace pnpm 11.9.0 and builder's Electron 43.2.0 ZIP hash agree. It does not
  rewrite the cache receipt, install packages or fetch anything.
- The exact 31 cached wheels contain 49 license/notice files, now enumerated with
  SHA-256. These include build dependencies and vendored components. This is a
  prerequisite inventory, **not the final shipped-sidecar SBOM**.
- Focused checks: two Node packaging tests, fifteen Windows-preparation Python
  tests, eight backup/DRAFT regressions, focused ESLint/Prettier and Ruff on the
  new tools/tests pass. `sidecar.py` syntax passes; its whole-file Ruff check still
  reports three inherited E501 lines and existing formatter drift outside the
  new inventory block. These were not suppressed or broadly reformatted.
  The backup tests include actual synthetic encoding and restored DB/media
  readback. This is not a whole-repository green status.

## Remaining acceptance gates, in execution order

| Gate                                | Concrete missing evidence / impact                                                                                                                                                                                                                                                      | Smallest next step                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authorized Windows host             | Current execution is Linux x64; no Windows or Wine. PyInstaller cannot establish Windows DLL loading here.                                                                                                                                                                              | Authorized Windows x64 build environment, portable pinned Python/Node, PowerShell and Git on PATH; no administrator install is required by our scripts. A separate clean standard-user QA environment must have no developer Node/Python/FFmpeg prerequisite.                                                                                                     |
| Windows dependency install/cache    | The 40 downloads do not include the complete Windows workspace npm store. Current Linux workspace has no installed `@rolldown/binding-win32-x64-msvc@1.2.1` or `lightningcss-win32-x64-msvc@1.33.0`; both are pinned in `pnpm-lock.yaml`. Builder cache extraction/routing is untested. | Restore workspace dependencies against the frozen pnpm lock on Windows, and isolated builder dependencies against its npm lock. Use verified official tool archives; inspect any new install scripts. Prove cache completeness before claiming offline builds. Reuse cross-platform JS/renderer output only when bound to the same frozen candidate and manifest. |
| Frozen backend                      | `aijian-sidecar.exe` and its `_internal` closure have never been produced or run on Windows.                                                                                                                                                                                            | Run `freeze-sidecar.py`, then `smoke-frozen-sidecar.py` with synthetic data. Verify Windows credential backend, stdin-close supervision, clean shutdown, source hashes and DLL imports.                                                                                                                                                                           |
| Full production resource tree       | Current template has 23 required layout roles, 24 entries with empty SHA and 24 unapproved entries. It is intentionally non-executable; its candidate SHA is historical.                                                                                                                | Build clean app/renderer; bring frozen sidecar bytes into one candidate; inventory all files, including both new contract modules, every renderer asset, subtitle font/OFL and third-party notices. Fill the real candidate SHA and exact hashes/approvals. Never toggle the template's flag alone.                                                               |
| Media release contract and evidence | The sole Gyan profile is `DEVELOPMENT_ONLY`; preflight requires `RELEASE_APPROVED`, but both backend media models reject that state. Current release staging cannot succeed, even if manifest labels change.                                                                            | Select and review the exact media distribution route, then implement a coordinated approved-profile schema/validation with tests. Preserve the current gate until review. Check actual Windows encoders/decoders, audio mix, drawtext/font and saved output playback.                                                                                             |
| Actual packaged desktop             | No Windows packaged Electron CJS/ESM receipt, native window or installed-resource readback exists. Node-only resolution cannot prove sandboxed preload, ASAR, native keyring or Windows filesystem behavior.                                                                            | In the exact final package structure, independently verify main/preload/contracts, renderer, sidecar executable/args/cwd, `AIJIAN_RESOURCE_ROOT`, media/font hashes, save/reopen, Chinese paths, cancel/recovery and shutdown. Keep sandbox/context isolation/web security enabled.                                                                               |
| Installer and recovery              | NSIS `customInit` deliberately aborts on recognized old installation or `%APPDATA%/AIVORA` data. Backup-before-replacement, rollback and uninstall behavior are unverified.                                                                                                             | Preserve the abort. Complete current-data backup/restore behavior below and actual historical identity mapping, then run staged-byte verification and the controlled installer build. Test fresh install, upgrade failure, restore, uninstall and data retention using one installer SHA.                                                                         |
| Release distribution                | Final source mapping, dependency/SBOM/NOTICE package, identity/rights review and signing/distribution decision are absent.                                                                                                                                                              | Review the exact final artifact and agree distribution scope. Signing, certificate acquisition, publication and live provider calls remain separate decisions.                                                                                                                                                                                                    |

[PyInstaller's multi-platform instructions](https://pyinstaller.org/en/stable/usage.html#supporting-multiple-operating-systems)
require a platform-specific build/test process. [electron-builder's cross-platform
guidance](https://www.electron.build/v26/docs/features/multi-platform-build/) does
not turn a Linux-only artifact into Windows runtime/installer acceptance.

### Completed backup-inventory correction and remaining scope

`draft_export_runtime.py` creates `workspace/draft-export-work` and removes its
per-operation directory afterward, leaving the parent. The earlier backup
inventory rejected that parent even when empty. This was reproduced and fixed
narrowly: the known parent is accepted only as a plain, empty directory; its
identity remains in the before/after inventory. A real successful synthetic
DRAFT, stopped-runtime backup, separate SQLite integrity/assembly/media restore
and external-output preservation now pass. Nonempty interrupted staging, unknown
roots, wrong file types, symlinks, reported junctions, new staged bytes and a
replaced directory identity still fail without a completion receipt.

The fix does not recursively copy or delete interrupted staging. Its recovery
policy still needs a deliberate design. The successful test holds the existing
workspace-owner lock around the helper; `backup_workspace` itself still only
takes its SQLite writer reservation. Installer/process-level stopped-workspace
exclusion and Windows failure/restore acceptance remain open. NSIS still aborts
on old installs/data, so this does not enable or claim working upgrades.

Retained composition previews live in `userData/composition-previews`, outside
`userData/workspace`; external user-selected DRAFT outputs can be elsewhere.
Workspace-only restore does not restore those files. Define the backup scope and
missing-output recovery truthfully. OS-protected credentials must not be dumped
into this backup or treated as recovered merely because their references exist.
See [the upgrade contract](../../packaging/windows/UPGRADE-BACKUP-CONTRACT.md).

## Exact distribution-material inventory still needed

There is no final shipped Windows artifact, so a final shipped-input licensing
conclusion cannot be given. The following is evidence collection, not legal
approval or a claim that all listed material is a statutory requirement.

- **FFmpeg/FFprobe:** the cached Gyan 8.1.2 full pair has the hashes in
  `config/media-toolchain-lock.json`. Its own README identifies GPL v3 and FFmpeg
  commit `38b88335f9`; the recorded build includes static external libraries and
  `libx264`/`libx265`. Missing: matching complete source/patch/build material,
  corresponding external-component versions/source/licenses, reviewed notices
  and an actual source-provision method. FFmpeg's [official licensing page](https://ffmpeg.org/legal.html)
  explains the GPL effect of enabled components; its [external-library
  documentation](https://ffmpeg.org/general.html#x264) describes x264's GPL
  dependency. A README/commit URL alone does not demonstrate compliance for the
  actual full static binaries. [Gyan's supplier page](https://www.gyan.dev/ffmpeg/builds/)
  and the exact downloaded archive are the provenance inputs, not legal signoff.
- **Electron 43.2.0:** the pinned Windows ZIP already contains `LICENSE` (SHA
  `5154e165bd6c2cc0cfbcd8916498c7abab0497923bafcd5cb07673fe8480087d`)
  and `LICENSES.chromium.html` (SHA
  `b911161e6594ec76b872498b423c54406168f2974e0d407a847f7de1e5ff94dd`).
  Verify their retention and user accessibility in the real builder output.
- **Python and frozen packages:** preserve the pinned CPython distribution's
  license material, inspect the actual PyInstaller output and map each shipped
  package/native dependency to source/version/license. The new wheel inventory
  hashes existing license files; a freezer may not carry those files forward.
  [PyInstaller's license and exception](https://pyinstaller.org/en/v6.22.3/license.html)
  do not establish the application's other dependency obligations.
- **Renderer/runtime packages:** current root `NOTICE` names only keyring and
  promises additional notices later. A final reviewed inventory must account for
  bundled React, React DOM, scheduler and any other code actually emitted, along
  with package license texts. Build tools belong in build provenance unless
  actually shipped; do not label all npm/dev packages application dependencies.
- **Fonts:** existing Noto CJK SC Regular 2.004 has SHA
  `2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b`;
  its OFL text has SHA
  `6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2`.
  The font metadata contains Adobe's 2014–2021 copyright. Preserve the actual
  copyright/license information and inventory the Bold font also emitted by the
  renderer. The subtitle font's two layout roles now exist, but that is not
  installed-resource readback or full font-license review. Upstream: [Noto CJK](https://github.com/notofonts/noto-cjk).
- **Illustrations/design crops:** the existing asset manifest describes several
  reference crops as “demo only”; the production renderer still emits some of
  those exact bytes. Record their redistribution rights or replace/remove them
  for the release candidate. Do not infer distribution permission from design
  reference authorization. This does not invalidate local functional tests.

## Reproducible preparation commands

From the repository root, with existing pinned tools:

```sh
node --test scripts/build-runtime.test.mjs
python -m unittest discover -s packaging/windows -p 'test_*.py' -v
python packaging/windows/audit-readiness.py --cache /workspace/shared/aivora-windows-toolchain
node scripts/build-desktop-runtime.mjs --out-dir /absolute/new/preparation/app
```

The audit prints JSON without modifying anything. The builder's stdout provides
hashes and proposed `app/` destinations; keep it outside the application tree.
The Linux evidence from this review is in the task workspace under
`/workspace/shared/aivora-readiness-20261008/`, not a published download or an
approved installer input. Regenerate it after source changes.

On an **authorized Windows build machine**, after placing the verified Python
interpreter and copied tool cache at the explicit paths below:

```powershell
& C:\AIVORA-build\python\python.exe .\packaging\windows\audit-readiness.py --cache C:\AIVORA-build\toolchain
& C:\AIVORA-build\python\python.exe .\packaging\windows\freeze-sidecar.py --cache C:\AIVORA-build\toolchain --output C:\AIVORA-build\sidecar-001
& C:\AIVORA-build\python\python.exe .\packaging\windows\smoke-frozen-sidecar.py --resources C:\AIVORA-build\sidecar-001\resources
```

`sidecar-001` must not exist and must be outside the checkout. The component
freeze does not copy FFmpeg or grant media approval. Font resources enter the
final runtime through their explicit stage-manifest roles. Build the app with
the new isolated builder and the renderer using Vite's explicit new output
directory after the Windows dependency restore. Put all actual release inputs
under the same frozen candidate and generate the complete reviewed manifest.

Only after those gates use the existing chain, without weakening it:

1. `release-preflight-windows.ps1 -Purpose Release`
2. `stage-windows-runtime.ps1`, with the exact independent Electron smoke receipt
3. `verify-windows-stage.ps1`, with pre-pinned stage/manifest SHA values
4. The isolated fixed electron-builder, `--win nsis --x64 --publish never`
5. [Clean standard-user install/upgrade/uninstall verification](../../packaging/windows/INSTALL-VERIFY.md)

No step in this review ran that release chain. Existing 173 Python type
diagnostics, the legacy locked-media fixture mismatch and old c19 counts remain
unresolved recorded findings; they were not relabeled as passes. They should be
triaged by current reachable functionality rather than used to claim every old
artifact failure blocks local editing. Conversely, failed packaging closure,
the broader backup/installer integration, unsupported release-media schema and
missing Windows acceptance directly affect delivery and cannot be dismissed as
clutter.

# AIVORA standalone sidecar EXE candidate (static handoff)

Status 2026-09-28: review candidate only. No PyInstaller installed or run here; no EXE, release receipt, provider call, database access, or installer test is claimed. The source worktree is dirty at HEAD `211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2`; `SOURCE.json` identifies this snapshot's relevant bytes. Before building, the release owner must freeze a complete source tree and all wheels, then update the receipt with every changed input.

## Entry and layout

- `entry.py` maps no arguments to `aijian_api.sidecar.run()` and all ordinary arguments to `backup_command()`. The supported offline CLI is `--backup-workspace <absolute existing workspace> --output <absolute new backup directory>`; success prints one JSON `backup-complete` receipt and exits 0. This is the new helper intended to run before an upgrade overwrites the old installation.
- `multiprocessing.freeze_support()` runs before any product import or CLI parsing. PyInstaller requires this for Windows spawn because frozen `sys.executable` points back to this EXE. Only two exact `-m` child commands are dispatched: `aijian_api.fake_agent_subprocess` with no module arguments and `aijian_api.fake_provider_worker` with two paths. These match the existing `sys.executable` call sites, whose meaning changes after freezing. No general `-m`, `-c`, Python interpreter, or arbitrary module dispatcher is exposed. Validate multiprocessing spawn and both child protocols in the frozen EXE before accepting this adaptation.
- `aijian-sidecar.spec` proposes PyInstaller 6.22.3, Python 3.12, Windows x64, `onefile`, `console=True`, `upx=False`. The console bootloader preserves stdin/stdout/stderr pipes; Electron uses `windowsHide` and reads exactly one handshake line. `keyring.backends` and `uvicorn` dynamic modules are collected; the build log and runtime test must still prove closure. The application package is not installed by `uv` (`package=false`), so the spec adds `services/api/src` to `pathex`.
- Expected single output: `<distpath>/aijian-sidecar.exe`, staged as `resources/sidecar/aijian-sidecar.exe`. Onefile extracts embedded Python/DLL files to a per-process `_MEI...` folder under the OS temp location and should clean it after normal exit. It does **not** embed the media lock or FFmpeg. The installed tree supplies `resources/config/media-toolchain-lock.json` and approved `resources/media/{ffmpeg,ffprobe}.exe` separately. This layout follows the current `runtime-layout.json` and `runtime_resources.py` binding to `sys.executable` and `AIJIAN_RESOURCE_ROOT`.
- Electron sets `AIJIAN_DATA_DIR` to its `userData/workspace` and `AIJIAN_RESOURCE_ROOT` to `process.resourcesPath`; the frozen sidecar validates both. The package contains no user database, secret, credential value, media, or prefilled workspace. Python dependencies come from reviewed `uv.lock`; `PyInstaller` and its transitive wheels require a separately approved, pinned build environment with wheel URL/SHA/licence evidence.

## Proposed build command (do not run before tool and snapshot approval)

From a frozen Windows x64 checkout containing this candidate at the same relative path, with approved Python 3.12 and PyInstaller 6.22.3 installed from approved wheel hashes:

```powershell
python -m PyInstaller --clean --noconfirm --distpath <isolated-dist> --workpath <isolated-work> work/dev05-sidecar-exe-entry-20260928/aijian-sidecar.spec
```

The spec refuses other Python, PyInstaller, OS, or architecture. Record the full `uv.lock` and wheel closure, spec/entry hashes, source-tree commit plus dirty-file hashes, command, tool versions, warnings, expected and actual dist file list, PE architecture, and EXE SHA256. Any missing import, DLL, metadata, or license is a failed build gate. No current receipt exists.

## Independent acceptance samples

1. On a clean Windows x64 standard-user profile without system Python/Node/FFmpeg, stage the EXE under the exact installed resource tree and record package/EXE/lock/media SHA, `process.resourcesPath`, `app.getPath('userData')`, sidecar `sys.executable` (diagnostic only), PID, `args=[]`, and `cwd`. The current media lock is development-only; no production export POST or playable-output claim until an approved media profile exists.
2. Start through the actual packaged Electron process with stdin/out/err pipes. Require one valid `ready` JSON handshake, loopback endpoint authentication, no stdout noise, and normal parent-close shutdown. Confirm no sidecar or managed child remains. A second process against the same workspace must emit only the workspace-busy diagnostic on stderr and exit 73 before handshake; a clean restart must work. Repeat under a Chinese user/path and a writable, non-admin temp directory; record `_MEI...` creation/cleanup and extraction failures separately.
3. Use an isolated disposable workspace fixture for `--backup-workspace` with DB, media, and Chinese paths. Verify output `receipt.json`, every file hash, SQLite integrity, restore/readback, and source immutability. Exercise busy/invalid/corrupt/missing-space cases; failure must be nonzero and must leave the original workspace untouched. Do not use the user's live workspace for the first sample.
4. Exercise both exact frozen child protocols: fake-agent request/response and fake-provider DB/request/response. Confirm unknown `-m` exits 2 without starting the API, and child processes terminate with the parent. Dynamic fake-agent handler modules must resolve from the bundle; any import error is a failed closure gate.
5. In a controlled QA profile, exercise OS keyring with a disposable credential through AIVORA's provider-connection UI/API, then close/reopen and verify status without logging secret values. Separately verify Sub2API readiness and a single explicitly approved source-extract call with operation identity, provider response identity, and accounting; local/mock success is not real provider acceptance.

The release owner and QA must distinguish this static candidate from an EXE build, installed runtime, media-toolchain approval, real AI-provider response, and user acceptance. The current installer still blocks old installations until its backup and recovery path is independently verified.

Primary PyInstaller references: https://pyinstaller.org/en/v6.22.3/spec-files.html ; https://pyinstaller.org/en/v6.22.3/runtime-information.html ; https://pyinstaller.org/en/v6.22.3/operating-mode.html ; https://pyinstaller.org/en/v6.22.3/common-issues-and-pitfalls.html .

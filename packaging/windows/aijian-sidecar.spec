# Build only on Windows x64 with the separately locked build requirements.
# Keep a console executable: Electron consumes stdout/stdin for authentication
# and parent-exit supervision. Electron itself hides the child console window.
from pathlib import Path
from PyInstaller.utils.hooks import collect_submodules, copy_metadata

root = Path(SPECPATH).resolve().parents[1]
hidden = collect_submodules("uvicorn") + [
    "keyring.backends.Windows",
    "win32ctypes.pywin32.win32cred",
    "win32ctypes.pywin32.pywintypes",
]
datas = copy_metadata("keyring") + copy_metadata("uvicorn")
a = Analysis(
    [str(root / "packaging/windows/sidecar-entry.py")],
    pathex=[str(root / "services/api/src")],
    binaries=[], datas=datas, hiddenimports=hidden,
    hookspath=[], hooksconfig={}, runtime_hooks=[], excludes=[], noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz, a.scripts, [], exclude_binaries=True, name="aijian-sidecar",
    debug=False, bootloader_ignore_signals=False, strip=False, upx=False,
    console=True, disable_windowed_traceback=False,
)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name="sidecar")

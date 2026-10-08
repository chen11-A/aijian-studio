"""Review candidate: one-file Windows sidecar, targeting PyInstaller 6.22.3.

Build only from a reviewed snapshot. This spec is not a build receipt.
"""

from importlib.metadata import version
from pathlib import Path
import platform
import sys

from PyInstaller.utils.hooks import collect_submodules, copy_metadata


spec_dir = Path(SPEC).resolve().parent
repo_root = spec_dir.parent.parent
source_root = repo_root / "services" / "api" / "src"
entry = spec_dir / "entry.py"

if platform.system() != "Windows" or platform.machine().lower() not in {"amd64", "x86_64"}:
    raise SystemExit("AIVORA sidecar requires a Windows x64 build host")
if sys.version_info[:2] != (3, 12):
    raise SystemExit("AIVORA sidecar requires Python 3.12")
if version("pyinstaller") != "6.22.3":
    raise SystemExit("AIVORA sidecar requires PyInstaller 6.22.3")
if not (source_root / "aijian_api" / "sidecar.py").is_file():
    raise SystemExit("AIVORA sidecar source root is missing")

analysis = Analysis(
    [str(entry)],
    pathex=[str(source_root)],
    binaries=[],
    datas=copy_metadata("keyring"),
    hiddenimports=(
        collect_submodules("keyring.backends")
        + collect_submodules("uvicorn")
    ),
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(analysis.pure)
exe = EXE(
    pyz,
    analysis.scripts,
    analysis.binaries,
    analysis.datas,
    [],
    name="aijian-sidecar",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
)

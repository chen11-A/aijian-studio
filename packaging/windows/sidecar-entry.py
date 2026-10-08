"""Frozen console entrypoint: preserve the authenticated stdio sidecar protocol."""

import multiprocessing
import sys
from pathlib import Path

if __name__ == "__main__":
    multiprocessing.freeze_support()
    # This profile is embedded only by the Windows 10+ development build. It
    # relies on OS-owned UCRT rather than redistributing runner system DLLs.
    if (
        bool(getattr(sys, "frozen", False))
        and (Path(sys._MEIPASS) / "aivora-development-runtime.json").is_file()
    ):
        if sys.platform != "win32" or sys.getwindowsversion().major < 10:
            raise RuntimeError("AIVORA Dev Core requires Windows 10 or later")
    from aijian_api.sidecar import backup_command, run

    if len(sys.argv) > 1:
        raise SystemExit(backup_command(sys.argv[1:]))
    run()

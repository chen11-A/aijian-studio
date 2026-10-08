"""PyInstaller entry for the Electron-managed AIVORA sidecar.

The two -m forms are the only Python child commands used by the local fake
workers. A frozen sys.executable points back to this executable, so dispatch
those exact module names before handling the normal sidecar CLI.
"""

from __future__ import annotations

import sys


def main(argv: list[str]) -> int:
    if argv[:1] == ["-m"]:
        if len(argv) >= 2 and argv[1] == "aijian_api.fake_agent_subprocess" and len(argv) == 2:
            from aijian_api.fake_agent_subprocess import run

            return run()
        if len(argv) == 4 and argv[1] == "aijian_api.fake_provider_worker":
            from aijian_api.fake_provider_worker import main as worker_main

            sys.argv = [argv[1], argv[2], argv[3]]
            worker_main()
        print("unsupported packaged worker command", file=sys.stderr, flush=True)
        return 2

    from aijian_api.sidecar import backup_command, run

    if argv:
        return backup_command(argv)
    run()
    return 0


if __name__ == "__main__":
    # PyInstaller must divert multiprocessing spawn before sidecar imports or CLI parsing.
    from multiprocessing import freeze_support

    freeze_support()
    raise SystemExit(main(sys.argv[1:]))

"""Frozen console entrypoint: preserve the authenticated stdio sidecar protocol."""

import multiprocessing
import sys

if __name__ == "__main__":
    multiprocessing.freeze_support()
    from aijian_api.sidecar import backup_command, run

    if len(sys.argv) > 1:
        raise SystemExit(backup_command(sys.argv[1:]))
    run()

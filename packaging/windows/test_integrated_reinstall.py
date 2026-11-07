"""Real preservation-helper guards on Linux; never launch a Windows installer."""

import importlib.util
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location(
    "integrated_reinstall", HERE / "smoke-integrated-install.py"
)
assert spec and spec.loader
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


class IntegratedReinstallTests(unittest.TestCase):
    def seed(self, root: Path) -> None:
        (root / "workspace").mkdir()
        (root / "workspace/workspace.sqlite3").write_bytes(b"original closed database")
        (root / "workspace/sample.json").write_text('{"all":"original raw"}')
        (root / "reinstall-unknown-user-file.txt").write_bytes(b"unknown\x00\xff")

    def test_identical_original_tree_passes_without_rebuilding_it(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.seed(root)
            before = smoke.data_snapshot(root)
            smoke.assert_data_preserved(root, before)
            self.assertEqual(before["workspace"]["workspace.sqlite3"][0], 24)
            # Runtime Chromium logs are not original workspace/sample/settings data.
            (root / "chrome_debug.log").write_text("runtime-only")
            smoke.assert_data_preserved(root, before)

    def test_changed_deleted_added_or_recreated_sample_bytes_fail(self) -> None:
        for change in ("database", "delete", "extra", "reseed", "sentinel"):
            with self.subTest(change=change), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                self.seed(root)
                before = smoke.data_snapshot(root)
                if change == "database":
                    (root / "workspace/workspace.sqlite3").write_bytes(b"different database")
                elif change == "delete":
                    (root / "workspace/sample.json").unlink()
                elif change == "extra":
                    (root / "workspace/new.db-wal").write_bytes(b"still running")
                elif change == "reseed":
                    (root / "workspace/sample.json").write_text('{"new":"seed"}')
                else:
                    (root / "reinstall-unknown-user-file.txt").write_bytes(b"replacement")
                with self.assertRaises(ValueError):
                    smoke.assert_data_preserved(root, before)

    def test_missing_sentinel_and_links_refuse_preservation_claim(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.seed(root)
            (root / "reinstall-unknown-user-file.txt").unlink()
            with self.assertRaises(ValueError):
                smoke.data_snapshot(root)
            (root / "reinstall-unknown-user-file.txt").write_text("retained")
            try:
                (root / "workspace/link").symlink_to(root / "chrome_debug.log")
            except OSError:
                self.skipTest("Symlink creation is unavailable to this user")
            with self.assertRaises(ValueError):
                smoke.data_snapshot(root)

    def test_fresh_smoke_refuses_any_existing_profile_before_install_or_seed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            appdata = root / "appdata"
            appdata.mkdir()
            (appdata / "AIVORA").mkdir()
            with (
                patch.object(smoke.sys, "platform", "win32"),
                patch.dict(
                    "os.environ",
                    {
                        "GITHUB_ACTIONS": "true",
                        "GITHUB_REPOSITORY": "chen11-A/aijian-studio",
                        "RUNNER_TEMP": str(root),
                        "APPDATA": str(appdata),
                    },
                ),
                patch.object(
                    smoke.sys,
                    "argv",
                    [
                        "smoke",
                        "--stage",
                        str(root / "stage"),
                        "--evidence",
                        str(root / "evidence"),
                        "--delivery",
                        str(root / "delivery"),
                    ],
                ),
                patch.object(smoke.subprocess, "run") as run,
            ):
                with self.assertRaisesRegex(ValueError, "Refusing existing"):
                    smoke.main()
                run.assert_not_called()
                self.assertFalse((root / "AivoraIntegratedReinstall").exists())

    def test_process_observation_fails_closed_without_killing_any_process(self) -> None:
        for output in ("1", "2", "", "unavailable"):
            with self.subTest(output=output), patch.object(smoke.subprocess, "run") as run:
                run.return_value = subprocess.CompletedProcess([], 0, output, "")
                with self.assertRaises(ValueError):
                    smoke.assert_stopped(Path("isolated-install"))
                self.assertNotIn("Stop-Process", run.call_args.args[0][-1])
        with patch.object(smoke.subprocess, "run") as run:
            run.return_value = subprocess.CompletedProcess([], 0, "0\n", "")
            smoke.assert_stopped(Path("isolated-install"))
            self.assertEqual(
                run.call_args.kwargs["env"]["AIVORA_SMOKE_INSTALL_ROOT"], "isolated-install"
            )


if __name__ == "__main__":
    unittest.main()

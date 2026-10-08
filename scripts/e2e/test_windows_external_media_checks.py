"""Host-safe checks of fixture shape and wrapper boundaries; never Windows proof."""

import importlib.util
import json
import os
import sqlite3
import struct
import tempfile
import unittest
import zlib
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


checks = load("windows_media_checks", ROOT / "scripts/e2e/windows_external_media_checks.py")
installed = load("installed_external_media", ROOT / "packaging/windows/test-installed-dev-core.py")


class HostChecks(unittest.TestCase):
    def test_formal_ledger_handle_closes_before_temporary_workspace_cleanup(self):
        for row_count in (0, 1):
            with self.subTest(row_count=row_count), tempfile.TemporaryDirectory() as temporary:
                path = Path(temporary).resolve(strict=True) / "workspace.sqlite3"
                connection = sqlite3.connect(path)
                connection.execute("CREATE TABLE product_export_operations(id INTEGER)")
                if row_count:
                    connection.execute("INSERT INTO product_export_operations VALUES (1)")
                connection.commit()
                with patch.object(checks.sqlite3, "connect", return_value=connection):
                    if row_count:
                        with self.assertRaises(AssertionError):
                            checks.assert_empty_formal_ledger(path)
                    else:
                        checks.assert_empty_formal_ledger(path)
                with self.assertRaises(sqlite3.ProgrammingError):
                    connection.execute("SELECT 1")
                path.unlink()  # Windows must release the actual DB file before cleanup.

    def test_nonwindows_host_never_admits_execution(self):
        with patch.object(checks.sys, "platform", "linux"):
            with self.assertRaises(RuntimeError):
                checks.require_host()

    def test_synthetic_png_has_exact_geometry_and_frame_marker(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary).resolve(strict=True) / "synthetic.png"
            checks.png(path, (255, 0, 0), 128)
            data = path.read_bytes()
            self.assertEqual(data[:8], b"\x89PNG\r\n\x1a\n")
            self.assertEqual(struct.unpack(">II", data[16:24]), (1280, 720))
            length = struct.unpack(">I", data[33:37])[0]
            raw = zlib.decompress(data[41 : 41 + length])
            offset = 60 * (1280 * 3 + 1) + 1
            self.assertEqual(raw[offset + 136 * 3 : offset + 137 * 3], b"\xff\xff\xff")
            self.assertEqual(raw[offset + 40 * 3 : offset + 41 * 3], b"\xff\0\0")

    def test_json_evidence_exclusive_and_bounded(self):
        with tempfile.TemporaryDirectory() as temporary:
            # Windows TEMP may use its 8.3 spelling. Normalize only this owned
            # fixture root; production plain() must continue rejecting aliases.
            root = Path(temporary).resolve(strict=True)
            path = root / "report.json"
            checks.write_json(path, {"result": "HOST_FIXTURE"})
            self.assertEqual(json.loads(path.read_text())["result"], "HOST_FIXTURE")
            with self.assertRaises(FileExistsError):
                checks.write_json(path, {})
            with self.assertRaises(ValueError):
                checks.write_json(root / "huge.json", {"data": "a" * 140000})

    def test_existing_noncanonical_spelling_remains_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve(strict=True)
            path = root / "owned.json"
            path.write_text("{}")
            with patch.object(Path, "resolve", return_value=root / "different-canonical-name.json"):
                with self.assertRaisesRegex(ValueError, "spelling differs"):
                    checks.plain(path)

    def test_legacy_installer_call_skips_optional_media_unchanged(self):
        with patch.object(installed.subprocess, "run") as run:
            self.assertIsNone(
                installed.external_media_phase(
                    SimpleNamespace(external_media_tools_report=None), Path("/not-used")
                )
            )
            run.assert_not_called()

    def test_media_phase_refuses_any_upload_enabled_run(self):
        with patch.dict(
            os.environ,
            {
                "RUNNER_TEMP": str(Path(tempfile.gettempdir()).resolve(strict=True)),
                "AIVORA_ARTIFACT_UPLOAD_ALLOWED": "true",
            },
        ):
            with self.assertRaisesRegex(ValueError, "zero-upload"):
                installed.external_media_phase(
                    SimpleNamespace(external_media_tools_report=Path("x")), Path("unused")
                )

    def test_helper_failure_is_preserved_in_install_evidence(self):
        with tempfile.TemporaryDirectory() as temporary:
            temp = Path(temporary).resolve(strict=True)
            evidence = temp / "aivora-evidence"
            evidence.mkdir()
            root = temp / "aivora-external-media-tools/ffmpeg-8.1.2-full_build/bin"
            prepared = temp / "aivora-external-media-tools.json"
            prepared.write_text(
                json.dumps(
                    {
                        "result": "EXTERNAL_MEDIA_TEST_INPUTS_PREPARED",
                        "toolchain_root": str(root),
                        "usage": "TEST_ONLY_NOT_FOR_DISTRIBUTION",
                        "release_approved": False,
                        "artifact_upload_allowed": False,
                    }
                )
            )
            args = SimpleNamespace(
                external_media_tools_report=prepared,
                evidence=evidence,
                external_media_python=temp / "aivora-frozen/build-env/Scripts/python.exe",
            )

            def fail(*_args, **_kwargs):
                work = temp / "aivora-external-media-test"
                work.mkdir()
                (work / "INPUTS.json").write_text(
                    json.dumps(
                        {
                            "result": "FAIL",
                            "stage": "actual_windows_process_boundary",
                            "failure_type": "ExternalMediaProcessError",
                            "message": "Private media directory DACL cannot be verified",
                            "completed_checks": {"prior_check": {"result": "PASS"}},
                        }
                    )
                )
                raise RuntimeError("test process failed")

            with (
                patch.dict(
                    os.environ,
                    {
                        "RUNNER_TEMP": str(temp),
                        "AIVORA_ARTIFACT_UPLOAD_ALLOWED": "false",
                        "GITHUB_SHA": "a" * 40,
                    },
                ),
                patch.object(installed.subprocess, "run", side_effect=fail),
            ):
                with self.assertRaises(RuntimeError):
                    installed.external_media_phase(
                        args, temp / "AivoraDevCoreInstall/AIVORA Dev Core.exe"
                    )
            receipt = json.loads((evidence / "INSTALLED-EXTERNAL-MEDIA-SMOKE.json").read_text())
            self.assertEqual(receipt["result"], "FAIL")
            self.assertEqual(receipt["helper_failure"]["stage"], "actual_windows_process_boundary")
            self.assertFalse(receipt["release_approved"])
            self.assertEqual(
                receipt["helper_failure"]["completed_checks"], {"prior_check": {"result": "PASS"}}
            )


if __name__ == "__main__":
    unittest.main()

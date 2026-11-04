"""Readiness inventory guard tests. No network or Windows execution."""

import importlib.util
import tempfile
import unittest
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("readiness", HERE / "audit-readiness.py")
assert spec is not None and spec.loader is not None
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class ReadinessTests(unittest.TestCase):
    def test_status_inspection_does_not_invent_approval(self):
        self.assertEqual(
            audit.media_status_contract(
                'class Profile:\n distribution_status: Literal["DEVELOPMENT_ONLY"]\n'
            ),
            {"Profile": ["DEVELOPMENT_ONLY"]},
        )
        self.assertEqual(audit.media_status_contract("class Profile:\n pass\n"), {})

    def test_wheel_inventory_hashes_license_without_asserting_shipment(self):
        with tempfile.TemporaryDirectory() as directory:
            wheel = Path(directory) / "example.whl"
            with zipfile.ZipFile(wheel, "w") as archive:
                archive.writestr("example.dist-info/METADATA", "Name: example\nVersion: 1\n")
                archive.writestr("vendor/other.dist-info/METADATA", "Name: vendored-other\n")
                archive.writestr("example.dist-info/licenses/LICENSE", b"license")
            result = audit.wheel_inventory(wheel)
            self.assertEqual(result["name"], "example")
            self.assertIsNone(result["declared_license_expression"])
            self.assertEqual(len(result["license_files"]), 1)
            self.assertEqual(result["shipped_in_frozen_sidecar"], "NOT_ESTABLISHED")

    def test_ambiguous_metadata_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            wheel = Path(directory) / "example.whl"
            with zipfile.ZipFile(wheel, "w") as archive:
                archive.writestr("one.dist-info/METADATA", "Name: one\n")
                archive.writestr("two.dist-info/METADATA", "Name: two\n")
            with self.assertRaisesRegex(ValueError, "exactly one"):
                audit.wheel_inventory(wheel)


if __name__ == "__main__":
    unittest.main()

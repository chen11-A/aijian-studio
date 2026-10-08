"""Synthetic cross-platform guards; never execute a Windows binary or installer."""

import copy
import importlib.util
import io
import json
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent


def load(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


prepare = load("dev_prepare", "prepare-dev-core.py")
package = load("dev_package", "package-dev-core.py")
distribution = load("dev_distribution", "verify-dev-core-distribution.py")
materials = load("dev_materials", "map-dev-native-materials.py")


class DevCoreTests(unittest.TestCase):
    def test_unsafe_archive_members_rejected(self):
        for name in ("../escape", "/absolute", "C:/root", "a\\b", "a//b"):
            with self.subTest(name=name):
                self.assertFalse(prepare.safe_archive_name(name))
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / "unsafe.tar.gz"
            with tarfile.open(archive, "w:gz") as output:
                item = tarfile.TarInfo("../escape")
                item.size = 1
                output.addfile(item, io.BytesIO(b"x"))
            with self.assertRaises(ValueError):
                prepare.extract_tar(archive, root / "unpack")
            self.assertFalse((root / "unpack").exists())

    def test_core_cannot_contain_media_or_user_data(self):
        for name in (
            "resources/media/ffmpeg.exe",
            "resources/sidecar/ffprobe.exe",
            "resources/workspace/workspace.sqlite3",
            "app/chatgpt-official/profile",
        ):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                target = root / name
                target.parent.mkdir(parents=True)
                target.write_bytes(b"synthetic guard input")
                with self.assertRaises(ValueError):
                    package.assert_core_tree(root)

    def test_exact_native_license_mapping_is_required(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            binary = root / "resources/sidecar/example.dll"
            binary.parent.mkdir(parents=True)
            binary.write_bytes(b"synthetic non-executable test bytes")
            license_file = root / "resources/licenses/example-LICENSE"
            license_file.parent.mkdir(parents=True)
            license_file.write_bytes(b"synthetic license evidence")
            review = {
                "schema_version": 1,
                "profile": "DEVELOPMENT_CORE",
                "status": "MATERIALS_VERIFIED",
                "release_approved": False,
                "native_components": [
                    {
                        "path": "resources/sidecar/example.dll",
                        "sha256": package.digest(binary),
                        "name": "synthetic",
                        "version": "1",
                        "source_url": "https://www.python.org/",
                        "licenses": [
                            {
                                "path": "resources/licenses/example-LICENSE",
                                "sha256": package.digest(license_file),
                            }
                        ],
                    }
                ],
            }
            distribution.verify(root, review)
            for changes in (
                {"native_components": []},
                {"release_approved": True},
                {"status": "BLOCKED"},
            ):
                invalid = {**copy.deepcopy(review), **changes}
                with self.assertRaises(ValueError):
                    distribution.verify(root, invalid)
            binary.write_bytes(b"changed bytes")
            with self.assertRaises(ValueError):
                distribution.verify(root, review)

    def test_checked_in_distribution_gate_is_not_approval(self):
        review = json.loads((HERE / "dev-core-distribution-review.json").read_text())
        self.assertFalse(review["release_approved"])
        if review["status"] == "BLOCKED":
            with tempfile.TemporaryDirectory() as directory, self.assertRaises(ValueError):
                distribution.verify(Path(directory), review)

    def test_dev_installer_keeps_per_user_and_data_abort(self):
        config = json.loads((HERE / "electron-builder.dev-core.json").read_text())
        self.assertEqual(config["appId"], "com.aivora.studio.devcore")
        self.assertFalse(config["win"]["signExecutable"])
        for key in ("perMachine", "allowElevation", "deleteAppDataOnUninstall", "runAfterFinish"):
            self.assertFalse(config["nsis"][key])
        hook = (HERE / "installer.dev-core.nsh").read_text()
        self.assertIn('"$APPDATA\\AIVORA Dev Core"', hook)
        self.assertIn('"$APPDATA\\AIVORA"', hook)
        self.assertIn("  Abort", hook)
        # The formal staging path is still Release-only.
        stage = (HERE.parents[1] / "scripts/stage-windows-runtime.ps1").read_text()
        self.assertIn("-Purpose Release", stage)

    def test_material_catalog_and_copy_remain_exact(self):
        catalog = materials.load_catalog()
        self.assertEqual(len(catalog["native_inputs"]), 72)
        self.assertFalse(catalog["release_approved"])
        with tempfile.TemporaryDirectory() as directory:
            resources = Path(directory) / "resources"
            materials.copy_companion(resources)
            for name, expected in catalog["license_text_hashes"].items():
                self.assertEqual(
                    package.digest(resources / "licenses/python-companion" / name), expected
                )
            with self.assertRaises(ValueError):
                materials.copy_companion(resources)

    def test_unknown_native_bytes_are_reported_not_approved(self):
        with tempfile.TemporaryDirectory() as directory:
            resources = Path(directory) / "resources"
            (resources / "sidecar").mkdir(parents=True)
            target = resources / "sidecar/unrecognized.dll"
            target.write_bytes(b"unknown synthetic native file")
            evidence = materials.inspect(resources, None)
            self.assertEqual(len(evidence["unknown_native_files"]), 1)
            self.assertEqual(evidence["matches"], [])
            self.assertFalse(evidence["release_approved"])

    def test_matching_digest_is_bound_to_catalog_input(self):
        with tempfile.TemporaryDirectory() as directory:
            resources = Path(directory) / "resources"
            (resources / "sidecar").mkdir(parents=True)
            target = resources / "sidecar/example.dll"
            target.write_bytes(b"synthetic exact native input")
            entry = {"sha256": package.digest(target), "name": "synthetic"}
            with patch.object(materials, "load_catalog", return_value={"native_inputs": [entry]}):
                evidence = materials.inspect(resources, None)
            self.assertEqual(evidence["matches"][0]["inputs"], [entry])
            self.assertEqual(evidence["unknown_native_files"], [])
            self.assertFalse(evidence["complete_frozen_receipt_available"])

    def test_generated_receipt_cannot_omit_backend_sources(self):
        with self.assertRaisesRegex(ValueError, "exactly this candidate"):
            materials.verify_source_receipt({"sources": {}})


if __name__ == "__main__":
    unittest.main()

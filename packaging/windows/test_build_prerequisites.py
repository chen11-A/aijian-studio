"""Offline packaging guard tests; no download or Windows execution."""

import copy
import hashlib
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


prerequisites = load("prerequisites", HERE / "prepare-prerequisites.py")
freeze = load("freeze", HERE / "freeze-sidecar.py")


class PrerequisiteTests(unittest.TestCase):
    def setUp(self):
        self.lock = json.loads(prerequisites.LOCK.read_text())

    def test_checked_in_lock_and_source_bindings(self):
        prerequisites.validate_lock(self.lock)
        prerequisites.verify_source_locks(self.lock)
        self.assertEqual(len(self.lock["downloads"]), 40)

    def test_reject_release_approval(self):
        self.lock["release_approved"] = True
        with self.assertRaises(ValueError):
            prerequisites.validate_lock(self.lock)

    def test_reject_duplicate_and_bad_hash(self):
        for mutate in (
            lambda lock: lock["downloads"].append(lock["downloads"][0]),
            lambda lock: lock["downloads"][0].update(sha256=""),
        ):
            lock = copy.deepcopy(self.lock)
            mutate(lock)
            with self.assertRaises(ValueError):
                prerequisites.validate_lock(lock)

    def test_reject_unsafe_source_url(self):
        for url in (
            "http://github.com/file",
            "https://example.org/file",
            "https://user:secret@github.com/file",
            "file:///tmp/a",
        ):
            with self.subTest(url=url), self.assertRaises(ValueError):
                lock = copy.deepcopy(self.lock)
                lock["downloads"][0]["url"] = url
                prerequisites.validate_lock(lock)

    def test_reject_unsafe_target(self):
        for path in ("../x", "x/../y", "/x", "C:/x", "a\\b", "a//b", "./a"):
            with self.subTest(path=path), self.assertRaises(ValueError):
                prerequisites.safe_relative(path)

    def test_offline_hit_missing_and_tampering(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            item = {"path": "test.bin", "sha256": hashlib.sha256(b"valid").hexdigest()}
            with self.assertRaises(FileNotFoundError):
                prerequisites.fetch(item, root, offline=True)
            (root / "test.bin").write_bytes(b"valid")
            with patch("urllib.request.urlopen", side_effect=AssertionError("network forbidden")):
                self.assertEqual(prerequisites.fetch(item, root, offline=True)["bytes"], 5)
            (root / "test.bin").write_bytes(b"tampered")
            with self.assertRaises(ValueError):
                prerequisites.fetch(item, root, offline=True)

    def test_source_drift_blocks(self):
        self.lock["source_locks"]["uv.lock"] = "0" * 64
        with self.assertRaises(ValueError):
            prerequisites.verify_source_locks(self.lock)

    def test_download_is_atomic_and_hash_checked(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            item = {
                "id": "example",
                "path": "download.bin",
                "url": "https://github.com/test",
                "sha256": hashlib.sha256(b"valid").hexdigest(),
            }
            response = io.BytesIO(b"invalid")
            response.url = "https://release-assets.githubusercontent.com/test"
            with (
                patch("urllib.request.urlopen", return_value=response),
                self.assertRaises(ValueError),
            ):
                prerequisites.fetch(item, root, offline=False)
            self.assertFalse((root / "download.bin").exists())
            self.assertFalse((root / "download.bin.partial").exists())
            response = io.BytesIO(b"valid")
            response.url = "https://release-assets.githubusercontent.com/test"
            with patch("urllib.request.urlopen", return_value=response):
                self.assertEqual(prerequisites.fetch(item, root, offline=False)["bytes"], 5)

    def test_download_rejects_http_redirect_and_retains_other_partial(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            item = {
                "id": "example",
                "path": "download.bin",
                "url": "https://github.com/test",
                "sha256": hashlib.sha256(b"valid").hexdigest(),
            }
            response = io.BytesIO(b"valid")
            response.url = "http://example.org/test"
            with (
                patch("urllib.request.urlopen", return_value=response),
                self.assertRaises(ValueError),
            ):
                prerequisites.fetch(item, root, offline=False)
            self.assertFalse((root / "download.bin.partial").exists())
            (root / "download.bin.partial").write_bytes(b"other in-progress download")
            with self.assertRaises(FileExistsError):
                prerequisites.fetch(item, root, offline=False)
            self.assertEqual(
                (root / "download.bin.partial").read_bytes(), b"other in-progress download"
            )

    def test_symlinks_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            try:
                (root / "link").symlink_to(root, target_is_directory=True)
            except OSError:
                self.skipTest("Creating test symlinks is unavailable")
            with self.assertRaises(ValueError):
                prerequisites.plain_path(root / "link/child")

    def test_freeze_refuses_linux_before_writing(self):
        with patch.object(freeze.sys, "platform", "linux"), self.assertRaises(RuntimeError):
            freeze.validate_host()

    def test_freeze_refuses_wrong_python_or_arch(self):
        with patch.object(freeze.sys, "platform", "win32"):
            with patch.object(freeze.platform, "machine", return_value="ARM64"):
                with self.assertRaises(RuntimeError):
                    freeze.validate_host()
            with patch.object(freeze.platform, "machine", return_value="AMD64"):
                with patch.object(freeze.sys, "version_info", (3, 13, 0)):
                    with self.assertRaises(RuntimeError):
                        freeze.validate_host()
                with patch.object(freeze.sys, "version_info", (3, 12, 13)):
                    freeze.validate_host()


if __name__ == "__main__":
    unittest.main()

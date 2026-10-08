"""Bounded authorization and tested-byte checks; no network or real installer."""

import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    "one_shot_upload", Path(__file__).with_name("verify-one-shot-upload.py")
)
assert SPEC and SPEC.loader
UPLOAD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(UPLOAD)


class OneShotUploadTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.directory = root / "aivora-delivery"
        self.directory.mkdir()
        self.environment = {
            "GITHUB_ACTIONS": "true",
            "GITHUB_REPOSITORY": UPLOAD.REPOSITORY,
            "GITHUB_REF": UPLOAD.REF,
            "GITHUB_WORKFLOW_REF": UPLOAD.WORKFLOW,
            "GITHUB_RUN_NUMBER": "7",
            "GITHUB_RUN_ATTEMPT": "1",
            "AIVORA_ARTIFACT_UPLOAD_ALLOWED": "true",
            "RUNNER_TEMP": str(root),
            "GITHUB_SHA": "a" * 40,
        }
        self.installer = self.directory / "AIVORA-Dev-Core-test.exe"
        self.installer.write_bytes(b"MZ non-executable synthetic fixture")
        self.receipt = {
            "result": "PASS",
            "profile": "DEVELOPMENT_CORE",
            "candidate_head": self.environment["GITHUB_SHA"],
            "release_approved": False,
            "fresh_install": "PASS",
            "installed_native_create_save_reopen": "PASS",
            "uninstall_app_removed": "PASS",
            "uninstall_workspace_preserved": "PASS",
            "uninstall_unknown_user_file_preserved": "PASS",
            "reinstall_existing_data": "SAFELY_ABORTED",
            "installer_bytes": self.installer.stat().st_size,
            "installer_sha256": hashlib.sha256(self.installer.read_bytes()).hexdigest(),
        }
        self.save_receipt()

    def save_receipt(self):
        (self.directory / "INSTALL-RESULT.json").write_text(json.dumps(self.receipt))

    def test_one_selected_first_attempt_accepts_exact_tested_bytes(self):
        result = UPLOAD.verify_delivery(self.directory, self.environment, 7)
        self.assertEqual(result["artifact_count"], 1)
        self.assertEqual(result["retention_days"], 1)

    def test_later_runs_retries_other_targets_and_disabled_upload_reject(self):
        for key, value in (
            ("GITHUB_RUN_NUMBER", "8"),
            ("GITHUB_RUN_ATTEMPT", "2"),
            ("GITHUB_REF", "refs/heads/main"),
            ("GITHUB_REPOSITORY", "someone/else"),
            ("GITHUB_WORKFLOW_REF", "another-workflow"),
            ("AIVORA_ARTIFACT_UPLOAD_ALLOWED", "false"),
        ):
            with self.subTest(key=key), self.assertRaises(ValueError):
                UPLOAD.verify_delivery(self.directory, {**self.environment, key: value}, 7)

    def test_impossible_run_sentinel_never_authorizes_upload(self):
        environment = {**self.environment, "GITHUB_RUN_NUMBER": "0"}
        with self.assertRaises(ValueError):
            UPLOAD.verify_delivery(self.directory, environment, 0)

    def test_failed_candidate_changed_bytes_and_extra_binary_reject(self):
        self.receipt["installed_native_create_save_reopen"] = "FAIL"
        self.save_receipt()
        with self.assertRaises(ValueError):
            UPLOAD.verify_delivery(self.directory, self.environment, 7)
        self.receipt["installed_native_create_save_reopen"] = "PASS"
        self.save_receipt()
        self.installer.write_bytes(b"changed")
        with self.assertRaises(ValueError):
            UPLOAD.verify_delivery(self.directory, self.environment, 7)
        (self.directory / "workspace.db").write_bytes(b"must not upload")
        with self.assertRaises(ValueError):
            UPLOAD.verify_delivery(self.directory, self.environment, 7)

    def test_storage_allowance_rejects_before_upload(self):
        with patch.object(UPLOAD, "MAX_SOURCE_BYTES", 1), self.assertRaises(ValueError):
            UPLOAD.verify_delivery(self.directory, self.environment, 7)


if __name__ == "__main__":
    unittest.main()

"""Check synthetic workspace placement without changing packaged path protections."""

import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("frozen_smoke", HERE / "smoke-frozen-sidecar.py")
assert spec and spec.loader
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


class FrozenSmokeWorkspaceTests(unittest.TestCase):
    def test_workspace_uses_fresh_local_appdata_parent_and_cleans_only_its_data(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            sentinel = root / "existing-user-file.txt"
            sentinel.write_text("retain")
            with patch.dict("os.environ", {"LOCALAPPDATA": str(root)}):
                with smoke.synthetic_packaged_workspace() as workspace:
                    self.assertEqual(workspace.name, "workspace")
                    self.assertEqual(workspace.parent.parent, root)
                    self.assertEqual(workspace.resolve(), workspace)
                    self.assertTrue(workspace.is_dir())
                    (workspace / "synthetic.sqlite3").write_bytes(b"synthetic")
                self.assertFalse(workspace.parent.exists())
            self.assertEqual(sentinel.read_text(), "retain")

    def test_missing_relative_or_nonexistent_local_appdata_fails_closed(self):
        for value in ("", "relative", " relative "):
            with self.subTest(value=value), patch.dict("os.environ", {"LOCALAPPDATA": value}):
                with self.assertRaises(RuntimeError), smoke.synthetic_packaged_workspace():
                    self.fail("An unsafe root must not allocate a workspace")
        with tempfile.TemporaryDirectory() as temporary:
            missing = Path(temporary) / "missing"
            with patch.dict("os.environ", {"LOCALAPPDATA": str(missing)}):
                with self.assertRaises(RuntimeError), smoke.synthetic_packaged_workspace():
                    self.fail("A nonexistent root must not allocate a workspace")


if __name__ == "__main__":
    unittest.main()

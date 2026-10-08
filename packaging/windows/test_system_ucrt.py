"""Synthetic provenance/filter tests; no OS DLL or Windows installer is executed."""

import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("system_ucrt", HERE / "system-ucrt.py")
assert spec and spec.loader
ucrt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ucrt)


class SystemUcrtTests(unittest.TestCase):
    def test_only_classified_os_inputs_are_omitted_and_exact_vcruntime_is_retained(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            entries = []
            for name in ("ucrtbase.dll", "vcruntime140.dll", "vcruntime140_1.dll", "python312.dll"):
                path = root / name
                path.write_bytes(name.encode())
                entries.append((name, str(path), "BINARY"))
            with patch.object(ucrt, "pe_version", return_value="10.0.26100.1"):
                kept, evidence = ucrt.partition_inputs(entries, {"WINDOWS_SYSTEM32": root})
            self.assertEqual(kept, entries[1:])
            self.assertEqual(len(evidence["native_inputs"]), 4)
            omitted = evidence["excluded_os_runtime_inputs"]
            self.assertEqual(len(omitted), 1)
            self.assertEqual(omitted[0]["sha256"], ucrt.digest(root / "ucrtbase.dll"))
            self.assertEqual(omitted[0]["file_version"], "10.0.26100.1")
            self.assertFalse(evidence["release_approved"])

    def test_unclassified_renamed_unreviewed_or_data_input_cannot_be_omitted(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            path = root / "ucrtbase.dll"
            path.write_bytes(b"synthetic")
            cases = [
                ([(path.name, str(path), "BINARY")], {}),
                (
                    [("api-ms-win-core-console-l1-1-0.dll", str(path), "BINARY")],
                    {"WINDOWS_SYSTEM32": root},
                ),
                ([(path.name, str(path), "DATA")], {"WINDOWS_SYSTEM32": root}),
            ]
            unreviewed = root / "api-ms-win-core-unreviewed-l1-1-0.dll"
            unreviewed.write_bytes(b"synthetic")
            cases.append(
                ([(unreviewed.name, str(unreviewed), "BINARY")], {"WINDOWS_SYSTEM32": root})
            )
            for entries, roots in cases:
                with self.subTest(entries=entries), self.assertRaises(ValueError):
                    ucrt.partition_inputs(entries, roots)

    def test_reviewed_names_are_exactly_the_observed_os_family(self):
        self.assertEqual(len(ucrt.OS_DLL_NAMES), 43)
        self.assertTrue(all(ucrt.OS_DLL.fullmatch(name) for name in ucrt.OS_DLL_NAMES))
        self.assertFalse(ucrt.OS_DLL.fullmatch("vcruntime140.dll"))
        self.assertFalse(ucrt.OS_DLL.fullmatch("ucrtbase.dll.extra"))


if __name__ == "__main__":
    unittest.main()

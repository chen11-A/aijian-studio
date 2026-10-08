"""Host-only external media preparation guards; never download or execute tools."""

import copy
import hashlib
import importlib.util
import io
import json
import os
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location(
    "prepare_windows_external_media", HERE / "prepare-windows-external-media.py"
)
media = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(media)
helper = media.load_helper("external_media_test_prerequisites", "prepare-prerequisites.py")
core = media.load_helper("external_media_test_core", "prepare-dev-core.py")
ENVIRONMENT = {
    "GITHUB_ACTIONS": "true",
    "GITHUB_REPOSITORY": "chen11-A/aijian-studio",
    "GITHUB_REF": "refs/heads/codex/windows-installer-dev-20261008",
    "AIVORA_ARTIFACT_UPLOAD_ALLOWED": "false",
}


def sha(value):
    return hashlib.sha256(value).hexdigest()


def listing_record(path, **extra):
    record = {"Path": path, "Size": "10", "Attributes": "A", "Encrypted": "-"}
    record.update(extra)
    return "\n".join(f"{key} = {value}" for key, value in record.items()) + "\n\n"


def good_listing():
    return "".join(
        listing_record(f"{media.ARCHIVE_ROOT}/bin/{name}") for name in media.PINNED_BINARIES
    )


class ExternalMediaPreparationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.cache = self.root / "aivora-tool-cache"
        self.tools = self.root / "aivora-tools"
        self.output = self.root / "aivora-external-media-tools"
        self.report = self.root / "external-media-test/preparation.json"
        self.cache.mkdir()
        self.tools.mkdir()
        self.environment = patch.dict(os.environ, {"RUNNER_TEMP": str(self.root)}, clear=True)
        self.environment.start()
        self.addCleanup(self.environment.stop)
        # An unexpected escape to either network or a child process fails every
        # host test, including the mocked end-to-end preparation test below.
        self.network = patch("urllib.request.urlopen", side_effect=AssertionError("No network"))
        self.process = patch.object(media.subprocess, "run", side_effect=AssertionError("No tools"))
        self.network.start()
        self.process.start()
        self.addCleanup(self.network.stop)
        self.addCleanup(self.process.stop)

    def paths(self, **changes):
        values = dict(cache=self.cache, tools=self.tools, output=self.output, report=self.report)
        values.update(changes)
        media.validate_paths(**values, helper=helper)

    def test_checked_in_source_locks_and_exact_pair_are_unchanged(self):
        archive, extractor = media.pinned_inputs(helper)
        self.assertEqual(archive["id"], "ffmpeg-development")
        self.assertEqual(extractor["id"], "7zip-win-x64")
        self.assertEqual(archive["version"], "8.1.2")

    def test_non_windows_fails_before_any_preparation(self):
        with patch.object(media.sys, "platform", "linux"), self.assertRaises(RuntimeError):
            media.prepare(self.cache, self.tools, self.output, self.report, offline=True)
        self.assertFalse(self.output.exists())
        self.assertFalse(self.report.exists())

    def test_each_ci_identity_and_upload_gate_is_required(self):
        with patch.object(media.sys, "platform", "win32"), patch.dict(os.environ, ENVIRONMENT):
            media.validate_host()
            for key in ENVIRONMENT:
                for replacement in ("", "wrong", "TRUE"):
                    with self.subTest(key=key, replacement=replacement):
                        with (
                            patch.dict(os.environ, {key: replacement}),
                            self.assertRaises(RuntimeError),
                        ):
                            media.validate_host()
            with patch.dict(os.environ, {"AIVORA_ARTIFACT_UPLOAD_ALLOWED": "true"}):
                with self.assertRaises(RuntimeError):
                    media.validate_host()

    def test_output_and_report_are_external_and_fresh(self):
        self.paths()
        self.output.mkdir()
        with self.assertRaises(ValueError):
            self.paths()
        self.output.rmdir()
        self.report.parent.mkdir()
        self.report.write_text("Existing receipt")
        with self.assertRaises(ValueError):
            self.paths()

    def test_path_aliases_and_reserved_windows_names_are_rejected(self):
        for part in ("NUL", "CON.txt", "com1", "a.", "a ", "a:b", "a~1", "x?", "a\n"):
            with self.subTest(part=part), self.assertRaises(ValueError):
                self.paths(report=self.root / part / "preparation.json")
        for path in (Path("relative"), self.root / "x" / ".." / "test.json"):
            with self.subTest(path=path), self.assertRaises(ValueError):
                self.paths(report=path)

    def test_protected_and_nonstandard_paths_are_rejected(self):
        for boundary in (
            self.cache,
            self.tools,
            self.output,
            self.root / "aivora-evidence",
            self.root / "aivora-delivery",
            self.root / "aivora-stage",
            self.root / "aivora-frozen",
            self.root / "aivora-workspace",
            self.root / "aivora-installed",
        ):
            with self.subTest(boundary=boundary), self.assertRaises(ValueError):
                self.paths(report=boundary / "preparation.json")
        for field in ("cache", "tools", "output"):
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.paths(**{field: self.root / "other"})
        with self.assertRaises(ValueError):
            self.paths(report=self.root.parent / "outside.json")
        with self.assertRaises(ValueError):
            self.paths(report=self.root / "not-json.exe")
        with patch.dict(os.environ, {"GITHUB_WORKSPACE": str(self.root)}):
            with self.assertRaises(ValueError):
                self.paths()

    def test_symlink_and_hardlink_paths_are_rejected(self):
        source = self.root / "original.json"
        source.write_text("source")
        alias = self.root / "alias.json"
        try:
            alias.symlink_to(source)
        except OSError:
            self.skipTest("Host cannot create symlinks")
        with self.assertRaises(ValueError):
            media.plain_path(alias, helper)
        alias.unlink()
        os.link(source, alias)
        with self.assertRaises(ValueError):
            media.plain_path(alias, helper)

    def test_listing_accepts_host_separators_and_exact_pair_only(self):
        expected = {f"{media.ARCHIVE_ROOT}/bin/{name}": 10 for name in media.PINNED_BINARIES}
        self.assertEqual(media.validate_listing(good_listing(), core), expected)
        self.assertEqual(media.validate_listing(good_listing().replace("/", "\\"), core), expected)
        directory = listing_record(media.ARCHIVE_ROOT, Size="0", Attributes="D", Folder="+")
        self.assertEqual(media.validate_listing(directory + good_listing(), core), expected)

    def test_listing_rejects_traversal_aliases_duplicates_and_other_roots(self):
        valid = good_listing()
        for path in (
            "../outside.exe",
            "/outside.exe",
            "C:/outside.exe",
            f"{media.ARCHIVE_ROOT}/../escape",
            f"{media.ARCHIVE_ROOT}/bin/ffmpeg.exe:stream",
            f"{media.ARCHIVE_ROOT}/bin/ffmpeg.exe.",
            f"{media.ARCHIVE_ROOT}/bin/ffmpeg.exe ",
            f"{media.ARCHIVE_ROOT}/bin/CON",
            f"{media.ARCHIVE_ROOT}/bin/ffmpe~1.exe",
            f"{media.ARCHIVE_ROOT}/bin//extra",
            f"{media.ARCHIVE_ROOT}/bin/FFMPEG.EXE",
            "other-root/bin/ffmpeg.exe",
        ):
            with self.subTest(path=path), self.assertRaises(ValueError):
                media.validate_listing(valid + listing_record(path), core)
        with self.assertRaises(ValueError):
            media.validate_listing(valid + valid, core)
        with self.assertRaises(ValueError):
            media.validate_listing(valid + listing_record(f"{media.ARCHIVE_ROOT}/bin"), core)

    def test_listing_rejects_link_stream_and_special_entries(self):
        for extra in (
            {"Symbolic Link": "other"},
            {"Hard Link": "other"},
            {"Reparse": "+"},
            {"Alternate Stream": "+"},
            {"Attributes": "lrwxrwxrwx"},
            {"Attributes": "RPARSE"},
            {"Encrypted": "+"},
            {"Anti": "+"},
            {"Folder": "+"},
            {"Size": "-1"},
            {"Size": str(2**40)},
        ):
            with self.subTest(extra=extra), self.assertRaises(ValueError):
                media.validate_listing(
                    good_listing() + listing_record(f"{media.ARCHIVE_ROOT}/extra", **extra),
                    core,
                )

    def test_listing_requires_both_nonempty_regular_exact_case_members(self):
        for listing in (
            "",
            good_listing().replace("ffprobe.exe", "other.exe"),
            good_listing().replace("ffmpeg.exe", "FFMPEG.EXE"),
            good_listing().replace("Size = 10", "Size = 0"),
            good_listing().replace("Attributes = A", "Attributes = D"),
            good_listing().replace("Encrypted = -", "Path = duplicate"),
            good_listing() + "not a technical record\n",
        ):
            with self.subTest(listing=listing), self.assertRaises(ValueError):
                media.validate_listing(listing, core)

    def make_sevenzip(self, *, link=False):
        payload = b"synthetic unit-test bytes, never executable"
        source = self.cache / "downloads/7zip-win-x64.tar.gz"
        source.parent.mkdir()
        with tarfile.open(source, "w:gz") as archive:
            entry = tarfile.TarInfo("7zip/bin/7za.exe")
            entry.size = len(payload)
            if link:
                entry.type = tarfile.SYMTYPE
                entry.linkname = "elsewhere"
                archive.addfile(entry)
            else:
                archive.addfile(entry, io.BytesIO(payload))
        executable = self.tools / "sevenzip/7zip/bin/7za.exe"
        executable.parent.mkdir(parents=True)
        executable.write_bytes(payload)
        item = {"path": "downloads/7zip-win-x64.tar.gz", "sha256": helper.digest(source)}
        receipt = {
            "schema_version": 1,
            "kind": "development-core-build-tools",
            "release_approved": False,
            "media_cli_included": False,
            "cache": str(self.cache),
            "environment": {"ELECTRON_BUILDER_7ZIP_PATH": str(executable)},
            "files": [item],
        }
        (self.tools / "DEV-TOOLS.json").write_text(json.dumps(receipt))
        return item, executable, payload

    def test_existing_extractor_must_match_verified_tar_bytes(self):
        item, executable, payload = self.make_sevenzip()
        self.assertEqual(
            media.verify_sevenzip(self.cache, self.tools, item, helper, core),
            (executable, sha(payload)),
        )
        executable.write_bytes(b"unverified replacement")
        with self.assertRaisesRegex(ValueError, "differs from its pinned archive"):
            media.verify_sevenzip(self.cache, self.tools, item, helper, core)

    def test_extractor_archive_and_receipt_tampering_are_rejected(self):
        item, _, _ = self.make_sevenzip()
        with self.assertRaises(ValueError):
            media.verify_sevenzip(
                self.cache, self.tools, {**item, "sha256": "0" * 64}, helper, core
            )
        receipt = self.tools / "DEV-TOOLS.json"
        value = json.loads(receipt.read_text())
        value["environment"]["ELECTRON_BUILDER_7ZIP_PATH"] = str(self.root / "arbitrary.exe")
        receipt.write_text(json.dumps(value))
        with self.assertRaisesRegex(ValueError, "does not identify"):
            media.verify_sevenzip(self.cache, self.tools, item, helper, core)

    def test_extractor_archive_links_are_rejected_without_execution(self):
        item, _, _ = self.make_sevenzip(link=True)
        with self.assertRaisesRegex(ValueError, "Unsafe member"):
            media.verify_sevenzip(self.cache, self.tools, item, helper, core)

    def test_only_fixed_archive_can_be_fetched(self):
        lock = json.loads(helper.LOCK.read_text())
        for name in media.PINNED_ARCHIVES:
            for field, replacement in (
                ("url", "https://www.gyan.dev/different.7z"),
                ("version", "9"),
            ):
                changed = copy.deepcopy(lock)
                next(item for item in changed["downloads"] if item["id"] == name)[field] = (
                    replacement
                )
                with patch.object(Path, "read_text", return_value=json.dumps(changed)):
                    with self.subTest(name=name, field=field), self.assertRaises(ValueError):
                        media.pinned_inputs(helper)

    def test_extraction_rechecks_actual_pinned_bytes_and_forbids_extra_files(self):
        directory = self.output / media.ARCHIVE_ROOT / "bin"
        directory.mkdir(parents=True)
        blobs = {name: name.encode() for name in media.PINNED_BINARIES}
        members = {f"{media.ARCHIVE_ROOT}/bin/{name}": len(blob) for name, blob in blobs.items()}
        for name, blob in blobs.items():
            (directory / name).write_bytes(blob)
        with self.assertRaisesRegex(ValueError, "pinned bytes"):
            media.verify_output(self.output, members, helper)
        # Fake hashes are allowed only in this host unit test, not in a CLI input.
        with patch.dict(media.PINNED_BINARIES, {name: sha(blob) for name, blob in blobs.items()}):
            self.assertEqual(media.verify_output(self.output, members, helper), directory)
            (directory / "ffplay.exe").write_bytes(b"unexpected")
            with self.assertRaisesRegex(ValueError, "Unexpected file"):
                media.verify_output(self.output, members, helper)

    def test_mocked_preparation_returns_only_external_bin_and_nonbinary_receipt(self):
        # No Windows tool is run: the subprocess and network guards installed in
        # setUp remain active while this test fakes their higher-level boundary.
        archive, sevenzip_item = media.pinned_inputs(helper)
        archive_path = self.cache / archive["path"]
        archive_path.parent.mkdir()
        archive_path.write_bytes(b"synthetic archive")
        original_digest = helper.digest
        digests = {str(archive_path): archive["sha256"]}
        for name, value in media.PINNED_BINARIES.items():
            digests[str(self.output / media.ARCHIVE_ROOT / "bin" / name)] = value

        def fake_digest(path):
            return digests.get(str(path)) or original_digest(path)

        def fake_run(executable, arguments, cwd):
            self.assertEqual(cwd, self.root)
            if arguments[0] == "l":
                self.assertFalse(self.output.exists())
                return good_listing()
            self.assertEqual(arguments[0], "x")
            self.assertTrue(self.output.is_dir())
            self.assertEqual(
                arguments[-2:],
                sorted(f"{media.ARCHIVE_ROOT}/bin/{name}" for name in media.PINNED_BINARIES),
            )
            directory = self.output / media.ARCHIVE_ROOT / "bin"
            directory.mkdir(parents=True)
            for name in media.PINNED_BINARIES:
                (directory / name).write_bytes(b"0123456789")
            return ""

        def helpers(name, filename):
            return helper if filename == "prepare-prerequisites.py" else core

        fetch_receipt = {"path": archive["path"], "sha256": archive["sha256"], "bytes": 17}
        with (
            patch.object(media, "validate_host"),
            patch.object(media, "load_helper", side_effect=helpers),
            patch.object(
                media, "verify_sevenzip", return_value=(self.tools / "7za.exe", "a" * 64)
            ) as verify,
            patch.object(helper, "fetch", return_value=fetch_receipt) as fetch,
            patch.object(helper, "digest", side_effect=fake_digest),
            patch.object(media, "run_sevenzip", side_effect=fake_run),
        ):
            result = media.prepare(self.cache, self.tools, self.output, self.report, offline=True)
        self.assertEqual(result, self.output / media.ARCHIVE_ROOT / "bin")
        fetch.assert_called_once_with(archive, self.cache, offline=True)
        self.assertEqual(verify.call_count, 2)
        receipt = json.loads(self.report.read_text())
        self.assertEqual(receipt["toolchain_root"], str(result))
        self.assertEqual(receipt["usage"], "TEST_ONLY_NOT_FOR_DISTRIBUTION")
        for flag in (
            "release_approved",
            "formal_release_approved",
            "release_distribution_permitted",
            "artifact_upload_allowed",
        ):
            self.assertIs(receipt[flag], False)
        self.assertEqual(receipt["media_execution"], "NOT_RUN")
        self.assertEqual(receipt["binaries"], media.PINNED_BINARIES)
        self.assertEqual(receipt["extractor"]["archive_sha256"], sevenzip_item["sha256"])
        self.assertLess(self.report.stat().st_size, 8192)
        self.assertEqual(list(self.report.parent.iterdir()), [self.report])


if __name__ == "__main__":
    unittest.main()

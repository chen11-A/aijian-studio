"""Guard release inputs against the upstream daily-build retention window."""

import calendar
import importlib.util
import re
import unittest
from pathlib import Path
from urllib.parse import urlparse


class ReleasePinTests(unittest.TestCase):
    def test_btbn_release_uses_retained_month_end_build(self):
        spec = importlib.util.spec_from_file_location(
            "linux_package", Path(__file__).with_name("package-desktop.py")
        )
        assert spec and spec.loader
        package = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(package)
        url = urlparse(package.FFMPEG_URL)
        self.assertEqual((url.scheme, url.netloc), ("https", "github.com"))
        match = re.fullmatch(
            r"/BtbN/FFmpeg-Builds/releases/download/"
            r"autobuild-(\d{4})-(\d{2})-(\d{2})-\d{2}-\d{2}/"
            r"ffmpeg-n[\w.-]+-linux64-gpl-shared-8\.1\.tar\.xz",
            url.path,
        )
        self.assertIsNotNone(match, "Use a fixed official release, never floating latest")
        assert match
        year, month, day = map(int, match.groups())
        self.assertEqual(
            day,
            calendar.monthrange(year, month)[1],
            "Daily builds expire after 14 days; month-end builds are retained for two years",
        )
        self.assertRegex(package.FFMPEG_SHA256, r"^[0-9a-f]{64}$")


if __name__ == "__main__":
    unittest.main()

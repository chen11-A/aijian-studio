"""Core NSIS syntax/manifest safety, without executing an installer."""

import importlib.util
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("core_nsis", HERE / "nsis-dev-core.py")
assert spec and spec.loader
core = importlib.util.module_from_spec(spec)
spec.loader.exec_module(core)


class NsisCoreTests(unittest.TestCase):
    def make_app(self, root: Path) -> Path:
        app = root / "app"
        app.mkdir()
        (app / "AIVORA.exe").write_bytes(b"MZsynthetic packaging input; never execute")
        (app / "resources").mkdir()
        (app / "resources/owned-file.txt").write_text("fixture")
        return app

    def test_script_has_only_explicit_program_deletion_and_no_plugin_calls(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            app = self.make_app(root)
            script, files = core.generate_script(
                app, root / "syntax-only.exe", HERE / "installer.dev-core.nsh"
            )
            self.assertEqual(len(files), 2)
            self.assertIn("RequestExecutionLevel highest", script)
            self.assertIn("SetCompressor /FINAL zlib", script)
            self.assertIn('!insertmacro MUI_LANGUAGE "SimpChinese"', script)
            self.assertIn("!insertmacro MUI_PAGE_DIRECTORY", script)
            self.assertIn("!insertmacro MUI_PAGE_COMPONENTS", script)
            self.assertIn('!define MUI_FINISHPAGE_RUN_TEXT "启动 AIVORA"', script)
            self.assertIn('Section "为当前用户安装" SEC_USER', script)
            self.assertIn('Section /o "为所有用户安装" SEC_ALL', script)
            self.assertIn('Section "开始菜单快捷方式" SEC_START', script)
            self.assertIn('Section "桌面快捷方式" SEC_DESKTOP', script)
            self.assertIn('InstallDir "$LOCALAPPDATA\\Programs\\AIVORA"', script)
            self.assertIn('Name "AIVORA"', script)
            self.assertIn('VIProductVersion "0.2.5.0"', script)
            self.assertNotIn("0.1.0-dev", script)
            self.assertNotIn('Name "AIVORA Dev Core"', script)
            hook = (HERE / "installer.dev-core.nsh").read_text()
            self.assertIn('"CurrentMajorVersionNumber"', hook)
            self.assertIn("SetRegView lastused", hook)
            self.assertIn("IfErrors aivoraDevUnsupportedWindows", hook)
            self.assertIn("AIVORA 需要 Windows 10 或更高版本。", hook)
            self.assertNotIn("$APPDATA", hook)
            self.assertNotIn("AIVORA Dev Core", hook)
            self.assertNotIn("::", script)
            self.assertNotIn("RMDir /r", script)
            self.assertNotIn('Delete "$APPDATA', script)
            self.assertNotIn('Delete "$INSTDIR\\*', script)
            self.assertIn('Delete "$INSTDIR\\resources\\owned-file.txt"', script)
            self.assertIn('Delete "$INSTDIR\\AIVORA Dev Core.exe"', script)

    def test_unsafe_literal_and_colliding_uninstaller_are_rejected(self):
        with self.assertRaises(ValueError):
            core.literal("line\nbreak")
        self.assertEqual(core.literal("$value"), '"$$value"')
        with tempfile.TemporaryDirectory() as directory:
            app = self.make_app(Path(directory))
            (app / "Uninstall.exe").write_bytes(b"collision")
            with self.assertRaisesRegex(ValueError, "collides"):
                core.program_files(app)

    def test_real_pinned_compiler_accepts_synthetic_installer_script(self):
        value = os.environ.get("AIVORA_NSIS_TEST_ROOT")
        if not value:
            self.skipTest("Set AIVORA_NSIS_TEST_ROOT to the verified NSIS cache")
        nsis = Path(value)
        is_windows = sys.platform == "win32"
        compiler = nsis / ("Bin/makensis.exe" if is_windows else "linux/makensis")
        expected = (
            core.NSIS_WINDOWS_COMPILER_SHA256 if is_windows else core.NSIS_LINUX_COMPILER_SHA256
        )
        self.assertEqual(core.digest(compiler), expected)
        self.assertEqual(core.digest(nsis / "COPYING"), core.NSIS_COPYING_SHA256)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            app = self.make_app(root)
            output = root / "synthetic-never-executed-installer.exe"
            script, _files = core.generate_script(app, output, HERE / "installer.dev-core.nsh")
            source = root / "core.nsi"
            source.write_text(script, encoding="utf-8-sig")
            result = subprocess.run(
                [str(compiler), "/V2" if is_windows else "-V2", str(source)],
                cwd=root,
                env={**os.environ, "NSISDIR": str(nsis)},
                capture_output=True,
                text=True,
                timeout=30,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(output.read_bytes()[:2], b"MZ")


if __name__ == "__main__":
    unittest.main()

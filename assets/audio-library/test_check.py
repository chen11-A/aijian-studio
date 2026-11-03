"""检查器的离线异常回归测试。"""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('audio_check', Path(__file__).with_name('check.py'))
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)


class CheckTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.tool = self.root / '工具 路径'
        self.tool.write_text('模拟工具')

    def validate(self, entries):
        (self.root / 'manifest.json').write_text(json.dumps(entries))
        return check.validate(self.root, self.tool, self.tool)[0]

    def test_absolute_tool_required(self):
        errors, _ = check.validate(self.root, Path('ffmpeg'), Path('ffprobe'))
        self.assertIn('绝对路径', errors[0])

    def test_missing_manifest(self):
        self.assertIn('无法读取', check.validate(self.root, self.tool, self.tool)[0][0])

    def test_invalid_manifest(self):
        self.assertIn('无法读取', self.validate({})[0])

    def test_counts_required(self):
        self.assertEqual(len(self.validate([])), 2)

    def test_incomplete_entry(self):
        self.assertIn('字段不完整', self.validate([{}])[0])

    def test_unlisted_audio(self):
        (self.root / '未知.ogg').write_bytes(b'x')
        self.assertTrue(any('未收录' in x for x in self.validate([])))

    def test_tool_failure_chinese(self):
        with self.assertRaisesRegex(ValueError, '工具运行失败'):
            check.run(self.root / '不存在', [])

    def test_parse_loudness(self):
        result = type('Result', (), {'stderr': '信息\n{"input_i":"-18.01"}'})()
        with patch.object(check, 'run', return_value=result):
            self.assertEqual(check.measured_loudness(self.root, self.tool), -18.01)

    def test_missing_loudness(self):
        result = type('Result', (), {'stderr': '没有数据'})()
        with patch.object(check, 'run', return_value=result):
            with self.assertRaisesRegex(ValueError, '无法测量'):
                check.measured_loudness(self.root, self.tool)


if __name__ == '__main__':
    unittest.main()

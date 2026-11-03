"""检查器的离线异常回归测试。"""
import importlib.util
import json
import hashlib
import os
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


class NewRequirementsTests(CheckTests):
    def fixture(self, **changes):
        file = self.root / '测试 音频.ogg'
        file.write_bytes(b'fake-audio-for-probe-mock')
        item = dict(id='声音', path=file.name, type='sfx', category='环境', name='小雨',
                    tags=['雨'], scene='适合雨天场景。', duration=5, loop=False,
                    loudness=-20, targetLufs=-20, source='https://example.org/audio',
                    license='CC0-1.0', sha256=hashlib.sha256(file.read_bytes()).hexdigest())
        item.update(changes)
        return item

    def validate_media(self, entries, strict=False, measured=-20):
        (self.root / 'manifest.json').write_text(json.dumps(entries))
        probe = {'streams': [{'codec_name': 'vorbis', 'sample_rate': '48000', 'channels': 1}],
                 'format': {'format_name': 'ogg', 'duration': '5'}}
        result = type('Result', (), {'stdout': json.dumps(probe)})()
        with patch.object(check, 'run', return_value=result), \
             patch.object(check, 'measured_loudness', return_value=measured):
            return check.validate(self.root, self.tool, self.tool, strict_request=strict)

    def test_target_defaults(self):
        self.assertEqual(check.target_lufs({'type': 'sfx'}), -18)
        self.assertEqual(check.target_lufs({'type': 'music'}), -20)

    def test_allowed_targets(self):
        for target in (-20, -18):
            self.assertEqual(check.target_lufs({'type': 'sfx', 'targetLufs': target}), target)

    def test_invalid_targets(self):
        for target in (True, '-20', None, -19, float('inf'), float('nan')):
            with self.subTest(target=target), self.assertRaisesRegex(ValueError, '目标响度'):
                check.target_lufs({'type': 'sfx', 'targetLufs': target})
        with self.assertRaisesRegex(ValueError, '配乐目标'):
            check.target_lufs({'type': 'music', 'targetLufs': -18})

    def test_loop_flag_compatibility(self):
        self.assertTrue(check.loopable({'loop': True}))
        self.assertFalse(check.loopable({'loop': False}))
        self.assertTrue(check.loopable({'loop': True, 'loopable': True}))
        for value in ('true', 1, None, False):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, '可循环标记'):
                check.loopable({'loop': True, 'loopable': value})

    def test_new_target_measurement(self):
        self.assertEqual(self.validate_media([self.fixture()])[0], ['音效不足 60 个。', '配乐不足 20 首。'])
        errors, _ = self.validate_media([self.fixture()], measured=-18)
        self.assertTrue(any('实测响度' in error for error in errors))

    def test_invalid_media_metadata_rejected(self):
        for key, value in [('category', []), ('duration', float('nan')), ('loudness', True), ('duration', 0)]:
            with self.subTest(key=key, value=value):
                errors, _ = self.validate_media([self.fixture(**{key: value})], strict=True)
                self.assertTrue(any('须为' in error for error in errors))

    def test_old_target_measurement(self):
        item = self.fixture(loudness=-18)
        del item['targetLufs']
        errors, _ = self.validate_media([item], measured=-18)
        self.assertFalse(any('响度' in error for error in errors))

    def test_mismatched_loop_flag_rejected(self):
        errors, _ = self.validate_media([self.fixture(loopable=True)])
        self.assertTrue(any('可循环标记' in error for error in errors))

    def test_loop_requires_actual_seam_check(self):
        with patch.object(check, 'validate_loop_seam') as seam:
            self.validate_media([self.fixture(loop=True, loopable=True)])
            seam.assert_called_once_with(self.root / '测试 音频.ogg', self.tool)
        with patch.object(check, 'validate_loop_seam', side_effect=ValueError('循环接缝不合格')):
            errors, report = self.validate_media([self.fixture(loop=True, loopable=True)], strict=True)
            self.assertTrue(any('循环接缝不合格' in error for error in errors))
            self.assertEqual(report['可循环环境音数量']['雨'], 0)

    def test_actual_ogg_seam_decode(self):
        ffmpeg = Path(os.environ.get('FFMPEG_PATH', '/usr/bin/ffmpeg'))
        seamless = self.root / '真实解码 循环.ogg'
        check.run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i',
                          'anoisesrc=color=pink:sample_rate=48000:duration=2:seed=17',
                          '-c:a', 'libvorbis', str(seamless)])
        metrics = check.validate_loop_seam(seamless, ffmpeg)
        self.assertTrue(metrics['passed'])
        faded = self.root / '错误接缝.ogg'
        check.run(ffmpeg, ['-v', 'error', '-i', str(seamless), '-af',
                          'afade=t=out:st=1:d=1', '-c:a', 'libvorbis', str(faded)])
        with self.assertRaisesRegex(ValueError, '循环接缝检查未通过'):
            check.validate_loop_seam(faded, ffmpeg)

    def test_strict_reports_every_missing_category(self):
        errors, report = check.strict_requirements([])
        self.assertEqual(len(errors), 19)
        self.assertEqual(list(report['指定类别数量']), list(check.STRICT_CATEGORIES))
        self.assertTrue(all('不足 3' in error for error in errors[:12]))

    def test_strict_uses_exact_category_or_tag(self):
        entries = [self.fixture(category='虫鸣', tags=['森林里的虫鸣', '雨声'], loop=True),
                   self.fixture(type='music', category='虫鸣', tags=['虫鸣'], loop=True)]
        _, report = check.strict_requirements(entries)
        self.assertEqual(report['指定类别数量']['虫鸣'], 1)
        self.assertEqual(report['指定类别数量']['森林'], 0)
        self.assertEqual(report['可循环环境音数量']['雨'], 0)

    def test_strict_success(self):
        entries = []
        for category in check.STRICT_CATEGORIES:
            entries.extend(self.fixture(tags=[category], loop=True, loopable=True) for _ in range(3))
        for category in ('雨', '风'):
            entries.append(self.fixture(tags=[category], loop=True, loopable=True))
        errors, report = check.strict_requirements(entries)
        self.assertEqual(errors, [])
        self.assertTrue(all(count == 3 for count in report['指定类别数量'].values()))

    def test_strict_is_opt_in(self):
        errors, report = self.validate_media([self.fixture()])
        self.assertNotIn('指定类别数量', report)
        self.assertFalse(any('严格验收' in error for error in errors))
        errors, report = self.validate_media([self.fixture()], strict=True)
        self.assertIn('指定类别数量', report)
        self.assertTrue(any('严格验收' in error for error in errors))


if __name__ == '__main__':
    unittest.main()

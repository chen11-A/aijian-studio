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
                    license='CC0-1.0', author='测试作者', sha256=hashlib.sha256(file.read_bytes()).hexdigest())
        item.update(changes)
        return item

    def validate_media(self, entries, strict=False, measured=-20):
        (self.root / 'manifest.json').write_text(json.dumps(entries))
        probe = {'streams': [{'codec_name': 'vorbis', 'sample_rate': '48000', 'channels': 1}],
                 'format': {'format_name': 'ogg', 'duration': '5'}}
        result = type('Result', (), {'stdout': json.dumps(probe)})()
        with patch.object(check, 'run', return_value=result), \
             patch.object(check, 'measured_levels', return_value={'loudness':measured,'truePeak':-2,'samplePeak':-2.1}):
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
            seam.assert_called_once_with(self.root / '测试 音频.ogg', self.tool, channels=1)
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

    def test_stereo_seam_checks_both_channels(self):
        ffmpeg = Path(os.environ.get('FFMPEG_PATH','/usr/bin/ffmpeg'))
        audio = self.root/'右声道接缝错误.ogg'
        check.run(ffmpeg,['-v','error','-f','lavfi','-i','anoisesrc=color=pink:sample_rate=48000:duration=2:seed=17',
            '-f','lavfi','-i','anoisesrc=color=pink:sample_rate=48000:duration=2:seed=17',
            '-filter_complex','[1:a]afade=t=out:st=1:d=1[r];[0:a][r]amerge=inputs=2[out]',
            '-map','[out]','-c:a','libvorbis',str(audio)])
        with self.assertRaisesRegex(ValueError,'每声道'):
            check.validate_loop_seam(audio,ffmpeg,channels=2)

    def test_strict_reports_every_missing_category(self):
        errors, report = check.strict_requirements([])
        self.assertEqual(len(errors), len(check.STRICT_CATEGORIES)+1+len(check.MUSIC_EMOTIONS)+1+5)
        self.assertEqual(list(report['指定类别数量']), list(check.STRICT_CATEGORIES))
        self.assertTrue(all('不足 3' in error for error in errors[:len(check.STRICT_CATEGORIES)]))

    def test_strict_uses_exact_category_or_tag(self):
        entries = [self.fixture(category='刀挥砍', tags=['森林里的虫鸣', '雨声'], loop=True),
                   self.fixture(type='music', category='刀挥砍', tags=['刀挥砍'], loop=True)]
        _, report = check.strict_requirements(entries)
        self.assertEqual(report['指定类别数量']['刀挥砍'], 1)
        self.assertEqual(report['指定类别数量']['刀划伤'], 0)
        self.assertEqual(report['可循环环境音数量']['雨'], 0)

    def test_strict_success(self):
        entries = []
        for category in check.STRICT_CATEGORIES:
            entries.extend(self.fixture(tags=[category], loop=True, loopable=True) for _ in range(3))
        for n in range(8):
            entries.append(self.fixture(tags=['雨','风','雨打伞','雨打窗','喘息'], duration=40,
                           loop=True,loopable=True,recordingVerified=True,source=f'https://example.org/recording/{n}'))
        for emotion in check.MUSIC_EMOTIONS:
            entries.append(self.fixture(type='music',category=emotion,tags=[emotion],loop=True))
        for n in range(2):
            entries.append(self.fixture(type='music',category='悲伤',tags=['悲伤'],loop=True,source=f'https://example.org/sad/{n}'))
        errors, report = check.strict_requirements(entries)
        self.assertEqual(errors, [])
        self.assertTrue(all(count == 3 for count in report['指定类别数量'].values()))

    def test_strict_does_not_count_same_song_twice_or_claim_recording(self):
        one=self.fixture(type='music',category='悲伤',tags=['悲伤'],loop=True)
        _, report=check.strict_requirements([one,{**one,'id':'derived'}])
        self.assertEqual(report['悲伤配乐独立来源数'],1)
        _, report=check.strict_requirements([self.fixture(tags=['雨'],loop=True,duration=40)])
        self.assertEqual(report['真实录音数量']['雨'],0)

    def test_strict_is_opt_in(self):
        errors, report = self.validate_media([self.fixture()])
        self.assertNotIn('指定类别数量', report)
        self.assertFalse(any('严格验收' in error for error in errors))
        errors, report = self.validate_media([self.fixture()], strict=True)
        self.assertIn('指定类别数量', report)
        self.assertTrue(any('严格验收' in error for error in errors))


class PeakSafetyTests(unittest.TestCase):
    def test_peak_checks_and_quieter_short_effects(self):
        item = {'loudness':-30, 'peakLimited':True}
        levels = {'loudness':-30, 'truePeak':-1.5, 'samplePeak':-1.6}
        check.validate_levels(item, levels, -18)
        for name in ('truePeak', 'samplePeak'):
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, '峰值超标'):
                check.validate_levels(item, {**levels, name:0.5}, -18)
        with self.assertRaisesRegex(ValueError, 'peakLimited'):
            check.validate_levels({'loudness':-30}, levels, -18)
        with self.assertRaisesRegex(ValueError, '实测响度'):
            check.validate_levels({'loudness':-29}, levels, -18)
        with self.assertRaisesRegex(ValueError, '布尔值'):
            check.validate_levels({'loudness':-30,'peakLimited':'true'},levels,-18)
        for invalid in (float('nan'), True, '-1', -10):
            with self.subTest(value=invalid), self.assertRaisesRegex(ValueError, '实测峰值'):
                check.validate_levels({**item,'truePeak':invalid},levels,-18)

    def test_real_short_effect_has_no_integrated_loudness(self):
        ffmpeg = Path(os.environ.get('FFMPEG_PATH', '/usr/bin/ffmpeg'))
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory)/'短促.ogg'
            check.run(ffmpeg,['-v','error','-f','lavfi','-i','sine=frequency=900:sample_rate=48000:duration=0.15',
                              '-c:a','libvorbis',str(file)])
            levels=check.measured_levels(file,ffmpeg)
            self.assertIsNone(levels['loudness'])
            item={'loudness':None,'duration':.15,'loudnessNote':'片段不足400毫秒，无法测量积分响度'}
            check.validate_levels(item,levels,-18)
            for changed in ({'duration':.5},{'loudnessNote':''},{'loudness':-18}):
                with self.assertRaisesRegex(ValueError,'400 毫秒'):
                    check.validate_levels({**item,**changed},levels,-18)
            with self.assertRaisesRegex(ValueError,'峰值超标'):
                check.validate_levels(item,{**levels,'samplePeak':0},-18)

    def test_true_ogg_overload_rejected_and_repaired(self):
        ffmpeg = Path(os.environ.get('FFMPEG_PATH', '/usr/bin/ffmpeg'))
        ffprobe = Path(os.environ.get('FFPROBE_PATH', '/usr/bin/ffprobe'))
        with tempfile.TemporaryDirectory(prefix='真实峰值 中文 ') as directory:
            root = Path(directory)
            file = root / '超峰 音效.ogg'
            # Vorbis 浮点允许记录大于 1 的采样，不能先转整数 PCM 截断再测。
            check.run(ffmpeg, ['-v','error','-f','lavfi','-i','sine=frequency=997:sample_rate=48000:duration=1',
                              '-af','volume=40dB','-c:a','libvorbis',str(file)])
            before = check.measured_levels(file, ffmpeg)
            self.assertGreater(before['samplePeak'], 0)
            self.assertGreater(before['truePeak'], 0)
            item = dict(id='overload',name='超峰',path=file.name,type='sfx',category='测试',tags=['测试'],
                        scene='真实测试',duration=1,loop=False,loudness=before['loudness'],source='https://example.org/source',
                        license='CC0-1.0',author='测试夹具',sha256=hashlib.sha256(file.read_bytes()).hexdigest())
            (root/'manifest.json').write_text(json.dumps([item]))
            errors, report = check.validate(root, ffmpeg, ffprobe)
            self.assertTrue(any('真峰值超标' in x for x in errors))
            self.assertEqual(report['峰值检查']['真峰值超标数'],1)
            peak_spec = importlib.util.spec_from_file_location('peak_safety_test',Path(__file__).with_name('peak_safety.py'))
            peak = importlib.util.module_from_spec(peak_spec); peak_spec.loader.exec_module(peak)
            after,gain = peak.repair_file(file,ffmpeg,before)
            self.assertLess(gain,0)
            self.assertLessEqual(after['truePeak'],-1)
            self.assertLessEqual(after['samplePeak'],-1)
            item.update(after); item['peakLimited']=True; item['sha256']=hashlib.sha256(file.read_bytes()).hexdigest()
            # 大幅衰减的纯音仍可能高于 -18；测试保留真实响度，继续降低到目标以下。
            if after['loudness'] > -17:
                quieter=root/'安静.ogg'
                check.run(ffmpeg,['-v','error','-i',str(file),'-af','volume=-20dB','-c:a','libvorbis',str(quieter)])
                file.write_bytes(quieter.read_bytes()); quieter.unlink()
                item.update(check.measured_levels(file,ffmpeg));item['sha256']=hashlib.sha256(file.read_bytes()).hexdigest()
            (root/'manifest.json').write_text(json.dumps([item]))
            errors, report = check.validate(root,ffmpeg,ffprobe)
            self.assertEqual(errors,['音效不足 60 个。','配乐不足 20 首。'])
            self.assertEqual(report['峰值检查']['真峰值超标数'],0)
            self.assertEqual(report['峰值检查']['采样峰值超标数'],0)


if __name__ == '__main__':
    unittest.main()

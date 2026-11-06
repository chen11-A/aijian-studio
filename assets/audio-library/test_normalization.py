"""使用真正Ogg编码/解码验证第三轮动态响度处理。"""
import hashlib
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest

ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('round3_normalization',ROOT/'normalization/normalize.py')
normalization=importlib.util.module_from_spec(spec);spec.loader.exec_module(normalization)


class NormalizationTests(unittest.TestCase):
    def test_real_quiet_audio_is_louder_peak_safe_and_same_length(self):
        ffmpeg=os.environ.get('FFMPEG_PATH','/usr/bin/ffmpeg')
        ffprobe=os.environ.get('FFPROBE_PATH','/usr/bin/ffprobe')
        with tempfile.TemporaryDirectory(prefix='循环测试 空格 ') as folder:
            root=Path(folder);audio=root/'安静循环.ogg'
            normalization.run([ffmpeg,'-v','error','-f','lavfi','-i',
                'sine=frequency=1000:sample_rate=48000:duration=1','-af','volume=-35dB',
                '-c:a','libvorbis',str(audio)])
            original=audio.read_bytes();oldroot=normalization.ROOT
            try:
                normalization.ROOT=root
                result=normalization.process({'id':'真实循环','path':audio.name,'type':'sfx',
                    'loop':False},ffmpeg,ffprobe,apply=True)
            finally:
                normalization.ROOT=oldroot
            self.assertTrue(result['modified'])
            self.assertLess(result['before']['loudness'],-21)
            self.assertGreaterEqual(result['after']['loudness'],-21)
            self.assertLessEqual(result['after']['loudness'],-15)
            self.assertLessEqual(result['after']['truePeak'],-1)
            self.assertLessEqual(result['after']['samplePeak'],-1)
            self.assertIsNone(result['seam'])
            self.assertAlmostEqual(result['duration'],1,places=3)
            self.assertNotEqual(original,audio.read_bytes())
            self.assertEqual(result['sha256'],hashlib.sha256(audio.read_bytes()).hexdigest())

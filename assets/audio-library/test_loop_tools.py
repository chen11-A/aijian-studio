import json
import hashlib
import os
import math
from pathlib import Path
import unittest
from array import array
from loop_tools import RATE, crossfade_loop, pcm_bytes, seam_metrics, run, decode


class LoopTests(unittest.TestCase):
    def test_crossfade_keeps_original_neighbor_boundary(self):
        samples = array('f', (.1 + .03 * math.sin(i / 10) for i in range(4800)))
        result, seconds = crossfade_loop(samples, .02)
        overlap = round(seconds * RATE)
        self.assertEqual(len(result), len(samples) - overlap)
        self.assertAlmostEqual(result[-1], samples[overlap - 1])
        self.assertAlmostEqual(result[0], samples[overlap])
        self.assertGreater(result[0], .05)  # 不是淡到零的伪循环

    def test_invalid_fade(self):
        for value in [0, -1, math.nan]:
            with self.assertRaisesRegex(ValueError, '交叉淡化'):
                crossfade_loop(array('f', [1] * 4800), value)
        with self.assertRaises(ValueError):
            crossfade_loop(array('f', [1]), .5)

    def test_explicit_executable(self):
        with self.assertRaisesRegex(ValueError, '完整路径'):
            run('ffmpeg', [])
        with self.assertRaisesRegex(ValueError, '处理失败'):
            run('/不存在/ffmpeg', [])

    def test_seam_rejects_jump(self):
        samples = array('f', (.1 * math.sin(i / 10) for i in range(4800)))
        samples[-1] = 10
        self.assertFalse(seam_metrics(samples)['passed'])
        self.assertEqual(len(pcm_bytes(samples)), len(samples) * 4)

    def test_delivered_reports_and_metadata(self):
        directory = Path(__file__).resolve().parent
        entries = json.loads((directory / 'loop_entries.json').read_text())
        self.assertEqual(len(entries), 2)
        for entry in entries:
            report = json.loads((directory / entry['loopReport']).read_text())
            self.assertTrue(entry['loop'] and entry['loopable'] and report['seam']['passed'])
            self.assertEqual(report['channels'], 1)
            self.assertGreaterEqual(report['duration'], 30)
            self.assertLessEqual(report['duration'], 60)
            self.assertLessEqual(report['truePeak'], -1)
            self.assertLessEqual(report['samplePeak'], -1)
            self.assertLessEqual(abs(report['loudness'] + 20), 1)
            self.assertFalse(report['subjectiveListeningCompleted'])
            audio = directory / entry['path']
            self.assertEqual(hashlib.sha256(audio.read_bytes()).hexdigest(), entry['sha256'])
            self.assertEqual(report['outputSha256'], entry['sha256'])
            self.assertTrue(seam_metrics(decode(os.environ.get('FFMPEG_PATH', '/usr/bin/ffmpeg'), audio))['passed'])



if __name__ == '__main__':
    unittest.main()

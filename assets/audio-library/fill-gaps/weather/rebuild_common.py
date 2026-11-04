#!/usr/bin/env python3
"""离线重建工具；仅从指定本地原录音读取，不联网。"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import subprocess
import sys
import tempfile

LIBRARY = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(LIBRARY))
import loop_tools as audio


def absolute_program(value):
    path = Path(value)
    if not path.is_absolute() or not path.is_file():
        raise argparse.ArgumentTypeError('请提供存在的程序绝对路径')
    return str(path)


def measurements(ffmpeg, path):
    samples = audio.decode(ffmpeg, path)
    loudness = audio.measure(ffmpeg, path)
    sample_peak = 20 * math.log10(max(abs(x) for x in samples))
    return samples, loudness, sample_peak


def attenuate(ffmpeg, path, gain):
    temporary = path.with_name(path.stem + '-调整.ogg')
    audio.run(ffmpeg, ['-n', '-i', str(path), '-af', f'volume={gain}dB',
                      '-ac', '1', '-ar', '48000', '-c:a', 'libvorbis',
                      '-q:a', '5', str(temporary)])
    temporary.replace(path)


def verify_source(source, evidence):
    expected = evidence.get('sourceSha256', evidence.get('downloadSha256'))
    if hashlib.sha256(source.read_bytes()).hexdigest() != expected:
        raise ValueError('原录音校验值不符：' + source.name)


def finish(ffmpeg, ffprobe, destination, loop):
    for attempt in range(6):
        samples, loudness, sample_peak = measurements(ffmpeg, destination)
        peak = max(sample_peak, loudness['true_peak_dbtp'])
        if peak <= -1:
            break
        if attempt == 5:
            raise ValueError('峰值检查失败：' + destination.name)
        attenuate(ffmpeg, destination, -3 - peak)
    probe = json.loads(subprocess.run(
        [ffprobe, '-v', 'error', '-show_streams', '-of', 'json', str(destination)],
        capture_output=True, check=True, text=True, encoding='utf-8').stdout)
    stream = probe['streams'][0]
    if (stream.get('sample_rate'), stream.get('channels'), stream.get('codec_name')) != ('48000', 1, 'vorbis'):
        raise ValueError('输出格式检查失败')
    report = dict(duration=len(samples) / 48000, **loudness,
                  sample_peak_dbfs=sample_peak,
                  sha256=hashlib.sha256(destination.read_bytes()).hexdigest(),
                  subjective_listening_completed=False)
    if loop:
        report['seam'] = audio.seam_metrics(samples)
        if not report['seam']['passed']:
            raise ValueError('循环接缝检查失败：' + destination.name)
    destination.with_suffix('.json').write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return report


class ChineseParser(argparse.ArgumentParser):
    def error(self, message):
        self.print_help(sys.stderr)
        self.exit(2, '参数无效，请检查必需参数、程序绝对路径、输入目录和新输出目录。\n')


def arguments():
    parser = ChineseParser(description=__doc__, add_help=False, usage='%(prog)s --ffmpeg 程序绝对路径 --ffprobe 程序绝对路径 --input-dir 原录音目录 --output-dir 新目录')
    parser._optionals.title = '参数'
    parser.add_argument('-h', '--help', action='help', help='显示帮助')
    parser.add_argument('--ffmpeg', required=True, type=absolute_program)
    parser.add_argument('--ffprobe', required=True, type=absolute_program)
    parser.add_argument('--input-dir', required=True, type=Path, help='原录音目录，支持中文和空格')
    parser.add_argument('--output-dir', required=True, type=Path, help='尚不存在的新输出目录')
    args = parser.parse_args()
    if not args.input_dir.is_dir():
        parser.error('原录音目录不存在')
    if args.output_dir.exists():
        parser.error('输出目录已存在，请指定新目录，避免覆盖已锁定音频')
    args.output_dir.mkdir(parents=True)
    return args

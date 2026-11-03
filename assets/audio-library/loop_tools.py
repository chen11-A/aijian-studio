#!/usr/bin/env python3
"""从真实环境录音生成交叉淡化循环；仅使用 Python 标准库和显式 ffmpeg 路径。"""
import argparse
from array import array
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import sys
import tempfile

RATE = 48000


def run(ffmpeg, args, data=None):
    if not Path(ffmpeg).is_absolute():
        raise ValueError('请提供 ffmpeg 完整路径')
    try:
        return subprocess.run([str(ffmpeg), '-hide_banner', '-nostdin', *args], input=data,
                              capture_output=True, check=True)
    except (OSError, subprocess.CalledProcessError) as exc:
        raise ValueError('音频处理失败，请检查程序路径、输入文件和编码器') from exc


def decode(ffmpeg, path):
    raw = run(ffmpeg, ['-i', str(path), '-vn', '-ac', '1', '-ar', str(RATE), '-f', 'f32le', '-']).stdout
    samples = array('f')
    samples.frombytes(raw)
    if sys.byteorder != 'little':
        samples.byteswap()
    if len(samples) < RATE // 2 or not all(math.isfinite(x) for x in samples):
        raise ValueError('音频太短或包含无效采样')
    return samples


def pcm_bytes(samples):
    data = array('f', samples)
    if sys.byteorder != 'little':
        data.byteswap()
    return data.tobytes()


def crossfade_loop(samples, seconds=.5):
    """输出中段+尾首等功率交叉淡化；循环边界回到原录音相邻采样。"""
    if not math.isfinite(seconds) or seconds <= 0:
        raise ValueError('交叉淡化时间必须大于零')
    count = min(round(seconds * RATE), len(samples) // 4)
    if count < 2:
        raise ValueError('交叉淡化区间太短')
    output = array('f', samples[count:-count])
    for i in range(count):
        angle = i / (count - 1) * math.pi / 2
        output.append(samples[len(samples) - count + i] * math.cos(angle) + samples[i] * math.sin(angle))
    return output, count / RATE


def measure(ffmpeg, path):
    log = run(ffmpeg, ['-i', str(path), '-af', 'loudnorm=I=-20:TP=-1:LRA=11:print_format=json', '-f', 'null', '-']).stderr.decode('utf-8', 'replace')
    blocks = re.findall(r'\{[^{}]*"input_i"[^{}]*\}', log)
    if not blocks:
        raise ValueError('没有测得响度')
    data = json.loads(blocks[-1])
    values = {'integrated_lufs': float(data['input_i']), 'true_peak_dbtp': float(data['input_tp'])}
    if not all(math.isfinite(x) for x in values.values()):
        raise ValueError('录音没有可测量的声音')
    return values


def percentile(values, fraction):
    values = sorted(values)
    return values[min(len(values) - 1, round((len(values) - 1) * fraction))]


def rms(samples):
    return math.sqrt(sum(x * x for x in samples) / len(samples))


def seam_metrics(samples):
    """在最终有损编码解码后的样本上检查；不替代主观试听。"""
    width = min(round(.02 * RATE), len(samples) // 8)
    jumps = [abs(samples[i] - samples[i - 1]) for i in range(1, len(samples))]
    boundary = abs(samples[-1] - samples[0])
    p95, p99 = percentile(jumps, .95), percentile(jumps, .99)
    seam = rms(samples[-width:] + samples[:width])
    nearby = rms(samples[-3 * width:-width] + samples[width:3 * width])
    ratio = seam / nearby if nearby else math.inf
    left, right = rms(samples[-width:]), rms(samples[:width])
    left_right = left / right if right else math.inf
    return {'boundary_sample_jump': boundary, 'adjacent_difference_p95': p95,
            'adjacent_difference_p99': p99,
            'boundary_difference_percentile': 100 * sum(x <= boundary for x in jumps) / len(jumps),
            'boundary_to_p99_ratio': boundary / p99 if p99 else math.inf,
            'seam_window_ms_each_side': width / RATE * 1000,
            'seam_rms': seam, 'nearby_rms': nearby, 'seam_to_nearby_rms_ratio': ratio,
            'left_to_right_rms_ratio': left_right,
            'passed': boundary <= p99 and .5 <= ratio <= 2 and .5 <= left_right <= 2,
            'limits': '边界跳变≤全片相邻差分99百分位；接缝/附近及左/右20毫秒RMS比在0.5至2之间。客观检查不等同主观试听。'}


def make_loop(ffmpeg, source, destination, fade=.5, target=-20):
    source, destination = Path(source), Path(destination)
    if destination.exists() or source.resolve() == destination.resolve():
        raise ValueError('输出文件已存在，不能覆盖原始录音')
    if not math.isfinite(target) or not -30 <= target <= -12:
        raise ValueError('目标响度应在 -30 至 -12 LUFS 之间')
    original_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    samples, actual_fade = crossfade_loop(decode(ffmpeg, source), fade)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='真实录音 循环 ') as directory:
        intermediate = Path(directory) / '交叉淡化.wav'
        run(ffmpeg, ['-f', 'f32le', '-ar', str(RATE), '-ac', '1', '-i', '-', '-c:a', 'pcm_f32le', str(intermediate)], pcm_bytes(samples))
        before = measure(ffmpeg, intermediate)
        gain = target - before['integrated_lufs']
        soft_limit = before['true_peak_dbtp'] + gain > -1.5
        if soft_limit:
            # 无状态柔性限幅保持循环周期，不引入首尾静音或压缩器启动状态。
            scale = 10 ** (gain / 20)
            samples = array('f', (.65 * math.tanh(x * scale / .65) for x in samples))
            run(ffmpeg, ['-y', '-f', 'f32le', '-ar', str(RATE), '-ac', '1', '-i', '-', '-c:a', 'pcm_f32le', str(intermediate)], pcm_bytes(samples))
            limited = measure(ffmpeg, intermediate)
            gain = target - limited['integrated_lufs']
        run(ffmpeg, ['-n', '-i', str(intermediate), '-af', f'volume={gain}dB', '-ar', str(RATE), '-ac', '1', '-c:a', 'libvorbis', '-q:a', '5', str(destination)])
    decoded = decode(ffmpeg, destination)
    metrics = seam_metrics(decoded)
    loudness = measure(ffmpeg, destination)
    valid = metrics['passed'] and abs(loudness['integrated_lufs'] - target) <= .5 and loudness['true_peak_dbtp'] <= -1
    report = {'input_sha256': original_hash, 'output_sha256': hashlib.sha256(destination.read_bytes()).hexdigest(),
              'duration': len(decoded) / RATE, 'sample_rate': RATE, 'channels': 1,
              'crossfade_seconds': actual_fade, 'constant_gain_db': gain, 'soft_peak_limiting_applied': soft_limit, **loudness, 'seam': metrics,
              'passed': valid, 'subjective_listening_completed': False,
              'processing': '解码48kHz单声道；保留中段，将尾段和首段做等功率重叠交叉淡化，不将首尾淡到零；施加固定增益；预测峰值偏高时使用无状态tanh柔性限幅并重新校准增益，再Vorbis编码；对最终解码样本测量响度、峰值、循环边界跳变及短窗RMS。'}
    if hashlib.sha256(source.read_bytes()).hexdigest() != original_hash:
        raise ValueError('原始文件校验值发生变化')
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ffmpeg', required=True, help='ffmpeg完整路径')
    parser.add_argument('--input', required=True, help='真实录音路径')
    parser.add_argument('--output', required=True, help='新建OGG路径')
    parser.add_argument('--report', required=True, help='新建JSON报告路径')
    parser.add_argument('--crossfade', type=float, default=.5)
    parser.add_argument('--target', type=float, default=-20)
    args = parser.parse_args()
    try:
        if Path(args.report).exists():
            raise ValueError('报告文件已存在，不能覆盖')
        result = make_loop(args.ffmpeg, args.input, args.output, args.crossfade, args.target)
        Path(args.report).write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print('循环检查通过；仍需主观试听' if result['passed'] else '循环检查未通过，不能标记为可循环')
        return 0 if result['passed'] else 1
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())

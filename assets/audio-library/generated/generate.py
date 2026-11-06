#!/usr/bin/env python3
"""原创数学合成音效；只使用 Python 标准库与显式提供的 FFmpeg 工具。"""
import argparse
import array
import hashlib
import json
import math
from pathlib import Path
import random
import re
import subprocess
import tempfile
import wave

RATE = 48000
SOURCE = 'https://github.com/chen11-A/aijian-studio/blob/40049a9966298aae6c6058673abf945d48fba2b9/assets/audio-library/generated/generate.py'


def execute(tool, args):
    result = subprocess.run([str(tool), *args], capture_output=True, text=True, encoding='utf-8', errors='replace')
    if result.returncode:
        raise RuntimeError('音频工具处理失败，请检查工具和输入路径。')
    return result


def loudness(ffmpeg, file, target):
    result = execute(ffmpeg, ['-hide_banner', '-nostdin', '-i', str(file), '-af',
                             f'loudnorm=I={target}:TP=-2:LRA=11:print_format=json', '-f', 'null', '-'])
    matches = re.findall(r'\{\s*"input_i"[\s\S]*?\}', result.stderr)
    if not matches:
        raise RuntimeError('无法读取真实响度测量。')
    return json.loads(matches[-1])


def heartbeat(variant):
    bpm, pitch, length = [(62, 53, 7.8), (96, 65, 6.8), (132, 76, 5.8)][variant]
    samples = [0.0] * int(length * RATE)
    interval = 60 / bpm
    for beat in range(int(length / interval) + 1):
        for delay, strength, freq in [(0, .9, pitch), (.16 if variant < 2 else .12, .58, pitch * 1.3)]:
            offset = int((beat * interval + delay) * RATE)
            for j in range(int(.23 * RATE)):
                if offset + j >= len(samples):
                    break
                t = j / RATE
                envelope = (1 - math.exp(-t * 500)) * math.exp(-t * 26)
                samples[offset + j] += strength * envelope * (math.sin(2 * math.pi * freq * t) + .2 * math.sin(2 * math.pi * freq * 2.2 * t))
    return samples


def impact(variant):
    length, high, low, decay = [(2.2, 150, 35, 3.7), (3.2, 110, 55, 1.0), (2.7, 210, 42, 3.0)][variant]
    rng = random.Random(762 + variant)
    samples, phase, previous = [], 0.0, 0.0
    for j in range(int(length * RATE)):
        t = j / RATE
        frequency = low + (high - low) * math.exp(-t * 9)
        phase += 2 * math.pi * frequency / RATE
        previous = .95 * previous + .05 * rng.uniform(-1, 1)
        envelope = (1 - math.exp(-t * 1500)) * math.exp(-t * decay)
        tone = math.sin(phase) + .24 * math.sin(phase * 1.501) + previous * 2 * math.exp(-t * 12)
        samples.append(envelope * tone)
    return samples


def phone(variant):
    length = [5.7, 5.5, 5.9][variant]
    samples = []
    for j in range(int(length * RATE)):
        t = j / RATE
        if variant == 0:  # 北美式双频响铃，双频只是数学合成并非录音。
            phase = t % 3.2
            gain = min(1, phase * 200, max(0, (1.3 - phase) * 200))
            sound = math.sin(2 * math.pi * 440 * t) + math.sin(2 * math.pi * 480 * t)
        elif variant == 1:  # 双短促电子提示铃。
            phase = t % 1.55
            local = phase if phase < .25 else phase - .36
            gain = min(1, max(0, local * 300), max(0, (.23 - local) * 300)) if phase < .62 else 0
            sound = math.sin(2 * math.pi * 880 * t) + .6 * math.sin(2 * math.pi * 1320 * t)
        else:  # 金属铃的非整数倍泛音，调幅模拟铃锤。
            phase = t % 2.2
            gain = min(1, phase * 200, max(0, (1.5 - phase) * 200)) * (.6 + .4 * math.sin(2 * math.pi * 23 * t))
            sound = sum(amplitude * math.sin(2 * math.pi * frequency * t) for frequency, amplitude in [(1650, 1), (2715, .6), (3542, .28)])
        samples.append(gain * sound * .4)
    return samples


def prepare(samples):
    # 删除首尾低于 -70dB 的无效样本，末端短淡出抑制截断爆音。
    first = next((i for i, value in enumerate(samples) if abs(value) > .0003), 0)
    last = next((i for i in range(len(samples) - 1, -1, -1) if abs(samples[i]) > .0003), len(samples) - 1)
    samples = samples[first:last + 1]
    fade = min(480, len(samples) // 2)
    for i in range(fade):
        samples[i] *= i / fade
        samples[-1 - i] *= i / fade
    peak = max(abs(value) for value in samples)
    return [value * .85 / peak for value in samples]


def main():
    parser = argparse.ArgumentParser(description='生成九个原创音效并测量真实响度。')
    parser.add_argument('--ffmpeg', required=True, type=Path, help='FFmpeg 的绝对路径')
    parser.add_argument('--ffprobe', required=True, type=Path, help='FFprobe 的绝对路径')
    parser.add_argument('--target-lufs', type=float, default=-20, help='目标响度，默认 -20 LUFS')
    args = parser.parse_args()
    if any(not p.is_absolute() or not p.is_file() for p in [args.ffmpeg, args.ffprobe]):
        parser.error('音频工具必须是存在的绝对路径，不会从 PATH 查找。')
    if not -30 <= args.target_lufs <= -14:
        parser.error('目标响度必须在 -30 到 -14 LUFS 之间。')
    root, entries = Path(__file__).resolve().parent, []
    groups = [
        ('heartbeat', heartbeat, ['舒缓双拍心跳', '紧张加速心跳', '急促惊慌心跳'], '转场', ['紧张', '悬疑', '心跳'], '适合表现人物心跳和紧张情绪。'),
        ('impact', impact, ['短促低频冲击', '深沉低频轰鸣', '下坠低频冲击'], '转场', ['紧张', '史诗', '低频冲击'], '适合突转画面、重击或悬念揭示。'),
        ('phone', phone, ['双频电话铃', '双短音电子电话铃', '金属电话铃'], '道具', ['日常', '电话铃'], '适合电话来电的道具提示。'),
    ]
    with tempfile.TemporaryDirectory(prefix='aivora-generated-') as temp:
        wav = Path(temp) / 'original.wav'
        for kind, synth, names, category, tags, scene in groups:
            for variant, name in enumerate(names):
                samples = prepare(synth(variant))
                pcm = array.array('h', (int(value * 32767) for value in samples))
                import sys
                if sys.byteorder != 'little':
                    pcm.byteswap()
                with wave.open(str(wav), 'wb') as audio:
                    audio.setnchannels(1)
                    audio.setsampwidth(2)
                    audio.setframerate(RATE)
                    audio.writeframes(pcm.tobytes())
                measured = loudness(args.ffmpeg, wav, args.target_lufs)
                identifier = f'self-{kind}-{variant + 1:02}'
                output = root / (identifier + '.ogg')
                normalize = (f'loudnorm=I={args.target_lufs}:TP=-2:LRA=11:'
                             f'measured_I={measured["input_i"]}:measured_TP={measured["input_tp"]}:'
                             f'measured_LRA={measured["input_lra"]}:measured_thresh={measured["input_thresh"]}:'
                             f'offset={measured["target_offset"]}:linear=true')
                execute(args.ffmpeg, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-i', str(wav),
                                     '-af', normalize, '-ar', str(RATE), '-ac', '1', '-c:a', 'libvorbis', '-q:a', '4', str(output)])
                actual = loudness(args.ffmpeg, output, args.target_lufs)
                metadata = json.loads(execute(args.ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(output)]).stdout)
                stream = metadata['streams'][0]
                entries.append(dict(id=identifier, path='generated/' + output.name, type='sfx', category=category,
                                    name='自制' + name, tags=tags, scene=scene, duration=float(metadata['format']['duration']),
                                    loop=False, loopable=False, targetLufs=args.target_lufs, loudness=float(actual['input_i']), truePeak=float(actual['input_tp']),
                                    source=SOURCE, license='CC0-1.0', origin='self-generated',
                                    sha256=hashlib.sha256(output.read_bytes()).hexdigest(),
                                    sampleRate=int(stream['sample_rate']), channels=int(stream['channels'])))
                print(f'{name}：{actual["input_i"]} LUFS，峰值 {actual["input_tp"]} dBTP')
    (root / 'entries.json').write_text(json.dumps(entries, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()

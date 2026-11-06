#!/usr/bin/env python3
"""测量解码后的真实峰值，并以固定衰减修复超峰 Ogg；优先保留瞬态。"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor


def measure_levels(file, ffmpeg):
    if not Path(ffmpeg).is_absolute():
        raise ValueError('请提供 ffmpeg 完整路径。')
    try:
        result = subprocess.run([str(ffmpeg), '-hide_banner', '-nostdin', '-i', str(file),
            '-af', 'astats=metadata=0:reset=0,loudnorm=I=-18:TP=-1:LRA=11:print_format=json',
            '-f', 'null', '-'], capture_output=True, text=True, encoding='utf-8', errors='replace', check=True, timeout=180)
    except (OSError, subprocess.SubprocessError) as exc:
        raise ValueError('峰值测量失败，请检查文件和 ffmpeg 路径。') from exc
    blocks = re.findall(r'\{[^{}]*"input_i"[^{}]*\}', result.stderr, re.S)
    peaks = re.findall(r'Peak level dB:\s*([-+\d.inf]+)', result.stderr)
    if not blocks or not peaks:
        raise ValueError('未取得完整响度和峰值测量。')
    info = json.loads(blocks[-1])
    levels = {'loudness': float(info['input_i']), 'truePeak': float(info['input_tp']),
              'samplePeak': max(float(p) for p in peaks)}
    if not all(math.isfinite(levels[key]) for key in ('truePeak', 'samplePeak')):
        raise ValueError('音频没有可测量的声音。')
    if not math.isfinite(levels['loudness']):
        levels['loudness'] = None
    return levels


def repair_file(file, ffmpeg, before=None):
    """保留原目标；不提升低响度素材，不截断或强制压缩瞬态。"""
    file = Path(file)
    before = before or measure_levels(file, ffmpeg)
    after = before.copy()
    gain = 0.0
    if max(before['truePeak'], before['samplePeak']) <= -1:
        return after, gain
    with tempfile.TemporaryDirectory(prefix='.aivora-peak-', dir=file.parent) as directory:
        output = Path(directory) / 'safe.ogg'
        gain = -1.7 - max(before['truePeak'], before['samplePeak'])
        for _ in range(5):
            try:
                subprocess.run([str(ffmpeg), '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
                    '-i', str(file), '-af', f'volume={gain:.8f}dB', '-ar', '48000',
                    '-c:a', 'libvorbis', '-q:a', '5', str(output)], capture_output=True, check=True, timeout=180)
            except (OSError, subprocess.SubprocessError) as exc:
                raise ValueError('峰值修复失败，原文件没有改变。') from exc
            after = measure_levels(output, ffmpeg)
            peak = max(after['truePeak'], after['samplePeak'])
            if peak <= -1:
                # 原文件只在完整测量通过后替换。
                output.replace(file)
                return after, gain
            gain -= peak + 1.7
    raise ValueError('峰值修复未达标，原文件没有改变。')


def author(item):
    if isinstance(item.get('author'), str) and item['author'].strip():
        return item['author']
    source = item['source']
    if 'effacestudios/' in source:
        return 'effacestudios'
    if 'kenney_' in source.lower() or 'KenneyNL/' in source:
        return 'Kenney Vleugels'
    if 'wyzowl/' in source:
        return 'Wyzowl'
    if 'Dechode/' in source:
        return 'Dechode'
    if item.get('origin') == 'self-generated':
        return 'AIVORA 项目自制（程序合成）'
    if any(x in source for x in ['Micro%20Pack', 'Micro Pack', 'bb%20-', 'bb -', 'BB_2HTC']):
        return 'Benjamin Burnes（包内协作者见许可证原文）'
    raise ValueError('缺少已核实的原作者：' + item['id'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ffmpeg', required=True, type=Path)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parent)
    args = parser.parse_args()
    entries = json.loads((args.root / 'manifest.json').read_text(encoding='utf-8'))
    def process(item):
        file = args.root / item['path']
        before = measure_levels(file, args.ffmpeg)
        after, gain = repair_file(file, args.ffmpeg, before)
        result = {'id': item['id'], 'name': item['name'], 'path': item['path'],
                  'before': before, 'after': after, 'gainDb': round(gain, 6), 'modified': gain != 0}
        item.update(after)
        item['author'] = author(item)
        item['sha256'] = hashlib.sha256(file.read_bytes()).hexdigest()
        item['targetLufs'] = item.get('targetLufs', -20 if item['type'] == 'music' else -18)
        item['peakLimited'] = bool(gain or (after['loudness'] is not None and after['loudness'] < item['targetLufs'] - 1))
        if after['loudness'] is None:
            item['loudnessNote'] = '片段不足400毫秒，无法测量积分响度'
        if gain:
            item['peakProcessing'] = f'最终 Ogg 固定衰减 {gain:.4f} dB，再编码并测量；峰值优先，不提升或强压短瞬态响度。'
        print(json.dumps({'id':item['id'], **after, 'gainDb':gain}, ensure_ascii=False), flush=True)
        return result
    with ThreadPoolExecutor(max_workers=3) as pool:
        rows = list(pool.map(process, entries))
    (args.root / 'manifest.json').write_text(json.dumps(entries, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    report = {'method': '只对最终解码峰值高于 -1 的素材固定衰减，留 -1.7dB 余量；Vorbis 再编码后重新测量，不提升其它素材，不强制压缩瞬态。',
      'samplePeakMethod': 'ffmpeg astats 对解码浮点样本取绝对最大值并换算dBFS（不经整数PCM截断）。',
      'files':len(rows), 'modified':sum(r['modified'] for r in rows),
      'beforeAbove0dBFS':sum(r['before']['samplePeak']>0 for r in rows),
      'beforeMaxSamplePeak':max(r['before']['samplePeak'] for r in rows),
      'afterMaxSamplePeak':max(r['after']['samplePeak'] for r in rows),
      'afterMaxTruePeak':max(r['after']['truePeak'] for r in rows), 'items':rows}
    (args.root / 'PEAK_REPAIR.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    by_id = {item['id']:item for item in entries}
    for sub in ['generated/entries.json', 'loop_entries.json', 'additions/phone-vehicle/entries.json']:
        p = args.root / sub
        data = json.loads(p.read_text(encoding='utf-8'))
        p.write_text(json.dumps([by_id[x['id']] for x in data], ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({k:v for k,v in report.items() if k!='items'}, ensure_ascii=False),flush=True)


if __name__ == '__main__':
    main()

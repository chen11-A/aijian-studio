#!/usr/bin/env python3
"""本地素材检查；必须显式提供 ffmpeg 和 ffprobe 的绝对路径。"""
import argparse
from array import array
import json
import math
import hashlib
import importlib.util
from pathlib import Path
import re
import subprocess
import sys


def run(executable, args):
    try:
        return subprocess.run([str(executable), *args], capture_output=True, text=True,
                              encoding='utf-8', errors='replace', check=True, timeout=180)
    except (OSError, subprocess.SubprocessError) as exc:
        raise ValueError('音频工具运行失败，请检查文件和工具路径。') from exc


def measured_loudness(path, ffmpeg):
    result = run(ffmpeg, ['-hide_banner', '-nostdin', '-i', str(path), '-af',
                         'loudnorm=I=-18:TP=-1:LRA=11:print_format=json', '-f', 'null', '-'])
    blocks = re.findall(r'\{[^{}]*"input_i"[^{}]*\}', result.stderr, re.S)
    if not blocks:
        raise ValueError('无法测量响度。')
    return float(json.loads(blocks[-1])['input_i'])


def measured_levels(file, ffmpeg):
    spec = importlib.util.spec_from_file_location('aivora_peak_safety', Path(__file__).with_name('peak_safety.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.measure_levels(file, ffmpeg)


def validate_levels(item, levels, target):
    if not all(math.isfinite(levels[key]) for key in ('truePeak', 'samplePeak')):
        raise ValueError('响度和峰值测量须为有效数值。')
    if levels['truePeak'] > -1:
        raise ValueError(f"真峰值超标：{levels['truePeak']:.2f} dBTP，须不高于 -1 dBTP。")
    if levels['samplePeak'] > -1:
        raise ValueError(f"采样峰值超标：{levels['samplePeak']:.2f} dBFS，须不高于 -1 dBFS。")
    short_unmeasurable = (item.get('type', 'sfx') == 'sfx' and levels['loudness'] is None and item['loudness'] is None
                          and item.get('duration', 1) < .4 and bool(item.get('loudnessNote')))
    if not short_unmeasurable and (levels['loudness'] is None or item['loudness'] is None):
        raise ValueError('只有不足 400 毫秒且附有说明的音效可以没有积分响度。')
    if not short_unmeasurable and abs(levels['loudness'] - item['loudness']) > .3:
        raise ValueError('实测响度与清单不一致。')
    limited = item.get('peakLimited', False)
    if not isinstance(limited, bool):
        raise ValueError('峰值优先标记必须是布尔值。')
    lower, upper = (-22, -18) if item.get('type') == 'music' else (-21, -15)
    if not short_unmeasurable and not lower <= levels['loudness'] <= upper:
        raise ValueError(f'实测响度超出允许范围 {lower} 至 {upper} LUFS；peakLimited 不能豁免。')
    for key in ('truePeak', 'samplePeak'):
        if key in item and (isinstance(item[key], bool) or not isinstance(item[key], (float, int))
                            or not math.isfinite(item[key]) or abs(item[key] - levels[key]) > .1):
            raise ValueError('实测峰值与清单不一致。')


STRICT_CATEGORIES = ('钥匙', '手机震动', '电话铃', '雨伞', '心跳', '低频冲击', '街道',
    '湿地面脚步', '水泥地奔跑', '钢管击打', '钢管拖地', '金属撞击', '刀挥砍', '刀划伤',
    '人体倒地', '心电监护仪', '医院底噪', '人群低语', '车辆驶过')
LOOP_CATEGORIES = ('雨', '风', '街道', '医院底噪')
MUSIC_EMOTIONS = ('紧张', '甜蜜', '悲伤', '温暖', '悬疑', '打斗', '搞笑', '史诗', '平静')


def validate_loop_seam(file, ffmpeg, channels=1):
    # 验证每一声道，不能把相反相位或单声道缺陷通过混音掩盖。
    spec = importlib.util.spec_from_file_location('aivora_loop_tools', Path(__file__).with_name('loop_tools.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    try:
        result = subprocess.run([str(ffmpeg), '-v','error','-nostdin','-i',str(file),
            '-vn','-ar','48000','-ac',str(channels),'-f','f32le','-'], capture_output=True,check=True,timeout=180)
    except (OSError, subprocess.SubprocessError) as exc:
        raise ValueError('循环音频解码失败。') from exc
    samples = array('f'); samples.frombytes(result.stdout)
    if sys.byteorder != 'little':
        samples.byteswap()
    metrics = [module.seam_metrics(samples[channel::channels]) for channel in range(channels)]
    passed = all(x['passed'] for x in metrics)
    if not passed:
        raise ValueError('循环接缝检查未通过：请修复每声道首尾跳变和音量变化后再标记可循环。')
    return {'channels': metrics, 'passed': passed}


def target_lufs(item):
    target = item.get('targetLufs', -20 if item['type'] == 'music' else -18)
    if isinstance(target, bool) or not isinstance(target, (int, float)) or target not in (-20, -18):
        raise ValueError('目标响度只能是 -20 或 -18 LUFS。')
    if item['type'] == 'music' and target != -20:
        raise ValueError('配乐目标响度必须是 -20 LUFS。')
    return target


def loopable(item):
    flag = item.get('loopable', item['loop'])
    if not isinstance(flag, bool) or flag != item['loop']:
        raise ValueError('可循环标记必须是布尔值，并与循环标记一致。')
    return flag


def strict_requirements(entries):
    counts = dict.fromkeys(STRICT_CATEGORIES, 0)
    loops = dict.fromkeys(LOOP_CATEGORIES, 0)
    music = dict.fromkeys(MUSIC_EMOTIONS, 0)
    environments = set()
    sad_sources = set()
    crowd_loops = 0
    recording_counts = dict.fromkeys(('雨', '风', '雨打伞', '雨打窗', '喘息'), 0)
    for item in entries:
        labels = set(item['tags']) | {item['category']}
        source = item.get('originalSource', item['source'])
        if item['type'] == 'music':
            if '悲伤' in labels:
                sad_sources.add(source)
            if loopable(item):
                for emotion in music:
                    if emotion in labels:
                        music[emotion] += 1
            continue
        for category in counts:
            if category in labels:
                counts[category] += 1
        if loopable(item) and 30 <= item['duration'] <= 60:
            if item['category'] == '环境':
                environments.add(source)
            for category in loops:
                if category in labels:
                    loops[category] += 1
        if (labels & {'人群低语', '人群'} and item['category'] == '环境'
                and loopable(item) and 30 <= item['duration'] <= 60
                and item.get('recordingVerified') is True
                and item.get('license') in ('CC0-1.0', 'Public Domain')
                and any(item.get(key) for key in ('licensePath', 'licenseEvidence', 'licenseEvidencePath'))
                and item.get('author') and source):
            crowd_loops += 1
        # “真实录音”须在元数据中明确通过来源证据核实，不能把合成/音乐采样只改标签。
        if item.get('recordingVerified') is True:
            for label in recording_counts:
                if label in labels and (label not in ('雨','风') or (loopable(item) and item['duration'] >= 30)):
                    recording_counts[label] += 1
    errors = [f'严格验收：{category}不足 3 个（实有 {count} 个）。'
              for category, count in counts.items() if count < 3]
    if not crowd_loops:
        errors.append('严格验收：人群缺少已核实真实录音、附许可依据且30–60秒可循环的环境音。')
    if len(environments) < 8:
        errors.append(f'严格验收：30–60秒可循环环境音不足 8 条不同来源（实有 {len(environments)} 条）。')
    errors += [f'严格验收：{emotion}缺少可循环配乐。' for emotion, count in music.items() if not count]
    if len(sad_sources) < 3:
        errors.append(f'严格验收：悲伤配乐不足 3 首不同来源（实有 {len(sad_sources)} 首）。')
    errors += [f'严格验收：{label}缺少已核实真实录音' + ('且至少30秒可循环的版本。' if label in ('雨','风') else '。')
               for label, count in recording_counts.items() if not count]
    return errors, {'指定类别数量': counts, '可循环环境音数量': loops,
        '已核实人群环境循环数':crowd_loops, '30至60秒不同来源环境循环数':len(environments), '可循环配乐情绪数量':music,
        '悲伤配乐独立来源数':len(sad_sources), '真实录音数量':recording_counts}


def loudness_summary(measured):
    summary = {}
    for kind, name, lower, upper in [('sfx', '音效', -21, -15), ('music', '配乐', -22, -18)]:
        rows = [row for row in measured if row['type'] == kind]
        values = [row['loudness'] for row in rows if row['loudness'] is not None]
        summary[name] = {'已测文件':len(rows), '允许范围LUFS':[lower, upper],
            '最小实测LUFS':min(values, default=None), '最大实测LUFS':max(values, default=None),
            '响度范围超标数':sum(not lower <= value <= upper for value in values),
            '极短音null豁免数':sum(row.get('nullExempt', False) for row in rows),
            '不可测但不符合豁免数':sum(row['loudness'] is None and not row.get('nullExempt',False) for row in rows)}
    return summary


def validate(root, ffmpeg, ffprobe, strict_request=False):
    errors = []
    for tool in (ffmpeg, ffprobe):
        if not tool.is_absolute() or not tool.is_file():
            return ['请提供存在的音频工具绝对路径。'], {}
    try:
        entries = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
        if not isinstance(entries, list):
            raise ValueError()
    except (OSError, ValueError):
        return ['素材清单无法读取。'], {}
    ids, paths = set(), set()
    total = 0
    counts = {'sfx': 0, 'music': 0}
    valid_entries = []
    measured = []
    for item in entries:
        label = item.get('id', '未命名素材') if isinstance(item, dict) else '未命名素材'
        try:
            required = ('id', 'path', 'type', 'category', 'name', 'tags', 'scene',
                        'duration', 'loop', 'loudness', 'source', 'license', 'author')
            if not isinstance(item, dict) or any(k not in item for k in required):
                raise ValueError('清单字段不完整。')
            if any(not isinstance(item[key], str) or not item[key].strip() for key in ('id', 'path', 'category', 'name', 'scene', 'author')):
                raise ValueError('编号、路径、分类、中文名和场景须为非空文字。')
            if isinstance(item['duration'], bool) or not isinstance(item['duration'], (int,float)) or not math.isfinite(item['duration']) or item['duration'] <= 0:
                raise ValueError('时长须为有效数值，且须大于零。')
            if item['loudness'] is not None and (isinstance(item['loudness'], bool) or not isinstance(item['loudness'], (int,float)) or not math.isfinite(item['loudness'])):
                raise ValueError('响度须为有效数值。')
            if item['id'] in ids or item['path'] in paths:
                raise ValueError('素材编号或路径重复。')
            ids.add(item['id']); paths.add(item['path'])
            if item['type'] not in counts:
                raise ValueError('素材类型不正确。')
            counts[item['type']] += 1
            if item['license'] not in ('CC0-1.0', 'Public Domain'):
                raise ValueError('只允许 CC0 或公有领域许可证。')
            if not isinstance(item['source'], str) or not item['source'].startswith('https://'):
                raise ValueError('缺少来源链接。')
            if not isinstance(item['loop'], bool) or not isinstance(item['tags'], list) or any(not isinstance(tag, str) for tag in item['tags']):
                raise ValueError('循环标记或标签格式错误。')
            target = target_lufs(item)
            can_loop = loopable(item)
            file = (root / item['path']).resolve()
            if not file.is_relative_to(root.resolve()) or not file.is_file() or file.suffix != '.ogg':
                raise ValueError('文件不存在、路径越界或扩展名错误。')
            total += file.stat().st_size
            if item.get('sha256') != hashlib.sha256(file.read_bytes()).hexdigest():
                raise ValueError('文件校验值不一致，素材可能已损坏。')
            data = json.loads(run(ffprobe, ['-v', 'error', '-show_streams', '-show_format',
                                          '-of', 'json', str(file)]).stdout)
            streams = data['streams']
            channels = 2 if item['type'] == 'music' else 1
            if len(streams) != 1 or streams[0]['codec_name'] != 'vorbis' or int(streams[0]['sample_rate']) != 48000 or streams[0]['channels'] != channels or data['format']['format_name'] != 'ogg':
                raise ValueError('格式须为 48kHz Ogg Vorbis，音效单声道、音乐双声道。')
            duration = float(data['format']['duration'])
            if abs(duration - item['duration']) > .05:
                raise ValueError('清单时长不准确。')
            if item['type'] == 'music' and not 30 <= duration <= 180:
                raise ValueError('音乐时长须为 30 到 180 秒。')
            levels = measured_levels(file, ffmpeg)
            measured.append({'id': item['id'], 'type': item['type'], **levels,
                'nullExempt': item['type'] == 'sfx' and levels['loudness'] is None
                    and item['loudness'] is None and duration < .4 and bool(item.get('loudnessNote'))})
            validate_levels({**item, 'duration': duration}, levels, target)
            if can_loop:
                validate_loop_seam(file, ffmpeg, channels=channels)
            valid_entries.append(item)
        except (ValueError, KeyError, TypeError, OSError) as exc:
            errors.append(f'{label}：{exc}')
    if counts['sfx'] < 60:
        errors.append('音效不足 60 个。')
    if counts['music'] < 20:
        errors.append('配乐不足 20 首。')
    unlisted = {p.relative_to(root).as_posix() for p in root.rglob('*.ogg')} - paths
    if unlisted:
        errors.append('存在未收录的音频文件：' + '、'.join(sorted(unlisted)))
    total = sum(p.stat().st_size for p in root.rglob('*') if p.is_file())
    if total > 150 * 1024 * 1024:
        errors.append('音频总大小超过 150MB。')
    report = {'音效': counts['sfx'], '配乐': counts['music'], '字节': total}
    report['峰值检查'] = {'已测文件': len(measured), '最大真峰值dBTP': max((x['truePeak'] for x in measured), default=None),
                        '最大采样峰值dBFS': max((x['samplePeak'] for x in measured), default=None),
                        '真峰值超标数': sum(x['truePeak'] > -1 for x in measured),
                        '采样峰值超标数': sum(x['samplePeak'] > -1 for x in measured)}
    report['响度检查'] = loudness_summary(measured)
    if strict_request:
        strict_errors, strict_report = strict_requirements(valid_entries)
        errors.extend(strict_errors)
        report.update(strict_report)
    return errors, report


def main():
    parser = argparse.ArgumentParser(description='检查本地素材库')
    parser.add_argument('--ffmpeg', required=True, type=Path, help='ffmpeg 绝对路径')
    parser.add_argument('--ffprobe', required=True, type=Path, help='ffprobe 绝对路径')
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument('--strict-request', action='store_true', help='额外检查第二轮类别、环境循环、情绪配乐与真实录音要求')
    args = parser.parse_args()
    errors, report = validate(args.root, args.ffmpeg, args.ffprobe, strict_request=args.strict_request)
    print(json.dumps({'统计': report, '问题': errors}, ensure_ascii=False, indent=2))
    return bool(errors)


if __name__ == '__main__':
    sys.exit(main())

#!/usr/bin/env python3
"""本地素材检查；必须显式提供 ffmpeg 和 ffprobe 的绝对路径。"""
import argparse
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


STRICT_CATEGORIES = ('虫鸣', '街道', '人群', '海浪', '森林', '手机震动', '电话铃', '雨伞', '钥匙', '车辆', '心跳', '低频冲击')
LOOP_CATEGORIES = ('雨', '风', '街道', '人群', '海浪', '森林', '虫鸣')


def validate_loop_seam(file, ffmpeg):
    # 按本文件位置导入，避免调用者工作目录影响工具加载。
    spec = importlib.util.spec_from_file_location('aivora_loop_tools', Path(__file__).with_name('loop_tools.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    metrics = module.seam_metrics(module.decode(ffmpeg, file))
    if not metrics['passed']:
        raise ValueError('循环接缝检查未通过：请修复首尾跳变和音量变化后再标记可循环。')
    return metrics


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
    for item in entries:
        if item['type'] != 'sfx':
            continue
        labels = set(item['tags']) | {item['category']}
        for category in counts:
            if category in labels:
                counts[category] += 1
        if loopable(item):
            for category in loops:
                if category in labels:
                    loops[category] += 1
    errors = [f'严格验收：{category}不足 3 个（实有 {count} 个）。'
              for category, count in counts.items() if count < 3]
    errors += [f'严格验收：{category}缺少通过接缝检查的可循环环境音。'
               for category, count in loops.items() if count == 0]
    return errors, {'指定类别数量': counts, '可循环环境音数量': loops}


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
    for item in entries:
        label = item.get('id', '未命名素材') if isinstance(item, dict) else '未命名素材'
        try:
            required = ('id', 'path', 'type', 'category', 'name', 'tags', 'scene',
                        'duration', 'loop', 'loudness', 'source', 'license')
            if not isinstance(item, dict) or any(k not in item for k in required):
                raise ValueError('清单字段不完整。')
            if any(not isinstance(item[key], str) or not item[key].strip() for key in ('id', 'path', 'category', 'name', 'scene')):
                raise ValueError('编号、路径、分类、中文名和场景须为非空文字。')
            if any(isinstance(item[key], bool) or not isinstance(item[key], (int, float)) or not math.isfinite(item[key]) for key in ('duration', 'loudness')) or item['duration'] <= 0:
                raise ValueError('时长和响度须为有效数值，时长须大于零。')
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
            loudness = measured_loudness(file, ffmpeg)
            if not math.isfinite(loudness) or abs(loudness - target) > 1 or abs(loudness-item['loudness']) > .3:
                raise ValueError('实测响度不符合目标或清单。')
            if can_loop:
                validate_loop_seam(file, ffmpeg)
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
    parser.add_argument('--strict-request', action='store_true', help='额外检查指定十二类别数量与七类可循环环境音')
    args = parser.parse_args()
    errors, report = validate(args.root, args.ffmpeg, args.ffprobe, strict_request=args.strict_request)
    print(json.dumps({'统计': report, '问题': errors}, ensure_ascii=False, indent=2))
    return bool(errors)


if __name__ == '__main__':
    sys.exit(main())

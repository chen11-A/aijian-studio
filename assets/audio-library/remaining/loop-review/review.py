#!/usr/bin/env python3
"""生成逐声道客观接缝报告和本地试听页；不修改原音频或清单。"""
import argparse
from array import array
import hashlib
import html
import importlib.util
import json
from pathlib import Path
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ffmpeg', type=Path, required=True)
    parser.add_argument('--ffprobe', type=Path, required=True)
    parser.add_argument('--reuse-metrics', action='store_true', help='仅在清单和音频哈希一致时复用已有测量，重建页面')
    args = parser.parse_args()
    for tool in (args.ffmpeg, args.ffprobe):
        if not tool.is_absolute() or not tool.is_file():
            parser.error('请提供存在的音频工具绝对路径。')
    out = Path(__file__).resolve().parent
    root = out.parent.parent
    spec = importlib.util.spec_from_file_location('loop_tools', root/'loop_tools.py')
    loops = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loops)
    snapshot = (root/'manifest.json').read_bytes()
    entries = [e for e in json.loads(snapshot) if e.get('loopable', e.get('loop'))]
    cached = {}
    if args.reuse_metrics:
        report = json.loads((out/'metrics.json').read_text())
        if report['manifestSha256'] != hashlib.sha256(snapshot).hexdigest():
            raise ValueError('清单已变更，请重新测量。')
        cached = {item['id']: item for item in report['items']}
    records, cards = [], []
    for entry in entries:
        path = root/entry['path']
        if args.reuse_metrics:
            record = cached[entry['id']].copy()
            if record['sha256'] != hashlib.sha256(path.read_bytes()).hexdigest():
                raise ValueError('音频已变更，请重新测量。')
            record.pop('preview', None)
        else:
            info = json.loads(subprocess.run([str(args.ffprobe), '-v','error','-select_streams','a:0',
                '-show_entries','stream=channels','-of','json',str(path)], capture_output=True, text=True, check=True).stdout)
            channels = info['streams'][0]['channels']
            raw = subprocess.run([str(args.ffmpeg),'-v','error','-nostdin','-i',str(path),'-vn','-ar','48000',
                '-f','f32le','-'],capture_output=True,check=True).stdout
            samples = array('f'); samples.frombytes(raw)
            if sys.byteorder != 'little': samples.byteswap()
            metrics = [loops.seam_metrics(samples[c::channels]) for c in range(channels)]
            record={'id':entry['id'],'path':entry['path'],'type':entry['type'],'category':entry['category'],
                'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'decodedFrames':len(samples)//channels,
                'channels':metrics,'passed':all(m['passed'] for m in metrics)}
        records.append(record)
        title=html.escape(entry.get('name',entry['id']))
        cards.append(f'<article><h2>{title}</h2><p>{html.escape(entry["id"])} · '+
            ('客观接缝通过' if record['passed'] else '客观接缝失败')+
            f'</p><audio controls loop preload="metadata" src="../../{html.escape(entry["path"],quote=True)}"></audio>'+
            '<p><button type="button" onclick="const a=this.closest(\'article\').querySelector(\'audio\');if(Number.isFinite(a.duration)){a.currentTime=Math.max(0,a.duration-2);a.play().catch(()=>alert(\'无法播放，请检查本地音频路径。\'))}else{alert(\'请先加载音频。\')}">从尾部两秒开始循环</button></p></article>')
    result={'manifestSha256':hashlib.sha256(snapshot).hexdigest(),'reviewed':len(records),
        'passed':sum(r['passed'] for r in records),'subjectiveListeningPerformed':False,
        '说明':'原Ogg解码为48kHz浮点后逐声道检查。试听直接播放原Ogg，浏览器循环衔接受播放器影响。客观通过不能证明听感自然；尚未人工试听。',
        'items':records}
    (out/'metrics.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    (out/'index.html').write_text('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>循环接缝试听</title>'+
        '<style>body{max-width:850px;margin:24px auto;font-family:sans-serif;padding:16px}article{border-top:1px solid #ccc;padding:12px}audio{width:100%}</style>'+
        '<h1>循环接缝试听</h1><p>所有播放均使用本地文件，无联网服务。客观检查不等于人工试听。本页未记录任何人工试听结论。</p>'+
        '<p>直接播放原Ogg（已设循环），也可定位尾部两秒。浏览器循环衔接受播放器影响，不能将播放间隙直接判定为文件接缝问题。</p>'+''.join(cards)+'</html>')
    print(json.dumps({'reviewed':result['reviewed'],'passed':result['passed'],'manifestSha256':result['manifestSha256']},ensure_ascii=False))
    return int(result['passed'] != len(records))


if __name__ == '__main__':
    raise SystemExit(main())

#!/usr/bin/env python3
"""仅本地处理已核实的独立真实自然录音，不联网、不修改主清单。"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parent
LIBRARY=ROOT.parent.parent
spec=importlib.util.spec_from_file_location('aivora_long_loops',LIBRARY/'round2-loops/build_loops.py')
loops=importlib.util.module_from_spec(spec);spec.loader.exec_module(loops)
GROUPS={
 'bsb-2749':('森林',['森林','林间风','鸟鸣']),
 'bsb-2713':('森林',['森林','溪流','鸟鸣']),
 'bsb-2715':('森林',['森林','鸟鸣']),
 'bsb-0698':('海浪',['海浪','大西洋','海岸']),
 'bsb-1447':('海浪',['海浪','沙滩','浪花']),
 'bsb-1046':('海浪',['海浪','海滩']),
 'bsb-1880':('虫鸣',['虫鸣','夜晚虫鸣','蟋蟀','田野']),
 'wav-crickets':('虫鸣',['虫鸣','夜晚虫鸣','蟋蟀']),
 'fs-175020':('虫鸣',['虫鸣','夜晚虫鸣','午夜','蟋蟀']),
}

def main():
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--ffmpeg',required=True,type=Path)
 parser.add_argument('--source-root',required=True,type=Path,help='QuietField的public文件夹')
 args=parser.parse_args()
 if not args.ffmpeg.is_absolute() or not args.ffmpeg.is_file(): parser.error('请提供存在的FFmpeg绝对路径。')
 catalog=json.loads((ROOT/'sources.json').read_text()); entries=[]
 for record in catalog:
  category,tags=GROUPS[record['id']]; source=args.source_root/record['path']
  if hashlib.sha256(source.read_bytes()).hexdigest()!=record['sha256']: raise ValueError('源录音校验值不同，请先重新核实来源。')
  item=dict(id=record['id'],path=record['path'],type='sfx',category='环境',name=record['name'],tags=tags,
            scene=f'适合{category}环境镜头的连续背景铺底。',source=record['source'],license='Public Domain' if record['license']=='Public Domain' else 'CC0-1.0',author=record['author'])
  entry=loops.make(args.ffmpeg,args.source_root,item,ROOT)
  entry.update(path='fill-gaps/nature/'+Path(entry['path']).name,loopReport='fill-gaps/nature/'+entry['id']+'.json',
               author=record['author'],recordingOrigin='field-recording',recordingTitle=record['title'],
               sourceMirror='https://github.com/Gary06868/QuietField/releases/download/v1.8.1/QuietField-1.8.1-Windows-x64-public.zip',
               sourceCatalog='https://github.com/Gary06868/QuietField/blob/1b54955db94baa59571bb0ae3e56fcad190f2087/src/catalog.public.json',
               licenseEvidence='fill-gaps/nature/LICENSE_EVIDENCE.md',peakLimited=entry['peakSafetyPrioritized'],
               processing='从独立真实自然录音取连续41秒，首尾1秒等功率交叉淡化至40秒；48kHz单声道；固定增益峰值优先；最终Ogg接缝与峰值复测通过，未人工试听。')
  report_path=ROOT/(entry['id']+'.json');report=json.loads(report_path.read_text())
  report['note']='来自独立真实自然录音，未用短片段重复凑足时长；没有把鸟声或蛙声冒充虫鸣。'
  report['author']=record['author'];report['license']=entry['license'];report['sourceCatalogSha256']=record['sha256']
  report_path.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
  entries.append(entry);(ROOT/'entries.json').write_text(json.dumps(entries,ensure_ascii=False,indent=2)+'\n')
  print(entry['name'],entry['duration'],entry['loudness'],entry['truePeak'],flush=True)

if __name__=='__main__':main()

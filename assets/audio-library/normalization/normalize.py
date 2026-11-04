#!/usr/bin/env python3
"""显式工具路径；固定187条快照，动态限幅后实际重测，不修改manifest。"""
import argparse, hashlib, importlib.util, json, subprocess, tempfile
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
ROOT=Path(__file__).resolve().parent.parent

def module(name):
 s=importlib.util.spec_from_file_location(name,ROOT/(name+'.py')); m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
peak=module('peak_safety');check=module('check')
def run(command):return subprocess.run(command,capture_output=True,check=True,timeout=240)
def process(item,ffmpeg,ffprobe,apply=False):
 source=ROOT/item['path'];before=peak.measure_levels(source,ffmpeg)
 low,high=(-22,-18) if item['type']=='music' else (-21,-15)
 target=-20 if item['type']=='music' else -18
 row={'id':item['id'],'path':item['path'],'before':before,'modified':False}
 info=json.loads(run([ffprobe,'-v','error','-show_entries','stream=channels:format=duration','-of','json',str(source)]).stdout)
 channels=info['streams'][0]['channels']; duration=float(info['format']['duration'])
 after=before; iterations=[];seam=None
 if before['loudness'] is not None and (not low<=before['loudness']<=high or max(before['truePeak'],before['samplePeak'])>-1):
  with tempfile.TemporaryDirectory(prefix='aivora-normalize-') as temp:
   dest=Path(temp)/'处理.ogg';gain=target-before['loudness'];limit=.70
   loop=bool(item.get('loopable',item.get('loop')))
   n=0
   if loop:n=len(run([ffmpeg,'-v','error','-i',str(source),'-f','f32le','-ar','48000','-']).stdout)//(4*channels)
   for attempt in range(12):
    filters=f'aresample=192000,volume={gain:.8f}dB,alimiter=limit={limit}:attack=5:release=50:level=false:latency=true,aresample=48000'
    if loop:filters+=f',atrim=start_sample={n}:end_sample={2*n},asetpts=PTS-STARTPTS'
    run([ffmpeg,'-v','error','-nostdin','-y',*(['-stream_loop','2'] if loop else []),'-i',str(source),'-af',filters,'-ar','48000','-c:a','libvorbis','-q:a','6',str(dest)])
    after=peak.measure_levels(dest,ffmpeg);iterations.append({'gainDb':gain,'limiterLinearCeiling':limit,**after})
    if after['loudness'] is None:raise ValueError('处理后无法测量响度：'+item['id'])
    p=max(after['truePeak'],after['samplePeak'])
    if low<=after['loudness']<=high and p<=-1:
     if loop:seam=check.validate_loop_seam(dest,Path(ffmpeg),channels)
     if apply:source.write_bytes(dest.read_bytes())
     row['modified']=True
     break
    if p>-1:limit*=10**((-1.5-p)/20)
    gain+=target-after['loudness']
   else:raise ValueError('迭代后仍不达标：'+item['id']+' '+str(after))
   chosen=source if apply else dest
   row.update({'sha256':hashlib.sha256(chosen.read_bytes()).hexdigest(),'duration':float(json.loads(run([ffprobe,'-v','error','-show_entries','format=duration','-of','json',str(chosen)]).stdout)['format']['duration'])})
 else:row.update({'sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'duration':duration})
 row.update({'after':after,'iterations':iterations,'seam':seam,'targetLufs':target,'peakLimited':False,'normalization':'四倍过采样动态限幅；循环三遍处理后保留中间一遍；Ogg编码后实测响度、峰值与循环接缝。' if row['modified'] else '原文件实测在允许范围内，未修改。'})
 print(json.dumps({'id':item['id'],'modified':row['modified'],**after},ensure_ascii=False),flush=True)
 return row

def main():
 p=argparse.ArgumentParser();p.add_argument('--ffmpeg',required=True);p.add_argument('--ffprobe',required=True);p.add_argument('--apply',action='store_true');p.add_argument('--ids',nargs='*');a=p.parse_args()
 for tool in (a.ffmpeg,a.ffprobe):
  if not Path(tool).is_absolute() or not Path(tool).is_file():p.error('请提供存在的工具绝对路径。')
 snapshot=ROOT/'normalization/snapshot.json'
 if not snapshot.exists():snapshot.write_bytes((ROOT/'manifest.json').read_bytes())
 entries=json.loads(snapshot.read_text());entries=[e for e in entries if not a.ids or e['id'] in a.ids]
 with ThreadPoolExecutor(max_workers=3) as pool:rows=list(pool.map(lambda e:process(e,a.ffmpeg,a.ffprobe,a.apply),entries))
 report={'files':len(rows),'modified':sum(r['modified'] for r in rows),'applied':a.apply,'items':rows}
 (ROOT/('ROUND3_NORMALIZATION.json' if a.apply else 'normalization/TRIAL.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
if __name__=='__main__':main()

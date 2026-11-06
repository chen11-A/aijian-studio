#!/usr/bin/env python3
"""本地重建三个真实夜街循环；需要 numpy，不联网。"""
import argparse, hashlib, importlib.util, json, math, tempfile
from pathlib import Path
import numpy as np
p=argparse.ArgumentParser(description=__doc__)
for name in ('ffmpeg','ffprobe','night'): p.add_argument('--'+name,type=Path,required=True)
a=p.parse_args()
for f in (a.ffmpeg,a.ffprobe,a.night):
 if not f.is_absolute() or not f.is_file(): p.error('请输入存在的绝对路径。')
root=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('loop_tools',root.parent.parent/'round2-loops/build_loops.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
samples=m.decode(a.ffmpeg,a.night,1)
if len(samples)<130*m.RATE: raise ValueError('源音频不足130秒，不能重建三段不同内容。')
entries=json.loads((root/'entries.json').read_text());reports=[]
with tempfile.TemporaryDirectory(prefix='夜街循环 ') as td:
 wav=Path(td)/'循环.wav'
 for entry,start in zip(entries,(0,45,90),strict=True):
  clip=samples[start*m.RATE:(start+40)*m.RATE]
  cyclic=m.crossfade(clip,m.RATE)
  m.write_wav(a.ffmpeg,cyclic,wav); initial_i,initial_tp=m.measure(a.ffmpeg,wav)
  gain=min(-20-initial_i,-1.6-initial_tp)
  out=root/Path(entry['path']).name
  for attempt in range(6):
   rotated,rotation=m.smooth_boundary(cyclic,attempt*m.RATE//3)
   m.write_wav(a.ffmpeg,rotated,wav)
   m.run(a.ffmpeg,['-v','error','-y','-i',str(wav),'-af',f'volume={gain}dB','-ar','48000','-ac','1','-c:a','libvorbis','-q:a','5',str(out)])
   decoded=m.decode(a.ffmpeg,out,1); lufs,tp=m.measure(a.ffmpeg,out)
   sp=20*math.log10(float(np.max(np.abs(decoded))))
   if max(tp,sp)>-1:
    gain-=max(tp,sp)+1.3;continue
   seam=m.seam(decoded)
   if seam['passed']:break
  else:raise ValueError('最终循环接缝或峰值检查未通过。')
  report=dict(id=entry['id'],sourceSha256=hashlib.sha256(a.night.read_bytes()).hexdigest(),outputSha256=hashlib.sha256(out.read_bytes()).hexdigest(),sourceSliceStart=start,sourceSliceDuration=40,crossfadeSeconds=1,boundaryRotationSeconds=rotation,duration=len(decoded)/m.RATE,loudness=lufs,truePeak=tp,samplePeak=sp,seam=seam,subjectiveListeningCompleted=False)
  report_path=out.with_suffix('.json');report_path.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
  entry.update(peakLimited=abs(lufs+20)>1,peakSafetyPrioritized=abs(lufs+20)>1,duration=report['duration'],loop=True,loopable=True,loudness=lufs,truePeak=tp,samplePeak=sp,sha256=report['outputSha256'],sourceSha256=report['sourceSha256'],loopReport='remaining/ambience/'+report_path.name,processing=f'墨西哥Puebla真实夜街同一原作不同片段；取136.056秒镜像节选内{start}至{start+40}秒，原726615对应起点由用户补充为{entry["sourceStart"]}秒（未独立对齐验证）。首尾1秒等功率交叉淡化，循环边界旋转到稳定窗口，不重复短车声；固定增益后48kHz单声道Vorbis编码，最终逐声道接缝、真峰值及采样峰值检查通过；未人工试听。')
  reports.append(report)
(root/'entries.json').write_text(json.dumps(entries,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(reports,ensure_ascii=False,indent=2))

#!/usr/bin/env python3
"""本地重建三个短人群循环及一个长版本；需要 numpy，不联网。"""
import argparse, hashlib, importlib.util, json, math, tempfile
from pathlib import Path
import numpy as np
p=argparse.ArgumentParser(description=__doc__)
for name in ('ffmpeg','ffprobe','crowd'): p.add_argument('--'+name,type=Path,required=True)
a=p.parse_args()
for f in (a.ffmpeg,a.ffprobe,a.crowd):
 if not f.is_absolute() or not f.is_file(): p.error('请输入存在的绝对路径。')
root=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('loop_tools',root.parent.parent/'round2-loops/build_loops.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
samples=m.decode(a.ffmpeg,a.crowd,1)
if len(samples)<57*m.RATE: raise ValueError('源音频不足57秒，不能重建三段不同内容。')
entries=json.loads((root/'entries.json').read_text());reports=[]
with tempfile.TemporaryDirectory(prefix='人群循环 ') as td:
 wav=Path(td)/'循环.wav'
 for entry,(start,length) in zip(entries,((0,18),(19,18),(38,18),(0,56)),strict=True):
  clip=samples[start*m.RATE:(start+length)*m.RATE]
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
  report=dict(id=entry['id'],sourceSha256=hashlib.sha256(a.crowd.read_bytes()).hexdigest(),outputSha256=hashlib.sha256(out.read_bytes()).hexdigest(),sourceSliceStart=start,sourceSliceDuration=length,crossfadeSeconds=1,boundaryRotationSeconds=rotation,duration=len(decoded)/m.RATE,loudness=lufs,truePeak=tp,samplePeak=sp,seam=seam,subjectiveListeningCompleted=False)
  report_path=out.with_suffix('.json');report_path.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
  entry.update(recordingVerified=True,channels=1,sampleRate=48000,peakLimited=abs(lufs+20)>1,peakSafetyPrioritized=abs(lufs+20)>1,duration=report['duration'],loop=True,loopable=True,loudness=lufs,truePeak=tp,samplePeak=sp,sha256=report['outputSha256'],sourceSha256=report['sourceSha256'],loopReport='remaining/crowd-loop/'+report_path.name,processing=f'jentlemen会议厅真实人群录音；取57.432秒镜像内{start}至{start+length}秒。前三个18秒原段互不重叠；第四条为同原录音56秒长版本，与前三条重叠，不是独立采集。首尾1秒等功率交叉淡化并旋转循环边界，未重复短片段凑时长。固定增益，48kHz单声道Vorbis编码；最终逐声道接缝、真峰值及采样峰值检查通过，未人工试听。')
  reports.append(report)
(root/'entries.json').write_text(json.dumps(entries,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(reports,ensure_ascii=False,indent=2))

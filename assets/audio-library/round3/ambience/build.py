#!/usr/bin/env python3
"""本地生成准确40秒夜街和医院走廊循环，显式工具路径、192kHz动态限幅。"""
import argparse,hashlib,importlib.util,json,math,tempfile,subprocess
from pathlib import Path
import numpy as np
p=argparse.ArgumentParser(description=__doc__)
for key in ('ffmpeg','ffprobe','source'):p.add_argument('--'+key,required=True,type=Path)
a=p.parse_args()
for f in (a.ffmpeg,a.ffprobe,a.source):
 if not f.is_absolute() or not f.exists():p.error('请提供存在的绝对路径。')
root=Path(__file__).resolve().parent;base=root.parent.parent
spec=importlib.util.spec_from_file_location('loops',base/'round2-loops/build_loops.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
sources={x['freesoundId']:x for x in json.loads((a.source/'sources.json').read_text())}
plans=[(413949,0,'夜街秘鲁街角'),(540223,0,'夜街城市车辆'),(850137,0,'夜街滑板车辆'),(451883,0,'医院走廊一'),(451883,50,'医院走廊二'),(451883,100,'医院走廊三')]
entries=[]
with tempfile.TemporaryDirectory(prefix='夜街40秒 ') as temp:
 temp=Path(temp)
 for sid,start,name in plans:
  src=sources[sid];raw=a.source/src['file'];sha=hashlib.sha256(raw.read_bytes()).hexdigest()
  if sha!=src['sha256']:raise ValueError('源文件校验失败。')
  samples=m.decode(a.ffmpeg,raw,1)
  if len(samples)<(start+41)*48000:raise ValueError('原录音不足41秒选段。')
  identifier=f'round3-{src["category"]}-{sid}-{start}'
  entry=dict(id=identifier,path='round3/ambience/'+identifier+'.ogg',type='sfx',category='环境',name=name,tags=['环境', '夜街','夜晚','街道'] if sid!=451883 else ['环境','医院','医院走廊','医院底噪'],scene='适合夜间街道的真实连续背景。' if sid!=451883 else '适合有远处对话和轻微活动的医院走廊。',loop=True,loopable=True,license='CC0-1.0',source=src['pageUrl'],downloadSource=src['previewUrl'],author=('Philipp Grzemba (Sheyvan)' if sid==540223 else src['author']),origin='derived',recordingVerified=True,channels=1,sampleRate=48000,rawCommit='72b08644f41a0d62fe11f5708b193450341f41c5',rawFile=src['file'],rawSha256=sha,licensePath='round3/ambience/evidence/'+str(sid)+'.md')
  cyclic=m.crossfade(samples[start*48000:(start+41)*48000],48000)
  output=root/Path(entry['path']).name
  for attempt in range(12):
   rotated,rotation=m.smooth_boundary(cyclic,attempt*8000)
   m.write_wav(a.ffmpeg,np.tile(rotated,(3,1)),temp/'three.wav')
   # 前后各一整圈给动态响度和限幅器预热，不在成品边界启动/结束处理。
   m.run(a.ffmpeg,['-v','error','-y','-i',str(temp/'three.wav'),'-af','loudnorm=I=-18:TP=-2:LRA=7,aresample=192000,alimiter=limit=0.749894:attack=5:release=50:level=false:latency=true,aresample=48000','-c:a','pcm_f32le',str(temp/'normalized.wav')])
   normalized=m.decode(a.ffmpeg,temp/'normalized.wav',1)[40*48000:80*48000]
   m.write_wav(a.ffmpeg,normalized,temp/'clip.wav')
   m.run(a.ffmpeg,['-v','error','-y','-i',str(temp/'clip.wav'),'-ac','1','-ar','48000','-c:a','libvorbis','-q:a','5',str(output)])
   decoded=m.decode(a.ffmpeg,output,1);lufs,tp=m.measure(a.ffmpeg,output);sp=20*math.log10(float(np.max(np.abs(decoded))));seam=m.seam(decoded)
   if -21<=lufs<=-15 and max(tp,sp)<=-1 and len(decoded)==40*48000 and seam['passed']:break
  else:raise ValueError('响度、峰值或接缝检查未通过。')
  probe=json.loads(subprocess.run([str(a.ffprobe),'-v','error','-show_streams','-show_format','-of','json',str(output)],capture_output=True,check=True).stdout)
  report=dict(id=entry['id'],sourceSha256=sha,outputSha256=hashlib.sha256(output.read_bytes()).hexdigest(),sourceSliceStart=start,sourceSliceDuration=41,crossfadeSeconds=1,boundaryRotationSeconds=rotation,duration=40,channels=1,sampleRate=48000,loudness=lufs,truePeak=tp,samplePeak=sp,targetLufs=-18,seam=seam,subjectiveListeningCompleted=False,normalization='三圈动态loudnorm，192kHz限幅后取中间一圈',probe=probe)
  output.with_suffix('.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
  entry.update(path='round3/ambience/'+output.name,duration=40,targetLufs=-18,loudness=lufs,truePeak=tp,samplePeak=sp,sha256=report['outputSha256'],sourceSha256=sha,loopReport='round3/ambience/'+output.with_suffix('.json').name,processing=f'真实原作公共HQ预览内{start}–{start+41}秒；1秒交叉淡化后准确40秒。三圈192kHz动态响度和限幅后取中间圈，48kHz单声道Ogg；客观响度、峰值、接缝通过，未人工试听。',peakLimited=False,peakSafetyPrioritized=False)
  entry.update(sourceSliceStart=start,sourceSliceDuration=41,crossfadeSeconds=1)
  entries.append(entry)
  print(entry['id'],lufs,tp,sp,flush=True)
(root/'entries.json').write_text(json.dumps(entries,ensure_ascii=False,indent=2)+'\n')

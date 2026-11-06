#!/usr/bin/env python3
"""离线处理已核实 CC0 的人群与监护仪素材。"""
import argparse,hashlib,json,re,subprocess,tempfile
from pathlib import Path
p=argparse.ArgumentParser(description='本地整理公共空间音效')
for n in ('ffmpeg','ffprobe','night','passing','country'): p.add_argument('--'+n,type=Path,required=True)
a=p.parse_args()
for v in (a.ffmpeg,a.ffprobe,a.night,a.passing,a.country):
 if not v.is_absolute() or not v.is_file(): raise SystemExit('请输入存在的绝对路径。')
r=Path(__file__).resolve().parent; prefix='fill-gaps/public-spaces/'
def run(args): return subprocess.run([str(x) for x in args],capture_output=True,text=True,check=True,timeout=120)
def measure(f):
 s=run([a.ffmpeg,'-nostdin','-hide_banner','-i',f,'-af','loudnorm=I=-20:TP=-2:LRA=11:print_format=json','-f','null','-']).stderr
 return json.loads(re.findall(r'\{[^{}]*"input_i"[^{}]*\}',s,re.S)[-1])
sources={'night': ('robotjay', 'https://freesound.org/people/robotjay/sounds/275164/', 'https://github.com/interactiveaudiolab/VocalImitationSet/blob/b77114c43c52f5faa7d0bb69b22e1ebca0632201/original_recordings/non_reference/257Sounds%20of%20things_Vehicle_Motor%20vehicle%20(road)_Car_Car%20passing%20by/275164__robotjay__car-passing-suburb.wav', '奥克兰夜晚郊区街道真实汽车驶过录音；不是30秒连续街景底噪。'), 'passing': ('hinzebeat', 'https://freesound.org/people/hinzebeat/sounds/171447/', 'https://github.com/interactiveaudiolab/VocalImitationSet/blob/b77114c43c52f5faa7d0bb69b22e1ebca0632201/original_recordings/non_reference/257Sounds%20of%20things_Vehicle_Motor%20vehicle%20(road)_Car_Car%20passing%20by/171447__hinzebeat__car-passing-by.wav', '原作者汽车驶过录音。'), 'country': ('dankri2', 'https://freesound.org/people/dankri2/sounds/343424/', 'https://github.com/interactiveaudiolab/VocalImitationSet/blob/b77114c43c52f5faa7d0bb69b22e1ebca0632201/original_recordings/non_reference/257Sounds%20of%20things_Vehicle_Motor%20vehicle%20(road)_Car_Car%20passing%20by/343424__dankri2__car-passing-by.wav', '乡间道路真实汽车驶过录音，使用数据集保留的12.955秒节选，原页完整录音48.439秒，原片节选位置未公开。')}
jobs=[('car-pass-night', '夜晚郊区汽车驶过', 'night', 0, 10.824), ('car-pass-left', '汽车从路边驶过', 'passing', 0, 5.408), ('car-pass-country', '乡间公路汽车驶过', 'country', 0, 12.955)]
entries=[]
with tempfile.TemporaryDirectory(prefix='公共空间 ') as td:
 for ident,name,kind,start,length in jobs:
  original=getattr(a,kind); raw=Path(td)/'裁剪.wav'; out=r/(ident+'.ogg')
  filters='silenceremove=start_periods=1:start_threshold=-65dB,areverse,silenceremove=start_periods=1:start_threshold=-65dB,areverse,afade=t=in:d=0.01,areverse,afade=t=in:d=0.01,areverse'
  run([a.ffmpeg,'-nostdin','-v','error','-y','-ss',start,'-i',original,'-t',length,'-af',filters,'-ac',1,'-ar',48000,raw]); m=measure(raw)
  af=f"loudnorm=I=-20:TP=-2:LRA=11:measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true"
  run([a.ffmpeg,'-nostdin','-v','error','-y','-i',raw,'-af',af,'-ar',48000,'-ac',1,'-c:a','libvorbis','-q:a',4,out]); m=measure(out)
  correction=min(-20-float(m['input_i']),-1.5-float(m['input_tp']))
  if abs(correction)>0.5:
   fixed=Path(td)/'修正.ogg'
   run([a.ffmpeg,'-nostdin','-v','error','-y','-i',out,'-af',f'volume={correction}dB','-c:a','libvorbis','-q:a',4,fixed]); out.write_bytes(fixed.read_bytes()); m=measure(out)
  d=float(json.loads(run([a.ffprobe,'-v','error','-show_entries','format=duration','-of','json',out]).stdout)['format']['duration'])
  author,source,download,desc=sources[kind]
  entries.append(dict(id='sfx-'+ident,path=prefix+out.name,type='sfx',category='道具',name=name,tags=['车辆','汽车','驶过','夜晚','街道'] if kind=='night' else ['车辆','汽车','驶过'],scene='适合夜晚郊区道路车辆驶过的镜头。' if kind=='night' else '适合路边汽车接近并驶远的镜头。',duration=d,loop=False,loopable=False,loudness=float(m['input_i']),truePeak=float(m['input_tp']),targetLufs=-20,license='CC0-1.0',source=source,originalLicenseUrl=source,downloadSource=download,author=author,licensePath=prefix+'licenses/vehicles.md',sourceSha256=hashlib.sha256(original.read_bytes()).hexdigest(),sha256=hashlib.sha256(out.read_bytes()).hexdigest(),processing=desc+f'原片{start}秒起截取{length}秒，去首尾静音，10毫秒淡化，转为48kHz单声道Ogg并统一-20 LUFS。镜像保留原编号、作者、标题，原始来源CSV对应相同ID和作者；部分为数据集节选。'))
(r/'vehicle-entries.json').write_text(json.dumps(entries,ensure_ascii=False,indent=2)+'\n')
print(json.dumps([{'名称':x['name'],'时长':x['duration'],'响度':x['loudness'],'真峰值':x['truePeak']} for x in entries],ensure_ascii=False))

#!/usr/bin/env python3
"""离线处理已核实 CC0 的人群与监护仪素材。"""
import argparse,hashlib,json,re,subprocess,tempfile
from pathlib import Path
p=argparse.ArgumentParser(description='本地整理公共空间音效')
for n in ('ffmpeg','ffprobe','crowd','monitor'): p.add_argument('--'+n,type=Path,required=True)
a=p.parse_args()
for v in (a.ffmpeg,a.ffprobe,a.crowd,a.monitor):
 if not v.is_absolute() or not v.is_file(): raise SystemExit('请输入存在的绝对路径。')
r=Path(__file__).resolve().parent; prefix='fill-gaps/public-spaces/'
def run(args): return subprocess.run([str(x) for x in args],capture_output=True,text=True,check=True,timeout=120)
def measure(f):
 s=run([a.ffmpeg,'-nostdin','-hide_banner','-i',f,'-af','loudnorm=I=-20:TP=-2:LRA=11:print_format=json','-f','null','-']).stderr
 return json.loads(re.findall(r'\{[^{}]*"input_i"[^{}]*\}',s,re.S)[-1])
sources={
'crowd':('jentlemen','https://freesound.org/people/jentlemen/sounds/432331/','https://github.com/CharlesMish/silk-road-vn/blob/551943bff5dc6e0f19635a157893004295a10dd5/site/index.html','会议厅真实录音；镜像内嵌转码，与原页标题、作者、ID及57秒时长对应。'),
'monitor':('samfk360','https://freesound.org/people/samfk360/sounds/148897/','https://github.com/nagromLobo/danger-docs-video-game/blob/2355e2f763ca80d18f9f77071be800f3bba4fe09/Assets/Audio/148897__samfk360__heart-monitor-beep.mp3','第三方制作的监护仪提示音；非医院现场录音。镜像保留原始ID、作者及标题，时长27.9秒对应。')}
jobs=[('crowd-low-1','会议厅人群低声交谈一','crowd',0,18),('crowd-low-2','会议厅人群低声交谈二','crowd',19,18),('crowd-low-3','会议厅人群低声交谈三','crowd',38,18),('monitor-steady','监护仪规律提示音','monitor',0.38,10.9),('monitor-speed-up','监护仪逐渐加速提示音','monitor',11.1,4.7),('monitor-continuous','监护仪持续长鸣','monitor',18,8)]
entries=[]
with tempfile.TemporaryDirectory(prefix='公共空间 ') as td:
 for ident,name,kind,start,length in jobs:
  original=getattr(a,kind); raw=Path(td)/'裁剪.wav'; out=r/(ident+'.ogg')
  filters='silenceremove=start_periods=1:start_threshold=-65dB,areverse,silenceremove=start_periods=1:start_threshold=-65dB,areverse,afade=t=in:d=0.01,areverse,afade=t=in:d=0.01,areverse'
  run([a.ffmpeg,'-nostdin','-v','error','-y','-ss',start,'-i',original,'-t',length,'-af',filters,'-ac',1,'-ar',48000,raw]); m=measure(raw)
  af=f"loudnorm=I=-20:TP=-2:LRA=11:measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true"
  run([a.ffmpeg,'-nostdin','-v','error','-y','-i',raw,'-af',af,'-ar',48000,'-ac',1,'-c:a','libvorbis','-q:a',4,out]); m=measure(out)
  d=float(json.loads(run([a.ffprobe,'-v','error','-show_entries','format=duration','-of','json',out]).stdout)['format']['duration'])
  author,source,download,desc=sources[kind]
  entries.append(dict(id='sfx-'+ident,path=prefix+out.name,type='sfx',category='环境' if kind=='crowd' else '道具',name=name,tags=['人群','低语','室内','会议厅'] if kind=='crowd' else ['监护仪','医院','心电监护'],scene='适合会议厅中众人低声交流的镜头。' if kind=='crowd' else '适合医院监护仪特写，须按剧情选择提示状态。',duration=d,loop=False,loopable=False,loudness=float(m['input_i']),truePeak=float(m['input_tp']),targetLufs=-20,license='CC0-1.0',source=source,originalLicenseUrl=source,downloadSource=download,author=author,licensePath=prefix+'licenses/'+kind+'.md',sourceSha256=hashlib.sha256(original.read_bytes()).hexdigest(),sha256=hashlib.sha256(out.read_bytes()).hexdigest(),processing=desc+f'原片{start}秒起截取{length}秒，去首尾静音，10毫秒淡化，转为48kHz单声道Ogg并统一-20 LUFS。同类三条来自同一原片，不是三次独立录音。'))
(r/'entries.json').write_text(json.dumps(entries,ensure_ascii=False,indent=2)+'\n')
print(json.dumps([{'名称':x['name'],'时长':x['duration'],'响度':x['loudness'],'真峰值':x['truePeak']} for x in entries],ensure_ascii=False))

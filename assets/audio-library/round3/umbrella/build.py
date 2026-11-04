#!/usr/bin/env python3
"""从已核验的本地原录音构建雨伞音效，不联网。"""
import argparse,hashlib,importlib.util,json,subprocess,sys,tempfile
from pathlib import Path
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
spec=importlib.util.spec_from_file_location('peak_safety',ROOT/'peak_safety.py')
peak=importlib.util.module_from_spec(spec);spec.loader.exec_module(peak)
def run(args):return subprocess.run(args,capture_output=True,check=True,timeout=240)
def main():
 p=argparse.ArgumentParser(description=__doc__)
 p.add_argument('--ffmpeg',required=True);p.add_argument('--ffprobe',required=True)
 p.add_argument('--input-dir',required=True,type=Path);p.add_argument('--output-dir',required=True,type=Path)
 a=p.parse_args()
 for tool in (a.ffmpeg,a.ffprobe):
  if not Path(tool).is_absolute() or not Path(tool).is_file():raise ValueError('需要存在的工具绝对路径')
 if a.output_dir.exists():raise ValueError('输出目录必须是新目录')
 sources={s['freesoundId']:s for s in json.loads((HERE/'sources.json').read_text())}
 for s in sources.values():
  f=a.input_dir/s['file']
  if hashlib.sha256(f.read_bytes()).hexdigest()!=s['sha256']:raise ValueError('原文件校验不符')
 a.output_dir.mkdir(parents=True);entries=[];reports=[]
 for clip in json.loads((HERE/'clips.json').read_text()):
  s=sources[clip['sourceId']];dest=a.output_dir/(clip['id']+'.ogg')
  with tempfile.TemporaryDirectory(prefix='雨伞 处理 ') as tmp:
   trimmed=Path(tmp)/'原片段.wav'
   run([a.ffmpeg,'-v','error','-nostdin','-i',str(a.input_dir/s['file']),'-ss',str(clip['start']),'-t',str(clip['end']-clip['start']),'-ac','1','-ar','48000','-c:a','pcm_f32le',str(trimmed)])
   before=peak.measure_levels(trimmed,a.ffmpeg);gain=-18-before['loudness'];limit=.70;iterations=[]
   for _ in range(12):
    filt=f'aresample=192000,volume={gain:.8f}dB,alimiter=limit={limit}:attack=5:release=50:level=false:latency=true,aresample=48000'
    run([a.ffmpeg,'-v','error','-nostdin','-y','-i',str(trimmed),'-af',filt,'-ar','48000','-ac','1','-c:a','libvorbis','-q:a','6',str(dest)])
    measured=peak.measure_levels(dest,a.ffmpeg);iterations.append(dict(gain=gain,limit=limit,**measured))
    high=max(measured['truePeak'],measured['samplePeak'])
    if measured['loudness'] is not None and -21<=measured['loudness']<=-15 and high<=-1:break
    if measured['loudness'] is None:raise ValueError('无法测量响度')
    if high>-1:limit*=10**((-1.5-high)/20)
    gain+=-18-measured['loudness']
   else:raise ValueError('响度或峰值未达标')
  info=json.loads(run([a.ffprobe,'-v','error','-show_streams','-show_format','-of','json',str(dest)]).stdout)
  assert info['streams'][0]['sample_rate']=='48000' and info['streams'][0]['channels']==1
  entries.append(dict(id=clip['id'],path='round3/umbrella/'+dest.name,type='sfx',category='道具',name=clip['name'],tags=clip['tags'],scene='适合人物'+('打开雨伞的单次动作。' if 'open-' in clip['id'] else '收拢雨伞的动作（按原作者开合顺序推定，未试听）。'),duration=float(info['format']['duration']),loop=False,loopable=False,**measured,targetLufs=-18,source=s['pageUrl'],downloadSource=s['previewUrl'],sourceSha256=s['sha256'],sha256=hashlib.sha256(dest.read_bytes()).hexdigest(),author=s['author'],license='CC0-1.0',licenseEvidence='round3/umbrella/evidence/fs-'+str(s['freesoundId'])+'.txt',rawCommit=s['rawCommit'],sourceInterval={'start':clip['start'],'end':clip['end']},origin='recording',recordingVerified=True,channels=1,sampleRate=48000,classificationEvidence=clip['classification'],classificationBasis=clip['classification'],subjectiveListeningCompleted=False,peakLimited=False,processing='真实预览录音截段；四倍过采样动态限幅；48kHz单声道Vorbis；编码后重测响度和双峰；未合成、未复制延长。'))
  reports.append(dict(id=clip['id'],before=before,iterations=iterations,after=measured));print(clip['id'],measured,flush=True)
 (a.output_dir/'entries.json').write_text(json.dumps(entries,ensure_ascii=False,indent=2)+'\n')
 (a.output_dir/'MEASUREMENTS.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2)+'\n')
if __name__=='__main__':
 try:main()
 except (ValueError,OSError,subprocess.SubprocessError):
  print('构建失败，请检查原件校验、工具路径和音频测量结果',file=sys.stderr);sys.exit(1)

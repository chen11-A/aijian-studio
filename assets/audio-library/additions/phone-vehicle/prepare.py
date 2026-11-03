#!/usr/bin/env python3
"""本地处理六个已核实许可的第三方音效。不下载、不联网。"""
import argparse, hashlib, json, math, re, subprocess, tempfile
from pathlib import Path

PARSER = argparse.ArgumentParser(description='本地整理手机震动与车辆素材')
PARSER.add_argument('--ffmpeg', type=Path, required=True)
PARSER.add_argument('--ffprobe', type=Path, required=True)
PARSER.add_argument('--wyzowl', type=Path, required=True)
PARSER.add_argument('--kenney', type=Path, required=True)
PARSER.add_argument('--dechode', type=Path, required=True)
ARGS = PARSER.parse_args()
for tool in (ARGS.ffmpeg, ARGS.ffprobe):
    if not tool.is_absolute() or not tool.is_file(): raise SystemExit('请提供音频工具绝对路径。')
ROOT = Path(__file__).resolve().parent
PREFIX = 'additions/phone-vehicle/'
WCOMMIT='92780e7ab0cdfb557497a988089c47f46e8c7412'
KCOMMIT='2f2e5f2646dda89cb21d4e8539bab60c6e955dc8'
DCOMMIT='f448b000f896053319938e4f67ddd230623da853'
JOBS = [
 ('phone-hand-double','手持手机双震动','手机震动',ARGS.wyzowl/'sounds/phone/phone-vibrate-hand.wav',2,0.15,'wyzowl/sfx-kit',WCOMMIT,'sounds/phone/phone-vibrate-hand.wav','wyzowl','第三方代码合成；手持震动原片重复两次，中间间隔0.15秒。'),
 ('phone-table','桌面手机双震动','手机震动',ARGS.wyzowl/'sounds/phone/phone-vibrate-table.wav',1,0,'wyzowl/sfx-kit',WCOMMIT,'sounds/phone/phone-vibrate-table.wav','wyzowl','第三方代码合成；保留原桌面双震动节奏。'),
 ('phone-table-repeat','桌面手机连续来电震动','手机震动',ARGS.wyzowl/'sounds/phone/phone-vibrate-table.wav',3,0.45,'wyzowl/sfx-kit',WCOMMIT,'sounds/phone/phone-vibrate-table.wav','wyzowl','第三方代码合成素材的加工变体；原桌面双震动重复三次，每次间隔0.45秒，不是独立录音。'),
 ('car-engine','汽车引擎','车辆',ARGS.kenney/'audio/engine.ogg',1,0,'KenneyNL/Starter-Kit-Racing',KCOMMIT,'audio/engine.ogg','kenney','原作者发布的汽车引擎素材；去首尾静音并统一响度。'),
 ('motorcycle-engine','摩托车引擎','车辆',ARGS.kenney/'audio/engine-motorcycle.ogg',1,0,'KenneyNL/Starter-Kit-Racing',KCOMMIT,'audio/engine-motorcycle.ogg','kenney','原作者发布的摩托车引擎素材；去首尾静音并统一响度。'),
 ('engine-synth','车辆发动机合成声','车辆',ARGS.dechode/'sounds/EngineSample.wav',1,0,'Dechode/Godot-Simple-Vehicle',DCOMMIT,'sounds/EngineSample.wav','dechode','第三方作者使用enginesound合成的车辆引擎声音，不是真实录音；去首尾静音并统一响度。'),
]
def run(args):
    return subprocess.run([str(a) for a in args],capture_output=True,text=True,check=True,timeout=120)
def measurement(file):
    p=run([ARGS.ffmpeg,'-nostdin','-hide_banner','-i',file,'-af','loudnorm=I=-20:TP=-1:LRA=11:print_format=json','-f','null','-'])
    return json.loads(re.findall(r'\{[^{}]*"input_i"[^{}]*\}',p.stderr,re.S)[-1])
entries=[]
with tempfile.TemporaryDirectory(prefix='音频补充 ') as tmp:
    tmp=Path(tmp)
    for ident,name,category,file,repeats,gap,repo,commit,sourcefile,lic,processing in JOBS:
        raw=tmp/(ident+'.wav')
        filters='silenceremove=start_periods=1:start_threshold=-65dB:start_silence=0,areverse,silenceremove=start_periods=1:start_threshold=-65dB:start_silence=0,areverse'
        run([ARGS.ffmpeg,'-nostdin','-v','error','-y','-i',file,'-af',filters,'-ac','1','-ar','48000',raw])
        if repeats>1:
            padded=tmp/(ident+'-padded.wav')
            run([ARGS.ffmpeg,'-nostdin','-v','error','-y','-i',raw,'-af',f'apad=pad_dur={gap}',padded])
            sequence=tmp/(ident+'-sequence.wav')
            run([ARGS.ffmpeg,'-nostdin','-v','error','-y','-stream_loop',str(repeats-1),'-i',padded,'-af',filters,sequence])
            raw=sequence
        stats=measurement(raw)
        if not math.isfinite(float(stats['input_i'])): raise RuntimeError('素材响度无法测量：'+name)
        normalizer=(f"loudnorm=I=-20:TP=-1:LRA=11:measured_I={stats['input_i']}:measured_TP={stats['input_tp']}:"
                    f"measured_LRA={stats['input_lra']}:measured_thresh={stats['input_thresh']}:offset={stats['target_offset']}:linear=true")
        output=ROOT/(ident+'.ogg')
        run([ARGS.ffmpeg,'-nostdin','-v','error','-y','-i',raw,'-af',normalizer,'-c:a','libvorbis','-q:a','4','-ac','1','-ar','48000',output])
        measured=measurement(output)
        duration=float(json.loads(run([ARGS.ffprobe,'-v','error','-show_entries','format=duration','-of','json',output]).stdout)['format']['duration'])
        if abs(float(measured['input_i'])+20)>1: raise RuntimeError('成品响度偏差过大：'+name)
        entries.append(dict(id='sfx-'+ident,path=PREFIX+output.name,type='sfx',category='道具',name=name,tags=[category,name],scene='适合手机收到消息或来电的特写。' if category=='手机震动' else '适合车辆运行或发动机特写的镜头。',duration=duration,loop=False,loopable=False,loudness=float(measured['input_i']),targetLufs=-20,source=f'https://github.com/{repo}/blob/{commit}/{sourcefile}',license='CC0-1.0',licensePath=PREFIX+f'licenses/{lic}-README.md',originalLicenseUrl=f'https://github.com/{repo}/blob/{commit}/README.md',author=repo.split('/')[0],processing=processing+' 成品48kHz单声道Ogg，目标-20 LUFS。',sha256=hashlib.sha256(output.read_bytes()).hexdigest()))
(ROOT/'entries.json').write_text(json.dumps(entries,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(json.dumps([{'名称':x['name'],'时长':x['duration'],'响度':x['loudness']} for x in entries],ensure_ascii=False,indent=2))

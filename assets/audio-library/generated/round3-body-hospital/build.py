"""自制人体倒地与医院走廊拟音；仅本地运行，不代表现场录音。"""
from array import array
import argparse
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import random
import re
import subprocess
import sys
import tempfile

HERE=Path(__file__).resolve().parent
BASE=HERE.parents[1]
RATE=48000

def module(name):
    spec=importlib.util.spec_from_file_location(name,BASE/(name+'.py'))
    result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result);return result


def run(ffmpeg,args,data=None):
    if not Path(ffmpeg).is_absolute(): raise ValueError('请指定ffmpeg完整路径')
    return subprocess.run([str(ffmpeg),'-hide_banner','-nostdin',*args],input=data,capture_output=True,check=True)


def bytes_pcm(samples):
    a=array('f',samples)
    if sys.byteorder!='little':a.byteswap()
    return a.tobytes()


def save(ffmpeg,path,samples):
    run(ffmpeg,['-y','-f','f32le','-ar',str(RATE),'-ac','1','-i','-','-c:a','pcm_f32le',str(path)],bytes_pcm(samples))


def build(ffmpeg,ffprobe,cloth_input,source_commit):
    if not Path(ffprobe).is_absolute():raise ValueError('请指定ffprobe完整路径')
    if not Path(cloth_input).is_absolute():raise ValueError('请指定衣服摩擦输入完整路径')
    if not re.fullmatch(r'[0-9a-fA-F]{40}',source_commit):raise ValueError('来源提交号必须是40位十六进制')
    peak=module('peak_safety');loops=module('loop_tools')
    cloth=Path(cloth_input)
    cloth_hash=hashlib.sha256(cloth.read_bytes()).hexdigest()
    if cloth_hash!='3804ef7eac232c533128f53ada6b2035e37def0f1a0fe0ec19fda5176209c2e7':raise ValueError('衣服摩擦来源校验失败')
    cloth_pcm=loops.decode(ffmpeg,cloth)
    entries=[];reports=[]
    with tempfile.TemporaryDirectory(prefix='自制拟音 ') as d:
        temp=Path(d)
        for kind in ('body','hospital'):
            for variant in range(1,4):
                seed=73100+variant+(100 if kind=='hospital' else 0)
                raw=temp/'raw.wav';processed=temp/'processed.wav';loop=False
                if kind=='body':
                    rng=random.Random(seed);phase=0; samples=[]
                    for n in range(int(.8*RATE)):
                        t=n/RATE
                        # 70→40Hz短促重击，使用积分相位；不同随机种子与混音配比。
                        freq=40+30*math.exp(-18*t);phase+=2*math.pi*freq/RATE
                        x=math.sin(phase)*math.exp(-18*t)+(.22+.03*variant)*rng.uniform(-1,1)*math.exp(-25*t)
                        x*=min(1,t/.001)
                        ci=n-round(.03*RATE)
                        if 0<=ci<len(cloth_pcm):x+=(.20+.04*variant)*cloth_pcm[ci]
                        samples.append(x)
                    save(ffmpeg,raw,samples)
                    run(ffmpeg,['-y','-i',str(raw),'-af','lowpass=f=2500,alimiter=limit=0.35:level=false:latency=true','-c:a','pcm_f32le',str(processed)])
                    name=f'自制人体倒地拟音{variant}'
                    tags=['人体倒地','自制','拟音'];scene='适合人体倒地撞击的动作节点；自制合成与衣服摩擦混合，不是水泥地实录。'
                else:
                    # 先在低电平构建配方；交付响度统一-18，场景播放建议再降12dB。
                    run(ffmpeg,['-y','-f','lavfi','-i',f'anoisesrc=color=pink:amplitude=0.15:sample_rate=48000:duration=41:seed={seed}',
                        '-af','highpass=f=60,lowpass=f=900,aeval=val(0)+0.005623413*sin(2*PI*120*t),aecho=0.8:0.7:60|110:0.18|0.12',
                        '-t','41','-c:a','pcm_f32le',str(raw)])
                    samples,_=loops.crossfade_loop(loops.decode(ffmpeg,raw),1)
                    # 第三种噪声编码接缝略高于p99，将循环起点平移0.5秒保持同一周期。
                    if variant==3:samples=samples[RATE//2:]+samples[:RATE//2]
                    save(ffmpeg,processed,samples)
                    loop=True;name=f'自制医院走廊底噪循环{variant}'
                    tags=['医院底噪','医院走廊','室内','自制'];scene='适合安静医院走廊铺底；建议播放增益-12dB，使场景底噪约-30LUFS。'
                measured=peak.measure_levels(processed,ffmpeg)
                gain=-18-measured['loudness']
                output=HERE/f'{kind}-{variant}.ogg'
                for attempt in range(4):
                    run(ffmpeg,['-y','-i',str(processed),'-af',f'volume={gain}dB','-ar','48000','-ac','1','-c:a','libvorbis','-q:a','5',str(output)])
                    measured=peak.measure_levels(output,ffmpeg)
                    if max(measured['truePeak'],measured['samplePeak'])>-1:
                        gain-=max(measured['truePeak'],measured['samplePeak'])+1.2
                    elif -21<=measured['loudness']<=-15:break
                    else:gain+=-18-measured['loudness']
                assert -21<=measured['loudness']<=-15 and max(measured['truePeak'],measured['samplePeak'])<=-1,measured
                info=json.loads(subprocess.check_output([str(ffprobe),'-v','error','-show_format','-show_streams','-of','json',str(output)]))
                seam=loops.seam_metrics(loops.decode(ffmpeg,output)) if loop else None
                if loop:assert seam['passed'],seam
                item=dict(id=f'round3-generated-{kind}-{variant}',path='generated/round3-body-hospital/'+output.name,type='sfx',category='环境' if loop else '动作',name=name,tags=tags,scene=scene,
                    duration=float(info['format']['duration']),loop=loop,loopable=loop,loudness=measured['loudness'],targetLufs=-18, truePeak=measured['truePeak'],samplePeak=measured['samplePeak'],
                    license='CC0-1.0',source=f'https://github.com/chen11-A/aijian-studio/blob/{source_commit}/assets/audio-library/generated/round3-body-hospital/build.py',author='AIVORA 自制拟音',origin='generated',generated=True,recordingVerified=False,
                    subjectiveListeningCompleted=False,sampleRate=48000,channels=1,sha256=hashlib.sha256(output.read_bytes()).hexdigest(),seed=seed,
                    processing='按用户授权配方本地生成；不是现场录音；固定随机种子、限峰与实测响度校准。'+('粉噪HP60/LP900、120Hz原始-45dB正弦、60/110ms回声；尾首1秒等功率交叉淡化，第三变体循环起点平移0.5秒。' if loop else '70→40Hz下扫exp(-18t)，噪声exp(-25t)，低通2500Hz，30ms处叠衣服摩擦。'),
                    evidence='generated/round3-body-hospital/SOURCES.md')
                if loop:item['suggestedGainDb']=-12;item['sceneTargetLufs']=-30
                else:item['components']=[dict(type='generated',recipe='70→40Hz及衰减噪声',license='CC0-1.0'),dict(type='recorded-foley',name='Kenney cloth1',author='Kenney Vleugels',license='CC0-1.0',sha256=cloth_hash,source='https://github.com/lavenderdotpet/CC0-Public-Domain-Sounds/blob/f2b6264f9ab89fabc266914c3654685d68c5a39b/kenney_rpgaudio/Audio/cloth1.ogg',checkpoint='40049a9966298aae6c6058673abf945d48fba2b9',offsetSeconds=.03)]
                entries.append(item);reports.append(dict(id=item['id'],levels=measured,seam=seam,passed=True,sha256=item['sha256'],bytes=output.stat().st_size))
                print(name,measured,flush=True)
    (HERE/'entries.json').write_text(json.dumps(entries,ensure_ascii=False,indent=2)+'\n')
    (HERE/'validation.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2)+'\n')

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--ffmpeg',required=True);p.add_argument('--ffprobe',required=True);p.add_argument('--cloth-input',required=True);p.add_argument('--source-commit',required=True);a=p.parse_args();build(a.ffmpeg,a.ffprobe,a.cloth_input,a.source_commit)

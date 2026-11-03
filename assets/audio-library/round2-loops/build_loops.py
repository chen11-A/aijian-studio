#!/usr/bin/env python3
"""真实录音/音乐的长循环派生；不联网，保留原录音与立体声。需 numpy。"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import tempfile
import numpy as np

RATE = 48000

def run(tool, args, data=None):
    try:
        return subprocess.run([str(tool), '-hide_banner', '-nostdin', *args], input=data, capture_output=True, check=True)
    except (OSError, subprocess.CalledProcessError) as exc:
        raise ValueError('音频处理失败，请检查工具路径、源文件和编码器。') from exc

def decode(tool, path, channels):
    data = run(tool, ['-v', 'error', '-i', str(path), '-ac', str(channels), '-ar', str(RATE), '-f', 'f32le', '-']).stdout
    return np.frombuffer(data, dtype='<f4').reshape(-1, channels).copy()

def measure(tool, path):
    data = run(tool, ['-i', str(path), '-af', 'loudnorm=I=-20:TP=-1:LRA=11:print_format=json', '-f', 'null', '-']).stderr.decode('utf-8', 'replace')
    record = json.loads(re.findall(r'\{[^{}]*"input_i"[^{}]*\}', data)[-1])
    return float(record['input_i']), float(record['input_tp'])

def rms(x):
    return float(np.sqrt(np.mean(np.square(x, dtype=np.float64))))

def seam(samples):
    result=[]
    for channel in range(samples.shape[1]):
        x=samples[:,channel]; delta=np.abs(np.diff(x)); jump=float(abs(x[-1]-x[0])); p99=float(np.quantile(delta,.99)); width=960
        left=rms(x[-width:]); right=rms(x[:width]); around=rms(np.concatenate((x[-3*width:-width],x[width:3*width])))
        nearby=rms(np.concatenate((x[-width:],x[:width]))) / max(around, 1e-15)
        ratio=left/max(right,1e-15)
        result.append(dict(channel=channel+1,boundarySampleJump=jump,adjacentDifferenceP99=p99,leftRightRmsRatio=ratio,seamNearbyRmsRatio=nearby,passed=bool(jump<=p99 and .5<=ratio<=2 and .5<=nearby<=2)))
    return dict(channels=result,passed=all(x['passed'] for x in result),subjectiveListeningCompleted=False)

def beat_period(samples):
    # 100Hz 能量上升包络自相关，估计拍速；只作为候选剪切网格，不声称识别乐句。
    count=len(samples)//480
    energy=np.sqrt(np.mean(samples[:count*480].reshape(count,480,-1)**2,axis=(1,2)))
    onset=np.maximum(np.diff(energy),0); onset-=np.mean(onset)
    candidates=range(34,86) # 约70–176BPM
    lag=max(candidates,key=lambda lag:float(np.dot(onset[lag:],onset[:-lag])) / max(len(onset)-lag,1))
    period=64*lag/100
    return min(58,max(32,period)), 6000/lag

def crossfade(samples, count):
    # 中段 + 尾首等功率交叉淡化，边界保持原录音的连续相邻样本。
    angle=np.linspace(0,np.pi/2,count,dtype=np.float64)[:,None]
    mixed=samples[-count:]*np.cos(angle)+samples[:count]*np.sin(angle)
    return np.concatenate((samples[count:-count],mixed)).astype('<f4')

def smooth_boundary(samples, shift=0):
    # 移动循环边界到稳定非静音窗口，未在首尾人为淡到静音。
    choices=[]
    for cut in range(RATE//2+shift, min(4*RATE+shift,len(samples)-RATE), 241):
        left=rms(samples[cut-960:cut]); right=rms(samples[cut:cut+960])
        if min(left,right) < .001 or not .8<left/right<1.25: continue
        change=float(np.max(np.abs(samples[cut]-samples[cut-1])))
        choices.append((change,cut))
    cut=min(choices)[1] if choices else RATE
    return np.roll(samples,-cut,axis=0),cut/RATE

def write_wav(tool, samples, target):
    run(tool,['-v','error','-y','-f','f32le','-ar',str(RATE),'-ac',str(samples.shape[1]),'-i','-','-c:a','pcm_f32le',str(target)],samples.astype('<f4').tobytes())

def make(tool, base, item, output_dir):
    music=item['type']=='music'; channels=2 if music else 1
    source=base/item['path']; source_hash=hashlib.sha256(source.read_bytes()).hexdigest()
    samples=decode(tool,source,channels)
    if len(samples)<RATE*32: raise ValueError('原录音不足32秒，不通过短片段重复凑成长录音。')
    start=4 if music else 1
    if music: period,bpm=beat_period(samples)
    else: period,bpm=40,None
    fade=.25 if music else 1
    total=min(round((period+fade)*RATE),len(samples)-round(start*RATE))
    clip=samples[round(start*RATE):round(start*RATE)+total]
    cyclic=crossfade(clip,round(fade*RATE))
    identifier='r2-loop-'+item['id']; output=output_dir/(identifier+'.ogg')
    with tempfile.TemporaryDirectory(prefix='aivora-long-loop-') as temp:
        wav=Path(temp)/'source.wav'
        write_wav(tool,cyclic,wav); initial_lufs,initial_tp=measure(tool,wav)
        gain=min(-20-initial_lufs,-1.6-initial_tp)
        passed=False
        for attempt in range(6):
            rotated,rotation=smooth_boundary(cyclic,attempt*RATE//3)
            write_wav(tool,rotated,wav)
            run(tool,['-v','error','-y','-i',str(wav),'-af',f'volume={gain}dB','-ar',str(RATE),'-ac',str(channels),'-c:a','libvorbis','-q:a','5',str(output)])
            decoded=decode(tool,output,channels); measured_lufs,true_peak=measure(tool,output)
            sample_peak=20*math.log10(float(np.max(np.abs(decoded))))
            peak=max(true_peak,sample_peak)
            if peak>-1:
                gain-=peak+1.3
                continue
            check=seam(decoded)
            if check['passed']:
                passed=True; break
        if not passed: raise ValueError('循环接缝或峰值客观检查未通过：'+item['name'])
    report=dict(id=identifier,sourceId=item['id'],sourceSha256=source_hash,outputSha256=hashlib.sha256(output.read_bytes()).hexdigest(),
                source=item['source'],duration=len(decoded)/RATE,channels=channels,sampleRate=RATE,loudness=measured_lufs,truePeak=true_peak,
                samplePeak=sample_peak,targetLufs=-20,constantGainDb=gain,peakSafetyPrioritized=abs(measured_lufs+20)>1,
                originalDuration=len(samples)/RATE,originalSliceStart=start,crossfadeSeconds=fade,boundaryRotationSeconds=rotation,
                estimatedBpm=bpm,stereoDifferenceRms=rms(decoded[:,0]-decoded[:,1]) if music else None,seam=check,subjectiveListeningCompleted=False,
                note='音乐使用包络自相关估拍和整拍长度候选；仍须人工验证节奏及和声接缝。' if music else '来自独立真实设备环境录音，未用短片段重复凑足时长。')
    (output_dir/(identifier+'.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    entry={**item,'id':identifier,'path':'round2-loops/'+output.name,'name':item['name']+'（长循环）','duration':report['duration'],
           'author':'effacestudios' if music else 'Benjamin Burnes','loop':True,'loopable':True,'targetLufs':-20,
           'loudness':measured_lufs,'truePeak':true_peak,'samplePeak':sample_peak,'peakSafetyPrioritized':report['peakSafetyPrioritized'],'sha256':report['outputSha256'],
           'origin':'derived','channels':channels,'sampleRate':RATE,'loopReport':'round2-loops/'+identifier+'.json',
           'derivedFrom':item['id'],'processing':'真实录音截段；尾首等功率交叉淡化；固定增益以真峰值和采样峰值不高于-1dB优先；48kHz Vorbis重新编码；最终文件客观接缝检查通过，未人工试听。'}
    return entry

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ffmpeg',required=True,type=Path)
    parser.add_argument('--manifest',type=Path,default=Path(__file__).resolve().parent.parent/'manifest.json')
    args=parser.parse_args()
    if not args.ffmpeg.is_absolute() or not args.ffmpeg.is_file(): parser.error('请提供存在的 FFmpeg 绝对路径。')
    manifest=json.loads(args.manifest.read_text()); base=args.manifest.resolve().parent
    selected=[]; moods=set()
    for item in manifest:
        if item['type']=='music' and item['category'] not in moods and not item.get('derivedFrom'):
            selected.append(item); moods.add(item['category'])
    names=['通风口','浴室风扇','电脑风扇','除湿机','微波炉','室外空调','室外底噪','水槽龙头']
    selected.extend(next(x for x in manifest if x['name']==name) for name in names)
    root=Path(__file__).resolve().parent; entries=[]
    for item in selected:
        entry=make(args.ffmpeg,base,item,root); entries.append(entry)
        print(entry['name'],round(entry['duration'],3),entry['loudness'],entry['truePeak'],flush=True)
        (root/'entries.json').write_text(json.dumps(entries,ensure_ascii=False,indent=2)+'\n')
    print('完成；主清单未修改。仍需人工试听。',flush=True)

if __name__=='__main__': main()

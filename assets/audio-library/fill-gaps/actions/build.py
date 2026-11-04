"""从已核实的本地真实录音/镜像派生动作音效；不联网，显式程序路径。"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent
BASE = ROOT.parents[1]
spec = importlib.util.spec_from_file_location('peak', BASE / 'peak_safety.py')
peak = importlib.util.module_from_spec(spec)
spec.loader.exec_module(peak)


def run(tool, args):
    subprocess.run([str(tool), '-v', 'error', '-nostdin', *args], capture_output=True, check=True)


def build(ffmpeg, ffprobe, knives, wet):
    for tool in (ffmpeg, ffprobe):
        if not Path(tool).is_absolute():
            raise ValueError('请提供媒体程序完整路径')
    knife_commit = '190a277555ff6a1b7112090fc0a2db3189006db8'
    wet_commit = '4811ba48d795197de5621985f404e765c0b7c0ef'
    records = [('knife-whoosh', '小刀挥动掠空', knives/'knife-whoosh.mp3', 0, None, 'Shamewap',
                'https://freesound.org/people/Shamewap/sounds/389690/', ['刀挥砍','刀','挥动'],
                f'https://github.com/StarKnightt/counter-strike-in-browser/blob/{knife_commit}/assets_src/audio_raw/knife_whoosh.mp3')]
    for i, (start, duration) in enumerate([(2.04,.36),(3.70,.64),(6.61,1.24)],1):
        records.append((f'knife-slash-{i}',f'刀划伤拟音{i}（西瓜实录）',knives/'knife-flesh.mp3',start,duration,'sillygrizzlies',
                        'https://freesound.org/people/sillygrizzlies/sounds/635049/',['刀划伤','刀','拟音'],
                        f'https://github.com/StarKnightt/counter-strike-in-browser/blob/{knife_commit}/assets_src/audio_raw/knife_flesh.mp3'))
    for i, (start, duration) in enumerate([(.331,.376),(1.093,.246),(1.419,.221)],1):
        records.append((f'wet-step-{i}',f'湿粗砂地脚步{i}',wet,start,duration,'bruno.auzet',
                        'https://freesound.org/people/bruno.auzet/sounds/539175/',['湿地面脚步','脚步','湿砂地'],
                        f'https://github.com/dgreenheck/tidewater/blob/{wet_commit}/public/audio/step_wetsand.ogg'))
    entries=[]
    with tempfile.TemporaryDirectory(prefix='动作素材 ') as folder:
        for identifier,name,path,start,duration,author,source,tags,mirror in records:
            source_hash=hashlib.sha256(path.read_bytes()).hexdigest()
            raw=Path(folder)/(identifier+'.wav')
            trimming=['-ss',str(start),'-i',str(path)]
            if duration is not None: trimming += ['-t',str(duration)]
            run(ffmpeg,['-y',*trimming,'-ac','1','-ar','48000','-af','silenceremove=start_periods=1:start_threshold=-55dB:start_silence=0.005,areverse,silenceremove=start_periods=1:start_threshold=-55dB:start_silence=0.005,areverse','-c:a','pcm_f32le',str(raw)])
            before=peak.measure_levels(raw,ffmpeg)
            headroom=-1.8-max(before['truePeak'],before['samplePeak'])
            gain=min(-18-before['loudness'],headroom) if before['loudness'] is not None else headroom
            output=ROOT/(identifier+'.ogg')
            run(ffmpeg,['-y','-i',str(raw),'-af',f'volume={gain}dB','-c:a','libvorbis','-q:a','5',str(output)])
            measured=peak.measure_levels(output,ffmpeg)
            measured,correction=peak.repair_file(output,ffmpeg,measured)
            info=json.loads(subprocess.run([str(ffprobe),'-v','error','-show_format','-show_streams','-of','json',str(output)],capture_output=True,text=True,check=True).stdout)
            item=dict(id='gap-'+identifier,path='fill-gaps/actions/'+output.name,type='sfx',category='动作',name=name,tags=tags,
                      scene='适合雨后湿砂地行走的落脚节点。' if identifier.startswith('wet') else '适合刀挥动或划伤动作的同步拟音。',
                      duration=float(info['format']['duration']),loop=False,loopable=False,loudness=measured['loudness'],targetLufs=-18,
                      source=source,originalSource=source,sourceMirror=mirror,author=author,license='CC0-1.0',origin='derived',
                      channels=1,sampleRate=48000,truePeak=measured['truePeak'],samplePeak=measured['samplePeak'],
                      peakLimited=measured['loudness'] is not None and measured['loudness'] < -19,
                      sourceSha256=source_hash,sha256=hashlib.sha256(output.read_bytes()).hexdigest(),
                      processing='原作者CC0录音的GitHub镜像；选取独立动作，裁首尾低于-55dB静音；48kHz单声道Vorbis；固定增益以不超过-1dB真峰值和采样峰值优先；无合成、无变速。',
                      sourceExcerpt={'start':start,'duration':duration},gainDb=gain+correction,
                      evidence='fill-gaps/actions/SOURCES.md',recordingVerified=True,subjectiveListeningCompleted=False)
            if measured['loudness'] is None: item['loudnessNote']='独立短动作不足400毫秒，无法得到有效EBU积分响度；不加静音凑长度，改按约-1.8dB峰值规范化，并以实际采样及真峰值验收。'
            assert max(item['truePeak'],item['samplePeak']) <= -1
            entries.append(item)
            print(name,item['duration'],item['loudness'],item['truePeak'],flush=True)
    (ROOT/'entries.json').write_text(json.dumps(entries,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ffmpeg',required=True,type=Path)
    parser.add_argument('--ffprobe',required=True,type=Path)
    parser.add_argument('--knives',required=True,type=Path)
    parser.add_argument('--wet',required=True,type=Path)
    args=parser.parse_args()
    build(args.ffmpeg,args.ffprobe,args.knives,args.wet)

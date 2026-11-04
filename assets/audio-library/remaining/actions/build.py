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


def build(ffmpeg, ffprobe, source_file, drag_file):
    for tool in (ffmpeg, ffprobe):
        if not Path(tool).is_absolute():
            raise ValueError('请提供媒体程序完整路径')
    records=[]
    for i,(start,duration) in enumerate([(0,2.1),(4.68,2.2),(9.34,1.8)],1):
        records.append((f'pipe-impact-{i}',f'金属管受击{i}（钢管动作拟音）',source_file,start,duration,'martian',
            'https://freesound.org/people/martian/sounds/182262/', ['钢管击打','金属管击打','金属','撞击','拟音'],
            'https://github.com/MMMaellon/P-Shooters/blob/bdf721f69a9592f648c767cfe4bf0e49cf565809/Packages/com.mmmaellon.p-shooters/Runtime/Resources/Audio/GunFoley/182262__martian__foley-bullet-hit-metal-pipe.wav'))
    for i,(start,duration) in enumerate([(0,4),(5,4),(10,4)],1):
        records.append((f'pipe-drag-{i}',f'金属管拖混凝土片段{i}（钢管动作拟音）',drag_file,start,duration,'RutgerMuller',
            'https://freesound.org/people/RutgerMuller/sounds/104361/', ['钢管拖地','金属管拖地','金属','混凝土','拖动'],
            'https://github.com/Yarnsh/NakoDay/blob/395ee18dfc6edbcf1daef1beacf5ad8dd4270319/SFX/104361__rutgermuller__metal-pipe-scraped-on-concrete-in-basement.aiff'))
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
            item=dict(id='remaining-'+identifier,path='remaining/actions/'+output.name,type='sfx',category='动作',name=name,tags=tags,
                      scene='适合金属管在混凝土地面拖动的动作。' if identifier.startswith('pipe-drag') else '适合金属管遭受撞击的动作节点；原作为子弹击中管道的拟音。',
                      duration=float(info['format']['duration']),loop=False,loopable=False,loudness=measured['loudness'],targetLufs=-18,
                      source=source,originalSource=source,sourceMirror=mirror,author=author,license='CC0-1.0',origin='derived',
                      channels=1,sampleRate=48000,truePeak=measured['truePeak'],samplePeak=measured['samplePeak'],
                      peakLimited=measured['loudness'] is not None and measured['loudness'] < -19,
                      sourceSha256=source_hash,sha256=hashlib.sha256(output.read_bytes()).hexdigest(),
                      processing='原作者CC0录音的GitHub镜像；选取独立动作，裁首尾低于-55dB静音；48kHz单声道Vorbis；固定增益以不超过-1dB真峰值和采样峰值优先；无合成、无变速。',
                      sourceExcerpt={'start':start,'duration':duration},gainDb=gain+correction,
                      evidence='remaining/actions/SOURCES.md',recordingVerified=True,subjectiveListeningCompleted=False,materialNote='原作者仅注明金属管；钢管标签表示适用拟音场景，不表示钢材已确认。')
            if measured['loudness'] is None: item['loudnessNote']='独立短动作不足400毫秒，无法得到有效EBU积分响度；不加静音凑长度，改按约-1.8dB峰值规范化，并以实际采样及真峰值验收。'
            assert max(item['truePeak'],item['samplePeak']) <= -1
            entries.append(item)
            print(name,item['duration'],item['loudness'],item['truePeak'],flush=True)
    (ROOT/'entries.json').write_text(json.dumps(entries,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ffmpeg',required=True,type=Path)
    parser.add_argument('--ffprobe',required=True,type=Path)
    parser.add_argument('--source-file',required=True,type=Path)
    parser.add_argument('--drag-file',required=True,type=Path)
    args=parser.parse_args()
    build(args.ffmpeg,args.ffprobe,args.source_file,args.drag_file)

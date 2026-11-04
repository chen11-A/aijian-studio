"""处理本地已核验CC0动作音频；不会联网。"""
import argparse, hashlib, importlib.util, json, subprocess, tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent
BASE=ROOT.parents[1]
RAW_COMMIT='72b08644f41a0d62fe11f5708b193450341f41c5'
COMPONENT_COMMIT='244e404a076bdd91cbd6e4c944993a46b61c147d'

def run(ffmpeg,args):
    return subprocess.run([str(ffmpeg),'-hide_banner','-nostdin',*args],capture_output=True,check=True)

def build(raw_root,repo,ffmpeg,ffprobe):
    if not all(Path(p).is_absolute() for p in (raw_root,repo,ffmpeg,ffprobe)):raise ValueError('请输入程序和目录完整路径')
    raw_root=Path(raw_root)
    spec=importlib.util.spec_from_file_location('peak',BASE/'peak_safety.py');peak=importlib.util.module_from_spec(spec);spec.loader.exec_module(peak)
    sources={x['freesoundId']:x for x in json.loads((raw_root/'sources.json').read_text())}
    manifest=json.loads(subprocess.check_output(['git','show',COMPONENT_COMMIT+':assets/audio-library/manifest.json'],cwd=repo))
    if isinstance(manifest,dict):manifest=manifest.get('entries',manifest.get('items',[]))
    components=[next(x for x in manifest if x['id']==i) for i in ['sfx-b74c1393e17c','sfx-4729d1a9a20d']]
    specs=[('pipe-hit-1',824117,.34,1.25,'金属管击打实录1','钢管击打'),('pipe-hit-2',824117,3.66,2.15,'金属管击打实录2','钢管击打'),('pipe-hit-3',674034,0,1.3,'金属管击打实录3','钢管击打'),('pipe-drag-1',164676,0,5.56,'金属管拖混凝土实录1','钢管拖地'),('pipe-drag-2',104361,0,6,'金属管拖混凝土实录2','钢管拖地'),('pipe-drag-3',870792,12,8,'搬运金属管刮擦与碰撞实录','钢管拖地'),('body-fall-1',614064,0,.9,'人体倒地叠加拟音1','人体倒地'),('body-fall-2',519262,1.38,.8,'人体倒地叠加拟音2','人体倒地'),('body-fall-3',172413,1.30,2.1,'人体倒地叠加拟音3','人体倒地')]
    entries=[];report=[]
    with tempfile.TemporaryDirectory(prefix='动作处理 ') as d:
        temp=Path(d);comp_paths=[]
        for c in components:
            b=subprocess.check_output(['git','show',COMPONENT_COMMIT+':assets/audio-library/'+c['path']],cwd=repo)
            assert hashlib.sha256(b).hexdigest()==c['sha256']
            p=temp/(c['id']+'.ogg');p.write_bytes(b);comp_paths.append(p)
        for name,source_id,start,length,title,tag in specs:
            source=sources[source_id];input_file=raw_root/source['file']
            assert source['license']=='CC0-1.0' and hashlib.sha256(input_file.read_bytes()).hexdigest()==source['sha256']
            selected=temp/'selected.wav';mixed=temp/'mixed.wav';limited=temp/'limited.wav'
            run(ffmpeg,['-y','-ss',str(start),'-i',str(input_file),'-t',str(length),'-ac','1','-ar','48000','-af','silenceremove=start_periods=1:start_threshold=-55dB:start_silence=0.005,areverse,silenceremove=start_periods=1:start_threshold=-55dB:start_silence=0.005,areverse','-c:a','pcm_f32le',str(selected)])
            body=tag=='人体倒地'
            if body:
                run(ffmpeg,['-y','-i',str(selected),'-i',str(comp_paths[0]),'-i',str(comp_paths[1]),'-filter_complex','[0:a]asetpts=PTS-STARTPTS[a];[1:a]volume=0.45,adelay=20:all=1[b];[2:a]volume=0.35,adelay=30:all=1[c];[a][b][c]amix=inputs=3:duration=longest:normalize=0[m]','-map','[m]','-ac','1','-ar','48000','-c:a','pcm_f32le',str(mixed)])
            else:mixed=selected
            before=peak.measure_levels(mixed,ffmpeg);gain=-18-before['loudness'];output=ROOT/(name+'.ogg')
            attempts=[]
            for attempt in range(8):
                # 在192kHz上动态限幅，再降采样；最终Ogg重测防止编码后峰值超标。
                run(ffmpeg,['-y','-i',str(mixed),'-af',f'volume={gain}dB,aresample=192000,alimiter=limit=0.78:attack=5:release=50:level=false:latency=true,aresample=48000','-c:a','pcm_f32le',str(limited)])
                level=peak.measure_levels(limited,ffmpeg)
                post=min(-18-level['loudness'],-1.5-max(level['truePeak'],level['samplePeak']))
                run(ffmpeg,['-y','-i',str(limited),'-af',f'volume={post}dB','-c:a','libvorbis','-q:a','5',str(output)])
                measured=peak.measure_levels(output,ffmpeg);attempts.append({'inputGainDb':gain,'postGainDb':post,**measured})
                if -21<=measured['loudness']<=-15 and max(measured['truePeak'],measured['samplePeak'])<=-1:break
                gain+=3
            else:raise ValueError('音量或峰值不达标：'+name)
            info=json.loads(subprocess.check_output([ffprobe,'-v','error','-show_format','-show_streams','-of','json',str(output)]))
            item=dict(id='round3-'+name,path='round3/actions/'+output.name,type='sfx',category='动作',name=title,tags=[tag,'金属管' if not body else '叠加拟音']+(['金属管击打','钢管','铁棍','棍子'] if tag=='钢管击打' else []),scene='适合人体倒地动作；混合重拳与衣物声增强重量，不代表水泥现场实录。' if body else '适合钢管动作拟音；原作者金属管材质未作钢材鉴定。',duration=float(info['format']['duration']),loop=False,loopable=False,targetLufs=-18,loudness=measured['loudness'],truePeak=measured['truePeak'],samplePeak=measured['samplePeak'],source=source['pageUrl'],downloadSource=source['previewUrl'],author=source['author'],license=source['license'],sourceSha256=source['sha256'],rawSha256=source['sha256'],rawCommit=RAW_COMMIT,rawPath=source['file'],sourceExcerpt={'start':start,'duration':length},sha256=hashlib.sha256(output.read_bytes()).hexdigest(),channels=1,sampleRate=48000,origin='derived',generated=False,recordingVerified=True,subjectiveListeningCompleted=False,evidence='round3/actions/SOURCES.md',processing='公开HQ MP3预览；截取实录，裁首尾-55dB静音；48k单声道；192kHz四倍过采样动态限幅，Ogg编码后重新测量响度及双峰。',components=[])
            if body:
                item['components']=[{'author':source['author'],'license':source['license'],'source':source['pageUrl'],'downloadSource':source['previewUrl'],'sha256':source['sha256'],'sourceStart':start,'offsetSeconds':0,'gain':1}]
                for c,offset,g in zip(components,[.02,.03],[.45,.35]):item['components'].append({'name':c['name'],'author':c['author'],'license':c['license'],'source':c['source'],'processedSource':f"https://github.com/chen11-A/aijian-studio/blob/{COMPONENT_COMMIT}/assets/audio-library/{c['path']}",'sha256':c['sha256'],'offsetSeconds':offset,'gain':g})
            entries.append(item);report.append({'id':item['id'],'attempts':attempts,'passed':True,'bytes':output.stat().st_size,'sha256':item['sha256']})
            print(title,measured,flush=True)
    (ROOT/'entries.json').write_text(json.dumps(entries,ensure_ascii=False,indent=2)+'\n');(ROOT/'validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['raw-root','repo','ffmpeg','ffprobe']:p.add_argument('--'+name,required=True)
    a=p.parse_args();build(a.raw_root,a.repo,a.ffmpeg,a.ffprobe)

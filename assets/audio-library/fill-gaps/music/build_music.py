#!/usr/bin/env python3
"""从已下载且核实的两首 HoliznaCC0 音乐制作立体声循环；仅本地运行。"""
import argparse
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
LIBRARY = ROOT.parent.parent
spec = importlib.util.spec_from_file_location('aivora_long_loops', LIBRARY / 'round2-loops/build_loops.py')
loops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(loops)
MIRROR_COMMIT = '655388f987eacf6d08d73080fcc3e727f267bfde'
TRACKS = [
    ('all-the-way-sad', 'All The Way Sad', '一路悲伤', 'lo-fi-and-chill', 'Lofi And Chill'),
    ('sad-boi', 'Sad Boi', '忧伤少年', 'left-overs', 'Left Overs'),
]

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ffmpeg', required=True, type=Path)
    parser.add_argument('--source-dir', required=True, type=Path, help='含两首原始 MP3 的本地文件夹')
    args=parser.parse_args()
    if not args.ffmpeg.is_absolute() or not args.ffmpeg.is_file(): parser.error('FFmpeg 必须是存在的绝对路径。')
    entries=[]
    from urllib.parse import quote
    for slug,title,name,album_slug,album in TRACKS:
        filename=f'HoliznaCC0 - {title}.mp3'
        source=f'https://freemusicarchive.org/music/holiznacc0/{album_slug}/{slug}/'
        item=dict(id='holizna-'+slug,path=filename,type='music',category='悲伤',name=name,tags=['悲伤','低保真','回忆'],
                  scene='适合失落、告别或独处回忆的情绪片段。',source=source,license='CC0-1.0',author='HoliznaCC0')
        entry=loops.make(args.ffmpeg,args.source_dir,item,ROOT)
        entry.update(path='fill-gaps/music/'+Path(entry['path']).name,
                     loopReport='fill-gaps/music/'+entry['id']+'.json',author='HoliznaCC0',
                     recordingTitle=title,album=album,compositionId='holizna-'+slug,
                     sourceMirror=f'https://github.com/SoundSafari/CC0-1.0-Music/blob/{MIRROR_COMMIT}/freemusicarchive.org/'+quote(filename),
                     licenseEvidence='fill-gaps/music/LICENSE_EVIDENCE.md',
                     licenseEvidenceNote='FMA逐曲CC0及原作者CC0整体声明；Bandcamp通用许可按钮另指向CC-BY4.0，详见证据说明。',
                     peakLimited=entry['peakSafetyPrioritized'])
        entries.append(entry)
        print(name,entry['duration'],entry['loudness'],entry['truePeak'],entry['samplePeak'],flush=True)
    (ROOT/'entries.json').write_text(json.dumps(entries,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

if __name__=='__main__': main()

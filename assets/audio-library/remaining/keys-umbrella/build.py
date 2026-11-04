#!/usr/bin/env python3
"""离线构建三条真实钥匙录音；不联网，不从 PATH 查找工具。"""
import sys
from pathlib import Path
HERE = Path(__file__).resolve().parent
LIBRARY = HERE.parents[1]
sys.path.insert(0, str(LIBRARY / 'fill-gaps/weather'))
from rebuild_common import *


def main():
    args = arguments()
    sources = json.loads((HERE / 'sources.json').read_text(encoding='utf-8'))
    entries = []
    for source in sources:
        original = args.input_dir / source['filename']
        verify_source(original, source)
        output = args.output_dir / (source['id'] + '.ogg')
        before = audio.measure(args.ffmpeg, original)
        gain = min(-18 - before['integrated_lufs'], -3 - before['true_peak_dbtp'])
        audio.run(args.ffmpeg, ['-n', '-i', str(original), '-af', f'volume={gain}dB',
                               '-ac', '1', '-ar', '48000', '-c:a', 'libvorbis',
                               '-q:a', '5', str(output)])
        report = finish(args.ffmpeg, args.ffprobe, output, loop=False)
        entries.append(dict(id=source['id'], path='remaining/keys-umbrella/' + output.name,
                            type='sfx', category='道具', name=source['name'],
                            tags=['钥匙', '钥匙串', '摇钥匙', '金属'],
                            scene='适合人物拿出、摇动或整理钥匙的动作细节。',
                            duration=report['duration'], loop=False, loopable=False,
                            loudness=report['integrated_lufs'], targetLufs=-18,
                            truePeak=report['true_peak_dbtp'], samplePeak=report['sample_peak_dbfs'],
                            peakLimited=report['integrated_lufs'] < -18.5,
                            peakSafetyPrioritized=True, origin='recording', recordingVerified=True,
                            sampleRate=48000, channels=1, sha256=report['sha256'],
                            source=source['source'], downloadSource=source['downloadSource'],
                            sourceSha256=source['sourceSha256'], author=source['author'],
                            license=source['license'], licenseEvidence='remaining/keys-umbrella/sources.json',
                            processing='使用研究库保留的真实钥匙录音片段；固定增益、48kHz单声道Vorbis；最终峰值优先，不重复拼接，不标记循环。'))
        print(source['name'] + '：格式及峰值检查通过')
    (args.output_dir / 'entries.json').write_text(json.dumps(entries, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError, KeyError, subprocess.SubprocessError):
        print('构建失败，请检查程序路径、原录音和来源校验值', file=sys.stderr)
        sys.exit(1)

#!/usr/bin/env python3
"""用本地原录音重建两条喘息和一条倒吸气，不联网或执行下载程序。"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'weather'))
from rebuild_common import *


def main():
    args = arguments()
    evidence_dir = Path(__file__).resolve().parent
    for number, filename in [('757113', 'breathing.mp3'), ('554906', 'breath_scared.mp3'), ('344407', 'jaw-gasp.wav')]:
        source = args.input_dir / filename
        evidence = json.loads((evidence_dir / (number + '-source.json')).read_text(encoding='utf-8'))
        verify_source(source, evidence)
        destination = args.output_dir / ('gap-human-' + number + '.ogg')
        before = audio.measure(args.ffmpeg, source)
        gain = min(-18 - before['integrated_lufs'], -3 - before['true_peak_dbtp'])
        audio.run(args.ffmpeg, ['-n', '-i', str(source), '-af', f'volume={gain}dB',
                               '-ac', '1', '-ar', '48000', '-c:a', 'libvorbis',
                               '-q:a', '5', str(destination)])
        finish(args.ffmpeg, args.ffprobe, destination, loop=False)
        print(number + '：格式和峰值检查通过')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError, KeyError, subprocess.SubprocessError) as error:
        print('离线构建失败，请检查原录音、程序路径和证据文件', file=sys.stderr)
        sys.exit(1)

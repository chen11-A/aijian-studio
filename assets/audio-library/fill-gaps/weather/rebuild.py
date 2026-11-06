#!/usr/bin/env python3
"""用本地 BigSoundBank 原始 WAV 重建八条天气录音；不会下载文件。"""
from rebuild_common import *


def main():
    args = arguments()
    evidence_dir = Path(__file__).resolve().parent
    for number in ['1019', '1290', '1289', '1295', '2679', '0904', '0908', '0907']:
        identifier = 'gap-weather-' + number
        source = args.input_dir / (number + '.wav')
        evidence = json.loads((evidence_dir / (identifier + '-source.json')).read_text(encoding='utf-8'))
        verify_source(source, evidence)
        duration = min(45.5, evidence['originalCatalogEntry']['duration'])
        destination = args.output_dir / (identifier + '.ogg')
        with tempfile.TemporaryDirectory(prefix='天气 原录音 ') as directory:
            trimmed = Path(directory) / '截取.wav'
            audio.run(args.ffmpeg, ['-i', str(source), '-t', str(duration),
                                   '-c:a', 'pcm_f32le', str(trimmed)])
            audio.make_loop(args.ffmpeg, trimmed, destination, target=-20)
        # 保留实际构建的首轮安全校准，再执行最终峰值检查。
        samples, loudness, sample_peak = measurements(args.ffmpeg, destination)
        peak = max(sample_peak, loudness['true_peak_dbtp'])
        if peak > -1.2:
            attenuate(args.ffmpeg, destination, -1.6 - peak)
        report = finish(args.ffmpeg, args.ffprobe, destination, loop=True)
        print(identifier + '：格式、峰值和接缝检查通过')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError, KeyError, subprocess.SubprocessError) as error:
        print('离线构建失败，请检查原录音、程序路径和证据文件', file=sys.stderr)
        sys.exit(1)

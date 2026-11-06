"""导出原循环尾部五秒接开头五秒，供人工试听；不追加淡化或调音。"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import wave

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
TRACKS = {
    'r2-loop-music-360f3c163ed6': 'happy-life-seam.wav',
    'r2-loop-music-9935a373414d': 'illusionist-seam.wav',
}


def export(ffmpeg, ffprobe):
    for tool in (ffmpeg, ffprobe):
        if not tool.is_absolute() or not tool.is_file():
            raise ValueError('请提供存在的音频工具绝对路径。')
    entries = {entry['id']: entry for entry in json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))}
    reports = []
    for identifier, filename in TRACKS.items():
        entry = entries[identifier]
        source = ROOT / entry['path']
        # 将最终交付 Ogg 解码为24位PCM，再直接拼接，无新增交叉淡化。
        decoded = subprocess.run([str(ffmpeg), '-v', 'error', '-nostdin', '-i', str(source),
                                  '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s24le', '-f', 's24le', 'pipe:1'],
                                 capture_output=True, check=True).stdout
        five_seconds = 5 * 48000 * 2 * 3
        if len(decoded) < five_seconds * 2:
            raise ValueError('原音乐不足十秒，无法提取指定试听片段。')
        output = HERE / filename
        with wave.open(str(output), 'wb') as audio:
            audio.setnchannels(2)
            audio.setsampwidth(3)
            audio.setframerate(48000)
            audio.writeframes(decoded[-five_seconds:] + decoded[:five_seconds])
        probe = json.loads(subprocess.run([str(ffprobe), '-v', 'error', '-show_streams', '-show_format',
                                           '-of', 'json', str(output)], capture_output=True, text=True,
                                          encoding='utf-8', check=True).stdout)
        stream = probe['streams'][0]
        if float(probe['format']['duration']) != 10 or int(stream['sample_rate']) != 48000 or stream['channels'] != 2:
            raise ValueError('试听文件格式或时长不符合要求。')
        reports.append({'id': identifier, 'name': entry['name'], 'source': entry['path'],
                        'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
                        'preview': filename, 'previewSha256': hashlib.sha256(output.read_bytes()).hexdigest(),
                        'duration': 10, 'joinAtSeconds': 5, 'sampleRate': 48000, 'channels': 2,
                        'format': '24位PCM WAV', 'processing': '最终Ogg尾5秒直接接头5秒；没有新增淡化、限幅或响度处理。',
                        'subjectiveListeningPerformed': False})
    (HERE / 'PREVIEWS.json').write_text(json.dumps(reports, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(reports, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ffmpeg', required=True, type=Path)
    parser.add_argument('--ffprobe', required=True, type=Path)
    args = parser.parse_args()
    try:
        export(args.ffmpeg, args.ffprobe)
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        parser.error(f'试听导出失败：{error}')

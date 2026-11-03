import { spawn } from 'node:child_process';
import { isAbsolute, win32, extname, resolve } from 'node:path';

export interface LoudnessMeasurement { integrated: number; truePeak: number; range: number; threshold: number; offset: number }
export interface NormalizeOptions { ffmpegPath: string; input: string; output: string; target: -14 | -23 }
/** 不使用命令解释器；中文、空格和特殊字符均作为原样参数传入。 */
export function runFFmpeg(executable: string, args: string[]): Promise<string> {
  if (!isAbsolute(executable) && !win32.isAbsolute(executable)) return Promise.reject(new Error('请提供 ffmpeg 的完整路径'));
  return new Promise((yes, no) => {
    const process = spawn(executable, args, { shell: false, windowsHide: true });
    let stderr = '';
    process.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-2_000_000); });
    process.on('error', () => no(new Error('无法启动 ffmpeg，请检查程序路径')));
    process.on('close', code => {
      if (code === 0 && !/already exists/.test(stderr)) { yes(stderr); return; }
      const message = /matches no streams|does not contain any stream/.test(stderr)
        ? '输入文件没有可用音轨，请选择包含声音的文件'
        : /already exists/.test(stderr) ? '输出文件已存在，请使用新的输出文件名'
        : '音频处理失败，请检查输入文件是否可读，以及输出格式和本机编码器是否匹配';
      no(new Error(message));
    });
  });
}
export function parseMeasurement(log: string): LoudnessMeasurement {
  const blocks = log.match(/\{[^{}]*"input_i"[^{}]*\}/g);
  if (!blocks) throw new Error('未能读取响度测量结果');
  const data = JSON.parse(blocks[blocks.length - 1]);
  const values = [data.input_i, data.input_tp, data.input_lra, data.input_thresh, data.target_offset].map(Number);
  if (values.some(v => !Number.isFinite(v))) throw new Error('音频没有可测量的声音');
  return { integrated: values[0], truePeak: values[1], range: values[2], threshold: values[3], offset: values[4] };
}
export async function measureLoudness(ffmpegPath: string, input: string, target: -14 | -23 = -14): Promise<LoudnessMeasurement> {
  return parseMeasurement(await runFFmpeg(ffmpegPath, ['-hide_banner', '-nostdin', '-i', input, '-map', '0:a:0', '-vn', '-af', `loudnorm=I=${target}:TP=-1.2:LRA=11:print_format=json`, '-f', 'null', '-']));
}
export async function normalizeLoudness(options: NormalizeOptions): Promise<{ before: LoudnessMeasurement; after: LoudnessMeasurement; output: string }> {
  const { ffmpegPath, input, output, target } = options;
  if (target !== -14 && target !== -23) throw new Error('目标响度只能为 -14 或 -23 LUFS');
  if (resolve(input) === resolve(output)) throw new Error('输出文件不能覆盖原文件');
  const extension = extname(output).toLowerCase();
  const audioCodecs: Record<string, string> = { '.wav': 'pcm_s24le', '.ogg': 'libvorbis', '.m4a': 'aac', '.aac': 'aac', '.mp3': 'libmp3lame', '.flac': 'flac', '.opus': 'libopus' };
  const audioOnly = Object.hasOwn(audioCodecs, extension);
  if (!audioOnly && !['.mp4', '.mov', '.mkv'].includes(extension)) throw new Error('输出格式不支持，请使用 WAV、OGG、M4A、AAC、MP3、FLAC、OPUS 或 MP4、MOV、MKV');
  const before = await measureLoudness(ffmpegPath, input, target);
  const filter = `loudnorm=I=${target}:TP=-1.2:LRA=11:measured_I=${before.integrated}:measured_TP=${before.truePeak}:measured_LRA=${before.range}:measured_thresh=${before.threshold}:offset=${before.offset}:linear=true:print_format=json`;
  const codec = audioOnly ? audioCodecs[extension] : 'aac';
  const mapping = audioOnly ? ['-map', '0:a:0', '-vn'] : ['-map', '0:v?', '-map', '0:a:0', '-c:v', 'copy'];
  await runFFmpeg(ffmpegPath, ['-hide_banner', '-nostdin', '-n', '-i', input, ...mapping, '-af', filter, '-ar', '48000', '-c:a', codec, output]);
  const after = await measureLoudness(ffmpegPath, output, target);
  if (after.truePeak > -1 || Math.abs(after.integrated - target) > 1) throw new Error('输出响度未达标，请使用无损输出或检查原始音频动态范围');
  return { before, after, output };
}

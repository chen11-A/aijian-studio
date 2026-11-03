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
    process.on('close', code => code === 0 ? yes(stderr) : no(new Error('音频处理失败，请检查文件和输出格式')));
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
  return parseMeasurement(await runFFmpeg(ffmpegPath, ['-hide_banner', '-nostdin', '-i', input, '-vn', '-af', `loudnorm=I=${target}:TP=-1.2:LRA=11:print_format=json`, '-f', 'null', '-']));
}
export async function normalizeLoudness(options: NormalizeOptions): Promise<{ before: LoudnessMeasurement; after: LoudnessMeasurement; output: string }> {
  const { ffmpegPath, input, output, target } = options;
  if (target !== -14 && target !== -23) throw new Error('目标响度只能为 -14 或 -23 LUFS');
  if (resolve(input) === resolve(output)) throw new Error('输出文件不能覆盖原文件');
  const before = await measureLoudness(ffmpegPath, input, target);
  const filter = `loudnorm=I=${target}:TP=-1.2:LRA=11:measured_I=${before.integrated}:measured_TP=${before.truePeak}:measured_LRA=${before.range}:measured_thresh=${before.threshold}:offset=${before.offset}:linear=true:print_format=json`;
  const codec = extname(output).toLowerCase() === '.wav' ? 'pcm_s24le' : extname(output).toLowerCase() === '.ogg' ? 'libvorbis' : 'aac';
  await runFFmpeg(ffmpegPath, ['-hide_banner', '-nostdin', '-n', '-i', input, '-map', '0:v?', '-map', '0:a:0', '-c:v', 'copy', '-af', filter, '-ar', '48000', '-c:a', codec, output]);
  const after = await measureLoudness(ffmpegPath, output, target);
  if (after.truePeak > -1 || Math.abs(after.integrated - target) > 1) throw new Error('输出响度未达标，请使用无损输出或检查原始音频动态范围');
  return { before, after, output };
}

import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { isAbsolute, win32 } from 'node:path';

export interface AudioClip { path: string; start: number; end: number; sourceStart?: number; /** 原音频中最后一个台词字的结束时间 */ speechEnd?: number; speechStart?: number }
export interface Shot { path: string; start: number; end: number; sourceStart?: number; voices?: AudioClip[]; music?: AudioClip[] }
export interface Timeline { shots: Shot[]; duration?: number }
export interface CheckOptions { ffmpegPath: string; ffprobePath: string; /** 连续无声阈值，默认 2 秒 */ silenceSeconds?: number }
export interface Issue { shot: number; time: number; code: string; message: string; suggestion: string }
export interface Report { ok: boolean; issues: Issue[]; text: string }
interface Probe { streams: { codec_type: string; width?: number; height?: number; sample_aspect_ratio?: string; duration?: string }[]; format: { duration?: string } }
export function runProgram(executable: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  if (!isAbsolute(executable) && !win32.isAbsolute(executable)) return Promise.reject(new Error('请提供媒体程序的完整路径'));
  return new Promise((yes, no) => {
    const child = spawn(executable, args, { shell: false, windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', b => { stdout = (stdout + b.toString()).slice(-2_000_000); });
    child.stderr.on('data', b => { stderr = (stderr + b.toString()).slice(-2_000_000); });
    child.on('error', () => no(new Error('无法启动媒体程序，请检查路径')));
    child.on('close', code => code === 0 ? yes({ stdout, stderr }) : no(new Error('媒体文件无法读取或解码')));
  });
}
/** 检测日志的时间相对被分析的片段。 */
export function detectIntervals(log: string, kind: 'black' | 'freeze' | 'silence', duration: number): [number, number][] {
  const starts: number[] = [], result: [number, number][] = [];
  const expression = new RegExp(`${kind}_(start|end):\\s*([\\d.]+)`, 'g');
  for (const match of log.matchAll(expression)) {
    if (match[1] === 'start') starts.push(Number(match[2]));
    else if (starts.length) result.push([starts.shift()!, Number(match[2])]);
  }
  for (const start of starts) result.push([start, duration]);
  return result;
}
export async function checkExport(timeline: Timeline, options: CheckOptions): Promise<Report> {
  const { ffmpegPath, ffprobePath } = options;
  for (const executable of [ffmpegPath, ffprobePath]) if (!isAbsolute(executable) && !win32.isAbsolute(executable)) throw new Error('请提供媒体程序的完整路径');
  const issues: Issue[] = [];
  const add = (shot: number, time: number, code: string, message: string, suggestion: string) => issues.push({ shot, time, code, message, suggestion });
  let reference = '';
  const audio: AudioClip[] = [];
  let end = 0;
  async function probe(path: string, shot: number, time: number): Promise<Probe | undefined> {
    try { await access(path); } catch { add(shot, time, 'missing', '文件不存在', '重新选择文件或恢复丢失的素材'); return; }
    try {
      const value = await runProgram(ffprobePath, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path]);
      const info: Probe = JSON.parse(value.stdout);
      await runProgram(ffmpegPath, ['-v', 'error', '-xerror', '-nostdin', '-i', path, '-f', 'null', '-']);
      return info;
    } catch { add(shot, time, 'decode', '文件无法解码', '重新转码或更换素材'); }
  }
  const valid = (start: number, finish: number, source: number) => [start, finish, source].every(Number.isFinite) && start >= 0 && finish > start && source >= 0;
  for (let index = 0; index < timeline.shots.length; index++) {
    const shot = timeline.shots[index], number = index + 1, source = shot.sourceStart ?? 0;
    if (!valid(shot.start, shot.end, source)) { add(number, Math.max(0, shot.start || 0), 'time', '镜头时间无效', '设置有效的起止时间'); continue; }
    if (shot.start > end + .05) add(number, end, 'gap', '画面时间线有空白', '补上画面或缩短镜头间隙');
    if (shot.start < end - .05) add(number, shot.start, 'overlap', '画面时间线有重叠', '检查镜头起止时间');
    end = Math.max(end, shot.end);
    const length = shot.end - shot.start;
    const info = await probe(shot.path, number, shot.start);
    if (info) {
      const video = info.streams.find(s => s.codec_type === 'video');
      if (!video) add(number, shot.start, 'video', '素材没有画面', '选择包含画面的视频');
      else {
        const size = `${video.width}x${video.height}:${video.sample_aspect_ratio ?? '1:1'}`;
        if (reference && size !== reference) add(number, shot.start, 'size', '分辨率或宽高比不一致', '统一分辨率和像素宽高比后导出');
        reference ||= size;
        const duration = Number(video.duration ?? info.format.duration);
        if (Number.isFinite(duration) && source + length > duration + .08) add(number, shot.start, 'video-duration', '画面素材时长不足', '缩短出点或补充画面');
        let scanLog = '';
        try {
        const scanned = await runProgram(ffmpegPath, ['-hide_banner', '-nostdin', '-ss', String(source), '-i', shot.path, '-t', String(length), '-an', '-vf', 'blackdetect=d=2:pix_th=0.10,freezedetect=n=-60dB:d=2', '-f', 'null', '-']);
        scanLog = scanned.stderr;
        } catch { add(number, shot.start, 'scan', '画面检测失败', '检查本机 ffmpeg 是否包含黑屏和静帧检测滤镜'); }
        for (const kind of ['black', 'freeze'] as const) for (const [start, finish] of detectIntervals(scanLog, kind, length)) {
          if (finish - start > 2) add(number, shot.start + start, kind, kind === 'black' ? '黑屏超过 2 秒' : '静帧超过 2 秒', '检查该段画面，替换异常素材或确认这是有意停留');
        }
      }
    }
    for (const clip of [...(shot.voices ?? []), ...(shot.music ?? [])]) {
      const sourceStart = clip.sourceStart ?? 0;
      if (!valid(clip.start, clip.end, sourceStart)) { add(number, shot.start, 'audio-time', '声音时间无效', '设置有效的声音起止时间'); continue; }
      if (clip.start < shot.start || clip.end > shot.end) add(number, clip.start, 'sync', '画面和声音时间对不上', '调整声音起止时间或延长画面');
      if (clip.speechStart !== undefined && sourceStart > clip.speechStart + .02) add(number, clip.start, 'speech-cut', '台词开头被截断', '提前配音入点，保留完整台词');
      if (clip.speechEnd !== undefined && clip.speechEnd > sourceStart + clip.end - clip.start + .02) add(number, clip.end, 'speech-cut', '台词尾部被截断', '延长配音出点，保留完整台词');
      const data = await probe(clip.path, number, clip.start);
      if (data) {
        const stream = data.streams.find(s => s.codec_type === 'audio');
        if (!stream) add(number, clip.start, 'audio', '素材没有声音', '选择包含声音的素材');
        else {
          const duration = Number(stream.duration ?? data.format.duration);
          if (Number.isFinite(duration) && sourceStart + clip.end - clip.start > duration + .08) add(number, clip.start, 'audio-duration', '声音素材时长不足', '缩短声音片段或补充音频');
          audio.push(clip);
        }
      }
    }
  }
  const duration = timeline.duration ?? end;
  if (!Number.isFinite(duration) || duration <= 0) add(1, 0, 'empty', '时间线没有有效内容', '添加镜头并设置时长');
  else {
    if (Math.abs(duration - end) > .08) add(Math.max(1, timeline.shots.length), Math.min(duration, end), 'duration', '整片时长和画面时长不一致', '让整片时长与最后一个镜头的出点一致');
    const threshold = options.silenceSeconds ?? 2;
    if (!Number.isFinite(threshold) || threshold <= 0) throw new Error('无声阈值必须大于零');
    let intervals: [number, number][];
    if (!audio.length) intervals = [[0, duration]];
    else {
      const args = ['-hide_banner', '-nostdin'];
      for (const clip of audio) args.push('-i', clip.path);
      const filters = audio.map((clip, i) => `[${i}:a:0]atrim=start=${clip.sourceStart ?? 0}:duration=${clip.end - clip.start},asetpts=PTS-STARTPTS,adelay=${Math.round(clip.start * 1000)}:all=1[a${i}]`);
      filters.push(audio.map((_, i) => `[a${i}]`).join('') + `amix=inputs=${audio.length}:normalize=0,apad,atrim=duration=${duration},silencedetect=n=-50dB:d=${threshold}[out]`);
      const scanned = await runProgram(ffmpegPath, [...args, '-filter_complex', filters.join(';'), '-map', '[out]', '-f', 'null', '-']);
      intervals = detectIntervals(scanned.stderr, 'silence', duration);
    }
    for (const [start, finish] of intervals) if (finish - start > threshold) {
      const shot = Math.max(0, timeline.shots.findIndex(s => s.start <= start && s.end > start)) + 1;
      add(shot, start, 'silence', `连续无声 ${Number((finish - start).toFixed(2))} 秒`, '补充环境音或确认这段留白是有意安排');
    }
  }
  return { ok: !issues.length, issues, text: issues.length ? issues.map(i => `第 ${i.shot} 个镜头，第 ${i.time.toFixed(2)} 秒：${i.message}。建议：${i.suggestion}。`).join('\n') : '自检通过，没有发现问题。' };
}

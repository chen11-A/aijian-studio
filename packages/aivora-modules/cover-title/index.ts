import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export type CoverFormat = 'landscape' | 'portrait' | 'square';
export type CoverTemplate = 'cinema' | 'drama' | 'comic';
export interface CoverOptions {
  /** 必须是绝对路径，不会从 PATH 查找。 */
  ffmpegPath: string;
  imagePath: string;
  outputPath: string;
  title: string;
  subtitle: string;
  episode: number;
  format: CoverFormat;
  template: CoverTemplate;
  /** 仓库内已有的中文字体文件，调用方显式提供。 */
  fontPath: string;
  aiLabel?: boolean;
}
export interface CoverResult { path: string; width: number; height: number; duration?: number }
export const sizes: Record<CoverFormat, readonly [number, number]> = {
  landscape: [1920, 1080], portrait: [1080, 1920], square: [1080, 1080],
};
const layouts = {
  cinema: { titleY: 0.66, subtitleY: 0.79, episodeY: 0.88, color: 'white', border: 2, box: false },
  drama: { titleY: 0.38, subtitleY: 0.54, episodeY: 0.64, color: '0xFFE9A6', border: 5, box: true },
  comic: { titleY: 0.18, subtitleY: 0.34, episodeY: 0.44, color: '0xFFEF63', border: 7, box: true },
} as const;

async function run(binary: string, args: string[], cwd: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    execFile(binary, args, { cwd, windowsHide: true, timeout: 180_000, maxBuffer: 2 * 1024 * 1024 }, error => {
      if (error) reject(new Error('封面或片头生成失败，请检查输入图片、字体和视频工具。'));
      else resolve();
    });
  });
}
function validate(o: CoverOptions): void {
  if (!path.isAbsolute(o.ffmpegPath)) throw new Error('请提供视频工具的绝对路径。');
  if (!sizes[o.format] || !layouts[o.template]) throw new Error('封面尺寸或排版模板不正确。');
  if (!o.title.trim() || !Number.isInteger(o.episode) || o.episode < 1) throw new Error('请填写片名和正确的集数。');
  if ([o.title, o.subtitle].some(t => /[\r\n\x00]/u.test(t) || [...t].length > 40)) throw new Error('片名和副标题请各写一行，最多四十个字。');
  if (!o.outputPath || path.resolve(o.outputPath) === path.resolve(o.imagePath) || path.resolve(o.outputPath) === path.resolve(o.fontPath) || path.resolve(o.outputPath) === path.resolve(o.ffmpegPath)) throw new Error('输出文件不能覆盖原图片、字体或视频工具。');
}
/** 图片居中裁切铺满；文字自动缩小以保留两边安全距离。 */
export async function createCover(o: CoverOptions): Promise<CoverResult> {
  validate(o);
  try { await Promise.all([access(o.imagePath), access(o.fontPath), access(o.ffmpegPath)]); }
  catch { throw new Error('找不到图片、字体或视频工具，请检查路径。'); }
  const output = path.resolve(o.outputPath);
  const dir = await mkdtemp(path.join(tmpdir(), 'aivora-cover-'));
  try {
    // 简短的本地文件名避免滤镜对 Windows 盘符、空格和中文路径进行二次解析。
    await copyFile(o.fontPath, path.join(dir, 'font.otf'));
    await Promise.all([
      writeFile(path.join(dir, 'title.txt'), o.title, 'utf8'),
      writeFile(path.join(dir, 'subtitle.txt'), o.subtitle, 'utf8'),
      writeFile(path.join(dir, 'episode.txt'), `第 ${o.episode} 集`, 'utf8'),
      writeFile(path.join(dir, 'label.txt'), 'AI 生成', 'utf8'),
    ]);
    const [width, height] = sizes[o.format];
    const layout = layouts[o.template];
    const base = Math.min(width, height);
    const fontSize = (text: string, ratio: number) => Math.floor(Math.min(base * ratio, width * 0.84 / Math.max(1, [...text].length)));
    const draw = (file: string, size: number, y: number, color: string, border: number) =>
      `drawtext=fontfile=font.otf:textfile=${file}.txt:expansion=none:fontsize=${size}:fontcolor=${color}:borderw=${border}:bordercolor=black:x=(w-tw)/2:y=h*${y}:box=${layout.box ? 1 : 0}:boxcolor=black@0.40:boxborderw=12`;
    const filters = [
      `scale=${width}:${height}:force_original_aspect_ratio=increase`, `crop=${width}:${height}`, 'setsar=1',
      'drawbox=x=0:y=ih*0.12:w=iw:h=ih*0.82:color=black@0.22:t=fill',
      draw('title', fontSize(o.title, 0.09), layout.titleY, layout.color, layout.border),
      draw('subtitle', fontSize(o.subtitle, 0.035), layout.subtitleY, 'white', 1),
      draw('episode', Math.floor(base * 0.027), layout.episodeY, 'white', 1),
    ];
    if (o.aiLabel) filters.push('drawtext=fontfile=font.otf:textfile=label.txt:expansion=none:fontsize=26:fontcolor=white:borderw=1:bordercolor=black:x=w-tw-40:y=h-th-40');
    await mkdir(path.dirname(output), { recursive: true });
    await run(o.ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', path.resolve(o.imagePath), '-vf', filters.join(','), '-frames:v', '1', '-threads', '1', '-f', 'image2', '-c:v', 'png', output], dir);
    return { path: output, width, height };
  } finally { await rm(dir, { recursive: true, force: true }); }
}
/** 输出固定三秒、25 帧每秒的 H.264 MP4；头尾各半秒淡入淡出，不附带声音。 */
export async function createTitleVideo(o: CoverOptions): Promise<CoverResult> {
  validate(o);
  const dir = await mkdtemp(path.join(tmpdir(), 'aivora-title-'));
  try {
    const cover = await createCover({ ...o, outputPath: path.join(dir, 'cover.png') });
    const output = path.resolve(o.outputPath);
    await mkdir(path.dirname(output), { recursive: true });
    await run(o.ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-loop', '1', '-i', cover.path, '-t', '3', '-r', '25', '-vf', 'fade=t=in:st=0:d=0.5,fade=t=out:st=2.5:d=0.5,format=yuv420p', '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-threads', '2', '-movflags', '+faststart', '-f', 'mp4', output], dir);
    return { path: output, width: cover.width, height: cover.height, duration: 3 };
  } finally { await rm(dir, { recursive: true, force: true }); }
}

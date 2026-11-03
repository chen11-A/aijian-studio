import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 始终相对于模块文件定位仓库字体，不依赖当前工作目录或系统字体。 */
export const defaultFontsDirectory = fileURLToPath(new URL('../../../apps/studio-web/src/aivora/assets/v2/', import.meta.url));

export interface Dialogue { speaker: string; text: string; start: number; end: number }
export type SubtitlePreset = 'short-drama' | 'cinema' | 'comic';
export interface SubtitleOptions { portrait?: boolean; preset?: SubtitlePreset; fontName?: string }

function validate(lines: Dialogue[]): void {
  for (const line of lines) {
    if (!Number.isFinite(line.start) || !Number.isFinite(line.end) || line.start < 0 || line.end <= line.start)
      throw new Error('字幕时间无效：结束时间必须晚于开始时间');
    if (!line.text.trim()) throw new Error('字幕文字不能为空');
  }
}

/** 优先词边界和中文避头尾规则；无法同时满足时，以字符数上限和保留原文为先。 */
export function wrapText(text: string, portrait = false): string[] {
  const limit = portrait ? 12 : 16;
  const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
  const closing = new Set(Array.from('，。！？、；：）》】〕〉」』”’…,.!?;:%％)]}'));
  const opening = new Set(Array.from('（《【〔〈「『“‘([{'));
  const result: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    const clean = paragraph.trim();
    const characters = Array.from(clean);
    const boundaries = new Set<number>();
    let offset = 0;
    for (const { segment } of segmenter.segment(clean)) {
      const length = Array.from(segment).length;
      // 超长英文、数字等词可按字符断开，避免超过上限或让整段字幕失败。
      if (length > limit) for (let i = 1; i < length; i++) boundaries.add(offset + i);
      offset += length;
      boundaries.add(offset);
    }
    let start = 0;
    while (start < characters.length) {
      const maximum = Math.min(start + limit, characters.length);
      const legal = (end: number): boolean => {
        let last = end - 1;
        let next = end;
        while (last >= start && /\s/.test(characters[last])) last--;
        while (next < characters.length && /\s/.test(characters[next])) next++;
        return !opening.has(characters[last]) && !closing.has(characters[next]);
      };
      let cut = maximum;
      if (maximum < characters.length) {
        while (cut > start && (!boundaries.has(cut) || !legal(cut))) cut--;
        // 极端标点与完整词冲突时，优先找可避头尾的字符边界。
        if (cut === start) {
          cut = maximum;
          while (cut > start && !legal(cut)) cut--;
        }
        // 连续超过一行的闭标点无法避头，仍保留文字且不超长。
        if (cut === start) cut = maximum;
      }
      const line = characters.slice(start, cut).join('').trim();
      if (line) result.push(line);
      start = cut;
      while (start < characters.length && /\s/.test(characters[start])) start++;
    }
  }
  return result;
}

function timestamp(seconds: number, ass: boolean): string {
  const units = ass ? 100 : 1000;
  const ticks = Math.round(seconds * units);
  const hours = Math.floor(ticks / (3600 * units));
  const minutes = Math.floor(ticks / (60 * units)) % 60;
  const secs = Math.floor(ticks / units) % 60;
  const tail = String(ticks % units).padStart(ass ? 2 : 3, '0');
  return `${ass ? hours : String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}${ass ? '.' : ','}${tail}`;
}

export function generateSrt(lines: Dialogue[], options: SubtitleOptions = {}): string {
  validate(lines);
  return [...lines].sort((a, b) => a.start - b.start).map((line, i) =>
    `${i + 1}\n${timestamp(line.start, false)} --> ${timestamp(line.end, false)}\n${wrapText(line.text, options.portrait).join('\n')}\n`
  ).join('\n');
}

function assText(text: string): string {
  // 全角替换阻止输入文字注入 ASS 覆盖指令。
  return text.replace(/\\/g, '＼').replace(/\{/g, '｛').replace(/\}/g, '｝');
}

export function generateAss(lines: Dialogue[], options: SubtitleOptions = {}): string {
  validate(lines);
  const preset = options.preset ?? 'short-drama';
  const styles: Record<SubtitlePreset, { size: number; outline: number; color: string; bold: number }> = {
    'short-drama': { size: 64, outline: 4, color: '&H00181818', bold: -1 },
    cinema: { size: 44, outline: 1, color: '&H00181818', bold: 0 },
    comic: { size: 60, outline: 4, color: '&H00CC3388', bold: -1 },
  };
  const style = styles[preset];
  if (!style) throw new Error('字幕样式不存在');
  const font = options.fontName ?? 'Noto Sans CJK SC';
  if (/[\r\n,]/.test(font)) throw new Error('字体名称不能包含逗号或换行');
  const width = options.portrait ? 1080 : 1920;
  const height = options.portrait ? 1920 : 1080;
  const margin = options.portrait ? 240 : 80;
  const events = [...lines].sort((a, b) => a.start - b.start).map(line =>
    `Dialogue: 0,${timestamp(line.start, true)},${timestamp(line.end, true)},Default,${assText(line.speaker).replace(/[,\r\n]/g, ' ')},0,0,0,,${wrapText(line.text, options.portrait).map(assText).join('\\N')}`
  );
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,${font},${style.size},&H00FFFFFF,&H000000FF,${style.color},&H80000000,${style.bold},0,0,0,100,100,0,0,1,${style.outline},0,2,60,60,${margin},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${events.join('\n')}\n`;
}

function filterValue(value: string): string {
  // 第一层为过滤器选项，第二层为过滤器图；参数直接传给 spawn，不经过 shell。
  return value.replace(/[\\':]/g, '\\$&').replace(/[\\'\[\],;]/g, '\\$&');
}

export function burnSubtitleArgs(input: { ffmpegPath: string; videoPath: string; subtitlePath: string; outputPath: string; fontsDirectory?: string }): { executable: string; args: string[] } {
  if (!path.isAbsolute(input.ffmpegPath) && !path.win32.isAbsolute(input.ffmpegPath)) throw new Error('请传入 ffmpeg 的完整路径');
  if (!input.videoPath || !input.subtitlePath || !input.outputPath) throw new Error('视频、字幕和输出路径不能为空');
  const fontsDirectory = input.fontsDirectory ?? defaultFontsDirectory;
  if (!fontsDirectory.trim()) throw new Error('字体目录不能为空');
  const filter = `subtitles=filename=${filterValue(input.subtitlePath)}:fontsdir=${filterValue(fontsDirectory)}`;
  return { executable: input.ffmpegPath, args: ['-nostdin', '-y', '-i', input.videoPath, '-vf', filter, '-c:v', 'libx264', '-c:a', 'copy', input.outputPath] };
}

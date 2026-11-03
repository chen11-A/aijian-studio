import { describe, expect, it } from 'vitest';
import { burnSubtitleArgs, generateAss, generateSrt, wrapText } from './index.js';
const line = { speaker: '小明', text: '今天的天空很蓝，我们一起去散步吧。', start: 1.234, end: 3.5 };
describe('字幕', () => {
  it('按时间生成 SRT 并处理小时进位', () => {
    const text = generateSrt([{ ...line, start: 3599.9996, end: 3602 }, line]);
    expect(text).toContain('1\n00:00:01,234 --> 00:00:03,500');
    expect(text).toContain('01:00:00,000 --> 01:00:02,000');
  });
  it.each([false, true])('中文按完整词断行，竖屏=%s', portrait => {
    const text = '今天我们来到美丽的森林，一起欣赏温暖阳光下的风景。';
    const lines = wrapText(text, portrait);
    expect(lines.join('')).toBe(text);
    expect(lines.every(l => Array.from(l).length <= (portrait ? 12 : 16))).toBe(true);
    for (const { segment } of new Intl.Segmenter('zh-CN', { granularity: 'word' }).segment(text))
      expect(lines.some(l => l.includes(segment))).toBe(true);
  });
  it('处理手动换行、空白、英文单词和空输入', () => {
    expect(wrapText(' hello world\r\n\r你好 ')).toEqual(['hello world', '你好']);
    expect(wrapText('')).toEqual([]);
    expect(wrapText('abcdefghijklmnop abc')).toEqual(['abcdefghijklmnop', 'abc']);
    expect(() => wrapText('abcdefghijklmnopq')).toThrow('单个词');
    expect(() => wrapText('abcdefghijklm', true)).toThrow('12');
  });
  it.each(['short-drama', 'cinema', 'comic'] as const)('生成 %s 样式', preset => {
    const result = generateAss([line], { preset });
    expect(result).toContain('PlayResX: 1920');
    expect(result).toContain('PlayResY: 1080');
    expect(result).toContain('Dialogue: 0,0:00:01.23,0:00:03.50');
    expect(result).toContain('\\N');
    expect(result).toContain(preset === 'comic' ? '&H00CC3388' : '&H00181818');
  });
  it('竖屏底部居中与安全留白，隔离 ASS 指令注入', () => {
    const result = generateAss([{ ...line, text: '{\\b1}你好', speaker: '甲,乙\n丙' }], { portrait: true, fontName: '中文字体' });
    expect(result).toContain('PlayResX: 1080');
    expect(result).toContain('PlayResY: 1920');
    expect(result).toContain(',2,60,60,240,1');
    expect(result).toContain('｛＼b1｝你好');
    expect(result).toContain('甲 乙 丙');
    expect(generateAss([])).toContain('[Events]');
    expect(generateSrt([], { portrait: true })).toBe('');
  });
  it('ASS 同样排序和进位', () => {
    expect(generateAss([{ ...line, start: 3599.999, end: 3601 }, line])).toContain('1:00:00.00');
  });
  it.each([-1, NaN, Infinity])('拒绝无效开始时间 %s', start => {
    expect(() => generateSrt([{ ...line, start }])).toThrow('字幕时间');
  });
  it('拒绝倒置、空文字和字体/样式注入', () => {
    expect(() => generateAss([{ ...line, end: 0 }])).toThrow('字幕时间');
    expect(() => generateSrt([{ ...line, end: Infinity }])).toThrow('字幕时间');
    expect(() => generateAss([{ ...line, text: ' ' }])).toThrow('字幕文字');
    expect(() => generateAss([], { fontName: '字体,坏' })).toThrow('字体名称');
    expect(() => generateAss([], { preset: '坏' as never })).toThrow('字幕样式');
  });
  it('烧录参数保留中文、空格与 Windows 完整路径', () => {
    const result = burnSubtitleArgs({ ffmpegPath: 'C:\\中文 工具\\ffmpeg.exe', videoPath: '片 段.mp4', subtitlePath: 'C:\\字幕 文件\\片名.ass', outputPath: '结 果.mp4', fontsDirectory: 'C:\\字体 目录' });
    expect(result.executable).toBe('C:\\中文 工具\\ffmpeg.exe');
    expect(result.args).toContain('片 段.mp4');
    expect(result.args.at(-1)).toBe('结 果.mp4');
    expect(result.args[5]).toContain(':fontsdir=');
    expect(burnSubtitleArgs({ ffmpegPath: '/工具/ffmpeg', videoPath: 'in', subtitlePath: "/tmp/a'b,[x];.ass", outputPath: 'out' }).args[5]).toContain('subtitles=filename=');
  });
  it('拒绝 PATH 查找与空路径', () => {
    expect(() => burnSubtitleArgs({ ffmpegPath: 'ffmpeg', videoPath: 'a', subtitlePath: 'b', outputPath: 'c' })).toThrow('完整路径');
    for (const key of ['videoPath', 'subtitlePath', 'outputPath'])
      expect(() => burnSubtitleArgs({ ffmpegPath: '/bin/ffmpeg', videoPath: 'a', subtitlePath: 'b', outputPath: 'c', [key]: '' })).toThrow('路径不能为空');
  });
});

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
it('真实烧录包含中文、空格、引号和过滤器特殊字符的路径', () => {
  const ffmpeg = process.env.FFMPEG_PATH ?? '/usr/bin/ffmpeg';
  const dir = mkdtempSync(path.join(tmpdir(), '字幕 测试 '));
  try {
    const subtitle = path.join(dir, "台词 '逗号,方括号[甲];.ass");
    writeFileSync(subtitle, generateAss([{ speaker: '甲', text: '你好', start: 0, end: 1 }]));
    const command = burnSubtitleArgs({ ffmpegPath: ffmpeg, videoPath: 'unused', subtitlePath: subtitle, outputPath: 'unused', fontsDirectory: path.resolve('../../apps/studio-web/src/aivora/assets/v2') });
    const result = spawnSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:d=0.1', '-vf', command.args[5], '-f', 'null', '-'], { encoding: 'utf8', env: { ...process.env, XDG_CACHE_HOME: dir } });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCover, createTitleVideo, sizes, type CoverOptions, type CoverFormat, type CoverTemplate } from './index.js';
const ffmpeg = process.env.FFMPEG_PATH || '/usr/bin/ffmpeg';
const ffprobe = process.env.FFPROBE_PATH || '/usr/bin/ffprobe';
let dir: string, options: CoverOptions;
function probe(file: string) { return JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8' })); }
beforeAll(async () => {
 dir = await mkdtemp(path.join(tmpdir(), '封面 中文 空格 '));
 const font = path.join(dir, '中文 字体.otf');
 await copyFile(fileURLToPath(new URL('../../../apps/studio-web/src/aivora/assets/v2/NotoSansCJKsc-Regular.otf', import.meta.url)), font);
 const image = path.join(dir, '原始 图片.ppm');
 await writeFile(image, Buffer.concat([Buffer.from('P6\n64 64\n255\n'), Buffer.alloc(64 * 64 * 3, 190)]));
 options = { ffmpegPath: ffmpeg, fontPath: font, imagePath: image, outputPath: path.join(dir, '测试 封面.png'), title: '我们的故事', subtitle: '重逢的那一天', episode: 2, format: 'landscape', template: 'cinema' };
});
afterAll(async () => { await rm(dir, { recursive: true, force: true }); });
describe('封面与片头', () => {
 it.each<[CoverFormat, CoverTemplate]>([['landscape', 'cinema'], ['portrait', 'drama'], ['square', 'comic']])('实际生成 %s 封面（%s）', async (format, template) => {
 const result = await createCover({ ...options, format, template, aiLabel: template === 'comic' });
 const stream = probe(result.path).streams[0];
 expect([stream.width, stream.height]).toEqual(sizes[format]);
 expect((await readFile(result.path)).subarray(1, 4).toString()).toBe('PNG');
 }, 30_000);
 it('实际生成三秒片头并检测淡入淡出', async () => {
 const result = await createTitleVideo({ ...options, title: '百分之百 100%：你好', subtitle: '', format: 'square', outputPath: path.join(dir, '片头 视频.mp4') });
 expect(result.duration).toBe(3);
 const meta = probe(result.path); expect(Number(meta.format.duration)).toBeCloseTo(3, 1); expect(meta.streams[0].codec_name).toBe('h264');
 const frame = (time: string) => execFileSync(ffmpeg, ['-v', 'error', '-ss', time, '-i', result.path, '-frames:v', '1', '-vf', 'scale=1:1,format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 1024 });
 expect(frame('0')[0]).toBeLessThan(frame('1')[0]); expect(frame('2.96')[0]).toBeLessThan(frame('1')[0]);
 }, 30_000);
 it.each([
 [{ ffmpegPath: 'ffmpeg' }, '绝对路径'], [{ format: 'other' }, '尺寸'], [{ template: 'other' }, '模板'],
 [{ title: ' ' }, '片名'], [{ episode: 0 }, '集数'], [{ episode: 1.2 }, '集数'],
 [{ title: '换\n行' }, '一行'], [{ subtitle: '长'.repeat(41) }, '四十'], [{ outputPath: '' }, '覆盖'],
 ])('输入错误返回中文提示 %j', async (patch, message) => { await expect(createCover({ ...options, ...patch } as CoverOptions)).rejects.toThrow(message as string); });
 it('拒绝覆盖原图、字体或视频工具', async () => {
 await expect(createCover({ ...options, outputPath: options.imagePath })).rejects.toThrow('覆盖');
 await expect(createTitleVideo({ ...options, outputPath: options.fontPath })).rejects.toThrow('覆盖');
 await expect(createCover({ ...options, outputPath: options.ffmpegPath })).rejects.toThrow('覆盖');
 });
 it('缺少图片时有中文提示', async () => { await expect(createCover({ ...options, imagePath: path.join(dir, '没有.png') })).rejects.toThrow('找不到'); });
 it('损坏图片时有中文提示', async () => {
 const bad = path.join(dir, '坏 图片.png'); await writeFile(bad, '无法解码');
 await expect(createTitleVideo({ ...options, imagePath: bad, outputPath: path.join(dir, '失败.mp4') })).rejects.toThrow('生成失败');
 });
});

import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { AudioAsset } from '../audio-picker/index.js';
export type { AudioAsset } from '../audio-picker/index.js';

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** 读取本地素材清单；不联网、不启动外部程序。返回路径仍相对于素材库根目录。 */
export async function loadAudioLibrary(root: string): Promise<AudioAsset[]> {
  let directory: string;
  let raw: unknown;
  try {
    directory = await realpath(root);
    const manifest = await realpath(path.join(directory, 'manifest.json'));
    if (!inside(directory, manifest)) throw new Error('清单越界');
    raw = JSON.parse(await readFile(manifest, 'utf8'));
  } catch {
    throw new Error('无法读取素材清单：请检查目录、清单位置和 JSON 格式');
  }
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('素材清单必须是非空数组');
  const ids = new Set<string>();
  const paths = new Set<string>();
  const assets: AudioAsset[] = [];
  for (const [index, item] of raw.entries()) {
    const fail = (detail: string): never => { throw new Error(`第 ${index + 1} 条素材${detail}`); };
    if (item === null || typeof item !== 'object' || Array.isArray(item)) fail('必须是对象');
    for (const [key, label] of Object.entries({ id: '编号', path: '路径', category: '分类', name: '中文名', scene: '适合场景', source: '来源', license: '许可证' })) {
      if (typeof item[key] !== 'string' || !item[key].trim()) fail(`的${label}字段不能为空`);
    }
    if (item.type !== 'sfx' && item.type !== 'music') fail('类型只能是音效或配乐');
    if (!Array.isArray(item.tags) || item.tags.some((tag: unknown) => typeof tag !== 'string' || !tag.trim())) fail('情绪标签必须是文字数组');
    if (typeof item.loop !== 'boolean') fail('循环标记必须是布尔值');
    if (typeof item.duration !== 'number' || !Number.isFinite(item.duration) || item.duration <= 0) fail('时长必须为正数');
    if (typeof item.loudness !== 'number' || !Number.isFinite(item.loudness)) fail('响度必须为有限数值');
    if (!['CC0', 'CC0-1.0', 'Public Domain', '公有领域'].includes(item.license)) fail('许可证必须是 CC0 或公有领域');
    try {
      const source = new URL(item.source);
      if (!['http:', 'https:'].includes(source.protocol)) fail('来源必须是网页链接');
    } catch { fail('来源必须是网页链接'); }
    if (ids.has(item.id)) fail('编号重复');
    ids.add(item.id);
    const relative: string = item.path;
    if (path.posix.isAbsolute(relative) || path.win32.isAbsolute(relative) || /[\\:\0]/.test(relative) || relative.split('/').some(part => part === '..' || part === '.' || !part)) fail('路径必须是库内相对路径，不能越界');
    if (path.extname(relative).toLowerCase() !== '.ogg') fail('文件必须是 .ogg 格式');
    const key = relative.toLowerCase();
    if (paths.has(key)) fail('文件路径重复');
    paths.add(key);
    try {
      const file = await realpath(path.resolve(directory, relative));
      if (!inside(directory, file) || !(await stat(file)).isFile()) fail('文件不存在或路径越界');
    } catch { fail('文件不存在或路径越界'); }
    assets.push(item as AudioAsset);
  }
  return assets;
}

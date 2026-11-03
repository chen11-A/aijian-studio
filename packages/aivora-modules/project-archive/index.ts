import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { zipSync, unzipSync } from 'fflate';
const MANIFEST = '__aivora_manifest.json';
export interface ArchiveOptions { maxBytes?: number; maxFiles?: number }
interface Manifest { version: 1; name: string; directories: string[]; files: { path: string; size: number; sha256: string }[] }
function chineseError(error: unknown): string {
  const e = error as NodeJS.ErrnoException;
  if (e.code) return ({ ENOENT: '文件或文件夹不存在', EEXIST: '目标文件已存在', EACCES: '没有文件访问权限', ENOTDIR: '文件路径与文件夹冲突' } as Record<string,string>)[e.code] ?? '无法读取或写入文件';
  return /[\u4e00-\u9fff]/.test(e.message) ? e.message : '备份数据损坏或格式不支持';
}
const digest = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
function safeName(name: string): boolean {
  return typeof name === 'string' && name.length > 0 && !name.includes('\\') && !name.includes(':') && !/[<>"|?*\x00-\x1f]/.test(name) && !name.startsWith('/') && name.split('/').every(p => p !== '' && p !== '.' && p !== '..' && !/[. ]$/.test(p) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p));
}
function limits(options: ArchiveOptions) {
  const maxBytes = options.maxBytes ?? 512 * 1024 * 1024, maxFiles = options.maxFiles ?? 10000;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isSafeInteger(maxFiles) || maxFiles < 1) throw new Error('备份大小和文件数量限制不正确');
  return { maxBytes, maxFiles };
}
export async function packProject(folder: string, output: string, options: ArchiveOptions = {}): Promise<Manifest> {
  const { maxBytes, maxFiles } = limits(options);
  const root = path.resolve(folder), dest = path.resolve(output);
  if (dest === root || dest.startsWith(root + path.sep)) throw new Error('备份文件不能放在作品文件夹内');
  if (!output.endsWith('.aivora')) throw new Error('备份文件必须使用 .aivora 后缀');
  const entries: Record<string, Uint8Array> = Object.create(null);
  const manifest: Manifest = { version: 1, name: path.basename(root), directories: [], files: [] };
  let total = 0; const names = new Set<string>();
  async function walk(dir: string, prefix = ''): Promise<void> {
    const info = await fs.lstat(dir);
    if (info.isSymbolicLink()) throw new Error('作品中不能包含符号链接');
    if (!info.isDirectory()) throw new Error('作品路径必须是文件夹');
    for (const entry of (await fs.readdir(dir, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
      const name = prefix + entry.name, full = path.join(dir, entry.name);
      if (!safeName(name) || name.toLowerCase() === MANIFEST || names.has(name.toLowerCase())) throw new Error('作品文件名不安全或与清单重名');
      names.add(name.toLowerCase());
      if (names.size > maxFiles) throw new Error('作品超过文件数量限制');
      if (entry.isSymbolicLink()) throw new Error('作品中不能包含符号链接');
      if (entry.isDirectory()) { manifest.directories.push(name); await walk(full, name + '/'); continue; }
      if (!entry.isFile()) throw new Error('作品中只能包含普通文件');
      const stat = await fs.lstat(full);
      total += stat.size;
      if (total > maxBytes || manifest.files.length >= maxFiles) throw new Error('作品超过备份大小或文件数量限制');
      const bytes = await fs.readFile(full);
      entries[name] = bytes;
      manifest.files.push({ path: name, size: bytes.length, sha256: digest(bytes) });
    }
  }
  try {
    await walk(root);
    entries[MANIFEST] = new TextEncoder().encode(JSON.stringify(manifest));
    if (entries[MANIFEST].length > 4 * 1024 * 1024) throw new Error('清单超过大小限制');
    await fs.writeFile(dest, zipSync(entries), { flag: 'wx' });
    return manifest;
  } catch (error) { throw new Error('打包失败：' + chineseError(error)); }
}
// 解压前读取中央目录，限制展开大小，拒绝重复路径、符号链接和 ZIP64。
function inspectZip(bytes: Uint8Array, maxBytes: number, maxFiles: number): void {
  const b = Buffer.from(bytes);
  let end = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (b.readUInt32LE(i) === 0x06054b50 && i + 22 + b.readUInt16LE(i + 20) === b.length) { end = i; break; }
  if (end < 0) throw new Error('备份格式损坏');
  const count = b.readUInt16LE(end + 10), start = b.readUInt32LE(end + 16);
  if (b.readUInt16LE(end + 4) || b.readUInt16LE(end + 6) || count === 65535 || count > maxFiles + 1 || start >= end) throw new Error('备份目录不支持或文件过多');
  let pos = start, total = 0;
  const names = new Set<string>();
  for (let i = 0; i < count; i++) {
    if (pos + 46 > end || b.readUInt32LE(pos) !== 0x02014b50) throw new Error('备份目录损坏');
    const size = b.readUInt32LE(pos + 24), n = b.readUInt16LE(pos + 28), extra = b.readUInt16LE(pos + 30), comment = b.readUInt16LE(pos + 32);
    const name = b.subarray(pos + 46, pos + 46 + n).toString('utf8');
    if (!safeName(name) || names.has(name.toLowerCase()) || ((b.readUInt32LE(pos + 38) >>> 16) & 0xf000) === 0xa000 || b.readUInt16LE(pos + 8) & 1) throw new Error('备份含不安全路径、重名文件或符号链接');
    const local = b.readUInt32LE(pos + 42), compressed = b.readUInt32LE(pos + 20);
    if (local + 30 > start || b.readUInt32LE(local) !== 0x04034b50 || b.readUInt16LE(pos + 8) & 8) throw new Error('备份本地目录不正确');
    const ln = b.readUInt16LE(local + 26), le = b.readUInt16LE(local + 28);
    if (b.readUInt32LE(local + 22) !== size || b.readUInt32LE(local + 18) !== compressed || b.readUInt16LE(local + 8) !== b.readUInt16LE(pos + 10) || b.subarray(local + 30, local + 30 + ln).toString('utf8') !== name || local + 30 + ln + le + compressed > start) throw new Error('备份目录与文件大小不一致');
    if (name === MANIFEST && size > 4 * 1024 * 1024) throw new Error('清单超过大小限制');
    names.add(name.toLowerCase()); total += size;
    if (total > maxBytes + 4 * 1024 * 1024) throw new Error('备份展开后超过大小限制');
    pos += 46 + n + extra + comment;
  }
  if (pos !== end) throw new Error('备份目录长度不正确');
}
export async function importProject(archive: string, destination: string, options: ArchiveOptions = {}): Promise<string> {
  const { maxBytes, maxFiles } = limits(options);
  let target: string | undefined;
  try {
    if ((await fs.stat(archive)).size > maxBytes + 8 * 1024 * 1024) throw new Error('备份文件超过大小限制');
    const bytes = await fs.readFile(archive);
    inspectZip(bytes, maxBytes, maxFiles);
    const entries = unzipSync(bytes);
    if (!entries[MANIFEST]) throw new Error('备份缺少清单');
    const manifest = JSON.parse(new TextDecoder().decode(entries[MANIFEST])) as Manifest;
    if (manifest.version !== 1 || !Array.isArray(manifest.directories) || !Array.isArray(manifest.files) || !safeName(manifest.name) || manifest.name.includes('/') || manifest.files.length + manifest.directories.length > maxFiles) throw new Error('备份清单不正确');
    const seen = new Set<string>(); let total = 0;
    for (const dir of manifest.directories) {
      if (typeof dir !== 'string' || !safeName(dir) || seen.has(dir.toLowerCase())) throw new Error('清单文件夹路径不安全或重复');
      seen.add(dir.toLowerCase());
    }
    for (const file of manifest.files) {
      if (!file || !safeName(file.path) || file.path === MANIFEST || seen.has(file.path.toLowerCase())) throw new Error('清单含不安全路径或重复文件');
      seen.add(file.path.toLowerCase());
      const content = entries[file.path];
      if (!content || content.length !== file.size || digest(content) !== file.sha256) throw new Error('文件损坏或校验失败：' + file.path);
      total += content.length;
      if (total > maxBytes) throw new Error('作品超过大小限制');
    }
    if (Object.keys(entries).length !== manifest.files.length + 1) throw new Error('备份含清单外文件');
    await fs.mkdir(destination, { recursive: true });
    for (let i = 0; ; i++) {
      const candidate = path.join(destination, manifest.name + (i ? ` (${i})` : ''));
      try { await fs.mkdir(candidate); target = candidate; break; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    }
    for (const dir of manifest.directories) await fs.mkdir(path.join(target!, dir), { recursive: true });
    for (const file of manifest.files) {
      const out = path.join(target!, file.path);
      await fs.mkdir(path.dirname(out), { recursive: true });
      await fs.writeFile(out, entries[file.path], { flag: 'wx' });
    }
    return target!;
  } catch (error) {
    if (target) await fs.rm(target, { recursive: true, force: true });
    throw new Error('导入失败：' + chineseError(error));
  }
}

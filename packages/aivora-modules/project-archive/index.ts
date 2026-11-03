import { promises as fs, createWriteStream, constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as yazl from 'yazl';
import * as yauzl from 'yauzl';
const MANIFEST = '__aivora_manifest.json';
const MANIFEST_LIMIT = 4 * 1024 * 1024;
export interface ArchiveOptions { maxBytes?: number; maxFiles?: number }
export interface Manifest { version: 1; name: string; directories: string[]; files: { path: string; size: number; sha256: string }[] }
function chineseError(error: unknown): string {
  const e = error as NodeJS.ErrnoException;
  if (e.code) return ({ ENOENT: '文件或文件夹不存在', EEXIST: '目标文件已存在', EACCES: '没有文件访问权限', ENOTDIR: '文件路径与文件夹冲突', ELOOP: '作品中不能包含符号链接' } as Record<string,string>)[e.code] ?? '无法读取或写入文件';
  return /^[\u4e00-\u9fff]/.test(e.message) ? e.message : '备份格式损坏或含不安全路径';
}
function safeName(name: string): boolean {
  return typeof name === 'string' && name.length > 0 && !name.includes('\\') && !name.includes(':') && !/[<>"|?*\x00-\x1f]/.test(name) && !name.startsWith('/') && name.split('/').every(p => p !== '' && p !== '.' && p !== '..' && !/[. ]$/.test(p) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p));
}
function limits(options: ArchiveOptions) {
  const maxBytes = options.maxBytes ?? 20 * 1024 ** 3, maxFiles = options.maxFiles ?? 10000;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isSafeInteger(maxFiles) || maxFiles < 1) throw new Error('备份大小和文件数量限制不正确');
  return { maxBytes, maxFiles };
}
/** 每次只读取一个文件。内容经过哈希转换流后写进 ZIP，清单最后写入。 */
export async function packProject(folder: string, output: string, options: ArchiveOptions = {}): Promise<Manifest> {
  const { maxBytes, maxFiles } = limits(options);
  const root = path.resolve(folder), dest = path.resolve(output);
  if (dest === root || dest.startsWith(root + path.sep)) throw new Error('备份文件不能放在作品文件夹内');
  if (!output.endsWith('.aivora')) throw new Error('备份文件必须使用 .aivora 后缀');
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
      if (total > maxBytes) throw new Error('作品超过备份大小限制');
      manifest.files.push({ path: name, size: stat.size, sha256: '' });
    }
  }
  let owned = false;
  const zip = new yazl.ZipFile();
  const live = new Set<Readable>();
  // 库的事件错误送入管道，让调用方得到中文错误并清理不完整备份。
  zip.on('error', error => (zip.outputStream as Readable).destroy(error));
  try {
    await walk(root);
    // 哈希固定为64字符，提前限制清单大小，防止许多长路径撑大元数据。
    if (Buffer.byteLength(JSON.stringify(manifest)) + manifest.files.length * 64 > MANIFEST_LIMIT) throw new Error('清单超过大小限制');
    const handle = await fs.open(dest, 'wx'); owned = true;
    const writing = pipeline(zip.outputStream, handle.createWriteStream());
    for (const file of manifest.files) {
      zip.addReadStreamLazy(file.path, { size: file.size, compress: !/\.(mp4|png|ogg)$/i.test(file.path) }, async callback => {
        try {
        const source = await fs.open(path.join(root, file.path), constants.O_RDONLY | constants.O_NOFOLLOW);
        const input = source.createReadStream({ highWaterMark: 64 * 1024 });
        live.add(input);
        const hash = createHash('sha256'); let count = 0;
        const hashing = new Transform({
          transform(chunk: Buffer, _encoding, next) {
            count += chunk.length;
            if (count > file.size) { next(new Error('打包时文件大小发生变化')); return; }
            hash.update(chunk); next(null, chunk);
          },
          flush(next) {
            if (count !== file.size) { next(new Error('打包时文件大小发生变化')); return; }
            file.sha256 = hash.digest('hex'); next();
          },
        });
        input.on('error', error => hashing.destroy(error));
        hashing.on('error', error => zip.emit('error', error));
        hashing.on('close', () => { input.destroy(); live.delete(input); });
        input.pipe(hashing); callback(null, hashing);
        } catch (error) { callback(error as Error, undefined!); }
      });
    }
    zip.addReadStreamLazy(MANIFEST, { compress: true }, callback => callback(null, Readable.from([Buffer.from(JSON.stringify(manifest))])));
    zip.end({ forceZip64Format: true, comment: '' });
    await writing;
    return manifest;
  } catch (error) {
    (zip.outputStream as Readable).destroy();
    for (const input of live) input.destroy();
    if (owned) await fs.rm(dest, { force: true });
    throw new Error('打包失败：' + chineseError(error));
  }
}
function openZip(file: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true, autoClose: false, strictFileNames: true, validateEntrySizes: true }, (error, zip) => error ? reject(error) : resolve(zip!)));
}
function nextEntry(zip: yauzl.ZipFile): Promise<yauzl.Entry | null> {
  return new Promise((resolve, reject) => {
    const cleanup = () => { zip.off('entry', entry); zip.off('end', end); zip.off('error', fail); };
    const entry = (value: yauzl.Entry) => { cleanup(); resolve(value); };
    const end = () => { cleanup(); resolve(null); };
    const fail = (error: Error) => { cleanup(); reject(error); };
    zip.once('entry', entry); zip.once('end', end); zip.once('error', fail); zip.readEntry();
  });
}
function openEntry(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<Readable> {
  return new Promise((resolve,reject) => zip.openReadStream(entry, (error, stream) => error ? reject(error) : resolve(stream!)));
}
async function inspectZip(zip: yauzl.ZipFile, archive: string, maxBytes: number, maxFiles: number): Promise<Map<string,yauzl.Entry>> {
  if (zip.entryCount > maxFiles + 1) throw new Error('备份目录文件过多');
  const entries = new Map<string,yauzl.Entry>(), names = new Set<string>(); let total = 0;
  const handle = await fs.open(archive, 'r');
  try {
    for (let entry = await nextEntry(zip); entry; entry = await nextEntry(zip)) {
      const name = entry.fileName;
      if (!safeName(name) || names.has(name.toLowerCase()) || ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000 || entry.generalPurposeBitFlag & 1) throw new Error('备份含不安全路径、重名文件或符号链接');
      if (![0,8].includes(entry.compressionMethod)) throw new Error('备份压缩格式不支持');
      total += entry.uncompressedSize;
      if (!Number.isSafeInteger(total) || total > maxBytes + MANIFEST_LIMIT) throw new Error('备份展开后超过大小限制');
      if (name === MANIFEST && entry.uncompressedSize > MANIFEST_LIMIT) throw new Error('清单超过大小限制');
      const header = Buffer.alloc(30);
      await handle.read(header, 0, 30, entry.relativeOffsetOfLocalHeader);
      if (header.readUInt32LE(0) !== 0x04034b50 || header.readUInt16LE(8) !== entry.compressionMethod || header.readUInt16LE(6) !== entry.generalPurposeBitFlag) throw new Error('备份本地目录不正确');
      // 数据描述符及 ZIP64 使用中央目录大小；普通文件必须与本地头一致。
      if (!(entry.generalPurposeBitFlag & 8) && ((header.readUInt32LE(22) !== 0xffffffff && header.readUInt32LE(22) !== entry.uncompressedSize) || (header.readUInt32LE(18) !== 0xffffffff && header.readUInt32LE(18) !== entry.compressedSize))) throw new Error('备份目录与文件大小不一致');
      const nameBuffer = Buffer.alloc(header.readUInt16LE(26));
      await handle.read(nameBuffer,0,nameBuffer.length,entry.relativeOffsetOfLocalHeader+30);
      if (nameBuffer.toString('utf8') !== name) throw new Error('备份本地路径与目录不一致');
      names.add(name.toLowerCase()); entries.set(name,entry);
    }
    return entries;
  } finally { await handle.close(); }
}
async function readManifest(zip: yauzl.ZipFile, entry: yauzl.Entry | undefined): Promise<Manifest> {
  if (!entry) throw new Error('备份缺少清单');
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of await openEntry(zip, entry)) {
    size += chunk.length;
    if (size > MANIFEST_LIMIT) throw new Error('清单超过大小限制');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Manifest; }
  catch { throw new Error('备份数据损坏：清单不是有效格式'); }
}
export async function importProject(archive: string, destination: string, options: ArchiveOptions = {}): Promise<string> {
  const { maxBytes, maxFiles } = limits(options);
  let target: string | undefined, zip: yauzl.ZipFile | undefined;
  try {
    if ((await fs.stat(archive)).size > maxBytes + 16 * 1024 * 1024) throw new Error('备份文件超过大小限制');
    zip = await openZip(archive);
    const entries = await inspectZip(zip, archive, maxBytes, maxFiles);
    const manifest = await readManifest(zip, entries.get(MANIFEST));
    if (manifest.version !== 1 || !Array.isArray(manifest.directories) || !Array.isArray(manifest.files) || !safeName(manifest.name) || manifest.name.includes('/') || manifest.files.length + manifest.directories.length > maxFiles) throw new Error('备份清单不正确');
    const seen = new Set<string>(); let total = 0;
    for (const dir of manifest.directories) {
      if (!safeName(dir) || seen.has(dir.toLowerCase())) throw new Error('清单文件夹路径不安全或重复');
      seen.add(dir.toLowerCase());
    }
    for (const file of manifest.files) {
      if (!file || !safeName(file.path) || file.path === MANIFEST || seen.has(file.path.toLowerCase())) throw new Error('清单含不安全路径或重复文件');
      seen.add(file.path.toLowerCase());
      if (!Number.isSafeInteger(file.size) || file.size < 0 || !/^[a-f0-9]{64}$/.test(file.sha256) || entries.get(file.path)?.uncompressedSize !== file.size) throw new Error('文件损坏或校验失败：' + file.path);
      total += file.size;
      if (total > maxBytes) throw new Error('作品超过大小限制');
    }
    if (entries.size !== manifest.files.length + 1) throw new Error('备份含清单外文件');
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
      const hash = createHash('sha256'); let size = 0;
      const verify = new Transform({ transform(chunk: Buffer,_encoding,next) {
        size += chunk.length;
        if (size > file.size) { next(new Error('文件展开大小超过清单')); return; }
        hash.update(chunk); next(null,chunk);
      } });
      await pipeline(await openEntry(zip, entries.get(file.path)!), verify, createWriteStream(out, { flags: 'wx', highWaterMark: 64 * 1024 }));
      if (size !== file.size || hash.digest('hex') !== file.sha256) throw new Error('文件损坏或校验失败：' + file.path);
    }
    return target!;
  } catch (error) {
    if (target) await fs.rm(target, { recursive: true, force: true });
    throw new Error('导入失败：' + chineseError(error));
  } finally { zip?.close(); }
}

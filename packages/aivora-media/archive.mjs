import path from "node:path";
import { Buffer } from "node:buffer";
import {
  open,
  lstat,
  realpath,
  readdir,
  mkdir,
  mkdtemp,
  rm,
  copyFile,
  rename,
  readFile,
} from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Transform, Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { crc32, createInflateRaw } from "node:zlib";
import { TextDecoder } from "node:util";

const MAX = 8 * 1024 ** 3;
const U32 = 0xffffffff;
const ARCHIVE_MAX = MAX + 64 * 1024 * 1024;
const MAX_FILES = 10000;
const MAX_DIRECTORY = 16 * 1024 * 1024;
const MAX_JSON = 16 * 1024 * 1024;
const utf8 = new TextDecoder("utf-8", { fatal: true });
const fail = () => {
  throw new Error("无效或不安全的 ZIP / 项目路径");
};

function safeName(name) {
  if (
    !name ||
    /[\\:]/u.test(name) ||
    [...name].some((c) => c.codePointAt(0) < 32) ||
    name.startsWith("/")
  )
    fail();
  const parts = name.replace(/\/$/, "").split("/");
  if (
    parts.some(
      (p) =>
        !p ||
        p === "." ||
        p === ".." ||
        /[. ]$/.test(p) ||
        /[<>"|?*]/.test(p) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p),
    )
  )
    fail();
  return parts;
}
const keyOf = (name) => name.replace(/\/$/, "").normalize("NFC").toLowerCase();

async function project(root) {
  const file = path.join(root, "project.json");
  const meta = await lstat(file);
  if (!meta.isFile() || meta.size > MAX_JSON) fail();
  const value = JSON.parse(await readFile(file, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
}

async function exact(file, size, position) {
  const result = Buffer.alloc(size);
  let read = 0;
  while (read < size) {
    const { bytesRead } = await file.read(result, read, size - read, position + read);
    if (!bytesRead) fail();
    read += bytesRead;
  }
  return result;
}

async function stageFor(target, work) {
  await mkdir(path.dirname(target), { recursive: true });
  const stage = await mkdtemp(path.join(path.dirname(target), ".aivora-zip-"));
  try {
    return await work(stage);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

/** Write UTF-8 STORE ZIP using bounded file streams, without third-party tools. */
export async function archiveProject({ projectDir, output }) {
  const requested = path.resolve(projectDir);
  if (!(await lstat(requested)).isDirectory()) fail();
  const root = await realpath(requested);
  const target = path.resolve(output);
  await mkdir(path.dirname(target), { recursive: true });
  const parent = await realpath(path.dirname(target));
  const relative = path.relative(root, parent);
  if (
    !relative ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  )
    fail();
  await project(root);
  const entries = [];
  const seen = new Set();
  let total = 0;
  let directorySize = 0;
  async function walk(dir, prefix = "") {
    for (const name of (await readdir(dir)).sort()) {
      const full = path.join(dir, name);
      const info = await lstat(full);
      if (!info.isFile() && !info.isDirectory()) fail();
      const relativeName = `${prefix}${name}${info.isDirectory() ? "/" : ""}`;
      safeName(relativeName);
      const key = keyOf(relativeName);
      if (seen.has(key)) fail();
      seen.add(key);
      const bytes = Buffer.from(relativeName);
      if (bytes.length > 65535) fail();
      directorySize += 74 + bytes.length;
      total += info.isFile() ? info.size : 0;
      if (entries.length >= MAX_FILES || total > MAX || directorySize > MAX_DIRECTORY) fail();
      entries.push({
        full,
        name: bytes,
        directory: info.isDirectory(),
        size: info.isFile() ? info.size : 0,
      });
      if (info.isDirectory()) await walk(full, `${prefix}${name}/`);
    }
  }
  await walk(root);
  return stageFor(target, async (stage) => {
    const temporary = path.join(stage, "project.zip");
    const out = await open(temporary, "wx");
    let offset = 0;
    const write = async (data) => {
      if (offset + data.length > ARCHIVE_MAX) fail();
      await out.writeFile(data);
      offset += data.length;
    };
    try {
      for (const entry of entries) {
        entry.offset = offset;
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(45, 4);
        local.writeUInt32LE(U32, 18);
        local.writeUInt32LE(U32, 22);
        local.writeUInt16LE(20, 28);
        local.writeUInt16LE(0x808, 6); // UTF-8 and trailing data descriptor.
        local.writeUInt16LE(0x21, 12); // 1980-01-01.
        local.writeUInt16LE(entry.name.length, 26);
        await write(local);
        await write(entry.name);
        await write(zip64Extra([entry.size, entry.size]));
        let checksum = 0;
        let size = 0;
        if (!entry.directory) {
          // lstat again before opening: links are never accepted as source entries.
          const before = await lstat(entry.full);
          if (!before.isFile()) fail();
          const source = await open(entry.full, "r");
          try {
            const current = await source.stat();
            if (!current.isFile() || current.ino !== before.ino || current.dev !== before.dev)
              fail();
            for await (const chunk of source.createReadStream({
              autoClose: false,
              highWaterMark: 256 * 1024,
            })) {
              size += chunk.length;
              if (size > entry.size) fail();
              checksum = crc32(chunk, checksum);
              await write(chunk);
            }
          } finally {
            await source.close();
          }
        }
        if (size !== entry.size) fail();
        entry.crc = checksum;
        const descriptor = Buffer.alloc(24);
        descriptor.writeUInt32LE(0x08074b50, 0);
        descriptor.writeUInt32LE(checksum, 4);
        descriptor.writeBigUInt64LE(BigInt(size), 8);
        descriptor.writeBigUInt64LE(BigInt(size), 16);
        await write(descriptor);
      }
      const start = offset;
      for (const entry of entries) {
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(0x032d, 4);
        central.writeUInt16LE(45, 6);
        central.writeUInt16LE(0x808, 8);
        central.writeUInt16LE(0x21, 14);
        central.writeUInt32LE(entry.crc, 16);
        central.writeUInt32LE(U32, 20);
        central.writeUInt32LE(U32, 24);
        central.writeUInt16LE(entry.name.length, 28);
        central.writeUInt32LE(((entry.directory ? 0o40755 : 0o100644) << 16) >>> 0, 38);
        central.writeUInt32LE(U32, 42);
        central.writeUInt16LE(28, 30);
        await write(central);
        await write(entry.name);
        await write(zip64Extra([entry.size, entry.size, entry.offset]));
      }
      const end64 = Buffer.alloc(56);
      end64.writeUInt32LE(0x06064b50, 0);
      end64.writeBigUInt64LE(44n, 4);
      end64.writeUInt16LE(45, 12);
      end64.writeUInt16LE(45, 14);
      end64.writeBigUInt64LE(BigInt(entries.length), 24);
      end64.writeBigUInt64LE(BigInt(entries.length), 32);
      end64.writeBigUInt64LE(BigInt(offset - start), 40);
      end64.writeBigUInt64LE(BigInt(start), 48);
      const locator = Buffer.alloc(20);
      locator.writeUInt32LE(0x07064b50, 0);
      locator.writeBigUInt64LE(BigInt(offset), 8);
      locator.writeUInt32LE(1, 16);
      await write(end64);
      await write(locator);
      const end = Buffer.alloc(22);
      end.writeUInt32LE(0x06054b50, 0);
      end.writeUInt16LE(0xffff, 8);
      end.writeUInt16LE(0xffff, 10);
      end.writeUInt32LE(U32, 12);
      end.writeUInt32LE(U32, 16);
      await write(end);
    } finally {
      await out.close();
    }
    await copyFile(temporary, target, 1);
    return target;
  });
}

function zip64Extra(values) {
  const extra = Buffer.alloc(4 + values.length * 8);
  extra.writeUInt16LE(1, 0);
  extra.writeUInt16LE(values.length * 8, 2);
  values.forEach((value, i) => extra.writeBigUInt64LE(BigInt(value), 4 + i * 8));
  return extra;
}
function uint64(buffer, offset) {
  if (offset + 8 > buffer.length) fail();
  const value = buffer.readBigUInt64LE(offset);
  if (value > BigInt(ARCHIVE_MAX)) fail();
  return Number(value);
}
function extended(extra, values) {
  let record;
  for (let at = 0; at < extra.length;) {
    if (at + 4 > extra.length) fail();
    const id = extra.readUInt16LE(at),
      length = extra.readUInt16LE(at + 2);
    if (at + 4 + length > extra.length) fail();
    if (id === 1) {
      if (record) fail();
      record = extra.subarray(at + 4, at + 4 + length);
    }
    at += 4 + length;
  }
  let at = 0;
  return values.map((value) => {
    if (value !== U32) return value;
    if (!record) fail();
    const result = uint64(record, at);
    at += 8;
    return result;
  });
}

async function directory(file) {
  const { size } = await file.stat();
  if (size < 22 || size > ARCHIVE_MAX) fail();
  const tail = await exact(file, Math.min(size, 65557), Math.max(0, size - 65557));
  let e = tail.length - 22;
  while (
    e >= 0 &&
    (tail.readUInt32LE(e) !== 0x06054b50 || e + 22 + tail.readUInt16LE(e + 20) !== tail.length)
  )
    e--;
  if (e < 0) fail();
  let endPosition = size - tail.length + e;
  let count = tail.readUInt16LE(e + 10);
  let length = tail.readUInt32LE(e + 12);
  let start = tail.readUInt32LE(e + 16);
  if (tail.readUInt16LE(e + 4) || tail.readUInt16LE(e + 6) || count !== tail.readUInt16LE(e + 8))
    fail();
  if (count === 0xffff || length === U32 || start === U32) {
    if (endPosition < 76) fail();
    const locator = await exact(file, 20, endPosition - 20);
    if (
      locator.readUInt32LE(0) !== 0x07064b50 ||
      locator.readUInt32LE(4) ||
      locator.readUInt32LE(16) !== 1
    )
      fail();
    const location = uint64(locator, 8);
    if (location + 56 !== endPosition - 20) fail();
    const record = await exact(file, 56, location);
    if (
      record.readUInt32LE(0) !== 0x06064b50 ||
      uint64(record, 4) !== 44 ||
      record.readUInt32LE(16) ||
      record.readUInt32LE(20) ||
      uint64(record, 24) !== uint64(record, 32)
    )
      fail();
    count = uint64(record, 32);
    length = uint64(record, 40);
    start = uint64(record, 48);
    endPosition = location;
  }
  if (count > MAX_FILES || length > MAX_DIRECTORY || start + length !== endPosition) fail();
  const entries = [];
  const seen = new Map();
  let position = start;
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (position + 46 > endPosition) fail();
    const h = await exact(file, 46, position);
    if (h.readUInt32LE(0) !== 0x02014b50 || h.readUInt16LE(34)) fail();
    const flags = h.readUInt16LE(8),
      method = h.readUInt16LE(10);
    let compressed = h.readUInt32LE(20),
      expanded = h.readUInt32LE(24),
      offset = h.readUInt32LE(42);
    const nameLength = h.readUInt16LE(28),
      extraLength = h.readUInt16LE(30),
      commentLength = h.readUInt16LE(32);
    const kind = (h.readUInt32LE(38) >>> 16) & 0o170000;
    if (flags & ~0x808 || ![0, 8].includes(method) || ![0, 0o100000, 0o40000].includes(kind))
      fail();
    position += 46;
    if (position + nameLength + extraLength + commentLength > endPosition) fail();
    const rawName = await exact(file, nameLength, position);
    const extra = await exact(file, extraLength, position + nameLength);
    const zip64 = compressed === U32 || expanded === U32;
    [expanded, compressed, offset] = extended(extra, [expanded, compressed, offset]);
    if (compressed > MAX || expanded > MAX || offset >= start) fail();
    if (!(flags & 0x800) && rawName.some((b) => b > 127)) fail();
    const name = utf8.decode(rawName);
    const parts = safeName(name);
    const isDir = name.endsWith("/");
    if (
      (kind === 0o40000 && !isDir) ||
      (isDir && (expanded || compressed)) ||
      (method === 0 && compressed !== expanded)
    )
      fail();
    const key = keyOf(name);
    if (seen.has(key)) fail();
    seen.set(key, isDir);
    total += expanded;
    if (total > MAX) fail();
    entries.push({
      name,
      zip64,
      rawName,
      parts,
      isDir,
      flags,
      method,
      compressed,
      expanded,
      offset,
      crc: h.readUInt32LE(16),
    });
    position += nameLength + extraLength + commentLength;
  }
  if (position !== endPosition) fail();
  for (const entry of entries) {
    for (let i = 1; i < entry.parts.length; i++)
      if (seen.get(keyOf(entry.parts.slice(0, i).join("/"))) === false) fail();
  }
  // Validate local names/headers and non-overlapping physical ranges before extraction.
  let previousEnd = 0;
  for (const entry of [...entries].sort((a, b) => a.offset - b.offset)) {
    if (entry.offset < previousEnd || entry.offset + 30 > start) fail();
    const local = await exact(file, 30, entry.offset);
    const n = local.readUInt16LE(26),
      extra = local.readUInt16LE(28);
    if (
      local.readUInt32LE(0) !== 0x04034b50 ||
      local.readUInt16LE(6) !== entry.flags ||
      local.readUInt16LE(8) !== entry.method ||
      n !== entry.rawName.length
    )
      fail();
    if (!(await exact(file, n, entry.offset + 30)).equals(entry.rawName)) fail();
    const localExtra = await exact(file, extra, entry.offset + 30 + n);
    const [localSize, localCompressed] = extended(localExtra, [
      local.readUInt32LE(22),
      local.readUInt32LE(18),
    ]);
    entry.data = entry.offset + 30 + n + extra;
    previousEnd = entry.data + entry.compressed;
    if (previousEnd > start) fail();
    if (entry.flags & 8) {
      const descriptorSize = entry.zip64 ? 20 : 12;
      let d = await exact(file, descriptorSize, previousEnd);
      const signature = d.readUInt32LE(0) === 0x08074b50;
      if (signature) d = await exact(file, descriptorSize, previousEnd + 4);
      if (
        d.readUInt32LE(0) !== entry.crc ||
        (entry.zip64 ? uint64(d, 4) : d.readUInt32LE(4)) !== entry.compressed ||
        (entry.zip64 ? uint64(d, 12) : d.readUInt32LE(8)) !== entry.expanded
      )
        fail();
      previousEnd += descriptorSize + (signature ? 4 : 0);
    } else if (
      local.readUInt32LE(14) !== entry.crc ||
      localCompressed !== entry.compressed ||
      localSize !== entry.expanded
    )
      fail();
    if (previousEnd > start) fail();
  }
  return entries;
}

/** Validate, stream-extract and CRC-check into a private staging directory. */
export async function restoreProject({ archive, destination }) {
  const target = path.resolve(destination);
  try {
    await lstat(target);
    fail();
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const file = await open(path.resolve(archive), "r");
  try {
    const entries = await directory(file);
    return await stageFor(target, async (stage) => {
      const root = path.join(stage, "project");
      await mkdir(root);
      for (const entry of entries) {
        const output = path.join(root, ...entry.parts);
        if (entry.isDir) {
          await mkdir(output, { recursive: true });
          continue;
        }
        await mkdir(path.dirname(output), { recursive: true });
        let size = 0,
          checksum = 0;
        const meter = new Transform({
          transform(chunk, _encoding, callback) {
            size += chunk.length;
            if (size > entry.expanded) {
              callback(new Error("ZIP 解压大小超限"));
              return;
            }
            checksum = crc32(chunk, checksum);
            callback(null, chunk);
          },
        });
        const source = entry.compressed
          ? file.createReadStream({
              start: entry.data,
              end: entry.data + entry.compressed - 1,
              autoClose: false,
              highWaterMark: 256 * 1024,
            })
          : Readable.from([]);
        const streams = [source];
        if (entry.method === 8) streams.push(createInflateRaw());
        streams.push(meter, createWriteStream(output, { flags: "wx", highWaterMark: 256 * 1024 }));
        await pipeline(streams);
        if (size !== entry.expanded || checksum !== entry.crc) fail();
      }
      await project(root);
      await mkdir(target); // Exclusive reservation also rejects destination symlinks.
      try {
        for (const name of await readdir(root))
          await rename(path.join(root, name), path.join(target, name));
      } catch (error) {
        await rm(target, { recursive: true, force: true });
        throw error;
      }
      return target;
    });
  } finally {
    await file.close();
  }
}

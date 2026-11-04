// Independent, small in-memory ZIP fixture writer; never used for project data.
import { Buffer } from "node:buffer";
import { crc32, deflateRawSync } from "node:zlib";
export function fixture(entries) {
  const bodies = [],
    records = [];
  let offset = 0;
  for (const {
    name,
    text = "x",
    mode = 0o100644,
    method = 0,
    declaredSize,
    badCrc = false,
    localName = name,
    flags = 0x800,
  } of entries) {
    const data = Buffer.from(text),
      filename = Buffer.from(name),
      localFilename = Buffer.from(localName);
    const compressed = method === 8 ? deflateRawSync(data) : data;
    const crc = badCrc ? 42 : crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(declaredSize ?? data.length, 22);
    local.writeUInt16LE(localFilename.length, 26);
    bodies.push(local, localFilename, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(declaredSize ?? data.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE((mode << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    records.push(central, filename);
    offset += local.length + localFilename.length + compressed.length;
  }
  const central = Buffer.concat(records),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...bodies, central, end]);
}

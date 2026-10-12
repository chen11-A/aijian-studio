import { createHash } from "node:crypto";
import type { VisualInspection } from "@aijian/contracts/visual-bible";

/** Read dimensions without decompressing to bound native allocation first. */
export function visualImageDimensions(
  bytes: Uint8Array,
  mime: string,
): { width: number; height: number } {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (b.length < 12 || b.length > 33554432) throw new Error("Unsupported image inspection size");
  let width = 0,
    height = 0;
  if (mime === "image/png") {
    if (
      b.length < 33 ||
      b.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
      b.toString("ascii", 12, 16) !== "IHDR"
    )
      throw new Error("Invalid PNG dimensions");
    width = b.readUInt32BE(16);
    height = b.readUInt32BE(20);
    // nativeImage returns a single bitmap; it cannot attest to all animation frames.
    for (let offset = 8; offset < b.length;) {
      if (offset + 12 > b.length) throw new Error("Truncated PNG chunk");
      const length = b.readUInt32BE(offset);
      if (offset + length + 12 > b.length) throw new Error("Invalid PNG chunk size");
      if (b.toString("ascii", offset + 4, offset + 8) === "acTL")
        throw new Error("Animated PNG needs a full-frame inspector");
      offset += length + 12;
    }
  } else if (mime === "image/jpeg") {
    if (b[0] !== 0xff || b[1] !== 0xd8) throw new Error("Invalid JPEG dimensions");
    let offset = 2;
    for (let markerCount = 0; markerCount < 4096 && offset < b.length; markerCount++) {
      if (b[offset++] !== 0xff) throw new Error("Invalid JPEG marker");
      while (b[offset] === 0xff) offset++;
      const marker = b[offset++];
      if (marker === undefined || marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > b.length) throw new Error("Truncated JPEG dimensions");
      const length = b.readUInt16BE(offset);
      if (length < 2 || offset + length > b.length) throw new Error("Invalid JPEG segment");
      if (
        [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
          marker,
        )
      ) {
        if (length < 8) throw new Error("Invalid JPEG frame");
        height = b.readUInt16BE(offset + 3);
        width = b.readUInt16BE(offset + 5);
        break;
      }
      offset += length;
    }
  } else if (mime === "image/webp") {
    if (
      b.toString("ascii", 0, 4) !== "RIFF" ||
      b.toString("ascii", 8, 12) !== "WEBP" ||
      b.readUInt32LE(4) + 8 !== b.length
    )
      throw new Error("Invalid WebP dimensions");
    const tag = b.toString("ascii", 12, 16);
    if (tag === "VP8X" && b.length >= 30) {
      if ((b[20]! & 0x02) !== 0) throw new Error("Animated WebP needs a full-frame inspector");
      width = 1 + b.readUIntLE(24, 3);
      height = 1 + b.readUIntLE(27, 3);
    } else if (tag === "VP8 " && b.length >= 30 && b.toString("hex", 23, 26) === "9d012a") {
      width = b.readUInt16LE(26) & 0x3fff;
      height = b.readUInt16LE(28) & 0x3fff;
    } else if (tag === "VP8L" && b.length >= 25 && b[20] === 0x2f) {
      const bits = b.readUInt32LE(21);
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
    }
  }
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 32768 ||
    height > 32768 ||
    width * height > 16777216
  )
    throw new Error("Image dimensions unavailable or exceed decode budget");
  return { width, height };
}
export type DecodedVisualImage = { width: number; height: number; bitmap: Uint8Array };
/** Trusted main supplies Electron nativeImage; unit tests supply controlled failures. */
export function inspectVisualImage(
  bytes: Uint8Array,
  mime: string,
  sha256: string,
  operationId: string,
  decoderVersion: string,
  decode: (bytes: Uint8Array) => DecodedVisualImage,
): VisualInspection["evidence"] {
  if (
    !/^[0-9a-f]{64}$/.test(sha256) ||
    !/^vinop_[0-9a-f]{32}$/.test(operationId) ||
    !decoderVersion ||
    decoderVersion.length > 120 ||
    createHash("sha256").update(bytes).digest("hex") !== sha256
  )
    throw new Error("Image identity mismatch");
  const header = visualImageDimensions(bytes, mime);
  const decoded = decode(bytes);
  if (
    decoded.width !== header.width ||
    decoded.height !== header.height ||
    decoded.bitmap.byteLength !== header.width * header.height * 4
  )
    throw new Error("Decoded pixels differ from inspected dimensions");
  if (mime !== "image/png" && mime !== "image/jpeg" && mime !== "image/webp")
    throw new Error("Unsupported decoder MIME");
  return {
    operation_id: operationId,
    asset_sha256: sha256,
    byte_size: bytes.byteLength,
    mime_type: mime,
    width: decoded.width,
    height: decoded.height,
    pixel_sha256: createHash("sha256").update(decoded.bitmap).digest("hex"),
    decoder: "ELECTRON_NATIVE_IMAGE",
    decoder_version: decoderVersion,
  };
}

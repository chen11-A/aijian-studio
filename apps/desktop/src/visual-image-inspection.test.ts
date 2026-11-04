import { createHash } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import { inspectVisualImage, visualImageDimensions } from "./visual-image-inspection";
const png = () => {
  const b = Buffer.alloc(33);
  Buffer.from("89504e470d0a1a0a", "hex").copy(b);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(1, 16);
  b.writeUInt32BE(1, 20);
  return b;
};
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
describe("trusted native image adapter (controlled decode only)", () => {
  it("binds complete returned bitmap to exact original and operation", () => {
    const b = png(),
      pixels = new Uint8Array([0, 0, 255, 255]),
      decode = vi.fn(() => ({ width: 1, height: 1, bitmap: pixels }));
    const result = inspectVisualImage(
      b,
      "image/png",
      hash(b),
      "vinop_" + "a".repeat(32),
      "TEST_ADAPTER",
      decode,
    );
    expect(result.pixel_sha256).toBe(hash(pixels));
    expect(result.byte_size).toBe(b.length);
    expect(decode).toHaveBeenCalledTimes(1);
  });
  it("bounds dimensions before invoking the native decoder", () => {
    const b = png();
    b.writeUInt32BE(32768, 16);
    b.writeUInt32BE(32768, 20);
    const decode = vi.fn();
    expect(() =>
      inspectVisualImage(b, "image/png", hash(b), "vinop_" + "a".repeat(32), "TEST", decode),
    ).toThrow();
    expect(decode).not.toHaveBeenCalled();
  });
  it.each(["hash", "empty", "size", "bytes", "decoder"])(
    "refuses %s faults rather than persisting passing evidence",
    (fault) => {
      const b = png();
      const decode = vi.fn(() => {
        if (fault === "decoder") throw new Error("corrupt");
        return {
          width: fault === "size" ? 2 : 1,
          height: 1,
          bitmap: new Uint8Array(fault === "empty" ? 0 : fault === "bytes" ? 3 : 4),
        };
      });
      expect(() =>
        inspectVisualImage(
          b,
          "image/png",
          fault === "hash" ? "0".repeat(64) : hash(b),
          "vinop_" + "a".repeat(32),
          "TEST",
          decode,
        ),
      ).toThrow();
      if (fault === "hash") expect(decode).not.toHaveBeenCalled();
    },
  );
  it("requires supported original magic and complete bounded dimensions", () => {
    expect(() => visualImageDimensions(new Uint8Array(40), "image/jpeg")).toThrow();
    expect(() => visualImageDimensions(new Uint8Array(40), "image/webp")).toThrow();
    expect(() => visualImageDimensions(png(), "image/svg+xml")).toThrow();
  });
  it.each(["APNG", "WebP"])("refuses %s animations before single-frame decoding", (format) => {
    let b: Buffer;
    if (format === "APNG") {
      b = Buffer.concat([png(), Buffer.alloc(20)]);
      b.writeUInt32BE(8, 33);
      b.write("acTL", 37, "ascii");
    } else {
      b = Buffer.alloc(30);
      b.write("RIFF", 0, "ascii");
      b.writeUInt32LE(22, 4);
      b.write("WEBPVP8X", 8, "ascii");
      b[20] = 2;
    }
    const decode = vi.fn();
    expect(() =>
      inspectVisualImage(
        b,
        format === "APNG" ? "image/png" : "image/webp",
        hash(b),
        "vinop_" + "a".repeat(32),
        "TEST",
        decode,
      ),
    ).toThrow(/Animated/);
    expect(decode).not.toHaveBeenCalled();
  });
});

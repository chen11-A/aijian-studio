/** Synthetic test bytes only, never a acquired/reviewed native binary or Windows proof. */
import { createHash } from "node:crypto";
import { visualJson } from "@aijian/contracts/visual-bible";
import type { MltPeClosureReceipt, HeldPeBytes } from "./media-preview-pe-admission";
import { MLT_VIDEO_CAPABILITIES, type MltNativeReleaseProfile } from "./media-preview-native-wire";
type Options = { dll?: boolean; imports?: string[]; delay?: string[]; forward?: string[] };
export function syntheticPe({
  dll = true,
  imports = [],
  delay = [],
  forward = [],
}: Options = {}): Buffer {
  const b = Buffer.alloc(0x1800);
  b.writeUInt16LE(0x5a4d, 0);
  b.writeUInt32LE(0x80, 0x3c);
  b.writeUInt32LE(0x4550, 0x80);
  b.writeUInt16LE(0x8664, 0x84);
  b.writeUInt16LE(1, 0x86);
  b.writeUInt16LE(240, 0x94);
  b.writeUInt16LE(dll ? 0x2002 : 2, 0x96);
  b.writeUInt16LE(0x20b, 0x98);
  b.writeUInt32LE(0x3000, 0x98 + 56);
  b.writeUInt32LE(0x400, 0x98 + 60);
  b.writeUInt32LE(16, 0x98 + 108);
  b.writeUInt32LE(0x1400, 0x188 + 8);
  b.writeUInt32LE(0x1000, 0x188 + 12);
  b.writeUInt32LE(0x1400, 0x188 + 16);
  b.writeUInt32LE(0x400, 0x188 + 20);
  let cursor = 0x1100;
  const at = (rva: number) => rva - 0x1000 + 0x400;
  const alloc = (n: number) => {
    const start = cursor;
    cursor += n;
    return start;
  };
  const text = (s: string) => {
    const start = alloc(Buffer.byteLength(s) + 1);
    b.write(s, at(start), "ascii");
    return start;
  };
  function directory(i: number, rva: number, n: number) {
    b.writeUInt32LE(rva, 0x98 + 112 + i * 8);
    b.writeUInt32LE(n, 0x98 + 116 + i * 8);
  }
  for (const [index, names, stride] of [
    [1, imports, 20],
    [13, delay, 32],
  ] as const) {
    if (!names.length) continue;
    const start = alloc((names.length + 1) * stride);
    directory(index, start, (names.length + 1) * stride);
    for (let i = 0; i < names.length; i++) {
      const offset = at(start + i * stride),
        name = text(names[i]!),
        iat = alloc(8);
      if (index === 1) {
        b.writeUInt32LE(name, offset + 12);
        b.writeUInt32LE(iat, offset + 16);
      } else {
        b.writeUInt32LE(1, offset);
        b.writeUInt32LE(name, offset + 4);
        b.writeUInt32LE(iat, offset + 12);
      }
    }
  }
  if (forward.length) {
    const start = alloc(40),
      table = alloc(forward.length * 4);
    b.writeUInt32LE(forward.length, at(start) + 20);
    b.writeUInt32LE(table, at(start) + 28);
    for (let i = 0; i < forward.length; i++) b.writeUInt32LE(text(forward[i]!), at(table) + i * 4);
    directory(0, start, cursor - start);
  }
  return b;
}
const digest = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const sorted = (names: string[]) => names.map((s) => s.toLowerCase()).sort();
export function syntheticPeMaterial(extra: Options = {}) {
  const definitions: [string, Options][] = [
    ["aivora-mlt-preview-host.exe", { dll: false, imports: ["KERNEL32.dll"] }],
    ["libmlt-7.dll", { imports: ["KERNEL32.dll"], ...extra }],
    ["modules\\mltcore.dll", { imports: ["libmlt-7.dll"] }],
    ["modules\\mltavformat.dll", { imports: ["libmlt-7.dll", "avformat-test.dll"] }],
    ["modules\\mltsdl2.dll", { imports: ["libmlt-7.dll"], delay: ["sdl2.dll"] }],
    ["avformat-test.dll", { forward: ["KERNEL32.Sleep"] }],
    ["sdl2.dll", { imports: ["USER32.dll"] }],
  ];
  const held: HeldPeBytes[] = definitions.map(([relative_path, options]) => ({
    relative_path,
    bytes: syntheticPe(options),
  }));
  held.push({
    relative_path: "licenses\\third-party-notices.txt",
    bytes: Buffer.from("synthetic test notice, not a license review"),
  });
  const files = held.map((f) => ({
    relative_path: f.relative_path,
    sha256: digest(f.bytes),
    byte_size: f.bytes.length,
  }));
  const receipt: MltPeClosureReceipt = {
    schema_version: 1,
    target: "WINDOWS_X64_PE32_PLUS",
    embedded_manifests: "REFUSED",
    host_startup: "SYSTEM32_ONLY_STATIC_CRT",
    files: definitions.map(([relative_path, options]) => ({
      ...files.find((f) => f.relative_path === relative_path)!,
      imports: sorted(options.imports ?? []),
      delay_imports: sorted(options.delay ?? []),
      forwarder_imports: sorted(
        (options.forward ?? []).map((s) => s.slice(0, s.indexOf(".")) + ".dll"),
      ),
    })),
  };
  const profile: MltNativeReleaseProfile = {
    schema_version: 1,
    distribution_status: "REVIEWED_RELEASE",
    mlt_version: "7.40.0",
    source_patch_sha256: "a".repeat(64),
    capability: structuredClone(MLT_VIDEO_CAPABILITIES),
    network_disabled_build: true,
    pe_closure_receipt_sha256: digest(Buffer.from(visualJson(receipt))),
    license_source_receipt_sha256: "b".repeat(64),
    host_file: "aivora-mlt-preview-host.exe",
    framework_file: "libmlt-7.dll",
    files,
  };
  const refresh = () => {
    for (const f of held) {
      const target = profile.files.find((v) => v.relative_path === f.relative_path);
      if (target) {
        target.sha256 = digest(f.bytes);
        target.byte_size = f.bytes.length;
      }
    }
    for (const f of receipt.files) {
      const target = profile.files.find((v) => v.relative_path === f.relative_path);
      if (target) {
        f.sha256 = target.sha256;
        f.byte_size = target.byte_size;
      }
    }
    profile.pe_closure_receipt_sha256 = digest(Buffer.from(visualJson(receipt)));
  };
  return { held, receipt, profile, refresh, system: ["kernel32.dll", "user32.dll"] };
}

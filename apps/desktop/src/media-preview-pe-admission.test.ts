/** Synthetic PE bytes only. No acquired binary, native loader, compiler or process. */
import { visualJson } from "@aijian/contracts/visual-bible";
import { expect, it } from "vitest";
import {
  admitMltPeClosure,
  inspectPeImports,
  requireMltPeAdmission,
} from "./media-preview-pe-admission";
import {
  syntheticPe as pe,
  syntheticPeMaterial as fixture,
} from "./media-preview-pe-admission.test-support";
it("parses normal, RVA delay and forwarded dependencies independently from receipt declarations", () => {
  expect(
    inspectPeImports(
      pe({ imports: ["USER32.dll", "KERNEL32.dll"], delay: ["SDL2.dll"], forward: ["other.#7"] }),
      true,
    ),
  ).toEqual({
    imports: ["kernel32.dll", "user32.dll"],
    delay_imports: ["sdl2.dll"],
    forwarder_imports: ["other.dll"],
  });
});
it("admits the exact closed synthetic byte inventory with trusted system policy and nonforgeable token", () => {
  const f = fixture();
  const original = visualJson(f.profile);
  const token = admitMltPeClosure(f.profile, f.receipt, f.held, f.system);
  expect(() => requireMltPeAdmission(token, f.profile)).not.toThrow();
  expect(Object.isFrozen(token)).toBe(true);
  expect(visualJson(f.profile)).toBe(original);
  expect(() => requireMltPeAdmission({ kind: "STATIC_HELD_PE_CLOSURE" }, f.profile)).toThrow();
  expect(() => requireMltPeAdmission(structuredClone(token), f.profile)).toThrow();
  f.profile.source_patch_sha256 = "c".repeat(64);
  expect(() => requireMltPeAdmission(token, f.profile)).toThrow();
});
it.each([
  ["bad DOS", (b: Buffer) => b.writeUInt16LE(0, 0)],
  ["bad PE", (b: Buffer) => b.writeUInt32LE(0, 0x80)],
  ["x86", (b: Buffer) => b.writeUInt16LE(0x14c, 0x84)],
  ["PE32", (b: Buffer) => b.writeUInt16LE(0x10b, 0x98)],
  ["wrong DLL flag", (b: Buffer) => b.writeUInt16LE(2, 0x96)],
  ["optional truncation", (b: Buffer) => b.writeUInt16LE(100, 0x94)],
  ["directory overflow", (b: Buffer) => b.writeUInt32LE(32, 0x98 + 108)],
  ["section file overlap with headers", (b: Buffer) => b.writeUInt32LE(0x100, 0x188 + 20)],
  ["virtual-only import RVA", (b: Buffer) => b.writeUInt32LE(0x2500, 0x98 + 120)],
  ["zero-size directory", (b: Buffer) => b.writeUInt32LE(0, 0x98 + 124)],
  ["descriptor lacks terminal", (b: Buffer) => b.writeUInt32LE(20, 0x98 + 124)],
  ["malformed IAT", (b: Buffer) => b.writeUInt32LE(0, 0x500 + 16)],
  ["huge descriptor directory", (b: Buffer) => b.writeUInt32LE(0xfffffff0, 0x98 + 124)],
] as const)("refuses malformed PE: %s", (_name, corrupt) => {
  const bytes = pe({ imports: ["KERNEL32.dll"] });
  corrupt(bytes);
  expect(() => inspectPeImports(bytes, true)).toThrow();
});
it.each([64, 511, 0x188, 0x500, 0x900, 0x17ff])("refuses truncated raw PE at %i bytes", (n) => {
  expect(() => inspectPeImports(pe({ imports: ["KERNEL32.dll"] }).subarray(0, n), true)).toThrow();
});
it.each([
  "../evil.dll",
  "C:\\evil.dll",
  "evil/d.dll",
  "evil\\d.dll",
  "evil.dll ",
  "evil.exe",
  "evil.dll:stream",
])("refuses non-basename import %s", (name) => {
  expect(() => inspectPeImports(pe({ imports: [name] }), true)).toThrow();
});
it("refuses duplicate import spellings, unsupported VA delay descriptors and bounded/CLR alternatives", () => {
  expect(() => inspectPeImports(pe({ imports: ["KERNEL32.dll", "kernel32.dll"] }), true)).toThrow();
  const delayed = pe({ delay: ["sdl2.dll"] });
  delayed.writeUInt32LE(0, 0x500);
  expect(() => inspectPeImports(delayed, true)).toThrow();
  for (const index of [11, 14]) {
    const b = pe();
    b.writeUInt32LE(0x1100, 0x98 + 112 + index * 8);
    b.writeUInt32LE(16, 0x98 + 116 + index * 8);
    expect(() => inspectPeImports(b, true)).toThrow();
  }
});
it("refuses embedded manifests and ambiguous named resource types", () => {
  for (const type of [24, 0x80000001]) {
    const b = pe();
    b.writeUInt32LE(0x1100, 0x98 + 128);
    b.writeUInt32LE(24, 0x98 + 132);
    b.writeUInt16LE(1, 0x500 + 14);
    b.writeUInt32LE(type, 0x510);
    expect(() => inspectPeImports(b, true)).toThrow();
  }
});
it.each([
  { imports: ["missing.dll"] },
  { delay: ["missing.dll"] },
  { forward: ["missing.Function"] },
])("refuses unheld external dependency in every loader table %j", (options) => {
  const f = fixture(options);
  expect(() => admitMltPeClosure(f.profile, f.receipt, f.held, f.system)).toThrow();
});
it("refuses a fully hashed host with a third-party startup import", () => {
  const f = fixture();
  f.held[0]!.bytes = pe({ dll: false, imports: ["libmlt-7.dll"] });
  f.receipt.files[0]!.imports = ["libmlt-7.dll"];
  f.refresh();
  expect(() => admitMltPeClosure(f.profile, f.receipt, f.held, f.system)).toThrow();
});
it("refuses rewritten receipts even if their digest is recomputed", () => {
  const f = fixture();
  f.receipt.files[4]!.delay_imports = [];
  f.refresh();
  expect(() => admitMltPeClosure(f.profile, f.receipt, f.held, f.system)).toThrow();
});
it("refuses false receipt hashes and changed notice/source bytes", () => {
  const f = fixture();
  f.profile.pe_closure_receipt_sha256 = "0".repeat(64);
  expect(() => admitMltPeClosure(f.profile, f.receipt, f.held, f.system)).toThrow();
  const changed = fixture();
  changed.held.at(-1)!.bytes[0] = 0;
  expect(() =>
    admitMltPeClosure(changed.profile, changed.receipt, changed.held, changed.system),
  ).toThrow();
});
it("refuses missing, extra and duplicate held entries", () => {
  const missing = fixture();
  missing.held.pop();
  expect(() =>
    admitMltPeClosure(missing.profile, missing.receipt, missing.held, missing.system),
  ).toThrow();
  const extra = fixture();
  extra.held.push({ relative_path: "unlisted.dll", bytes: pe() });
  expect(() => admitMltPeClosure(extra.profile, extra.receipt, extra.held, extra.system)).toThrow();
  const duplicate = fixture();
  duplicate.held[1] = duplicate.held[0]!;
  expect(() =>
    admitMltPeClosure(duplicate.profile, duplicate.receipt, duplicate.held, duplicate.system),
  ).toThrow();
});
it("refuses duplicate DLL basenames, system shadowing and API-set payloads", () => {
  for (const name of ["mltcore.dll", "kernel32.dll", "api-ms-fake.dll"]) {
    const f = fixture();
    f.held[5]!.relative_path = name;
    f.profile.files[5]!.relative_path = name;
    f.receipt.files[5]!.relative_path = name;
    f.refresh();
    expect(() => admitMltPeClosure(f.profile, f.receipt, f.held, f.system)).toThrow();
  }
});
it("refuses unknown receipt fields, repeated metadata and empty/broad system policy", () => {
  const f = fixture();
  expect(() =>
    admitMltPeClosure(f.profile, { ...f.receipt, allowed: true }, f.held, f.system),
  ).toThrow();
  f.receipt.files[1] = f.receipt.files[0]!;
  f.refresh();
  expect(() => admitMltPeClosure(f.profile, f.receipt, f.held, f.system)).toThrow();
  for (const policy of [[], ["*.dll"], ["kernel32.dll", "KERNEL32.dll"]]) {
    const v = fixture();
    expect(() => admitMltPeClosure(v.profile, v.receipt, v.held, policy)).toThrow();
  }
});

it("refuses dynamic CRT host dependencies even if wrongly listed as system policy", () => {
  const f = fixture();
  f.held[0]!.bytes = pe({ dll: false, imports: ["ucrtbase.dll"] });
  f.receipt.files[0]!.imports = ["ucrtbase.dll"];
  f.refresh();
  expect(() =>
    admitMltPeClosure(f.profile, f.receipt, f.held, [...f.system, "ucrtbase.dll"]),
  ).toThrow();
});

it("refuses bound normal timestamps, bound delay IAT and bound delay timestamps", () => {
  const normal = pe({ imports: ["kernel32.dll"] });
  normal.writeUInt32LE(1, 0x504);
  expect(() => inspectPeImports(normal, true)).toThrow();
  for (const offset of [20, 28]) {
    const delayed = pe({ delay: ["sdl2.dll"] });
    delayed.writeUInt32LE(1, 0x500 + offset);
    expect(() => inspectPeImports(delayed, true)).toThrow();
  }
});

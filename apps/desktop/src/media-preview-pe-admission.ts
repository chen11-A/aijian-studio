/** Static PE-byte admission only. Never loads a DLL, launches a process or admits a release. */
import { createHash } from "node:crypto";
import { visualJson } from "@aijian/contracts/visual-bible";
import type { MltNativeReleaseProfile } from "./media-preview-native-wire";

export type PeImports = { imports: string[]; delay_imports: string[]; forwarder_imports: string[] };
export type MltPeClosureReceipt = {
  schema_version: 1;
  target: "WINDOWS_X64_PE32_PLUS";
  embedded_manifests: "REFUSED";
  host_startup: "SYSTEM32_ONLY_STATIC_CRT";
  files: ({ relative_path: string; sha256: string; byte_size: number } & PeImports)[];
};
export type HeldPeBytes = { relative_path: string; bytes: Buffer };
const MAX_FILE = 512 * 1024 * 1024;
function must(value: unknown): asserts value {
  if (!value) throw new Error("MLT PE closure has not been verified");
}
function dllName(value: string): string {
  must(value.length <= 128 && /^[a-zA-Z0-9_-]+\.dll$/.test(value));
  return value.toLowerCase();
}
function closed(
  value: unknown,
  names: readonly string[],
): asserts value is Record<string, unknown> {
  must(value !== null && typeof value === "object" && !Array.isArray(value));
  const object = value as Record<string, unknown>;
  must(Object.keys(object).length === names.length && names.every((n) => Object.hasOwn(object, n)));
}
/** Import/forwarder dependency parser, with bounded non-overlapping file-backed RVA mapping.
 * Delay VA descriptors, bound imports, CLR and embedded manifests fail closed. Dynamic
 * LoadLibrary/service/driver dependencies remain separate source/build and Windows obligations.
 * Layout source: https://learn.microsoft.com/windows/win32/debug/pe-format
 */
export function inspectPeImports(bytes: Buffer, expectedDll: boolean): PeImports {
  must(Buffer.isBuffer(bytes) && bytes.length >= 512 && bytes.length <= MAX_FILE);
  const range = (offset: number, size: number) => {
    must(
      Number.isSafeInteger(offset) &&
        Number.isSafeInteger(size) &&
        offset >= 0 &&
        size >= 0 &&
        offset + size <= bytes.length,
    );
  };
  const u16 = (at: number) => {
    range(at, 2);
    return bytes.readUInt16LE(at);
  };
  const u32 = (at: number) => {
    range(at, 4);
    return bytes.readUInt32LE(at);
  };
  must(u16(0) === 0x5a4d);
  const pe = u32(0x3c);
  must(pe >= 64 && pe <= 1024 * 1024 && u32(pe) === 0x4550);
  must(u16(pe + 4) === 0x8664);
  const count = u16(pe + 6),
    optionalSize = u16(pe + 20),
    flags = u16(pe + 22);
  must(count > 0 && count <= 96 && (flags & 2) !== 0 && Boolean(flags & 0x2000) === expectedDll);
  const optional = pe + 24;
  range(optional, optionalSize);
  must(optionalSize >= 240 && u16(optional) === 0x20b);
  const imageSize = u32(optional + 56),
    headers = u32(optional + 60),
    directories = u32(optional + 108);
  must(
    imageSize > 0 &&
      imageSize < 0x80000000 &&
      headers >= optional + optionalSize + count * 40 &&
      headers <= bytes.length &&
      directories === 16 &&
      112 + directories * 8 <= optionalSize,
  );
  const sections: { rva: number; virtualSize: number; offset: number; rawSize: number }[] = [];
  for (let i = 0; i < count; i++) {
    const at = optional + optionalSize + i * 40;
    range(at, 40);
    const section = {
      virtualSize: u32(at + 8),
      rva: u32(at + 12),
      rawSize: u32(at + 16),
      offset: u32(at + 20),
    };
    must(
      section.rva >= headers &&
        section.rva + Math.max(section.virtualSize, section.rawSize) <= imageSize,
    );
    if (section.rawSize) {
      range(section.offset, section.rawSize);
      must(section.offset >= headers);
    }
    for (const prior of sections) {
      must(
        section.rva + Math.max(section.virtualSize, section.rawSize) <= prior.rva ||
          prior.rva + Math.max(prior.virtualSize, prior.rawSize) <= section.rva,
      );
      must(
        !section.rawSize ||
          !prior.rawSize ||
          section.offset + section.rawSize <= prior.offset ||
          prior.offset + prior.rawSize <= section.offset,
      );
    }
    sections.push(section);
  }
  function mapped(rva: number, size: number): { offset: number; limit: number } {
    must(rva > 0 && size > 0 && rva + size < 0x1_0000_0000);
    if (rva < headers) {
      must(rva + size <= headers);
      return { offset: rva, limit: headers };
    }
    const matches = sections.filter((s) => rva >= s.rva && rva + size <= s.rva + s.rawSize);
    must(matches.length === 1);
    const s = matches[0]!;
    return { offset: s.offset + rva - s.rva, limit: s.offset + s.rawSize };
  }
  const atRva = (rva: number, size: number) => mapped(rva, size).offset;
  function text(rva: number): string {
    const { offset, limit } = mapped(rva, 1);
    const relativeEnd = bytes.subarray(offset, Math.min(limit, offset + 257)).indexOf(0);
    const end = relativeEnd < 0 ? -1 : offset + relativeEnd;
    must(end >= offset && end < limit && end - offset > 0 && end - offset <= 256);
    const body = bytes.subarray(offset, end);
    must([...body].every((b) => b >= 33 && b <= 126));
    return body.toString("ascii");
  }
  function directory(index: number): { rva: number; size: number } {
    const at = optional + 112 + index * 8,
      rva = u32(at),
      size = u32(at + 4);
    must((rva === 0) === (size === 0));
    if (rva) atRva(rva, size);
    return { rva, size };
  }
  must(directory(11).rva === 0 && directory(14).rva === 0 && directory(15).rva === 0); // No bound or managed loader alternative.
  const resources = directory(2);
  if (resources.rva) {
    const root = atRva(resources.rva, resources.size);
    must(resources.size >= 16);
    const n = u16(root + 12) + u16(root + 14);
    must(n <= 256 && 16 + n * 8 <= resources.size);
    for (let i = 0; i < n; i++) {
      const type = u32(root + 16 + i * 8);
      // Named resource types could be ambiguous RT_MANIFEST aliases: refuse rather than infer.
      must((type & 0x80000000) === 0 && type !== 24);
    }
  }
  function imports(index: number, stride: number, nameOffset: number, delay: boolean): string[] {
    const d = directory(index);
    if (!d.rva) return [];
    must(d.size >= stride && d.size <= 65536);
    const names = new Set<string>();
    let ended = false;
    for (let offset = 0; offset + stride <= d.size; offset += stride) {
      const at = atRva(d.rva + offset, stride),
        words = Array.from({ length: stride / 4 }, (_, i) => u32(at + i * 4));
      if (words.every((v) => v === 0)) {
        ended = true;
        break;
      }
      must(
        names.size < 256 &&
          (delay ? words[0] === 1 && words[5] === 0 && words[7] === 0 : words[1] === 0),
      );
      const name = dllName(text(u32(at + nameOffset)));
      must(!names.has(name));
      names.add(name);
      // Import tables are file-backed, and terminators must exist in the descriptor directory.
      const lookup = delay ? words[4]! : words[0]!,
        address = delay ? words[3]! : words[4]!;
      must(address > 0);
      atRva(address, 8);
      if (lookup) atRva(lookup, 8);
    }
    must(ended);
    return [...names].sort();
  }
  const exported = directory(0),
    forwarders = new Set<string>();
  if (exported.rva) {
    must(exported.size >= 40);
    const start = atRva(exported.rva, 40),
      functions = u32(start + 20),
      table = u32(start + 28);
    must(functions <= 65536);
    if (functions) atRva(table, functions * 4);
    for (let i = 0; i < functions; i++) {
      const value = u32(atRva(table + i * 4, 4));
      if (value >= exported.rva && value < exported.rva + exported.size) {
        const name = text(value);
        must(value + Buffer.byteLength(name) + 1 <= exported.rva + exported.size);
        const dot = name.indexOf(".");
        must(dot > 0 && dot < name.length - 1);
        must(/^(?:[a-zA-Z_][a-zA-Z0-9_@?$]*|#[0-9]+)$/.test(name.slice(dot + 1)));
        forwarders.add(dllName(name.slice(0, dot) + ".dll"));
        must(forwarders.size <= 256);
      } else if (value) must(value < imageSize);
    }
  }
  return {
    imports: imports(1, 20, 12, false),
    delay_imports: imports(13, 32, 4, true),
    forwarder_imports: [...forwarders].sort(),
  };
}
const admissionTokens = new WeakMap<object, { profileHash: string; filesHash: string }>();
export type MltPeAdmission = Readonly<{ kind: "STATIC_HELD_PE_CLOSURE" }>;
/** Caller must read these bytes FROM held native handles, never mutable pathname snapshots.
 * A receipt digest alone is insufficient: parse the original held PE and compare the full body.
 * systemDlls is trusted Windows release policy, not the user manifest/renderer/environment.
 */
export function admitMltPeClosure(
  profile: MltNativeReleaseProfile,
  receipt: unknown,
  held: readonly HeldPeBytes[],
  systemDlls: readonly string[],
): MltPeAdmission {
  closed(receipt, ["schema_version", "target", "embedded_manifests", "host_startup", "files"]);
  must(
    receipt.schema_version === 1 &&
      receipt.target === "WINDOWS_X64_PE32_PLUS" &&
      receipt.embedded_manifests === "REFUSED" &&
      receipt.host_startup === "SYSTEM32_ONLY_STATIC_CRT" &&
      Array.isArray(receipt.files),
  );
  must(
    createHash("sha256").update(visualJson(receipt)).digest("hex") ===
      profile.pe_closure_receipt_sha256,
  );
  const system = new Set(systemDlls.map(dllName));
  must(system.size > 0 && system.size <= 128 && system.size === systemDlls.length);
  const inventory = new Map<string, { relative_path: string; bytes: Buffer }>();
  let total = 0;
  must(
    profile.files.length >= 6 &&
      profile.files.length <= 256 &&
      held.length === profile.files.length,
  );
  const names = new Set<string>();
  for (const file of profile.files) {
    must(
      /^[a-z0-9_.-]+(?:\\[a-z0-9_.-]+)*$/.test(file.relative_path) &&
        !file.relative_path.split("\\").some((s) => s === "." || s === "..") &&
        !names.has(file.relative_path),
    );
    names.add(file.relative_path);
    const matches = held.filter((h) => h.relative_path === file.relative_path);
    must(matches.length === 1);
    const bytes = matches[0]!.bytes;
    must(
      Buffer.isBuffer(bytes) &&
        bytes.length > 0 &&
        bytes.length <= MAX_FILE &&
        bytes.length === file.byte_size &&
        createHash("sha256").update(bytes).digest("hex") === file.sha256,
    );
    total += bytes.length;
    must(total <= 2 * 1024 * 1024 * 1024);
    if (!/\.(dll|exe)$/.test(file.relative_path)) continue;
    const parts = file.relative_path.split("\\"),
      name = parts.at(-1)!;
    must(
      parts.length === 1 ||
        (parts.length === 2 &&
          parts[0] === "modules" &&
          /^(?:lib)?mlt(core|avformat|sdl2)\.dll$/.test(name)),
    );
    must(!inventory.has(name) && !system.has(name) && !/^(api-ms-|ext-ms-)/.test(name));
    must(!name.endsWith(".exe") || file.relative_path === profile.host_file);
    inventory.set(name, { relative_path: file.relative_path, bytes });
  }
  must(names.has(profile.host_file) && names.has(profile.framework_file));
  must(receipt.files.length === inventory.size);
  const receipts = new Set<string>();
  for (const raw of receipt.files) {
    closed(raw, [
      "relative_path",
      "sha256",
      "byte_size",
      "imports",
      "delay_imports",
      "forwarder_imports",
    ]);
    const entry = [...inventory.values()].find((v) => v.relative_path === raw.relative_path);
    must(entry && !receipts.has(entry.relative_path));
    receipts.add(entry.relative_path);
    const file = profile.files.find((f) => f.relative_path === entry.relative_path)!;
    const imports = inspectPeImports(entry.bytes, entry.relative_path.endsWith(".dll"));
    must(
      raw.sha256 === file.sha256 &&
        raw.byte_size === file.byte_size &&
        visualJson({
          imports: raw.imports,
          delay_imports: raw.delay_imports,
          forwarder_imports: raw.forwarder_imports,
        }) === visualJson(imports),
    );
    for (const name of [
      ...imports.imports,
      ...imports.delay_imports,
      ...imports.forwarder_imports,
    ]) {
      if (entry.relative_path === profile.host_file)
        must(
          !/^(?:ucrtbase|vcruntime[^.]*|msvcp[^.]*|msvcr[^.]*|concrt[^.]*|api-ms-win-crt-[^.]*)\.dll$/.test(
            name,
          ),
        );
      if (system.has(name)) continue;
      must(entry.relative_path !== profile.host_file); // All host startup dependencies must come from trusted System32 policy.
      const dependency = inventory.get(name);
      must(dependency);
      const parent = entry.relative_path.includes("\\") ? entry.relative_path.split("\\")[0]! : "";
      const targetParent = dependency.relative_path.includes("\\")
        ? dependency.relative_path.split("\\")[0]!
        : "";
      must(targetParent === "" || (parent === "modules" && targetParent === "modules"));
    }
  }
  const token = Object.freeze({ kind: "STATIC_HELD_PE_CLOSURE" as const });
  admissionTokens.set(token, {
    profileHash: createHash("sha256").update(visualJson(profile)).digest("hex"),
    filesHash: createHash("sha256").update(visualJson(profile.files)).digest("hex"),
  });
  return token;
}
export function requireMltPeAdmission(
  token: MltPeAdmission,
  profile: MltNativeReleaseProfile,
): void {
  const proof = admissionTokens.get(token);
  must(
    proof &&
      proof.profileHash === createHash("sha256").update(visualJson(profile)).digest("hex") &&
      proof.filesHash === createHash("sha256").update(visualJson(profile.files)).digest("hex"),
  );
}

import { createExportOperations } from "./film-export-operation";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
  symlink,
  lstat,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { writeDeliveryManifest } from "./film-delivery-manifest";
const cleanupFault = vi.hoisted(() => ({ deny: false }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown> & { rm: typeof rm }>();
  return {
    ...actual,
    rm: async (...args: Parameters<typeof rm>) => {
      if (cleanupFault.deny && String(args[0]).includes(".aivora-delivery-"))
        throw new Error("controlled cleanup denial");
      return actual.rm(...args);
    },
  };
});
const roots: string[] = [];
afterEach(async () => {
  cleanupFault.deny = false;
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const hash = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const id = () => "01234567-89ab-4cde-8fab-0123456789ab";
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "delivery-io-"));
  roots.push(root);
  const requestedDirectory = resolve(root, "output");
  await mkdir(requestedDirectory);
  // The actual publish consumer canonicalizes the picked directory before it
  // derives output paths. Windows temporary roots may use DOS 8.3 aliases.
  const directory = await realpath(requestedDirectory);
  const data = Buffer.from("known checked final bytes");
  const path = join(directory, "成片.mp4");
  await writeFile(path, data);
  return {
    root,
    data,
    path,
    input: {
      directory,
      published: [{ aspectRatio: "16:9" as const, path }],
      checked: [
        {
          aspectRatio: "16:9" as const,
          videoSha256: hash(data),
          technical: null,
          qc: {
            schemaVersion: 1 as const,
            status: "clear" as const,
            counts: { block: 0, warn: 0, info: 0 },
            integratedLufs: null,
            truePeakDbtp: null,
          },
        },
      ],
      selection: [
        {
          shotId: "shot",
          takeId: "take",
          label: "第 1 场 · 镜头 1",
          versionLabel: "第 2 版",
          startSeconds: 0,
          endSeconds: 2,
        },
      ],
      settings: {
        aspects: ["16:9" as const],
        quality: "720p" as const,
        subtitles: "none" as const,
        style: "white" as const,
        aiMark: true,
      },
      unverified: ["台词是否说完未检查。"],
      complete: true,
      now: 1000,
      assertCurrent: vi.fn(async () => undefined),
    },
  };
}
it("writes exclusive actual-byte evidence without paths, tokens, or inferred technical values", async () => {
  const f = await fixture();
  f.input.assertCurrent = vi.fn(async () => {
    const stage = (await readdir(f.input.directory)).filter((name) =>
      name.startsWith(".aivora-delivery-"),
    );
    expect(stage).toHaveLength(1);
    expect((await lstat(join(f.input.directory, stage[0]!), { bigint: true })).dev).toBe(
      (await lstat(f.input.directory, { bigint: true })).dev,
    );
  });
  const result = await writeDeliveryManifest(f.input, id);
  expect(result.kind).toBe("WRITTEN");
  if (result.kind !== "WRITTEN") throw new Error("evidence required");
  const bytes = await readFile(join(f.input.directory, result.fileName));
  expect(hash(bytes)).toBe(result.manifestSha256);
  expect(JSON.parse(bytes.toString())).toEqual(result.manifest);
  expect(result.manifest.files).toEqual([
    {
      role: "video",
      aspectRatio: "16:9",
      fileName: "成片.mp4",
      sha256: hash(f.data),
      bytes: f.data.length,
      technical: null,
      qc: f.input.checked[0]!.qc,
    },
  ]);
  expect(result.manifest.settings.autoAdjustVolume).toBe(false);
  expect(JSON.stringify(result)).not.toContain(f.root);
  expect(JSON.stringify(result)).not.toContain("qcReceipt");
  expect(result.manifest.unverified.join()).toContain("未知");
  expect(await readFile(f.path)).toEqual(f.data);
  expect(
    (await readdir(f.input.directory)).filter((name) => name.startsWith(".aivora-delivery-")),
  ).toEqual([]);
});
it("lists only actual partial sidecars and refuses a false complete status", async () => {
  const f = await fixture();
  const input = {
    ...f.input,
    checked: [{ ...f.input.checked[0]!, subtitleSha256: "a".repeat(64) }],
  };
  expect(await writeDeliveryManifest(input, id)).toMatchObject({
    kind: "FAILED",
    code: "EVIDENCE_UNAVAILABLE",
  });
  const result = await writeDeliveryManifest({ ...input, complete: false }, id);
  expect(result.kind).toBe("WRITTEN");
  if (result.kind !== "WRITTEN") throw new Error("partial evidence required");
  expect(result.manifest.status).toBe("partial");
  expect(result.manifest.files.map((file) => file.role)).toEqual(["video"]);
  expect(result.manifest.unverified.join()).toContain("未完成交付");
});
it("rejects modified bytes and preserves the file instead of issuing checked evidence", async () => {
  const f = await fixture();
  await writeFile(f.path, "different bytes");
  const result = await writeDeliveryManifest(f.input, id);
  expect(result).toEqual({
    kind: "FAILED",
    code: "EVIDENCE_UNAVAILABLE",
    files: [{ role: "video", aspectRatio: "16:9", fileName: "成片.mp4" }],
  });
  expect(await readFile(f.path, "utf8")).toBe("different bytes");
  expect(await readdir(f.input.directory)).toEqual(["成片.mp4"]);
});
it("rechecks file identity after the final current-project guard", async () => {
  const f = await fixture();
  f.input.assertCurrent = vi.fn(async () => {
    await writeFile(f.path, "same length changed data");
  });
  expect(await writeDeliveryManifest(f.input, id)).toMatchObject({
    kind: "FAILED",
    code: "EVIDENCE_UNAVAILABLE",
  });
  expect(
    (await readdir(f.input.directory)).filter((name) => name.startsWith(".aivora-delivery-")),
  ).toEqual([]);
  expect(await readdir(f.input.directory)).toEqual(["成片.mp4"]);
});
it("never overwrites an existing manifest or deletes existing user video", async () => {
  const f = await fixture(),
    target = join(f.input.directory, `aivora-delivery-${id()}.json`);
  await writeFile(target, "original user manifest");
  expect(await writeDeliveryManifest(f.input, id)).toMatchObject({
    kind: "FAILED",
    code: "EVIDENCE_WRITE_FAILED",
  });
  expect(await readFile(target, "utf8")).toBe("original user manifest");
  expect(await readFile(f.path)).toEqual(f.data);
  expect(
    (await readdir(f.input.directory)).filter((name) => name.startsWith(".aivora-delivery-")),
  ).toEqual([]);
});
it("does not commit a manifest after input changes or accepted cancellation", async () => {
  const f = await fixture();
  f.input.assertCurrent = vi.fn(async () => {
    throw new Error("PROJECT_CHANGED");
  });
  expect(await writeDeliveryManifest(f.input, id)).toMatchObject({
    kind: "FAILED",
    code: "EVIDENCE_UNAVAILABLE",
  });
  const controller = new AbortController();
  const work = {
    signal: controller.signal,
    phase: vi.fn(),
    cancellable: vi.fn(),
    published: vi.fn(),
    retract: vi.fn(),
    track: <T>(task: Promise<T>) => task,
  };
  const result = await writeDeliveryManifest(
    {
      ...f.input,
      work,
      assertCurrent: async () => {
        controller.abort();
      },
    },
    id,
  );
  expect(result).toMatchObject({ kind: "FAILED", code: "EVIDENCE_UNAVAILABLE" });
  expect(await readdir(f.input.directory)).toEqual(["成片.mp4"]);
  expect(
    (await readdir(f.input.directory)).filter((name) => name.startsWith(".aivora-delivery-")),
  ).toEqual([]);
  expect(await readFile(f.path)).toEqual(f.data);
});
it("refuses escaped or symlink file references without exposing the target path", async () => {
  const f = await fixture(),
    outside = join(f.root, "outside.mp4"),
    alias = join(f.input.directory, "alias.mp4");
  await writeFile(outside, f.data);
  await symlink(outside, alias);
  const result = await writeDeliveryManifest(
    { ...f.input, published: [{ aspectRatio: "16:9", path: alias }] },
    id,
  );
  expect(result).toEqual({ kind: "FAILED", code: "EVIDENCE_UNAVAILABLE", files: [] });
  expect(JSON.stringify(result)).not.toContain(outside);
  expect(await readFile(outside)).toEqual(f.data);
});

it("preserves the written file fact but never confirms cleanup after a real owned-directory rm failure", async () => {
  const f = await fixture(),
    controller = new AbortController();
  const cleanupUnconfirmed = vi.fn();
  const work = {
    signal: controller.signal,
    phase: vi.fn(),
    cancellable: vi.fn(),
    published: vi.fn(),
    retract: vi.fn(),
    track: <T>(task: Promise<T>) => task,
    cleanupUnconfirmed,
  };
  cleanupFault.deny = true;
  const result = await writeDeliveryManifest({ ...f.input, work }, id);
  expect(result).toMatchObject({ kind: "WRITTEN", cleanupUnconfirmed: true });
  if (result.kind !== "WRITTEN") throw new Error("actual written fact required");
  const written = await readFile(join(f.input.directory, result.fileName));
  expect(hash(written)).toBe(result.manifestSha256);
  expect(JSON.parse(written.toString())).toEqual(result.manifest);
  expect(cleanupUnconfirmed).toHaveBeenCalledOnce();
  expect(
    (await readdir(f.input.directory)).filter((name) => name.startsWith(".aivora-delivery-")),
  ).toHaveLength(1);
  // The manifest can physically exist: an uncertain result must not claim it was absent.
  expect(
    JSON.parse(await readFile(join(f.input.directory, `aivora-delivery-${id()}.json`), "utf8"))
      .schemaVersion,
  ).toBe(1);
  expect(await readFile(f.path)).toEqual(f.data);
});

it("keeps an accepted stop unconfirmed if owned JSON staging cannot be cleaned", async () => {
  const f = await fixture();
  const views: { cancelState: string }[] = [];
  const operations = createExportOperations((_owner, value) => views.push(value));
  const operation = operations.begin("owner", "project", "staging-stop");
  if (!operation) throw new Error("operation required");
  cleanupFault.deny = true;
  const result = await writeDeliveryManifest(
    {
      ...f.input,
      work: operation.work,
      assertCurrent: async () => {
        expect(operations.cancel("owner", "staging-stop").kind).toBe("REQUESTED");
      },
    },
    id,
  );
  expect(result).toMatchObject({
    kind: "FAILED",
    code: "EVIDENCE_UNAVAILABLE",
    cleanupUnconfirmed: true,
  });
  await operation.finish("partial");
  expect(views.at(-1)?.cancelState).toBe("unavailable");
  expect(views.some((view) => view.cancelState === "stopped")).toBe(false);
  expect((await readdir(f.input.directory)).filter((name) => name.endsWith(".json"))).toEqual([]);
  expect(await readFile(f.path)).toEqual(f.data);
});

it("mirrors main canonicalization for a real directory alias without relaxing the noncanonical gate", async () => {
  const f = await fixture();
  const alias = join(f.root, "output-alias");
  await symlink(f.input.directory, alias, "junction");
  const aliasFile = join(alias, "成片.mp4");
  const before = await lstat(f.path, { bigint: true });
  const aliasIdentity = await lstat(aliasFile, { bigint: true });
  expect([aliasIdentity.dev, aliasIdentity.ino, aliasIdentity.size]).toEqual([
    before.dev,
    before.ino,
    before.size,
  ]);
  expect(await readFile(aliasFile)).toEqual(f.data);
  // This is the pre-fix fixture shape: resolve() alone does not establish
  // the canonical directory required by the main-only manifest function.
  expect(
    await writeDeliveryManifest(
      {
        ...f.input,
        directory: resolve(alias),
        published: [{ aspectRatio: "16:9", path: aliasFile }],
      },
      id,
    ),
  ).toEqual({
    kind: "FAILED",
    code: "EVIDENCE_UNAVAILABLE",
    files: [],
  });
  expect(await realpath(resolve(alias))).not.toBe(resolve(alias));
  expect(f.input.assertCurrent).not.toHaveBeenCalled();
  const canonical = await realpath(alias);
  const result = await writeDeliveryManifest(
    {
      ...f.input,
      directory: canonical,
      published: [{ aspectRatio: "16:9", path: join(canonical, "成片.mp4") }],
    },
    id,
  );
  expect(result.kind).toBe("WRITTEN");
  if (result.kind !== "WRITTEN") throw new Error("actual canonical evidence required");
  expect(result.manifest.files).toHaveLength(1);
  expect(result.manifest.files[0]).toMatchObject({ sha256: hash(f.data), bytes: f.data.length });
  expect(hash(await readFile(join(canonical, result.fileName)))).toBe(result.manifestSha256);
  const after = await lstat(aliasFile, { bigint: true });
  expect([after.dev, after.ino, after.size]).toEqual([before.dev, before.ino, before.size]);
  expect(await readFile(f.path)).toEqual(f.data);
});

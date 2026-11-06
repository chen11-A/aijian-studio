import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, rm, copyFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { verifiedQcTools, loadQcEngine } from "./film-export-qc-runtime";
const roots: string[] = [];
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "qc-runtime-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
describe("fixed QC runtime", () => {
  it("hashes both tools before any process execution and preserves development-only licence policy", async () => {
    const root = await setup();
    const suffix = process.platform === "win32" ? ".exe" : "";
    await writeFile(join(root, `ffmpeg${suffix}`), "one");
    await writeFile(join(root, `ffprobe${suffix}`), "two");
    const hash = (text: string) => createHash("sha256").update(text).digest("hex");
    const lock = {
      schema_version: 1,
      expected_version: "7.1.5",
      profiles: [
        {
          ffmpeg_sha256: hash("one"),
          ffprobe_sha256: hash("wrong"),
          license_class: "GPL",
          distribution_status: "DEVELOPMENT_ONLY",
        },
      ],
    };
    const path = join(root, "lock.json");
    await writeFile(path, JSON.stringify(lock));
    const version = vi.fn(
      async (binary: string) =>
        `${binary.includes("ffprobe") ? "ffprobe" : "ffmpeg"} version 7.1.5-test\nconfiguration: --enable-gpl`,
    );
    await expect(verifiedQcTools(root, path, process.platform, version)).rejects.toThrow(
      "TOOLS_UNAVAILABLE",
    );
    expect(version).not.toHaveBeenCalled();
    lock.profiles[0]!.ffprobe_sha256 = hash("two");
    await writeFile(path, JSON.stringify(lock));
    const tools = await verifiedQcTools(root, path, process.platform, version);
    expect(tools.ffmpegPath).toMatch(/ffmpeg/);
    expect(version).toHaveBeenCalledTimes(2);
    lock.profiles[0]!.distribution_status = "RELEASE_REVIEW_REQUIRED";
    await writeFile(path, JSON.stringify(lock));
    version.mockClear();
    await expect(verifiedQcTools(root, path, process.platform, version)).rejects.toThrow(
      "TOOLS_UNAVAILABLE",
    );
    expect(version).not.toHaveBeenCalled();
  });
  it("rejects mismatched executable version after pinned hashes and never resolves ambient PATH", async () => {
    const root = await setup();
    const suffix = process.platform === "win32" ? ".exe" : "";
    const hash = createHash("sha256").update("tool").digest("hex");
    for (const name of ["ffmpeg", "ffprobe"]) await writeFile(join(root, name + suffix), "tool");
    const lock = join(root, "lock.json");
    await writeFile(
      lock,
      JSON.stringify({
        schema_version: 1,
        expected_version: "7.1.5",
        profiles: [
          {
            ffmpeg_sha256: hash,
            ffprobe_sha256: hash,
            license_class: "LGPL",
            distribution_status: "DEVELOPMENT_ONLY",
          },
        ],
      }),
    );
    await expect(
      verifiedQcTools(root, lock, process.platform, async () => "ffmpeg version 8.0.0"),
    ).rejects.toThrow("TOOLS_UNAVAILABLE");
    await expect(verifiedQcTools(join(root, "absent"), lock)).rejects.toThrow();
  });
  it("loads the original QC engine from a collected resource layout without repository module lookup", async () => {
    const root = await setup();
    const resources = join(root, "resources", "qc");
    await mkdir(resources, { recursive: true });
    for (const name of ["index.mjs", "media.mjs", "rules.mjs", "subtitles.mjs"])
      await copyFile(resolve("../../packages/aivora-qc", name), join(resources, name));
    expect(await loadQcEngine(resources)).toBeTypeOf("function");
    await rm(join(resources, "rules.mjs"));
    await expect(loadQcEngine(resources)).rejects.toThrow();
  });
});

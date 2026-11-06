import { afterEach, expect, it } from "vitest";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveBundledAudioLibraryRoot } from "./film-audio-library-root";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "audio-root-"));
  roots.push(root);
  const mainDir = join(root, "apps", "desktop", "dist"),
    resourcesPath = join(root, "electron", "resources"),
    portable = join(root, "audio-library"),
    development = join(mainDir, "audio-library");
  await mkdir(mainDir, { recursive: true });
  const marker = async (folder: string, changes: Record<string, unknown> = {}) => {
    await mkdir(folder, { recursive: true });
    await writeFile(
      join(folder, "resource-index.json"),
      JSON.stringify({
        schemaVersion: 1,
        createdBy: "aivora-bundled-audio-builder",
        assetCount: 206,
        manifestSha256: "a".repeat(64),
        loaderSha256: "b".repeat(64),
        files: [{ path: "manifest.json", sha256: "a".repeat(64) }],
        ...changes,
      }),
    );
  };
  return { root, mainDir, resourcesPath, portable, development, marker };
}
it("uses packaged resources exclusively even when portable and development bundles exist", async () => {
  const f = await fixture();
  await f.marker(f.portable);
  await f.marker(f.development);
  expect(resolveBundledAudioLibraryRoot({ ...f, isPackaged: true })).toBe(
    join(f.resourcesPath, "audio-library"),
  );
});
it("recognizes the actual Linux electron-directory layout by its built index", async () => {
  const f = await fixture();
  await f.marker(f.portable);
  await f.marker(f.development);
  expect(resolveBundledAudioLibraryRoot({ ...f, isPackaged: false })).toBe(f.portable);
});
it("does not mistake raw assets, an empty portable directory or a malformed index for a built bundle", async () => {
  const f = await fixture();
  await mkdir(join(f.root, "assets", "audio-library"), { recursive: true });
  await writeFile(join(f.root, "assets", "audio-library", "manifest.json"), "[]");
  await mkdir(f.portable);
  expect(resolveBundledAudioLibraryRoot({ ...f, isPackaged: false })).toBe(f.development);
  for (const change of [
    { createdBy: "raw-source" },
    { manifestSha256: "invalid" },
    { assetCount: 0 },
    { files: [] },
  ]) {
    await f.marker(f.portable, change);
    expect(resolveBundledAudioLibraryRoot({ ...f, isPackaged: false })).toBe(f.development);
  }
});

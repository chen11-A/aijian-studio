import { afterEach, expect, it } from "vitest";
import { mkdtemp, copyFile, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { loadProjectArchiveEngine } from "./film-project-archive-runtime";
const folders: string[] = [];
afterEach(async () => {
  for (const f of folders.splice(0)) await rm(f, { recursive: true, force: true });
});
it("loads the same standalone shipped module from a resources-shaped directory without repository imports", async () => {
  const root = await mkdtemp(join(tmpdir(), "archive-resource-"));
  folders.push(root);
  const resources = join(root, "resources", "project-archive");
  await mkdir(resources, { recursive: true });
  await copyFile(
    resolve("../../packages/aivora-media/archive.mjs"),
    join(resources, "archive.mjs"),
  );
  const engine = await loadProjectArchiveEngine(resources);
  const source = join(root, "project");
  await mkdir(source);
  await writeFile(join(source, "project.json"), '{"title":"打包资源核验"}');
  const zip = await engine.archiveProject({
    projectDir: source,
    output: join(root, "project.zip"),
  });
  const restored = await engine.restoreProject({
    archive: zip,
    destination: join(root, "restored"),
  });
  expect(JSON.parse(await readFile(join(restored, "project.json"), "utf8"))).toEqual({
    title: "打包资源核验",
  });
  await expect(loadProjectArchiveEngine(join(root, "missing"))).rejects.toThrow();
});

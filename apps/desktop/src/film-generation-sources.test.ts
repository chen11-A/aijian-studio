import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generationImageSources } from "./film-generation-sources";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "aivora-generation-sources-"));
  roots.push(root);
  const filmsRoot = join(root, "films"),
    storyFilmsRoot = join(root, "story");
  const episode = join(filmsRoot, "series", "episodes", "current");
  for (const path of [
    episode,
    storyFilmsRoot,
    join(filmsRoot, "series", "media"),
    join(filmsRoot, "series", "stills"),
    join(filmsRoot, "series", "episodes", "foreign"),
  ])
    await mkdir(path, { recursive: true });
  const storySourceOwner = vi.fn(async () => false);
  const host = {
    filmsRoot,
    storyFilmsRoot,
    seriesId: "series",
    projectId: "current",
    backendProjectId: "prj_bound",
    storySourceOwner,
  };
  return { root, episode, host };
}

describe("generation image byte snapshots", () => {
  it("materializes only actual current/shared images and rechecks the original bytes", async () => {
    const f = await fixture(),
      path = join(f.episode, "frame.png");
    const bytes = Buffer.from("original image bytes");
    await writeFile(path, bytes);
    const pool = await generationImageSources(f.host);
    const captured = await pool.capture(path);
    expect(captured.sha256).toBe(hash(bytes));
    expect(await pool.materialize([path, path])).toEqual([captured.dataUrl, captured.dataUrl]);
    expect(pool.identities()).toHaveLength(1);
    const preview = `data:image/png;base64,${Buffer.alloc(5000, 1).toString("base64")}`;
    expect((await pool.capture(preview)).sha256).toBe(hash(Buffer.alloc(5000, 1)));
    expect(await pool.materialize([preview])).toEqual([preview]);

    await pool.verify();
    await writeFile(path, Buffer.from("changed image bytes!"));
    await expect(pool.verify()).rejects.toThrow("SOURCE_UNVERIFIABLE");
    expect(f.host.storySourceOwner).not.toHaveBeenCalled();
  });

  it("rejects foreign episode and aliases that change after capture without changing either source", async () => {
    const f = await fixture(),
      first = join(f.episode, "first.png"),
      second = join(f.episode, "other.png");
    const foreign = join(f.host.filmsRoot, "series", "episodes", "foreign", "frame.png");
    await Promise.all([
      writeFile(first, "first"),
      writeFile(second, "other"),
      writeFile(foreign, "foreign"),
    ]);
    const pool = await generationImageSources(f.host);
    await expect(pool.capture(foreign)).rejects.toThrow("SOURCE_UNVERIFIABLE");
    const alias = join(f.episode, "alias.png");
    await symlink(first, alias);
    await pool.capture(alias);
    await rm(alias);
    await symlink(second, alias);
    await expect(pool.verify()).rejects.toThrow("SOURCE_UNVERIFIABLE");
    expect(await readFile(first, "utf8")).toBe("first");
    expect(await readFile(second, "utf8")).toBe("other");
  });

  it("requires actual story owner on every verification and keeps fixed byte bounds", async () => {
    const f = await fixture(),
      path = join(f.host.storyFilmsRoot, "owned.png");
    await writeFile(path, "owned");
    const pool = await generationImageSources(f.host);
    await expect(pool.capture(path)).rejects.toThrow("SOURCE_UNVERIFIABLE");
    f.host.storySourceOwner.mockResolvedValue(true);
    const info = await pool.capture(path);
    expect(f.host.storySourceOwner).toHaveBeenLastCalledWith(
      "prj_bound",
      info.path,
      hash(Buffer.from("owned")),
    );
    f.host.storySourceOwner.mockResolvedValue(false);
    await expect(pool.verify()).rejects.toThrow("SOURCE_UNVERIFIABLE");
    const huge = join(f.episode, "huge.png");
    await writeFile(huge, Buffer.alloc(12_000_001));
    await expect(pool.capture(huge)).rejects.toThrow("SOURCE_UNVERIFIABLE");
    await expect(pool.capture("data:image/png;base64,YQ")).rejects.toThrow("SOURCE_UNVERIFIABLE");
  });
});

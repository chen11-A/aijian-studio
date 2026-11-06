import { expect, it, vi } from "vitest";
import * as fs from "node:fs";
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join, sep } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { storyFilmQcOwner } from "./film-export-qc-ownership";
vi.mock("node:fs", async (importActual) => {
  const actual = await importActual<typeof fs>();
  const walker = vi.fn(actual.realpathSync);
  Object.assign(walker, { native: actual.realpathSync.native });
  return { ...actual, realpathSync: walker };
});
it("keeps exact owner/hash/file identity when stored DOS-style names meet native callers", async () => {
  const root = await mkdtemp(join(tmpdir(), "qc-native-owner-"));
  try {
    const long = join(root, "实际 中文目录"),
      alias = join(root, "DOSALI~1");
    await mkdir(long);
    await symlink(long, alias, process.platform === "win32" ? "junction" : "dir");
    const source = join(long, "clean 副本.mp4"),
      foreign = join(long, "same-bytes-other-file.mp4"),
      bytes = "unique clean bytes";
    await writeFile(source, bytes);
    await writeFile(foreign, bytes);
    const actual = await vi.importActual<typeof fs>("node:fs"),
      walker = vi
        .mocked(fs.realpathSync)
        .mockImplementation((path, options) =>
          typeof path === "string" && (path === alias || path.startsWith(alias + sep))
            ? path
            : actual.realpathSync(path, options),
        );
    Object.assign(walker, { native: actual.realpathSync.native });
    const database = join(root, "workspace.sqlite3"),
      project = `prj_${"a".repeat(32)}`,
      hash = createHash("sha256").update(bytes).digest("hex"),
      db = new DatabaseSync(database);
    db.exec(
      "CREATE TABLE draft_export_jobs(project_id TEXT,status TEXT,output_path TEXT,output_sha256 TEXT)",
    );
    db.prepare("INSERT INTO draft_export_jobs VALUES(?,?,?,?)").run(
      project,
      "SUCCEEDED",
      join(alias, "clean 副本.mp4"),
      hash,
    );
    db.close();
    expect(storyFilmQcOwner(database, project, await realpath(source), hash)).toBe(true);
    expect(storyFilmQcOwner(database, project, await realpath(foreign), hash)).toBe(false);
    expect(storyFilmQcOwner(database, `prj_${"b".repeat(32)}`, await realpath(source), hash)).toBe(
      false,
    );
    expect(storyFilmQcOwner(database, project, await realpath(source), "c".repeat(64))).toBe(false);
  } finally {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  }
});

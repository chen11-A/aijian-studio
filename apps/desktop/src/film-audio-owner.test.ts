import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { storyFilmAudioOwner } from "./film-audio-owner";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
it("proves exact selected assembly audio SHA and project without guessing from filenames or writing the database", async () => {
  const root = await mkdtemp(join(tmpdir(), "mix-owner-"));
  roots.push(root);
  const databasePath = join(root, "db.sqlite3"),
    path = join(root, "selected.mp4");
  await writeFile(path, "original final bytes");
  const sha = (value: string) => createHash("sha256").update(value).digest("hex"),
    project = `prj_${"a".repeat(32)}`;
  const db = new DatabaseSync(databasePath);
  db.exec(
    "CREATE TABLE artifacts(artifact_id TEXT,project_id TEXT,episode_id TEXT,artifact_type TEXT);CREATE TABLE artifact_versions(version_id TEXT,artifact_id TEXT,content_json TEXT,content_hash TEXT);CREATE TABLE draft_export_jobs(operation_id TEXT,project_id TEXT,episode_id TEXT,assembly_version_id TEXT,status TEXT,output_path TEXT,assembly_content_hash TEXT);CREATE TABLE media_assets(id TEXT,project_id TEXT,deleted_at TEXT);CREATE TABLE media_asset_versions(id TEXT,asset_id TEXT,project_id TEXT,sha256 TEXT)",
  );
  db.prepare("INSERT INTO artifacts VALUES(?,?,?,?)").run(
    "assembly",
    project,
    "episode",
    "episode_media_assembly",
  );
  db.prepare("INSERT INTO artifact_versions VALUES(?,?,?,?)").run(
    "assembly-version",
    "assembly",
    JSON.stringify({
      audio_segments: [{ media: { asset_id: "voice", asset_version_id: "voice-version" } }],
    }),
    "assembly-hash",
  );
  db.prepare("INSERT INTO artifacts VALUES(?,?,?,?)").run("film", project, null, "story_film");
  db.prepare("INSERT INTO artifact_versions VALUES(?,?,?,?)").run(
    "film-version",
    "film",
    JSON.stringify({
      output_sha256: sha("original final bytes"),
      assembly_version_id: "assembly-version",
      assembly_content_hash: "assembly-hash",
      draft_operation_id: "draft",
    }),
    "film-hash",
  );
  db.prepare("INSERT INTO draft_export_jobs VALUES(?,?,?,?,?,?,?)").run(
    "draft",
    project,
    "episode",
    "assembly-version",
    "SUCCEEDED",
    path,
    "assembly-hash",
  );
  for (const [id, contents] of [
    ["voice", "selected audio"],
    ["other", "other audio"],
  ] as const) {
    db.prepare("INSERT INTO media_assets VALUES(?,?,?)").run(id, project, null);
    db.prepare("INSERT INTO media_asset_versions VALUES(?,?,?,?)").run(
      `${id}-version`,
      id,
      project,
      sha(contents!),
    );
  }
  db.close();
  const before = await readFile(databasePath),
    source = { path, sha: sha("original final bytes") };
  expect(storyFilmAudioOwner(databasePath, project, sha("selected audio"), source)).toBe(true);
  expect(storyFilmAudioOwner(databasePath, project, sha("other audio"), source)).toBe(false);
  expect(
    storyFilmAudioOwner(databasePath, `prj_${"b".repeat(32)}`, sha("selected audio"), source),
  ).toBe(false);
  expect(storyFilmAudioOwner(databasePath, project, sha("changed audio"), source)).toBe(false);
  expect(
    storyFilmAudioOwner(databasePath, project, sha("selected audio"), {
      ...source,
      sha: sha("changed video"),
    }),
  ).toBe(false);
  expect(storyFilmAudioOwner(databasePath, project, sha("other audio"))).toBe(true); // global project library, not a claimed selected voice
  expect(await readFile(databasePath)).toEqual(before);
  expect(await readFile(path, "utf8")).toBe("original final bytes");
});

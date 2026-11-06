import { expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { storyFilmQcOwner } from "./film-export-qc-ownership";
it("requires exact read-only project, digest and successful path evidence, failing closed on missing schema", async () => {
  const root = await mkdtemp(join(tmpdir(), "qc-owner-"));
  try {
    const path = join(root, "workspace.sqlite3"),
      project = `prj_${"a".repeat(32)}`,
      other = `prj_${"b".repeat(32)}`,
      sha = "c".repeat(64);
    const db = new DatabaseSync(path);
    db.exec(
      "CREATE TABLE draft_export_jobs(project_id TEXT,status TEXT,output_path TEXT,output_sha256 TEXT);CREATE TABLE artifacts(artifact_id TEXT,project_id TEXT,artifact_type TEXT,episode_id TEXT);CREATE TABLE artifact_versions(artifact_id TEXT,content_json TEXT,version_id TEXT);",
    );
    db.prepare("INSERT INTO draft_export_jobs VALUES(?,?,?,?)").run(
      project,
      "SUCCEEDED",
      "/trusted/clean.mp4",
      sha,
    );
    db.prepare("INSERT INTO artifacts VALUES(?,?,?,?)").run("story", project, "story_film", null);
    db.prepare("INSERT INTO artifacts VALUES(?,?,?,?)").run(
      "assembly",
      project,
      "episode_media_assembly",
      "episode-one",
    );
    db.prepare("INSERT INTO artifact_versions VALUES(?,?,?)").run("assembly", "{}", "assembly-one");
    db.prepare("INSERT INTO artifact_versions VALUES(?,?,?)").run(
      "story",
      JSON.stringify({ output_sha256: "e".repeat(64), assembly_version_id: "assembly-one" }),
      "story-one",
    );
    db.prepare("INSERT INTO artifact_versions VALUES(?,?,?)").run(
      "story",
      JSON.stringify({ output_sha256: "f".repeat(64), assembly_version_id: "absent" }),
      "bad-story",
    );
    db.close();
    expect(storyFilmQcOwner(path, project, "/trusted/clean.mp4", sha)).toBe(true);
    expect(storyFilmQcOwner(path, project, "/trusted/source.mp4", "e".repeat(64))).toBe(true);
    expect(storyFilmQcOwner(path, project, "/trusted/source.mp4", "f".repeat(64))).toBe(false);
    expect(storyFilmQcOwner(path, other, "/trusted/clean.mp4", sha)).toBe(false);
    expect(storyFilmQcOwner(path, project, "/foreign/clean.mp4", sha)).toBe(false);
    expect(storyFilmQcOwner(path, project, "/trusted/clean.mp4", "d".repeat(64))).toBe(false);
    expect(storyFilmQcOwner(join(root, "absent.sqlite3"), project, "/trusted/clean.mp4", sha)).toBe(
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

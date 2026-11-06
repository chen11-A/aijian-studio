import { afterEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve, delimiter } from "node:path";
import { existsSync } from "node:fs";
import { loadQcEngine, loadQcRunner, verifiedQcTools } from "./film-export-qc-runtime";
import { createFilmExportQc } from "./film-export-qc";
import { storyFilmQcOwner } from "./film-export-qc-ownership";
import { createHash } from "node:crypto";
import { createCleanCopyRecovery, cleanRecoverySelectionHash } from "./clean-copy-recovery";
import { readProject, writeProject } from "./film-library";
import { originalCleanRecoveryProof, finalCleanRecoveryProof } from "./clean-copy-recovery-proof";
const roots: string[] = [];
afterEach(async () => {
  for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true });
});
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "clean-recovery-"));
  roots.push(root);
  const filmsRoot = join(root, "films"),
    storyFilmsRoot = join(root, "story"),
    databasePath = join(root, "db.sqlite3");
  await mkdir(storyFilmsRoot);
  const video = join(storyFilmsRoot, "original.mp4"),
    old = join(storyFilmsRoot, "old-clean.mp4"),
    clean = join(storyFilmsRoot, "new-clean.mp4"),
    project = `prj_${"a".repeat(32)}`;
  await writeFile(video, "original post-tag");
  await writeFile(old, "old clean without proof");
  const db = new DatabaseSync(databasePath);
  db.exec(
    "CREATE TABLE artifacts(artifact_id TEXT PRIMARY KEY,project_id TEXT,episode_id TEXT,artifact_type TEXT);CREATE TABLE artifact_versions(version_id TEXT PRIMARY KEY,artifact_id TEXT,content_json TEXT,content_hash TEXT);CREATE TABLE draft_export_jobs(operation_id TEXT,project_id TEXT,episode_id TEXT,assembly_version_id TEXT,status TEXT,output_path TEXT,output_sha256 TEXT,assembly_content_hash TEXT)",
  );
  const artifact = (
    id: string,
    type: string,
    version: string,
    content: unknown,
    episode: string | null = "episode",
    owner = project,
  ) => {
    db.prepare("INSERT INTO artifacts VALUES(?,?,?,?)").run(id, owner, episode, type);
    db.prepare("INSERT INTO artifact_versions VALUES(?,?,?,?)").run(
      version,
      id,
      JSON.stringify(content),
      `${version}-hash`,
    );
  };
  artifact("assembly", "episode_media_assembly", "assembly-version", {});
  artifact(
    "film",
    "story_film",
    "film-version",
    {
      output_sha256: hash("original post-tag"),
      assembly_version_id: "assembly-version",
      assembly_content_hash: "assembly-version-hash",
      draft_operation_id: "draft",
    },
    null,
  );
  db.prepare("INSERT INTO draft_export_jobs VALUES(?,?,?,?,?,?,?,?)").run(
    "draft",
    project,
    "episode",
    "assembly-version",
    "SUCCEEDED",
    video,
    "old-pretag-sha",
    "assembly-version-hash",
  );
  const record = await writeProject(filmsRoot, {
    id: "film_recovery00000001",
    seriesId: "film_recoveryseries01",
    backendProjectId: project,
    shots: [
      {
        id: "shot",
        selectedTakeId: "take",
        takes: [
          { id: "take", shotId: "shot", status: "done", videoPath: video, cleanVideoPath: old },
        ],
      },
    ],
  });
  const proof = () =>
    artifact("clean", "story_film_clean_copy", "clean-version", {
      output_path: clean,
      output_sha256: hash("new tagged clean"),
      assembly_version_id: "assembly-version",
      assembly_content_hash: "assembly-version-hash",
    });
  const remake = vi.fn(async () => {
    await writeFile(clean, "new tagged clean");
    proof();
    return { data: { status: "SUCCEEDED", clean_output_path: clean } };
  });
  const host = { filmsRoot, storyFilmsRoot, databasePath, remake };
  const input = {
    projectId: record.id,
    shotId: "shot",
    takeId: "take",
    selectionHash: cleanRecoverySelectionHash(video, old),
  };
  return {
    root,
    db,
    host,
    input,
    record,
    project,
    video,
    old,
    clean,
    remake,
    proof,
    close: () => db.close(),
  };
}
it("explicitly rebuilds from verified original proof, saves by CAS, and retains both original files", async () => {
  const f = await fixture();
  try {
    const result = await createCleanCopyRecovery(f.host)(f.input);
    expect(result.kind).toBe("RECOVERED");
    expect(f.remake).toHaveBeenCalledWith(f.project, f.video, {
      sha256: hash("original post-tag"),
      assemblyVersionId: "assembly-version",
    });
    const stored = await readProject(f.host.filmsRoot, f.record.id);
    expect(JSON.stringify(stored)).toContain(f.clean);
    expect(await readFile(f.video, "utf8")).toBe("original post-tag");
    expect(await readFile(f.old, "utf8")).toBe("old clean without proof");
    expect(f.db.prepare("SELECT output_sha256 FROM draft_export_jobs").get()?.output_sha256).toBe(
      "old-pretag-sha",
    );
    expect(
      finalCleanRecoveryProof(f.host.databasePath, f.project, f.clean, hash("new tagged clean")),
    ).toBe(true);
  } finally {
    f.close();
  }
});
it.each(["owner", "sha", "assembly", "path"])(
  "refuses wrong original %s before any local rebuild",
  async (kind) => {
    const f = await fixture();
    try {
      if (kind === "owner")
        f.db
          .prepare("UPDATE artifacts SET project_id=? WHERE artifact_id='film'")
          .run(`prj_${"b".repeat(32)}`);
      if (kind === "sha") await writeFile(f.video, "changed");
      if (kind === "assembly")
        f.db
          .prepare(
            "UPDATE artifact_versions SET content_hash='wrong' WHERE version_id='assembly-version'",
          )
          .run();
      if (kind === "path") {
        const different = join(f.host.storyFilmsRoot, "other.mp4");
        await writeFile(different, "original post-tag");
        f.db.prepare("UPDATE draft_export_jobs SET output_path=?").run(different);
      }
      expect(await createCleanCopyRecovery(f.host)(f.input)).toEqual({
        kind: "FAILED",
        code: "SOURCE_UNVERIFIED",
      });
      expect(f.remake).not.toHaveBeenCalled();
    } finally {
      f.close();
    }
  },
);
it("does not replace old copy without final post-tag evidence", async () => {
  const f = await fixture();
  try {
    f.remake.mockImplementationOnce(async () => {
      await writeFile(f.clean, "new tagged clean");
      return { data: { status: "SUCCEEDED", clean_output_path: f.clean } };
    });
    expect(await createCleanCopyRecovery(f.host)(f.input)).toEqual({
      kind: "FAILED",
      code: "EVIDENCE_FAILED",
    });
    expect(JSON.stringify(await readProject(f.host.filmsRoot, f.record.id))).toContain(f.old);
  } finally {
    f.close();
  }
});
it("refuses intervening persisted edits and duplicate requests without overwriting or replaying", async () => {
  const f = await fixture();
  try {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = f.remake.getMockImplementation()!;
    f.remake.mockImplementationOnce(async () => {
      await gate;
      return original();
    });
    const recover = createCleanCopyRecovery(f.host);
    const pending = recover(f.input);
    await expect.poll(() => f.remake.mock.calls.length).toBe(1);
    expect(await recover(f.input)).toEqual({ kind: "FAILED", code: "BUSY" });
    await writeProject(f.host.filmsRoot, { ...f.record, title: "changed while waiting" });
    release();
    expect(await pending).toEqual({ kind: "FAILED", code: "PROJECT_CHANGED" });
    const stored = await readProject(f.host.filmsRoot, f.record.id);
    expect(stored?.title).toBe("changed while waiting");
    expect(JSON.stringify(stored)).toContain(f.old);
  } finally {
    f.close();
  }
});
it("does not call a no-subtitles original a newly restored proof", async () => {
  const f = await fixture();
  try {
    f.remake.mockResolvedValueOnce({ data: { status: "SUCCEEDED", clean_output_path: f.video } });
    expect(await createCleanCopyRecovery(f.host)(f.input)).toMatchObject({
      kind: "REUSED_ORIGINAL",
    });
    const stored = await readProject(f.host.filmsRoot, f.record.id);
    expect(
      (stored!.shots![0] as { takes: { cleanVideoPath: string }[] }).takes[0]!.cleanVideoPath,
    ).toBe(f.video);
    expect(
      finalCleanRecoveryProof(f.host.databasePath, f.project, f.video, hash("original post-tag")),
    ).toBe(false);
    expect(await readFile(f.old, "utf8")).toBe("old clean without proof");
  } finally {
    f.close();
  }
});
it("refuses renderer execution paths, wrong selections and fallback project records", async () => {
  const f = await fixture();
  try {
    expect(await createCleanCopyRecovery(f.host)({ ...f.input, path: f.video })).toEqual({
      kind: "FAILED",
      code: "INVALID_INPUT",
    });
    expect(await createCleanCopyRecovery(f.host)({ ...f.input, takeId: "wrong" })).toEqual({
      kind: "FAILED",
      code: "PROJECT_CHANGED",
    });
    expect(
      await createCleanCopyRecovery({
        ...f.host,
        read: async () => ({ ...f.record, id: "film_different0000001" }),
      })(f.input),
    ).toEqual({ kind: "FAILED", code: "PROJECT_CHANGED" });
    expect(f.remake).not.toHaveBeenCalled();
  } finally {
    f.close();
  }
});
it("reports actual persistence failure and never says recovered", async () => {
  const f = await fixture();
  try {
    expect(
      await createCleanCopyRecovery({
        ...f.host,
        save: async () => {
          throw new Error("/private/write");
        },
      })(f.input),
    ).toEqual({ kind: "FAILED", code: "SAVE_FAILED" });
    expect(JSON.stringify(await readProject(f.host.filmsRoot, f.record.id))).toContain(f.old);
    expect(
      originalCleanRecoveryProof(
        f.host.databasePath,
        f.project,
        f.video,
        hash("original post-tag"),
      ),
    ).not.toBeNull();
  } finally {
    f.close();
  }
});
it.each(["owner", "path", "sha", "assembly"])(
  "rejects invalid final %s evidence without replacing either existing file",
  async (kind) => {
    const f = await fixture();
    try {
      const original = f.remake.getMockImplementation()!;
      f.remake.mockImplementationOnce(async () => {
        const response = await original();
        const row = f.db
          .prepare("SELECT content_json FROM artifact_versions WHERE version_id='clean-version'")
          .get()!;
        const content = JSON.parse(String(row.content_json));
        if (kind === "owner")
          f.db
            .prepare("UPDATE artifacts SET project_id=? WHERE artifact_id='clean'")
            .run(`prj_${"b".repeat(32)}`);
        if (kind === "path") content.output_path = f.old;
        if (kind === "sha") content.output_sha256 = "0".repeat(64);
        if (kind === "assembly") content.assembly_version_id = "unknown-version";
        f.db
          .prepare("UPDATE artifact_versions SET content_json=? WHERE version_id='clean-version'")
          .run(JSON.stringify(content));
        return response;
      });
      expect(await createCleanCopyRecovery(f.host)(f.input)).toEqual({
        kind: "FAILED",
        code: "EVIDENCE_FAILED",
      });
      expect(JSON.stringify(await readProject(f.host.filmsRoot, f.record.id))).toContain(f.old);
      expect(await readFile(f.video, "utf8")).toBe("original post-tag");
    } finally {
      f.close();
    }
  },
);
it("skips a clean copy that already has exact final evidence without doing any work", async () => {
  const f = await fixture();
  try {
    f.proof();
    const content = {
      output_path: f.old,
      output_sha256: hash("old clean without proof"),
      assembly_version_id: "assembly-version",
      assembly_content_hash: "assembly-version-hash",
    };
    f.db
      .prepare("UPDATE artifact_versions SET content_json=? WHERE version_id='clean-version'")
      .run(JSON.stringify(content));
    expect(await createCleanCopyRecovery(f.host)(f.input)).toEqual({
      kind: "UNCHANGED",
      reason: "ALREADY_VERIFIED",
    });
    expect(f.remake).not.toHaveBeenCalled();
  } finally {
    f.close();
  }
});
it.each(["shot", "take"])(
  "rejects ambiguous duplicate %s identities before local work",
  async (kind) => {
    const f = await fixture();
    try {
      const duplicate = structuredClone(f.record);
      if (kind === "shot") duplicate.shots!.push(structuredClone(duplicate.shots![0]));
      else {
        const shot = duplicate.shots![0] as { takes: unknown[] };
        shot.takes.push(structuredClone(shot.takes[0]));
      }
      await writeProject(f.host.filmsRoot, duplicate);
      expect(await createCleanCopyRecovery(f.host)(f.input)).toEqual({
        kind: "FAILED",
        code: "PROJECT_CHANGED",
      });
      expect(f.remake).not.toHaveBeenCalled();
    } finally {
      f.close();
    }
  },
);
it("reuses a proven non-burned original, then actually passes prepare with pinned FFmpeg and the original QC engine", async () => {
  const f = await fixture();
  try {
    const suffix = process.platform === "win32" ? ".exe" : "";
    const ffmpeg = (process.env.PATH ?? "")
      .split(delimiter)
      .map((dir) => resolve(dir, "ffmpeg" + suffix))
      .find((path) => existsSync(path));
    expect(ffmpeg).toBeTruthy();
    const packageRoot = resolve("../../packages/aivora-qc"),
      runner = await loadQcRunner(packageRoot),
      engine = await loadQcEngine(packageRoot);
    const tools = await verifiedQcTools(
      dirname(ffmpeg!),
      resolve(
        "../../config",
        process.platform === "win32"
          ? "media-toolchain-lock.json"
          : "draft-media-toolchain-linux-dev-lock.json",
      ),
    );
    await runner(tools.ffmpegPath, [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=160x90:rate=24:duration=0.6",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=0.6",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      f.video,
    ]);
    const digest = createHash("sha256")
      .update(await readFile(f.video))
      .digest("hex");
    const row = f.db
      .prepare("SELECT content_json FROM artifact_versions WHERE version_id='film-version'")
      .get()!;
    const content = JSON.parse(String(row.content_json));
    content.output_sha256 = digest;
    f.db
      .prepare("UPDATE artifact_versions SET content_json=? WHERE version_id='film-version'")
      .run(JSON.stringify(content));
    f.remake.mockResolvedValueOnce({ data: { status: "SUCCEEDED", clean_output_path: f.video } });
    expect(await createCleanCopyRecovery(f.host)(f.input)).toMatchObject({
      kind: "REUSED_ORIGINAL",
    });
    const qc = createFilmExportQc({
      ...f.host,
      temporaryRoot: join(f.root, "staging"),
      tools: async () => tools,
      runner: async () => runner,
      engine: async () => engine,
      font: () => resolve("../studio-web/src/aivora/assets/v2/NotoSansCJKsc-Regular.otf"),
      pickDirectory: async () => null,
      storyOwner: async (project, path, hash) =>
        storyFilmQcOwner(f.host.databasePath, project, path, hash),
    });
    const result = await qc.prepare("owner", {
      projectId: f.record.id,
      expectedSelection: [{ shotId: "shot", takeId: "take" }],
      settings: {
        aspects: ["16:9"],
        quality: "720p",
        subtitles: "none",
        style: "white",
        aiMark: false,
      },
    });
    expect(result).toMatchObject({ kind: "READY" });
    if (result.kind === "READY") {
      expect(result.outputs[0]!.report).toMatchObject({ schemaVersion: 1 });
      await qc.discard("owner", result.qcReceipt);
    }
    expect(
      createHash("sha256")
        .update(await readFile(f.video))
        .digest("hex"),
    ).toBe(digest);
    expect(await readFile(f.old, "utf8")).toBe("old clean without proof");
  } finally {
    f.close();
  }
}, 30000);

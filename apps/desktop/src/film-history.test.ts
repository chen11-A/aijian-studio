import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFilmHistory, filmHistoryRecordHash } from "./film-history";
import { writeProject, readProject, type FilmRecord } from "./film-library";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "film-history-"));
  roots.push(root);
  const original = join(root, "original.mp4"),
    newMedia = join(root, "new.mp4");
  await writeFile(original, "old media bytes");
  await writeFile(newMedia, "new media bytes");
  const film = await writeProject(root, {
    id: "film_historyproject01",
    seriesId: "film_historyseries001",
    title: "原来",
    scenes: [{ id: "scene", no: 1 }],
    shots: [
      {
        id: "shot",
        no: 1,
        takes: [{ id: "take-old", status: "done", videoPath: original }],
        selectedTakeId: "take-old",
      },
    ],
  });
  const folder = join(root, film.seriesId, "episodes", film.id, "history"),
    projectFile = join(root, film.seriesId, "episodes", film.id, "project.json");
  const current = async () => (await readProject(root, film.id))!;
  const capture = async (history = createFilmHistory({ filmsRoot: root })) => {
    const result = await history.capture({
      projectId: film.id,
      expectedHash: filmHistoryRecordHash(await current()),
      reason: "manual",
    });
    expect(result.kind).toBe("CAPTURED");
    if (result.kind !== "CAPTURED") throw new Error(result.code);
    return result.entry;
  };
  return { root, film, folder, projectFile, current, capture, original, newMedia };
}
it("keeps canonical snapshots across module restart and lists only safe summary metadata", async () => {
  const f = await fixture(),
    entry = await f.capture();
  const fresh = createFilmHistory({ filmsRoot: f.root });
  const list = await fresh.list(f.film.id);
  expect(list).toEqual({ kind: "LIST", entries: [entry], unreadable: 0 });
  expect(entry.summary).toEqual({ scenes: 1, shots: 1, done: 1 });
  expect(Date.parse(entry.createdAt)).toBeGreaterThan(0);
  expect(JSON.stringify(list)).not.toContain(f.original);
  expect(JSON.stringify(list)).not.toContain("原来");
  const body = JSON.parse(await readFile(join(f.folder, entry.id + ".json"), "utf8"));
  expect(body.snapshot).toEqual(await f.current());
});
it("backs up the current work before restoring, preserves every take and never removes media or history", async () => {
  const f = await fixture(),
    entry = await f.capture();
  const changed = structuredClone(f.film);
  changed.title = "现在";
  const shot = changed.shots![0] as { takes: unknown[]; selectedTakeId: string };
  shot.takes.push({ id: "take-new", status: "done", videoPath: f.newMedia });
  shot.selectedTakeId = "take-new";
  await writeProject(f.root, changed);
  const history = createFilmHistory({ filmsRoot: f.root });
  const result = await history.restore({
    projectId: f.film.id,
    historyId: entry.id,
    expectedHash: filmHistoryRecordHash(await f.current()),
  });
  expect(result.kind).toBe("RESTORED");
  if (result.kind !== "RESTORED") throw new Error("not restored");
  const restored = result.project as FilmRecord;
  expect(restored.title).toBe("原来");
  expect((restored.shots![0] as { takes: unknown[] }).takes).toHaveLength(2);
  expect((restored.shots![0] as { selectedTakeId: string }).selectedTakeId).toBe("take-old");
  expect(result.backup.reason).toBe("before-restore");
  const backup = JSON.parse(await readFile(join(f.folder, result.backup.id + ".json"), "utf8"));
  expect(backup.snapshot.title).toBe("现在");
  expect(await readdir(f.folder)).toHaveLength(2);
  expect(await readFile(f.original, "utf8")).toBe("old media bytes");
  expect(await readFile(f.newMedia, "utf8")).toBe("new media bytes");
});
it("refuses a series fallback, wrong project, traversal, extra renderer paths and stale expected snapshots", async () => {
  const f = await fixture(),
    entry = await f.capture(),
    history = createFilmHistory({ filmsRoot: f.root });
  const hash = filmHistoryRecordHash(await f.current());
  expect(
    await history.capture({ projectId: f.film.seriesId, expectedHash: hash, reason: "manual" }),
  ).toMatchObject({ kind: "FAILED", code: "PROJECT_CHANGED" });
  expect(
    await history.restore({ projectId: f.film.id, historyId: "../project", expectedHash: hash }),
  ).toMatchObject({ kind: "FAILED", code: "INVALID_INPUT" });
  expect(
    await history.capture({
      projectId: f.film.id,
      expectedHash: hash,
      reason: "manual",
      path: "/outside",
    }),
  ).toMatchObject({ kind: "FAILED", code: "INVALID_INPUT" });
  await writeProject(f.root, { ...f.film, title: "new input" });
  const before = await readFile(f.projectFile);
  expect(
    await history.restore({ projectId: f.film.id, historyId: entry.id, expectedHash: hash }),
  ).toMatchObject({ kind: "FAILED", code: "PROJECT_CHANGED", unchanged: true });
  expect(await readFile(f.projectFile)).toEqual(before);
});
it("detects modified snapshots, reports unreadable entries and refuses cross-project or linked history files", async () => {
  const f = await fixture(),
    entry = await f.capture(),
    history = createFilmHistory({ filmsRoot: f.root });
  const path = join(f.folder, entry.id + ".json"),
    body = JSON.parse(await readFile(path, "utf8"));
  body.snapshot.title = "tampered";
  await writeFile(path, JSON.stringify(body));
  expect(await history.list(f.film.id)).toEqual({ kind: "LIST", entries: [], unreadable: 1 });
  const before = await readFile(f.projectFile);
  expect(
    await history.restore({
      projectId: f.film.id,
      historyId: entry.id,
      expectedHash: filmHistoryRecordHash(await f.current()),
    }),
  ).toMatchObject({ kind: "FAILED", code: "HISTORY_DAMAGED" });
  expect(await readFile(f.projectFile)).toEqual(before);
  await rm(path);
  const outside = join(f.root, "external");
  await mkdir(outside);
  await writeFile(join(outside, entry.id + ".json"), JSON.stringify(body));
  await rm(f.folder, { recursive: true });
  await symlink(outside, f.folder, process.platform === "win32" ? "junction" : "dir");
  expect(
    await history.capture({
      projectId: f.film.id,
      expectedHash: filmHistoryRecordHash(await f.current()),
      reason: "manual",
    }),
  ).toMatchObject({ kind: "FAILED", code: "BACKUP_FAILED" });
  expect(await readFile(f.projectFile)).toEqual(before);
});
it("does not mutate current bytes when the required pre-restore backup fails", async () => {
  const f = await fixture(),
    entry = await f.capture();
  await writeProject(f.root, { ...f.film, title: "current before failed restore" });
  const before = await readFile(f.projectFile);
  const history = createFilmHistory({
    filmsRoot: f.root,
    beforeSnapshotWrite: async () => {
      throw new Error("synthetic disk failure");
    },
  });
  expect(
    await history.restore({
      projectId: f.film.id,
      historyId: entry.id,
      expectedHash: filmHistoryRecordHash(await f.current()),
    }),
  ).toMatchObject({ kind: "FAILED", code: "BACKUP_FAILED", unchanged: true });
  expect(await readFile(f.projectFile)).toEqual(before);
  expect(await readFile(f.original, "utf8")).toBe("old media bytes");
});
it("reports partial/unknown if project content committed but the ordinary library index write failed", async () => {
  const f = await fixture(),
    entry = await f.capture();
  await writeProject(f.root, { ...f.film, title: "current" });
  const history = createFilmHistory({
    filmsRoot: f.root,
    beforeSnapshotWrite: async () => {
      await rm(join(f.root, "index.json"));
      await mkdir(join(f.root, "index.json"));
    },
  });
  const result = await history.restore({
    projectId: f.film.id,
    historyId: entry.id,
    expectedHash: filmHistoryRecordHash(await f.current()),
  });
  expect(result.kind).toBe("PARTIAL");
  expect(JSON.parse(await readFile(f.projectFile, "utf8")).title).toBe("原来");
  expect(await readdir(f.folder)).toHaveLength(2);
});
it("serializes snapshot capture and ordinary writes on the same actual project queue", async () => {
  const f = await fixture();
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  let started = false;
  const history = createFilmHistory({
    filmsRoot: f.root,
    beforeSnapshotWrite: async () => {
      started = true;
      await gate;
    },
  });
  const captured = history.capture({
    projectId: f.film.id,
    expectedHash: filmHistoryRecordHash(await f.current()),
    reason: "before-batch-generation",
  });
  while (!started) await new Promise((resolve) => setTimeout(resolve, 1));
  let written = false;
  const queued = writeProject(f.root, { ...f.film, title: "later user input" }).then(() => {
    written = true;
  });
  await Promise.resolve();
  expect(written).toBe(false);
  release();
  const result = await captured;
  await queued;
  expect(result.kind).toBe("CAPTURED");
  expect((await f.current()).title).toBe("later user input");
  if (result.kind === "CAPTURED")
    expect(
      JSON.parse(await readFile(join(f.folder, result.entry.id + ".json"), "utf8")).snapshot.title,
    ).toBe("原来");
});
it("does not revive historical queued/running jobs or automatically resume their pipeline", async () => {
  const f = await fixture();
  const pending = {
      ...f.film,
      jobs: [{ id: "job", status: "running" }],
      productionPipeline: {
        status: "running",
        steps: [{ id: "video", status: "running", targets: [{ id: "shot", status: "running" }] }],
      },
    },
    shot = pending.shots![0] as { takes: Record<string, unknown>[] };
  shot.takes.push({ id: "queued-take", status: "queued", videoPath: "" });
  await writeProject(f.root, pending);
  const entry = await f.capture();
  await writeProject(f.root, { ...f.film, title: "now" });
  const result = await createFilmHistory({ filmsRoot: f.root }).restore({
    projectId: f.film.id,
    historyId: entry.id,
    expectedHash: filmHistoryRecordHash(await f.current()),
  });
  expect(result.kind).toBe("RESTORED");
  if (result.kind === "RESTORED") {
    expect(result.project).toMatchObject({
      jobs: [{ status: "failed" }],
      productionPipeline: {
        status: "uncertain",
        steps: [{ status: "uncertain", targets: [{ status: "uncertain" }] }],
      },
    });
    expect(
      (result.project as { shots: { takes: { status: string }[] }[] }).shots[0]!.takes.every(
        (take) => take.status !== "queued" && take.status !== "running",
      ),
    ).toBe(true);
  }
});
it("rejects a valid snapshot copied into a different project's private history directory", async () => {
  const f = await fixture(),
    entry = await f.capture();
  const other = await writeProject(f.root, {
    ...f.film,
    id: "film_historysecond001",
    title: "other project",
  });
  const folder = join(f.root, other.seriesId, "episodes", other.id, "history");
  await mkdir(folder);
  await writeFile(
    join(folder, entry.id + ".json"),
    await readFile(join(f.folder, entry.id + ".json")),
  );
  const projectFile = join(f.root, other.seriesId, "episodes", other.id, "project.json"),
    before = await readFile(projectFile);
  const result = await createFilmHistory({ filmsRoot: f.root }).restore({
    projectId: other.id,
    historyId: entry.id,
    expectedHash: filmHistoryRecordHash(other),
  });
  expect(result).toMatchObject({ kind: "FAILED", code: "HISTORY_DAMAGED", unchanged: true });
  expect(await readFile(projectFile)).toEqual(before);
});

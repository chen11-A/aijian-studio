import { afterEach, expect, it, vi } from "vitest";
import type { FilmRangeGateway } from "@aijian/contracts/film-range";
import { sampleFilm, type FilmProject, type FilmTake } from "../../film/project";
import { createFilmPersistence } from "../film-persistence";
import { executeRangeRedo, type RangeReady } from "./range-redo";
import { historyRecordHash } from "./persistent-history";
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
afterEach(() => {
  delete window.aijian;
});
function fixture() {
  const base = sampleFilm();
  const target = base.shots[0]!;
  const take = (id: string): FilmTake => ({
    id,
    shotId: target.id,
    index: 1,
    status: "done",
    videoPath: `/media/${id}.mp4`,
    videoUrl: "",
    stillUrl: "",
    prompt: "",
    createdAt: "",
    reason: "",
  });
  target.takes = [take("source")];
  target.selectedTakeId = "source";
  let live = base;
  const disk = new Map([[base.id, structuredClone(base)]]);
  const order: string[] = [];
  const hold = deferred();
  let pause = false,
    cancelled = false;
  const write = vi.fn(async (film: FilmProject) => {
    disk.set(film.id, structuredClone(film));
    return structuredClone(film);
  });
  const persistence = createFilmPersistence({ current: () => live, write });
  const snapshots: FilmProject[] = [];
  const generate = vi.fn<FilmRangeGateway["generateFilmRange"]>(async (input) => {
    const saved = disk.get(input.projectId)!;
    if ((await historyRecordHash(saved)) !== input.expectedHash)
      return { kind: "FAILED", code: "PROJECT_CHANGED", requestMayHaveRun: false };
    snapshots.push(structuredClone(saved));
    order.push("backup", "provider");
    if (pause) await hold.promise;
    const project = structuredClone(disk.get(base.id)!);
    project.shots[0]!.takes.push(take("segment"));
    disk.set(base.id, project);
    return { kind: "GENERATED", project: structuredClone(project), segmentTakeId: "segment" };
  });
  const finish = vi.fn<FilmRangeGateway["finishFilmRange"]>(async (input) => {
    const project = structuredClone(disk.get(base.id)!);
    expect(await historyRecordHash(project)).toBe(input.expectedHash);
    project.shots[0]!.takes.push(take("composed"));
    project.shots[0]!.selectedTakeId = "composed";
    disk.set(base.id, project);
    order.push("splice");
    return { kind: "SPLICED", project: structuredClone(project) };
  });
  const discard = vi.fn(async () => undefined);
  const gateway = {
    generateFilmRange: generate,
    finishFilmRange: finish,
    discardFilmRange: discard,
    prepareFilmRange: vi.fn(),
  } as FilmRangeGateway;
  window.aijian = {
    readFilmProject: async (id: string) => structuredClone(disk.get(id)!),
    captureFilmHistory: vi.fn(),
    listFilmHistory: vi.fn(),
    restoreFilmHistory: vi.fn(),
  } as unknown as Window["aijian"];
  const ready: RangeReady = {
    project: base,
    shotId: target.id,
    takeId: "source",
    planId: "rng_test",
    plan: {
      requested: { start: 1, end: 3 },
      effective: { start: 1, end: 3 },
      duration: 4,
      generationSeconds: 2,
      frameRate: 24,
      speech: "preserve-original-audio",
    },
  };
  return {
    base,
    ready,
    gateway,
    generate,
    finish,
    discard,
    snapshots,
    order,
    disk,
    write,
    persistence,
    hold,
    pause: () => {
      pause = true;
    },
    cancel: () => {
      cancelled = true;
    },
    live: () => live,
    change: (film: FilmProject) => {
      live = film;
    },
    host: {
      current: () => live,
      apply: (film: FilmProject) => {
        live = film;
      },
      accept: (film: FilmProject) => {
        live = film;
      },
      acquire: persistence.acquire,
      gateway,
      cancelled: () => cancelled,
    },
  };
}
it("backs up before the single ordinary request, retains the candidate, then composes/selects a new version", async () => {
  const f = fixture();
  expect(await executeRangeRedo(f.ready, "新的画面", f.host)).toBe("applied");
  expect(f.generate).toHaveBeenCalledOnce();
  expect(f.generate.mock.calls[0]![0]).toMatchObject({ confirmed: true, prompt: "新的画面" });
  expect(f.snapshots[0]!.shots[0]!.takes.map((t) => t.id)).toEqual(["source"]);
  expect(f.order).toEqual(["backup", "provider", "splice"]);
  expect(f.disk.get(f.base.id)!.shots[0]!.takes.map((t) => t.id)).toEqual([
    "source",
    "segment",
    "composed",
  ]);
  expect(f.live().shots[0]!.selectedTakeId).toBe("composed");
  expect((await f.persistence.flushAll()).status).toBe("saved");
});
it.each(["edit", "selection", "cancel", "switch"])(
  "retains a late generated segment on %s without composing, selecting or replaying",
  async (mode) => {
    const f = fixture();
    f.pause();
    const work = executeRangeRedo(f.ready, "新的画面", f.host);
    await vi.waitFor(() => expect(f.generate).toHaveBeenCalledOnce());
    if (mode === "cancel") f.cancel();
    else if (mode === "switch") {
      const other = sampleFilm();
      other.id = "film_rangeother0001";
      other.title = "另一个工程";
      f.change(other);
    } else {
      const next = structuredClone(f.live());
      if (mode === "edit") next.shots[0]!.picture = "稍后编辑";
      else next.shots[0]!.selectedTakeId = "user-selected";
      f.change(next);
    }
    const during = f.live();
    f.hold.resolve();
    expect(await work).toBe("retained");
    expect(f.finish).not.toHaveBeenCalled();
    expect(f.generate).toHaveBeenCalledOnce();
    expect(f.disk.get(f.base.id)!.shots[0]!.takes.map((t) => t.id)).toEqual(["source", "segment"]);
    expect(f.disk.get(f.base.id)!.shots[0]!.selectedTakeId).toBe(
      mode === "selection" ? "user-selected" : "source",
    );
    if (mode === "edit") expect(f.disk.get(f.base.id)!.shots[0]!.picture).toBe("稍后编辑");
    if (mode === "switch") expect(f.live()).toBe(during);
  },
);
it("rejects a changed confirmation baseline and failed save before any paid request", async () => {
  const stale = fixture();
  stale.change(structuredClone(stale.live()));
  expect(await executeRangeRedo(stale.ready, "画面", stale.host)).toBe("stale");
  expect(stale.generate).not.toHaveBeenCalled();
  const failed = fixture();
  failed.write.mockRejectedValue(new Error("disk failure"));
  await expect(executeRangeRedo(failed.ready, "画面", failed.host)).rejects.toThrow();
  expect(failed.generate).not.toHaveBeenCalled();
});
it("never retries an uncertain provider result or claims that a failed local splice finished", async () => {
  const f = fixture();
  f.generate.mockResolvedValue({
    kind: "FAILED",
    code: "GENERATION_UNCONFIRMED",
    requestMayHaveRun: true,
  });
  expect(await executeRangeRedo(f.ready, "画面", f.host)).toBe("unconfirmed");
  expect(f.generate).toHaveBeenCalledOnce();
  expect(f.finish).not.toHaveBeenCalled();
  const g = fixture();
  g.finish.mockResolvedValue({ kind: "FAILED", code: "SPLICE_FAILED", segmentRetained: true });
  expect(await executeRangeRedo(g.ready, "画面", g.host)).toBe("retained");
  expect(g.disk.get(g.base.id)!.shots[0]!.selectedTakeId).toBe("source");
  expect(g.generate).toHaveBeenCalledOnce();
});
it("releases the real persistence lease when discard IPC rejects and keeps the known result", async () => {
  const f = fixture();
  f.discard.mockRejectedValue(new Error("sender has gone"));
  expect(await executeRangeRedo(f.ready, "画面", f.host)).toBe("applied");
  expect((await f.persistence.flushAll()).status).toBe("saved");
  expect(f.live().shots[0]!.selectedTakeId).toBe("composed");
  const g = fixture();
  g.discard.mockRejectedValue(new Error("sender has gone"));
  g.generate.mockResolvedValue({
    kind: "FAILED",
    code: "GENERATION_UNCONFIRMED",
    requestMayHaveRun: true,
  });
  expect(await executeRangeRedo(g.ready, "画面", g.host)).toBe("unconfirmed");
  expect((await g.persistence.flushAll()).status).toBe("saved");
});

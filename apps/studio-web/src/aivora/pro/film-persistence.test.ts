import { expect, it, vi } from "vitest";
import { sampleFilm, type FilmProject } from "../film/project";
import { createFilmPersistence } from "./film-persistence";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("drains an already dispatched autosave before a checkpoint and drops queued old renders", async () => {
  const old = sampleFilm();
  let live = old;
  const wait = deferred();
  const writes: string[] = [];
  const write = vi.fn(async (film: FilmProject) => {
    if (film === undefined) throw new Error("missing");
    if (writes.length === 0) await wait.promise;
    writes.push(film.title);
    return film;
  });
  const persistence = createFilmPersistence({ current: () => live, write });
  const automatic = persistence.save(old);
  await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
  const claimed = persistence.acquire(old.id);
  const queuedOld = persistence.save(old);
  let acquired = false;
  void claimed.then(() => {
    acquired = true;
  });
  await Promise.resolve();
  expect(acquired).toBe(false);
  wait.resolve();
  await automatic;
  const lease = await claimed;
  expect(await queuedOld).toBeNull();
  const checkpoint = { ...old, title: "durable checkpoint" };
  await lease.save(checkpoint, () => live === old);
  live = checkpoint;
  expect(await persistence.save(old)).toBeNull();
  await lease.release();
  expect(writes).toEqual([old.title, "durable checkpoint"]);
});

it("checks the latest project and snapshot at dispatch, not when scheduling the write", async () => {
  let live = sampleFilm();
  const write = vi.fn(async (film: FilmProject) => film);
  const persistence = createFilmPersistence({ current: () => live, write });
  const pending = persistence.save(live);
  live = { ...live, title: "new edit" };
  expect(await pending).toBeNull();
  expect(write).not.toHaveBeenCalled();
  expect(await persistence.save(live)).toMatchObject({ title: "new edit" });
});

it("flushes only pending durable writes while owned and preserves a user edit on release", async () => {
  let live = sampleFilm();
  const write = vi.fn(async (film: FilmProject) => film);
  const persistence = createFilmPersistence({ current: () => live, write });
  const lease = await persistence.acquire(live.id);
  await lease.save(live, () => true);
  expect(await persistence.flush()).toBeNull();
  expect(write).toHaveBeenCalledOnce();
  live = { ...live, title: "user edit while stopping" };
  await lease.release();
  expect(write).toHaveBeenCalledTimes(2);
  expect(write.mock.calls[1]![0].title).toBe("user edit while stopping");
  await lease.release();
  expect(write).toHaveBeenCalledTimes(2);
});

it("flushes a newer user edit during a pending provider request without waiting for that request", async () => {
  let live = sampleFilm();
  const write = vi.fn(async (film: FilmProject) => film);
  const persistence = createFilmPersistence({ current: () => live, write });
  const lease = await persistence.acquire(live.id);
  await lease.save(live, () => true);
  live = { ...live, title: "saved before shutdown" };
  await persistence.flush();
  expect(write.mock.calls.at(-1)![0].title).toBe("saved before shutdown");
  await lease.release();
  expect(write).toHaveBeenCalledTimes(2);
});

it("rejects stale leases and duplicate owners without blocking another project", async () => {
  let live = sampleFilm();
  const write = vi.fn(async (film: FilmProject) => film);
  const persistence = createFilmPersistence({ current: () => live, write });
  const first = live;
  const lease = await persistence.acquire(first.id);
  await expect(persistence.acquire(first.id)).rejects.toThrow("PIPELINE_ALREADY_RUNNING");
  live = { ...live, id: "film_other000000000001" };
  await persistence.save(live);
  await expect(lease.save(first, () => live.id === first.id)).rejects.toThrow(
    "PIPELINE_INPUT_CHANGED",
  );
  await lease.release();
  expect(write).toHaveBeenCalledOnce();
  expect(write.mock.calls[0]![0].id).toBe(live.id);
  await expect(lease.save(first, () => true)).rejects.toThrow("PIPELINE_INPUT_CHANGED");
});

it("reports a failed write and allows the next save to repair the disk", async () => {
  const live = sampleFilm();
  const write = vi
    .fn(async (film: FilmProject) => film)
    .mockRejectedValueOnce(new Error("disk full"));
  const persistence = createFilmPersistence({ current: () => live, write });
  await expect(persistence.save(live)).rejects.toThrow("disk full");
  await expect(persistence.save(live)).resolves.toEqual(live);
});

it("freezes the payload before a caller can mutate a pending snapshot", async () => {
  const live = sampleFilm();
  const title = live.title;
  const write = vi.fn(async (film: FilmProject) => film);
  const persistence = createFilmPersistence({ current: () => live, write });
  const save = persistence.save(live);
  live.title = "mutated in place";
  expect(await save).toMatchObject({ title });
  expect(write.mock.calls[0]![0]).not.toBe(live);
});
it("returns the same completed native stored receipt from the owned save without an extra write or changing ownership", async () => {
  const current = sampleFilm(),
    stored = { ...current, directory: "/actual/stored", savedAt: "2026-01-01T00:00:00.000Z" },
    write = vi.fn(async () => stored),
    p = createFilmPersistence({ current: () => current, write });
  const lease = await p.acquire(current.id);
  expect(await lease.save(current, () => true)).toBe(stored);
  expect(write).toHaveBeenCalledOnce();
  await lease.release();
  expect(write).toHaveBeenCalledOnce();
  expect(p.externalWriteState(current.id)).toBeNull();
});

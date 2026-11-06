import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { sampleFilm, type FilmProject } from "../film/project";
import { createFilmPersistence } from "./film-persistence";
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
it("waits for actual writes of multiple projects before reporting saved", async () => {
  const first = sampleFilm(),
    second = { ...first, id: "film_another00000001" };
  let current = first;
  const a = gate(),
    b = gate(),
    write = vi.fn(async (value: FilmProject) => {
      await (value.id === first.id ? a.promise : b.promise);
      return value;
    });
  const p = createFilmPersistence({ current: () => current, write });
  const pa = p.save(first, () => true);
  await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
  current = second;
  const pb = p.save(second);
  let settled = false;
  const closing = p.flushAll().then((result) => {
    settled = true;
    return result;
  });
  a.resolve();
  await pa;
  await Promise.resolve();
  expect(settled).toBe(false);
  b.resolve();
  await pb;
  expect((await closing).status).toBe("saved");
});
it("writes the latest project and input when they change during an older in-flight save", async () => {
  let current = sampleFilm();
  const wait = gate();
  const write = vi.fn(async (value: FilmProject) => {
    if (write.mock.calls.length === 1) await wait.promise;
    return value;
  });
  const p = createFilmPersistence({ current: () => current, write });
  const initial = current;
  const pending = p.flushAll();
  await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
  current = { ...initial, id: "film_switched0000001", title: "latest work" };
  wait.resolve();
  const result = await pending;
  expect(result.status).toBe("saved");
  expect(result.snapshot).toBe(current);
  expect(write.mock.calls.at(-1)![0]).toMatchObject({ id: current.id, title: "latest work" });
});
it("does not turn a held pipeline lease or a skipped save into a success", async () => {
  const current = sampleFilm(),
    write = vi.fn(async (value: FilmProject) => value),
    p = createFilmPersistence({ current: () => current, write });
  const lease = await p.acquire(current.id);
  await lease.save(current, () => true);
  expect((await p.flushAll()).status).toBe("busy");
  expect(write).toHaveBeenCalledOnce();
  await lease.release();
  expect((await p.flushAll()).status).toBe("saved");
});
it("retries known historical failures only while their failed snapshot is still authoritative", async () => {
  const first = sampleFilm();
  let current = first;
  const write = vi.fn(async (value: FilmProject) => value);
  const p = createFilmPersistence({ current: () => current, write });
  write.mockRejectedValueOnce(new Error("disk full"));
  await expect(p.save(first)).rejects.toThrow();
  current = { ...first, id: "film_second00000001" };
  expect((await p.flushAll()).status).toBe("saved");
  expect(write.mock.calls.map(([film]) => film.id)).toEqual([first.id, first.id, current.id]);
  const newer = { ...first, title: "newer historical edit" };
  await p.save(newer, () => true);
  await p.flushAll();
  expect(write.mock.calls.filter(([film]) => film.id === first.id).at(-1)![0].title).toBe(
    "newer historical edit",
  );
});
it("reports a persistent historical write failure instead of falsely acknowledging the current work alone", async () => {
  const first = sampleFilm();
  let current = first;
  const write = vi.fn(async (value: FilmProject) => {
    if (value.id === first.id) throw new Error("private/path");
    return value;
  });
  const p = createFilmPersistence({ current: () => current, write });
  await expect(p.save(first)).rejects.toThrow();
  current = { ...first, id: "film_second00000001" };
  expect(await p.flushAll()).toMatchObject({ status: "failed", failedProjectId: first.id });
});
it("detects changes to the same snapshot object while disk is still writing", async () => {
  const current = sampleFilm(),
    wait = gate();
  const write = vi.fn(async (value: FilmProject) => {
    if (write.mock.calls.length === 1) await wait.promise;
    return value;
  });
  const p = createFilmPersistence({ current: () => current, write });
  const pending = p.flushAll();
  await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
  current.title = "mutated latest";
  wait.resolve();
  expect((await pending).status).toBe("saved");
  expect(write.mock.calls.at(-1)![0].title).toBe("mutated latest");
  expect(write).toHaveBeenCalledTimes(2);
});
it("still waits for the other project's real queued write before acknowledging a known failure", async () => {
  const first = sampleFilm();
  let current = first;
  const a = gate(),
    b = gate();
  const write = vi.fn(async (value: FilmProject) => {
    if (value.id === first.id) {
      await a.promise;
      throw new Error("disk full");
    }
    await b.promise;
    return value;
  });
  const p = createFilmPersistence({ current: () => current, write });
  const closing = p.flushAll();
  await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
  current = { ...first, id: "film_second00000001" };
  const other = p.save(current);
  let settled = false;
  void closing.then(() => {
    settled = true;
  });
  a.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(settled).toBe(false);
  b.resolve();
  await other;
  expect((await closing).status).toBe("failed");
});
it("does not replay a failed old snapshot over a newer save already queued for that same project", async () => {
  const first = sampleFilm();
  let current = first;
  const write = vi.fn(async (value: FilmProject) => value);
  const p = createFilmPersistence({ current: () => current, write });
  write.mockRejectedValueOnce(new Error("failed old edit"));
  await expect(p.save(first)).rejects.toThrow();
  const newer = { ...first, title: "latest authoritative edit" };
  const newerWrite = p.save(newer, () => true);
  current = { ...first, id: "film_second00000001" };
  const closing = p.flushAll();
  await newerWrite;
  expect((await closing).status).toBe("saved");
  expect(
    write.mock.calls.filter(([value]) => value.id === first.id).map(([value]) => value.title),
  ).toEqual([first.title, newer.title]);
});
it("returns unknown rather than saved if snapshots never settle", async () => {
  let current = sampleFilm();
  const write = vi.fn(async (value: FilmProject) => {
    current = { ...current, title: current.title + "." };
    return value;
  });
  const p = createFilmPersistence({ current: () => current, write });
  expect((await p.flushAll()).status).toBe("unknown");
  expect(write).toHaveBeenCalledTimes(20);
});
it("does not attach the old project's stored directory to an already saved newer project", async () => {
  const first = sampleFilm();
  let current = first;
  const a = gate();
  const write = vi.fn(async (value: FilmProject) => {
    if (value.id === first.id) await a.promise;
    return { ...value, directory: value.id === first.id ? "/saved/old" : "/saved/new" };
  });
  const p = createFilmPersistence({ current: () => current, write });
  const closing = p.flushAll();
  await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
  current = { ...first, id: "film_second00000001" };
  await p.save(current);
  a.resolve();
  const result = await closing;
  expect(result.status).toBe("saved");
  expect(result.snapshot).toBe(current);
  expect(result.stored).toBeNull();
});
it("waits for real file writes and verifies the final bytes describe the latest input", async () => {
  const directory = await mkdtemp(join(tmpdir(), "quit-save-bytes-"));
  try {
    let current = sampleFilm();
    const a = gate();
    let count = 0;
    const write = vi.fn(async (value: FilmProject) => {
      if (++count === 1) await a.promise;
      await writeFile(join(directory, "project.json"), JSON.stringify(value));
      return value;
    });
    const p = createFilmPersistence({ current: () => current, write });
    const closing = p.flushAll();
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
    current = { ...current, title: "真正写入磁盘的最新正文" };
    a.resolve();
    expect((await closing).status).toBe("saved");
    expect(JSON.parse(await readFile(join(directory, "project.json"), "utf8")).title).toBe(
      current.title,
    );
    expect(write).toHaveBeenCalledTimes(2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

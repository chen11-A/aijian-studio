import { expect, it, vi } from "vitest";
import { sampleFilm, type FilmProject } from "../film/project";
import { createFilmPersistence } from "./film-persistence";
function setup() {
  let live = sampleFilm();
  const write = vi.fn(async (film: FilmProject) => structuredClone(film));
  const persistence = createFilmPersistence({ current: () => live, write });
  return {
    persistence,
    write,
    current: () => live,
    apply: (film: FilmProject) => {
      live = film;
    },
  };
}
it("blocks queued/autosave/flush while native writes, and release cannot replay an old snapshot", async () => {
  const f = setup(),
    before = f.current();
  const lease = await f.persistence.acquire(before.id);
  await lease.save(before, () => true);
  lease.beginExternalWrite!(() => true);
  const pendingSave = f.persistence.save(before);
  expect(await f.persistence.flush()).toBeNull();
  expect((await f.persistence.flushAll()).status).toBe("busy");
  expect(await pendingSave).toBeNull();
  await lease.release();
  expect(f.write).toHaveBeenCalledOnce();
  expect((await f.persistence.flushAll()).status).toBe("unknown");
  expect(f.persistence.externalWriteState(before.id)?.before).toBe(before);
});
it("adopts a native-confirmed current ref without an extra confirmation write", async () => {
  const f = setup(),
    before = f.current();
  const lease = await f.persistence.acquire(before.id);
  await lease.save(before, () => true);
  lease.beginExternalWrite!(() => true);
  const stored = { ...before, title: "已由本机写入" };
  f.apply(stored);
  expect(lease.confirmExternalWrite!(stored, stored, () => f.current() === stored)).toBe(true);
  await lease.release();
  expect(f.write).toHaveBeenCalledOnce();
  expect(await f.persistence.save(stored)).toEqual(stored);
  expect((await f.persistence.flushAll()).status).toBe("saved");
  expect(f.write).toHaveBeenCalledOnce();
});
it("records original-project canonical bytes without applying them to another open work", async () => {
  const f = setup(),
    before = f.current();
  const lease = await f.persistence.acquire(before.id);
  await lease.save(before, () => true);
  lease.beginExternalWrite!(() => true);
  const other = { ...before, id: "film_otherproject0000001", title: "新作品" };
  f.apply(other);
  expect(lease.confirmExternalWrite!({ ...before, title: "原作品本机结果" })).toBe(true);
  await lease.release();
  expect(f.current()).toBe(other);
  expect(f.write).toHaveBeenCalledOnce();
  expect(f.persistence.externalWriteState(before.id)).toBeNull();
});
it("retains late same-project edits and unknown canonical state until explicit recovery", async () => {
  const f = setup(),
    before = f.current();
  const lease = await f.persistence.acquire(before.id);
  await lease.save(before, () => true);
  lease.beginExternalWrite!(() => true);
  const edited = { ...before, title: "迟到时的新编辑" },
    canonical = { ...before, title: "磁盘结果" };
  f.apply(edited);
  expect(lease.confirmExternalWrite!(canonical)).toBe(false);
  await lease.release();
  expect(f.current()).toBe(edited);
  expect(f.persistence.externalWriteState(before.id)).toMatchObject({
    status: "unknown",
    draft: edited,
    canonical,
  });
  expect(await f.persistence.save(edited)).toBeNull();
  await expect(f.persistence.acquire(before.id)).rejects.toThrow("EXTERNAL_WRITE_UNCONFIRMED");
  expect((await f.persistence.flushAll()).status).toBe("unknown");
  expect(f.write).toHaveBeenCalledOnce();
});
it("allows explicit recovery to save a proven precise rebase through the same queue", async () => {
  const f = setup(),
    before = f.current();
  const lease = await f.persistence.acquire(before.id);
  await lease.save(before, () => true);
  lease.beginExternalWrite!(() => true);
  lease.markExternalWriteUnknown!();
  await lease.release();
  const recovery = await f.persistence.acquireExternalRecovery(before.id);
  const canonical = { ...before, title: "本机已存" },
    merged = { ...canonical, title: "保留用户更新" };
  f.apply(merged);
  expect(await recovery.rebaseExternalWrite!(canonical, merged, () => f.current() === merged)).toBe(
    true,
  );
  await recovery.release();
  expect(f.write).toHaveBeenCalledTimes(2);
  expect(f.write.mock.calls[1]![0]).toEqual(merged);
  expect((await f.persistence.flushAll()).status).toBe("saved");
});
it("does not claim divergent adopted data saved when its explicit rebase write fails", async () => {
  const f = setup(),
    before = f.current();
  const lease = await f.persistence.acquire(before.id);
  await lease.save(before, () => true);
  lease.beginExternalWrite!(() => true);
  const canonical = { ...before, title: "本机结果" },
    edited = { ...canonical, title: "未落盘新编辑" };
  f.apply(edited);
  f.write.mockRejectedValue(new Error("disk unavailable"));
  await expect(
    lease.rebaseExternalWrite!(canonical, edited, () => f.current() === edited),
  ).rejects.toThrow();
  expect(f.persistence.externalWriteState(before.id)?.status).toBe("unknown");
  expect(await f.persistence.save(edited)).toBeNull();
  await lease.release();
  expect((await f.persistence.flushAll()).status).toBe("failed");
  expect(f.current()).toBe(edited);
});
it("unknown on a non-current project still keeps all-project close unconfirmed", async () => {
  const f = setup(),
    before = f.current();
  const lease = await f.persistence.acquire(before.id);
  await lease.save(before, () => true);
  lease.beginExternalWrite!(() => true);
  lease.markExternalWriteUnknown!();
  await lease.release();
  f.apply({ ...before, id: "film_otherproject0000001" });
  expect((await f.persistence.flushAll()).status).toBe("unknown");
  expect(f.write).toHaveBeenCalledOnce();
});

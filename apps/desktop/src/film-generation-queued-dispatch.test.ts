import { dispatchProtectedGenerationStill } from "./film-generation-still-dispatch";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { readProject, writeProject, type FilmRecord } from "./film-library";
import { dispatchGenerationOnProjectQueue } from "./film-generation-queued-dispatch";
const roots: string[] = [],
  releases: (() => void)[] = [],
  work: Promise<unknown>[] = [];
afterEach(async () => {
  for (const release of releases.splice(0)) release();
  await Promise.allSettled(work.splice(0));
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "queued-generation-dispatch-"));
  roots.push(root);
  const saved = await writeProject(root, {
    id: `film_${"a".repeat(16)}`,
    seriesId: `film_${"b".repeat(16)}`,
    shots: [],
    title: "原稿",
  });
  const current = vi.fn(() => true),
    verifyCanonical = vi.fn(async (_record: FilmRecord): Promise<void> => undefined),
    dispatch = vi.fn(async () => new Response(null, { status: 204 }));
  const options = { filmsRoot: root, projectId: saved.id, current, verifyCanonical, dispatch };
  return { root, saved, options, current, verifyCanonical, dispatch };
}
it("releases the real save queue while actual transport is still pending and preserves intervening edits", async () => {
  const f = await fixture(),
    entered = deferred<void>(),
    response = deferred<Response>();
  releases.push(() => response.resolve(new Response(null, { status: 204 })));
  f.dispatch.mockImplementation(async () => {
    entered.resolve();
    return response.promise;
  });
  const pending = dispatchGenerationOnProjectQueue(f.options);
  work.push(pending);
  await entered.promise;
  const written = await writeProject(f.root, { ...f.saved, title: "后来的编辑" });
  expect((await readProject(f.root, f.saved.id))!.title).toBe("后来的编辑");
  expect(f.verifyCanonical).toHaveBeenCalledExactlyOnceWith(f.saved);
  expect(f.dispatch).toHaveBeenCalledTimes(1);
  response.resolve(new Response(null, { status: 204 }));
  expect((await pending).status).toBe(204);
  expect(await readProject(f.root, f.saved.id)).toEqual(written);
});
it("retirement during the real canonical verification reaches no transport and does not discard queued saves", async () => {
  const f = await fixture(),
    entered = deferred<void>(),
    verified = deferred<void>();
  releases.push(() => verified.resolve());
  f.verifyCanonical.mockImplementation(async () => {
    entered.resolve();
    await verified.promise;
  });
  const pending = dispatchGenerationOnProjectQueue(f.options);
  work.push(pending);
  const rejected = expect(pending).rejects.toMatchObject({ code: "EXECUTION_UNAVAILABLE" });
  await entered.promise;
  const write = writeProject(f.root, { ...f.saved, title: "保留编辑" });
  work.push(write);
  f.current.mockReturnValue(false);
  verified.resolve();
  await rejected;
  expect((await write).title).toBe("保留编辑");
  expect(f.dispatch).not.toHaveBeenCalled();
});
it("rejects a missing project or series fallback before verification and transport", async () => {
  const f = await fixture();
  await expect(
    dispatchGenerationOnProjectQueue({ ...f.options, projectId: f.saved.seriesId }),
  ).rejects.toMatchObject({ code: "PROJECT_CHANGED" });
  expect(f.verifyCanonical).not.toHaveBeenCalled();
  expect(f.dispatch).not.toHaveBeenCalled();
  expect(await readProject(f.root, f.saved.id)).toEqual(f.saved);
});
it("does not enter the queue verifier when the native owner is already retired", async () => {
  const f = await fixture();
  f.current.mockReturnValue(false);
  await expect(dispatchGenerationOnProjectQueue(f.options)).rejects.toMatchObject({
    code: "EXECUTION_UNAVAILABLE",
  });
  expect(f.verifyCanonical).not.toHaveBeenCalled();
  expect(f.dispatch).not.toHaveBeenCalled();
});
it("observes an immediately rejected transport without poisoning the original write queue", async () => {
  const f = await fixture(),
    error = Error("PRIVATE transport");
  f.dispatch.mockRejectedValueOnce(error);
  await expect(dispatchGenerationOnProjectQueue(f.options)).rejects.toBe(error);
  expect((await writeProject(f.root, { ...f.saved, title: "仍可保存" })).title).toBe("仍可保存");
  expect(f.dispatch).toHaveBeenCalledTimes(1);
});

it("preserves the final queue gate's fixed code through the actual protected still driver", async () => {
  const f = await fixture(),
    entered = deferred<void>(),
    verified = deferred<void>();
  releases.push(() => verified.resolve());
  f.verifyCanonical.mockImplementation(async () => {
    entered.resolve();
    await verified.promise;
  });
  const fetcher = vi.fn<typeof fetch>(),
    notSent = vi.fn(async () => undefined),
    observed = vi.fn(async () => undefined);
  const pending = dispatchProtectedGenerationStill({
    prompt: "受控画面",
    token: "synthetic",
    destination: join(f.root, "frame.png"),
    current: f.current,
    fetcher,
    beforePost: (_wire, dispatch) => dispatchGenerationOnProjectQueue({ ...f.options, dispatch }),
    notSent,
    observed,
  });
  work.push(pending);
  await entered.promise;
  f.current.mockReturnValue(false);
  verified.resolve();
  expect(await pending).toMatchObject({ path: "", code: "EXECUTION_UNAVAILABLE" });
  expect(fetcher).not.toHaveBeenCalled();
  expect(notSent).toHaveBeenCalledTimes(1);
  expect(observed).not.toHaveBeenCalled();
  expect(await readProject(f.root, f.saved.id)).toEqual(f.saved);
});

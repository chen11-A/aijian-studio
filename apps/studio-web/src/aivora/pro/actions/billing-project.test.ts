import { expect, it, vi } from "vitest";
import {
  isBillingProjectId,
  resolveBillingProject,
  type BillingProjectCreate,
} from "./billing-project";
const id = `prj_${"a".repeat(32)}`;
function deferred() {
  let resolve!: (value: { data: { id: string } }) => void;
  const promise = new Promise<{ data: { id: string } }>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
it("shares one creation per work and keeps the existing membership project payload", async () => {
  const wait = deferred();
  const create = vi.fn<BillingProjectCreate>(() => wait.promise);
  const pending = new Map<string, Promise<string>>();
  const input = { filmId: "film-a", name: "名".repeat(90), pending, isCurrent: () => true, create };
  const first = resolveBillingProject(input);
  const second = resolveBillingProject(input);
  await Promise.resolve();
  expect(create).toHaveBeenCalledOnce();
  expect(create).toHaveBeenCalledWith({
    name: "名".repeat(80),
    aspect_ratio: "9:16",
    source_language: "zh-CN",
    target_duration_seconds: 90,
  });
  wait.resolve({ data: { id } });
  expect(await first).toBe(id);
  expect(await second).toBe(id);
  expect(await resolveBillingProject(input)).toBe(id);
  expect(create).toHaveBeenCalledOnce();
});
it("does not return a stale work's ID and can reuse its result upon explicitly returning to that work", async () => {
  let current = "film-a";
  const wait = deferred();
  const create = vi.fn<BillingProjectCreate>(() => wait.promise);
  const input = {
    filmId: "film-a",
    name: "A",
    pending: new Map<string, Promise<string>>(),
    isCurrent: () => current === "film-a",
    create,
  };
  const result = resolveBillingProject(input);
  await Promise.resolve();
  current = "film-b";
  wait.resolve({ data: { id } });
  expect(await result).toBe("");
  current = "film-a";
  expect(await resolveBillingProject(input)).toBe(id);
  expect(create).toHaveBeenCalledOnce();
});
it("rejects malformed IDs without guessing and permits an explicit later retry", async () => {
  const pending = new Map<string, Promise<string>>();
  const create = vi
    .fn<BillingProjectCreate>()
    .mockResolvedValueOnce({ data: { id: "prj_wrong" } })
    .mockResolvedValueOnce({ data: { id } });
  const input = { filmId: "film-a", name: "A", pending, isCurrent: () => true, create };
  expect(await resolveBillingProject(input)).toBe("");
  expect(pending.size).toBe(0);
  expect(await resolveBillingProject(input)).toBe(id);
  for (const value of [null, {}, "prj_" + "A".repeat(32), id + "x", " " + id])
    expect(isBillingProjectId(value)).toBe(false);
});
it("deduplicates bridge failures and does not create for missing or already stale identity", async () => {
  const create = vi.fn<BillingProjectCreate>(() => {
    throw new Error("private bridge error");
  });
  const input = {
    filmId: "film-a",
    name: "",
    pending: new Map<string, Promise<string>>(),
    isCurrent: () => true,
    create,
  };
  expect(await Promise.all([resolveBillingProject(input), resolveBillingProject(input)])).toEqual([
    "",
    "",
  ]);
  expect(create).toHaveBeenCalledOnce();
  expect(input.pending.size).toBe(0);
  expect(await resolveBillingProject({ ...input, filmId: "" })).toBe("");
  expect(await resolveBillingProject({ ...input, isCurrent: () => false })).toBe("");
  expect(create).toHaveBeenCalledOnce();
});

it("does not dispatch if the work switches before the shared creation starts", async () => {
  let active = true;
  const create = vi.fn<BillingProjectCreate>(async () => ({ data: { id } }));
  const pending = new Map<string, Promise<string>>();
  const result = resolveBillingProject({
    filmId: "a",
    name: "A",
    pending,
    isCurrent: () => active,
    create,
  });
  active = false;
  expect(await result).toBe("");
  expect(create).not.toHaveBeenCalled();
  expect(pending.size).toBe(0);
});

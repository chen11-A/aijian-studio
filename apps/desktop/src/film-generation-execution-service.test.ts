import { expect, it, vi } from "vitest";
import {
  createFilmGenerationExecutionService,
  GenerationExecutionServiceError,
} from "./film-generation-execution-service";
import type { GenerationExecutionOwner } from "./film-generation-execution-registry";
const input = {
  projectId: `film_${"a".repeat(16)}`,
  expectedProjectHash: "a".repeat(64),
  mode: "video" as const,
  targets: [{ shotId: "shot", versions: 1 as const }],
};
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture() {
  let alive = true;
  const owner: GenerationExecutionOwner = { id: 1, current: () => alive };
  const state = { privateExecution: "PRIVATE" };
  const registration = {
    public: {
      projectId: input.projectId,
      projectHash: input.expectedProjectHash,
      targets: [
        {
          shotId: "shot",
          videoSlotIds: ["slot"],
          preparation: "CLIENT_IMAGES" as const,
          slotPreparations: [{ videoSlotId: "slot", preparation: "CLIENT_IMAGES" as const }],
        },
      ],
      stages: [{ stageId: "frame", kind: "shot-frame" as const, targetId: "shot" }],
    },
    stageSlots: new Map([["frame", ["slot"]]]),
    privateState: state,
    accountCurrent: () => true,
  };
  const prepare = vi.fn(async () => registration),
    retire = vi.fn(async (): Promise<void> => undefined);
  const service = createFilmGenerationExecutionService({ prepare, retire });
  return {
    owner,
    state,
    registration,
    prepare,
    retire,
    service,
    close: () => {
      alive = false;
    },
  };
}
it("rejects malformed scope before the trusted compiler and publishes only matching issued facts", async () => {
  const f = fixture();
  for (const raw of [
    null,
    { ...input, hash: "PRIVATE" },
    { ...input, targets: [...input.targets, ...input.targets] },
    { ...input, targets: [{ shotId: "shot", versions: 4 }] },
  ])
    expect(await f.service.prepare(f.owner, raw)).toEqual({
      kind: "FAILED",
      code: "INVALID_INPUT",
    });
  expect(f.prepare).not.toHaveBeenCalled();
  Object.assign(f.registration.public, { projectHash: "b".repeat(64) });
  expect(await f.service.prepare(f.owner, input)).toEqual({
    kind: "FAILED",
    code: "EXECUTION_UNAVAILABLE",
  });
  expect(f.retire).toHaveBeenCalledExactlyOnceWith(f.state, undefined);
});
it("keeps same-project prepare busy and cleans a late private execution after its captured owner retires", async () => {
  const f = fixture(),
    held = deferred();
  f.prepare.mockImplementation(async () => {
    await held.promise;
    return f.registration;
  });
  const pending = f.service.prepare(f.owner, input);
  expect(await f.service.prepare(f.owner, input)).toEqual({ kind: "FAILED", code: "BUSY" });
  f.close();
  // Mutating the caller's owner object cannot replace the already captured native epoch predicate.
  Object.assign(f.owner, { current: () => true });
  held.resolve();
  expect(await pending).toEqual({ kind: "FAILED", code: "EXECUTION_UNAVAILABLE" });
  expect(f.prepare).toHaveBeenCalledTimes(1);
  expect(f.retire).toHaveBeenCalledExactlyOnceWith(f.state, undefined);
});
it("retires an issued slot synchronously before its private cleanup acknowledgement", async () => {
  const f = fixture(),
    held = deferred();
  const prepared = await f.service.prepare(f.owner, input);
  if (prepared.kind !== "PREPARED") throw Error("not prepared");
  const lease = f.service.stage(
    f.owner,
    { executionId: prepared.executionId, stageId: "frame" },
    "image",
  );
  f.retire.mockImplementation(async () => held.promise);
  const pending = f.service.retire(f.owner, {
    executionId: prepared.executionId,
    videoSlotId: "slot",
  });
  expect(lease.current()).toBe(false);
  expect(f.retire).toHaveBeenCalledExactlyOnceWith(f.state, { shotId: "shot", index: 0 });
  held.resolve();
  expect(await pending).toEqual({ kind: "RETIRED" });
});
it("owner disposal closes captured video leases even when private cleanup fails", async () => {
  const f = fixture();
  const prepared = await f.service.prepare(f.owner, input);
  if (prepared.kind !== "PREPARED") throw Error("not prepared");
  const lease = f.service.video(f.owner, {
    executionId: prepared.executionId,
    videoSlotId: "slot",
    shotId: "shot",
    takeId: "take",
  });
  f.retire.mockRejectedValue(Error("PRIVATE cleanup"));
  const pending = f.service.disposeOwner(f.owner.id);
  expect(lease.current()).toBe(false);
  await pending;
  expect(f.retire).toHaveBeenCalledTimes(1);
});

it("does not publish a private prepare completed after explicit owner disposal", async () => {
  const f = fixture(),
    held = deferred();
  f.prepare.mockImplementation(async () => {
    await held.promise;
    return f.registration;
  });
  const pending = f.service.prepare(f.owner, input);
  await f.service.disposeOwner(f.owner.id);
  held.resolve();
  expect(await pending).toEqual({ kind: "FAILED", code: "EXECUTION_UNAVAILABLE" });
  expect(f.retire).toHaveBeenCalledExactlyOnceWith(f.state, undefined);
});

it("returns only trusted fixed failure codes and never provider or diagnostic text", async () => {
  const f = fixture();
  f.prepare.mockRejectedValueOnce(new GenerationExecutionServiceError("WRITE_UNCONFIRMED"));
  expect(await f.service.prepare(f.owner, input)).toEqual({
    kind: "FAILED",
    code: "WRITE_UNCONFIRMED",
  });
  f.prepare.mockRejectedValueOnce(Error("PRIVATE token/path/provider body"));
  expect(await f.service.prepare(f.owner, input)).toEqual({
    kind: "FAILED",
    code: "EXECUTION_UNAVAILABLE",
  });
  expect(f.prepare).toHaveBeenCalledTimes(2);
  expect(f.retire).not.toHaveBeenCalled();
});

it("publishes a curated pipeline local receipt without granting a stage/video execution or cleanup", async () => {
  const local = {
    kind: "NOT_NEEDED" as const,
    projectId: input.projectId,
    projectHash: input.expectedProjectHash,
    reason: "LOCAL_SELECTED_MEDIA" as const,
    selected: [{ shotId: "shot", takeId: "selected" }],
  };
  const retire = vi.fn(async () => undefined);
  const service = createFilmGenerationExecutionService({ prepare: async () => local, retire });
  const owner = { id: 1, current: () => true };
  await expect(service.prepare(owner, { ...input, mode: "pipeline" })).resolves.toEqual(local);
  expect(() =>
    service.stage(owner, { executionId: "not-issued", stageId: "not-issued" }, "image"),
  ).toThrowError();
  await service.disposeOwner(owner.id);
  expect(retire).not.toHaveBeenCalled();
});
it.each(["ordinary", "hash", "empty", "extra"])(
  "rejects a local receipt with invalid %s scope or leaked private fields",
  async (change) => {
    const local = {
      kind: "NOT_NEEDED" as const,
      projectId: input.projectId,
      projectHash: change === "hash" ? "b".repeat(64) : input.expectedProjectHash,
      reason: "LOCAL_SELECTED_MEDIA" as const,
      selected: change === "empty" ? [] : [{ shotId: "shot", takeId: "selected" }],
    };
    const result = change === "extra" ? { ...local, path: "PRIVATE_PATH" } : local;
    const retire = vi.fn(async () => undefined);
    const service = createFilmGenerationExecutionService({ prepare: async () => result, retire });
    await expect(
      service.prepare(
        { id: 1, current: () => true },
        { ...input, mode: change === "ordinary" ? "video" : "pipeline" },
      ),
    ).resolves.toEqual({ kind: "FAILED", code: "EXECUTION_UNAVAILABLE" });
    expect(retire).not.toHaveBeenCalled();
  },
);

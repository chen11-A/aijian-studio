import { expect, it, vi } from "vitest";
import {
  createFilmGenerationExecutionRegistry,
  type GenerationExecutionOwner,
} from "./film-generation-execution-registry";
function setup() {
  let documentCurrent = true,
    accountCurrent = true;
  const owner: GenerationExecutionOwner = { id: 7, current: () => documentCurrent };
  const registry = createFilmGenerationExecutionRegistry<{ secret: string }>();
  const registration = {
    public: {
      projectId: `film_${"a".repeat(16)}`,
      projectHash: "a".repeat(64),
      targets: [
        {
          shotId: "shot-one",
          videoSlotIds: ["slot-one", "slot-two"],
          preparation: "CLIENT_IMAGES" as const,
        },
        { shotId: "shot-two", videoSlotIds: ["slot-three"], preparation: "CLIENT_IMAGES" as const },
      ],
      stages: [
        { stageId: "shared", kind: "location-reference" as const, targetId: "place" },
        { stageId: "frame", kind: "shot-frame" as const, targetId: "shot-one" },
        {
          stageId: "continuity",
          kind: "continuity-frame" as const,
          targetId: "shot-two",
          sourceShotId: "shot-one",
        },
      ],
    },
    stageSlots: new Map([
      ["shared", ["slot-one", "slot-two", "slot-three"]],
      ["frame", ["slot-one", "slot-two"]],
      ["continuity", ["slot-three"]],
    ]),
    privateState: { secret: "PRIVATE_ACCOUNT_AND_SOURCE" },
    accountCurrent: () => accountCurrent,
  };
  const prepared = registry.register(owner, registration);
  return {
    registry,
    owner,
    registration,
    prepared,
    changeDocument: () => {
      documentCurrent = false;
    },
    changeAccount: () => {
      accountCurrent = false;
    },
    stage: (stageId = "shared") => ({ executionId: prepared.executionId, stageId }),
    video: (videoSlotId = "slot-one", shotId = "shot-one", takeId = "canonical-take") => ({
      executionId: prepared.executionId,
      videoSlotId,
      shotId,
      takeId,
    }),
  };
}
it("publishes only curated locators and isolates the issued table from later public mutations", () => {
  const f = setup();
  expect(JSON.stringify(f.prepared)).not.toContain("PRIVATE");
  Object.assign(f.registration.public.targets[0]!, { originalBody: "PRIVATE_ORIGINAL_BODY" });
  Object.assign(f.registration.public.stages[0]!, { origin: "PRIVATE_SOURCE" });
  expect(JSON.stringify(f.registry.register(f.owner, f.registration))).not.toContain("PRIVATE");
  expect(Object.keys(f.prepared).sort()).toEqual([
    "executionId",
    "kind",
    "projectHash",
    "projectId",
    "stages",
    "targets",
  ]);
  Object.assign(f.prepared.targets[0]!, { videoSlotIds: ["forged"] });
  Object.assign(f.prepared.stages[0]!, { targetId: "forged" });
  expect(f.registry.stage(f.owner, f.stage(), "image").stage.targetId).toBe("place");
  expect(() => f.registry.video(f.owner, f.video("forged"))).toThrow("EXECUTION_UNAVAILABLE");
  expect(f.registry.video(f.owner, f.video()).current()).toBe(true);
});
it("single-slot retirement is immediate while shared dependencies and the sibling slot remain usable", () => {
  const f = setup(),
    first = f.registry.video(f.owner, f.video()),
    sibling = f.registry.video(f.owner, f.video("slot-two"));
  const shared = f.registry.stage(f.owner, f.stage(), "image"),
    frame = f.registry.stage(f.owner, f.stage("frame"), "image");
  f.registry.retire(f.owner, { executionId: f.prepared.executionId, videoSlotId: "slot-one" });
  expect(first.current()).toBe(false);
  expect(sibling.current()).toBe(true);
  expect(shared.current()).toBe(true);
  expect(frame.current()).toBe(true);
  f.registry.retire(f.owner, { executionId: f.prepared.executionId, videoSlotId: "slot-two" });
  expect(frame.current()).toBe(false);
  expect(shared.current()).toBe(true);
  f.registry.retire(f.owner, { executionId: f.prepared.executionId, videoSlotId: "slot-three" });
  expect(shared.current()).toBe(false);
});
it("a held reservation cannot reach the final fetch gate after full retirement", async () => {
  const f = setup(),
    stage = f.registry.stage(f.owner, f.stage(), "image"),
    fetch = vi.fn();
  let release!: () => void;
  const reservation = new Promise<void>((resolve) => {
    release = resolve;
  });
  const operation = (async () => {
    await reservation;
    stage.assertCurrent();
    fetch();
  })();
  f.registry.retire(f.owner, { executionId: f.prepared.executionId });
  release();
  await expect(operation).rejects.toMatchObject({ code: "EXECUTION_UNAVAILABLE" });
  expect(fetch).not.toHaveBeenCalled();
});
it.each(["document", "account", "dispose"])(
  "%s retirement invalidates already captured leases without granting another document access",
  (change) => {
    const f = setup(),
      lease = f.registry.stage(f.owner, f.stage(), "image");
    expect(() => f.registry.stage({ id: 8, current: () => true }, f.stage(), "image")).toThrow(
      "EXECUTION_UNAVAILABLE",
    );
    if (change === "document") f.changeDocument();
    else if (change === "account") f.changeAccount();
    else
      expect(f.registry.disposeOwner(f.owner.id)).toEqual([
        { secret: "PRIVATE_ACCOUNT_AND_SOURCE" },
      ]);
    expect(lease.current()).toBe(false);
    expect(() =>
      f.registry.stage({ id: f.owner.id, current: () => true }, f.stage(), "image"),
    ).toThrow("EXECUTION_UNAVAILABLE");
  },
);
it("old preparation cleanup cannot clear a newer document's project reservation", () => {
  const f = setup();
  const oldRelease = f.registry.beginPreparation(f.owner, f.prepared.projectId);
  expect(() => f.registry.beginPreparation(f.owner, f.prepared.projectId)).toThrow("BUSY");
  f.registry.disposeOwner(f.owner.id);
  const fresh = { id: f.owner.id, current: () => true };
  const newRelease = f.registry.beginPreparation(fresh, f.prepared.projectId);
  oldRelease();
  expect(() => f.registry.beginPreparation(fresh, f.prepared.projectId)).toThrow("BUSY");
  newRelease();
  expect(f.registry.beginPreparation(fresh, f.prepared.projectId)).toBeTypeOf("function");
});
it("slot lookup does not itself bind a take, but a verified binding cannot be switched", () => {
  const f = setup(),
    original = f.registry.video(f.owner, f.video()),
    candidate = f.registry.video(f.owner, f.video("slot-one", "shot-one", "other-take"));
  candidate.bindVerifiedTake();
  expect(candidate.current()).toBe(true);
  expect(original.current()).toBe(false);
  expect(() => original.bindVerifiedTake()).toThrow("EXECUTION_UNAVAILABLE");
  expect(() => f.registry.video(f.owner, f.video())).toThrow("EXECUTION_UNAVAILABLE");
  expect(() => f.registry.video(f.owner, f.video("slot-one", "wrong-shot"))).toThrow(
    "EXECUTION_UNAVAILABLE",
  );
});
it("rejects context extras, foreign stages and image-versus-local-stage confusion", () => {
  const f = setup();
  expect(() =>
    f.registry.stage(f.owner, Object.assign(f.stage(), { path: "PRIVATE" }), "image"),
  ).toThrow("INVALID_INPUT");
  expect(() => f.registry.stage(f.owner, f.stage("continuity"), "image")).toThrow(
    "EXECUTION_UNAVAILABLE",
  );
  expect(() => f.registry.stage(f.owner, f.stage(), "continuity")).toThrow("EXECUTION_UNAVAILABLE");
  expect(f.registry.stage(f.owner, f.stage("continuity"), "continuity").stage.kind).toBe(
    "continuity-frame",
  );
  expect(() =>
    f.registry.retire(f.owner, { executionId: f.prepared.executionId, videoSlotId: "foreign" }),
  ).toThrow("EXECUTION_UNAVAILABLE");
});
it("rejects incomplete or invented native dependency graphs before publishing a capability", () => {
  const f = setup();
  f.registration.stageSlots.set("shared", ["foreign"]);
  expect(() => f.registry.register(f.owner, f.registration)).toThrow("EXECUTION_UNAVAILABLE");
  f.registration.stageSlots.delete("shared");
  expect(() => f.registry.register(f.owner, f.registration)).toThrow("EXECUTION_UNAVAILABLE");
});

it("does not revive an old document by replacing the caller's mutable owner callback", () => {
  const f = setup();
  const lease = f.registry.stage(f.owner, f.stage(), "image");
  f.changeDocument();
  f.owner.current = () => true;
  f.registration.accountCurrent = () => true;
  expect(lease.current()).toBe(false);
  expect(() => f.registry.stage(f.owner, f.stage(), "image")).toThrow("EXECUTION_UNAVAILABLE");
});

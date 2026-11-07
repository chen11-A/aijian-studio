import { randomBytes } from "node:crypto";
import type {
  FilmGenerationExecutionResult,
  FilmGenerationStillExecution,
  FilmGenerationVideoExecution,
} from "@aijian/contracts/film-generation-execution";

type Prepared = Extract<FilmGenerationExecutionResult, { kind: "PREPARED" }>;
export type GenerationExecutionOwner = Readonly<{ id: number; current: () => boolean }>;
export class GenerationExecutionRegistryError extends Error {
  constructor(readonly code: "BUSY" | "INVALID_INPUT" | "EXECUTION_UNAVAILABLE") {
    super(code);
  }
}
const fail = (code: GenerationExecutionRegistryError["code"]): never => {
  throw new GenerationExecutionRegistryError(code);
};
const alive = (current: () => boolean) => {
  try {
    return current() === true;
  } catch {
    return false;
  }
};
const text = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 256 && value.trim() === value;
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

type Registration<State> = {
  public: Omit<Prepared, "kind" | "executionId">;
  /** Native compiler's dependency graph, not supplied or returned by the renderer. */
  stageSlots: ReadonlyMap<string, readonly string[]>;
  privateState: State;
  accountCurrent: () => boolean;
};
type Entry<State> = {
  id: string;
  owner: GenerationExecutionOwner;
  registration: Registration<State>;
  public: Omit<Prepared, "kind" | "executionId">;
  stageSlots: Map<string, readonly string[]>;
  slots: Map<
    string,
    {
      shotId: string;
      index: number;
      retired: boolean;
      takeId: string | null;
      preparation: "CLIENT_IMAGES" | "STORYFILM_CACHE";
    }
  >;
  retired: boolean;
};

/** Only transient lifecycle/issued-table control. Canonical compilation, roots, bytes,
 * account attestation, cache and durable lineage remain the trusted adapter's job. */
export function createFilmGenerationExecutionRegistry<State>(maxExecutions = 128) {
  const entries = new Map<string, Entry<State>>();
  const preparing = new Map<string, { token: symbol; owner: GenerationExecutionOwner }>();
  const current = (entry: Entry<State>) =>
    entries.get(entry.id) === entry &&
    !entry.retired &&
    alive(entry.owner.current) &&
    alive(entry.registration.accountCurrent);
  function owned(owner: GenerationExecutionOwner, executionId: unknown) {
    const entry = typeof executionId === "string" ? entries.get(executionId) : undefined;
    if (!entry || owner.id !== entry.owner.id || !alive(owner.current) || !current(entry))
      return fail("EXECUTION_UNAVAILABLE");
    return entry;
  }
  return {
    beginPreparation(owner: GenerationExecutionOwner, projectId: string) {
      if (!text(projectId) || !Number.isSafeInteger(owner.id) || owner.id < 0)
        return fail("INVALID_INPUT");
      if (!alive(owner.current)) return fail("EXECUTION_UNAVAILABLE");
      if (preparing.has(projectId)) return fail("BUSY");
      const token = Symbol(projectId);
      preparing.set(projectId, { token, owner: { id: owner.id, current: owner.current } });
      return () => {
        if (preparing.get(projectId)?.token === token) preparing.delete(projectId);
      };
    },
    register(owner: GenerationExecutionOwner, registration: Registration<State>): Prepared {
      if (
        !Number.isSafeInteger(owner.id) ||
        owner.id < 0 ||
        !alive(owner.current) ||
        !alive(registration.accountCurrent)
      )
        return fail("EXECUTION_UNAVAILABLE");
      for (const [id, entry] of entries)
        if (
          entry.retired ||
          !alive(entry.owner.current) ||
          !alive(entry.registration.accountCurrent)
        )
          entries.delete(id);
      if (entries.size >= maxExecutions) return fail("BUSY");
      const input = registration.public;
      const slots: Entry<State>["slots"] = new Map();
      const ids = new Set<string>();
      const addId = (id: unknown) => {
        if (!text(id) || ids.has(id)) return fail("EXECUTION_UNAVAILABLE");
        ids.add(id);
      };
      if (
        !text(input.projectId) ||
        !/^[a-f0-9]{64}$/.test(input.projectHash) ||
        !input.targets.length
      )
        return fail("EXECUTION_UNAVAILABLE");
      const shotIds = new Set<string>();
      for (const target of input.targets) {
        if (
          !text(target.shotId) ||
          shotIds.has(target.shotId) ||
          !["CLIENT_IMAGES", "STORYFILM_CACHE"].includes(target.preparation) ||
          target.videoSlotIds.length < 1 ||
          target.videoSlotIds.length > 3
        )
          return fail("EXECUTION_UNAVAILABLE");
        if (
          !Array.isArray(target.slotPreparations) ||
          target.slotPreparations.length !== target.videoSlotIds.length ||
          !target.slotPreparations.every(
            (slot, index) =>
              exact(slot, ["videoSlotId", "preparation"]) &&
              slot.videoSlotId === target.videoSlotIds[index] &&
              (slot.preparation === "CLIENT_IMAGES" || slot.preparation === "STORYFILM_CACHE"),
          ) ||
          target.preparation !==
            (target.slotPreparations.every((slot) => slot.preparation === "STORYFILM_CACHE")
              ? "STORYFILM_CACHE"
              : "CLIENT_IMAGES")
        )
          return fail("EXECUTION_UNAVAILABLE");
        shotIds.add(target.shotId);
        target.videoSlotIds.forEach((id, index) => {
          addId(id);
          slots.set(id, {
            shotId: target.shotId,
            index,
            retired: false,
            takeId: null,
            preparation: target.slotPreparations[index]!.preparation,
          });
        });
      }
      const stages = input.stages.map((stage) => {
        addId(stage.stageId);
        if (!text(stage.targetId)) return fail("EXECUTION_UNAVAILABLE");
        if (
          (stage.kind === "continuity-frame" || stage.kind === "shot-frame") &&
          !input.targets.some(
            (target) =>
              target.shotId === stage.targetId &&
              target.slotPreparations.some((slot) => slot.preparation === "CLIENT_IMAGES"),
          )
        )
          return fail("EXECUTION_UNAVAILABLE");
        if (stage.kind === "continuity-frame") {
          if (!text(stage.sourceShotId) || stage.sourceShotId === stage.targetId)
            return fail("EXECUTION_UNAVAILABLE");
          return {
            kind: stage.kind,
            stageId: stage.stageId,
            targetId: stage.targetId,
            sourceShotId: stage.sourceShotId,
          };
        }
        if (!["location-reference", "portrait", "shot-frame"].includes(stage.kind))
          return fail("EXECUTION_UNAVAILABLE");
        if (stage.kind === "portrait") {
          if (!stage.view || !["正面", "侧面", "背面", "脸部"].includes(stage.view))
            return fail("EXECUTION_UNAVAILABLE");
          return {
            kind: stage.kind,
            stageId: stage.stageId,
            targetId: stage.targetId,
            view: stage.view,
          };
        }
        return { kind: stage.kind, stageId: stage.stageId, targetId: stage.targetId };
      });
      const stageSlots = new Map<string, readonly string[]>();
      if (registration.stageSlots.size !== stages.length) return fail("EXECUTION_UNAVAILABLE");
      for (const stage of stages) {
        const dependencies = registration.stageSlots.get(stage.stageId);
        if (
          !dependencies?.length ||
          new Set(dependencies).size !== dependencies.length ||
          dependencies.some((id) => slots.get(id)?.preparation !== "CLIENT_IMAGES")
        )
          return fail("EXECUTION_UNAVAILABLE");
        stageSlots.set(stage.stageId, [...dependencies]);
      }
      const curated = {
        projectId: input.projectId,
        projectHash: input.projectHash,
        stages,
        targets: input.targets.map((target) => ({
          shotId: target.shotId,
          preparation: target.preparation,
          videoSlotIds: [...target.videoSlotIds],
          slotPreparations: target.slotPreparations.map((slot) => ({ ...slot })),
        })),
      };
      const id = `gex_${randomBytes(16).toString("hex")}`;
      const entry: Entry<State> = {
        id,
        owner: { id: owner.id, current: owner.current },
        registration: { ...registration, accountCurrent: registration.accountCurrent },
        public: curated,
        stageSlots,
        slots,
        retired: false,
      };
      entries.set(id, entry);
      return { kind: "PREPARED", executionId: id, ...structuredClone(curated) };
    },
    stage(
      owner: GenerationExecutionOwner,
      input: FilmGenerationStillExecution,
      kind: "image" | "continuity",
    ) {
      if (
        !exact(input, ["executionId", "stageId"]) ||
        !text(input.executionId) ||
        !text(input.stageId)
      )
        return fail("INVALID_INPUT");
      const entry = owned(owner, input.executionId);
      const stage = entry.public.stages.find((stage) => stage.stageId === input.stageId);
      if (!stage || (stage.kind === "continuity-frame") !== (kind === "continuity"))
        return fail("EXECUTION_UNAVAILABLE");
      const isCurrent = () =>
        current(entry) &&
        entry.stageSlots.get(stage.stageId)!.some((id) => !entry.slots.get(id)!.retired);
      if (!isCurrent()) return fail("EXECUTION_UNAVAILABLE");
      return {
        privateState: entry.registration.privateState,
        stage: structuredClone(stage),
        current: isCurrent,
        assertCurrent: () => {
          if (!isCurrent()) return fail("EXECUTION_UNAVAILABLE");
        },
      };
    },
    video(owner: GenerationExecutionOwner, input: FilmGenerationVideoExecution) {
      if (
        !exact(input, ["executionId", "videoSlotId", "shotId", "takeId"]) ||
        !text(input.executionId) ||
        !text(input.videoSlotId) ||
        !text(input.shotId) ||
        !text(input.takeId)
      )
        return fail("INVALID_INPUT");
      const entry = owned(owner, input.executionId),
        slot = entry.slots.get(input.videoSlotId);
      if (
        !slot ||
        slot.shotId !== input.shotId ||
        slot.retired ||
        (slot.takeId && slot.takeId !== input.takeId)
      )
        return fail("EXECUTION_UNAVAILABLE");
      const isCurrent = () =>
        current(entry) && !slot.retired && (!slot.takeId || slot.takeId === input.takeId);
      return {
        privateState: entry.registration.privateState,
        shotId: slot.shotId,
        slotIndex: slot.index,
        preparation: slot.preparation,
        current: isCurrent,
        /** Call only after canonical/body/source verification, never merely on renderer lookup. */
        bindVerifiedTake: () => {
          if (!isCurrent()) return fail("EXECUTION_UNAVAILABLE");
          slot.takeId = input.takeId;
        },
        assertCurrent: () => {
          if (!isCurrent()) return fail("EXECUTION_UNAVAILABLE");
        },
      };
    },
    retire(owner: GenerationExecutionOwner, input: { executionId: string; videoSlotId?: string }) {
      if (!input || typeof input !== "object" || Array.isArray(input)) return fail("INVALID_INPUT");
      if (
        !exact(
          input,
          input.videoSlotId === undefined ? ["executionId"] : ["executionId", "videoSlotId"],
        ) ||
        !text(input.executionId) ||
        (input.videoSlotId !== undefined && !text(input.videoSlotId))
      )
        return fail("INVALID_INPUT");
      const entry = entries.get(input.executionId);
      if (
        !entry ||
        entry.owner.id !== owner.id ||
        !alive(owner.current) ||
        !alive(entry.owner.current)
      )
        return fail("EXECUTION_UNAVAILABLE");
      if (input.videoSlotId !== undefined) {
        const slot = entry.slots.get(input.videoSlotId);
        if (!slot) return fail("EXECUTION_UNAVAILABLE");
        slot.retired = true;
        return {
          privateState: entry.registration.privateState,
          shotId: slot.shotId,
          index: slot.index,
        };
      }
      entry.retired = true;
      return { privateState: entry.registration.privateState };
    },
    disposeOwner(ownerId: number) {
      const disposed: State[] = [];
      for (const [id, entry] of entries)
        if (entry.owner.id === ownerId) {
          entry.retired = true;
          entries.delete(id);
          disposed.push(entry.registration.privateState);
        }
      for (const [id, entry] of preparing) if (entry.owner.id === ownerId) preparing.delete(id);
      return disposed;
    },
  };
}

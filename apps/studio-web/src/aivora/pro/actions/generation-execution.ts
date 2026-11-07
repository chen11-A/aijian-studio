import type { FilmProject } from "../../film/project";
import { ProtectedGenerationFailure } from "../../film/generation-execution-failure";
import { NOTICE_TEXT } from "../../film/notices";
import type { UiNotice } from "../../film/contracts3j";
import { historyRecordHash } from "./persistent-history";
import type {
  FilmGenerationExecutionGateway,
  FilmGenerationExecutionInput,
  FilmGenerationExecutionResult,
  FilmGenerationImageStage,
  FilmGenerationStillExecution,
  FilmGenerationExtractionExecution,
  FilmGenerationVideoExecution,
} from "@aijian/contracts/film-generation-execution";

type Prepared = Extract<FilmGenerationExecutionResult, { kind: "PREPARED" }>;
export type GenerationExecutionBridge = Partial<FilmGenerationExecutionGateway>;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const exact = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
  record(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const locator = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 256 && value.trim() === value;
const failures = new Set([
  "INVALID_INPUT",
  "BUSY",
  "PROJECT_CHANGED",
  "SOURCE_UNVERIFIABLE",
  "ACCOUNT_UNAVAILABLE",
  "UNSUPPORTED_SCOPE",
  "EXECUTION_UNAVAILABLE",
  "VIDEO_UNCONFIGURED",
  "VIDEO_INPUT_FAILURE_LIMIT",
  "CREATION_UNCONFIGURED",
  "CREATION_INPUT_UNVERIFIABLE",
  "CREATION_INPUT_FAILURE_LIMIT",
  "CREATION_ATTEMPT_ALREADY_RESERVED",
  "WRITE_UNCONFIRMED",
]);
export const isGenerationExecutionFailureCode = (code: unknown): code is string =>
  typeof code === "string" && failures.has(code);
const fail = (code: string): never => {
  throw Object.assign(new Error(code), { code });
};

/** Keep fixed native failure codes internally, while presenting the actual failed gate. */
export function generationExecutionNotice(error: unknown): UiNotice {
  const raw =
    error && typeof error === "object" && "code" in error
      ? error.code
      : error instanceof Error
        ? error.message
        : "";
  const code =
    typeof raw === "string" && raw.startsWith("CREATION_") && Object.hasOwn(NOTICE_TEXT, raw)
      ? raw
      : raw === "VIDEO_UNCONFIGURED"
        ? "VIDEO_FAILURE_UNCONFIGURED"
        : raw === "VIDEO_INPUT_FAILURE_LIMIT"
          ? "VIDEO_FAILURE_INPUT_FAILURE_LIMIT"
          : raw === "GENERATION_EXECUTION_STALE" ||
              raw === "PROJECT_CHANGED" ||
              raw === "GENERATION_EXECUTION_STAGE_UNAVAILABLE" ||
              raw === "GENERATION_EXECUTION_SLOT_UNAVAILABLE"
            ? "GENERATION_SELECTION_STALE"
            : raw === "GENERATION_EXECUTION_UNAVAILABLE"
              ? "GENERATION_EXECUTION_UNAVAILABLE"
              : raw === "ACCOUNT_UNAVAILABLE"
                ? "GENERATION_EXECUTION_ACCOUNT_UNAVAILABLE"
                : raw === "SOURCE_UNVERIFIABLE"
                  ? "GENERATION_EXECUTION_SOURCE_UNVERIFIABLE"
                  : raw === "UNSUPPORTED_SCOPE"
                    ? "GENERATION_EXECUTION_SCOPE_UNSUPPORTED"
                    : raw === "BUSY"
                      ? "GENERATION_EXECUTION_BUSY"
                      : raw === "WRITE_UNCONFIRMED"
                        ? "GENERATION_EXECUTION_WRITE_UNCONFIRMED"
                        : "GENERATION_EXECUTION_UNCONFIRMED";
  return { code, text: NOTICE_TEXT[code as keyof typeof NOTICE_TEXT] };
}

/** Validate only the declared transient table. It is not a failure identity or authorization. */
export function validGenerationExecution(
  value: unknown,
  input: FilmGenerationExecutionInput,
): value is Prepared {
  if (
    !exact(value, ["kind", "executionId", "projectId", "projectHash", "stages", "targets"]) ||
    value.kind !== "PREPARED" ||
    !locator(value.executionId) ||
    value.projectId !== input.projectId ||
    value.projectHash !== input.expectedProjectHash ||
    !Array.isArray(value.targets) ||
    (input.mode === "video"
      ? value.targets.length !== input.targets.length
      : value.targets.length === 0 || value.targets.length > input.targets.length) ||
    !Array.isArray(value.stages)
  )
    return false;
  const ids = new Set<string>([value.executionId]);
  let nextInput = 0;
  for (const target of value.targets) {
    if (!record(target)) return false;
    if (input.mode === "pipeline")
      while (nextInput < input.targets.length && input.targets[nextInput]?.shotId !== target.shotId)
        nextInput++;
    const wanted = input.targets[nextInput++];
    if (!wanted) return false;
    if (
      !exact(target, ["shotId", "videoSlotIds", "preparation", "slotPreparations"]) ||
      target.shotId !== wanted.shotId ||
      !["CLIENT_IMAGES", "STORYFILM_CACHE"].includes(String(target.preparation)) ||
      !Array.isArray(target.videoSlotIds) ||
      target.videoSlotIds.length !== wanted.versions
    )
      return false;
    const videoSlotIds = target.videoSlotIds;
    if (
      !Array.isArray(target.slotPreparations) ||
      target.slotPreparations.length !== target.videoSlotIds.length ||
      !target.slotPreparations.every(
        (slot, index) =>
          exact(slot, ["videoSlotId", "preparation"]) &&
          slot.videoSlotId === videoSlotIds[index] &&
          (slot.preparation === "CLIENT_IMAGES" || slot.preparation === "STORYFILM_CACHE"),
      )
    )
      return false;
    const allCached = target.slotPreparations.every(
      (slot) => slot.preparation === "STORYFILM_CACHE",
    );
    if (target.preparation !== (allCached ? "STORYFILM_CACHE" : "CLIENT_IMAGES")) return false;
    for (const id of target.videoSlotIds) {
      if (!locator(id) || ids.has(id)) return false;
      ids.add(id);
    }
  }
  const stageKeys = new Set<string>();
  for (const stage of value.stages) {
    if (
      !record(stage) ||
      !locator(stage.stageId) ||
      !locator(stage.targetId) ||
      ids.has(stage.stageId)
    )
      return false;
    const portrait = stage.kind === "portrait",
      continuity = stage.kind === "continuity-frame";
    if (
      !exact(
        stage,
        continuity
          ? ["stageId", "kind", "targetId", "sourceShotId"]
          : portrait
            ? ["stageId", "kind", "targetId", "view"]
            : ["stageId", "kind", "targetId"],
      ) ||
      !["portrait", "shot-frame", "location-reference", "continuity-frame"].includes(
        String(stage.kind),
      ) ||
      (portrait && !["正面", "侧面", "背面", "脸部"].includes(String(stage.view))) ||
      (continuity && (!locator(stage.sourceShotId) || stage.sourceShotId === stage.targetId))
    )
      return false;
    if (
      (stage.kind === "shot-frame" || continuity) &&
      !value.targets.some(
        (target: unknown) =>
          record(target) &&
          target.shotId === stage.targetId &&
          Array.isArray(target.slotPreparations) &&
          target.slotPreparations.some(
            (slot: unknown) => record(slot) && slot.preparation === "CLIENT_IMAGES",
          ),
      )
    )
      return false;
    const key = JSON.stringify([stage.kind, stage.targetId, stage.view ?? null]);
    if (stageKeys.has(key)) return false;
    stageKeys.add(key);
    ids.add(stage.stageId);
  }
  return true;
}

/** One confirmed run; all opaque locators remain in memory and retire before late UI discard. */
export function createGenerationExecutionSession(
  bridge: GenerationExecutionBridge,
  current: () => boolean,
) {
  let prepared: Prepared | undefined,
    retired = false,
    started = false;
  const retiredSlots = new Set<string>();
  const alive = () => {
    if (retired || !current()) return fail("GENERATION_EXECUTION_STALE");
    return prepared ?? fail("GENERATION_EXECUTION_UNAVAILABLE");
  };
  function notifyRetire(input: { executionId: string; videoSlotId?: string }) {
    // A transport failure is not evidence HTTP stopped or an UNKNOWN attempt was released.
    try {
      void bridge.retireFilmGenerationExecution?.(input)?.catch(() => undefined);
    } catch {
      /* The local session stays retired; no completion claim is made. */
    }
  }
  return {
    async prepare(input: FilmGenerationExecutionInput, requestCurrent: () => boolean = () => true) {
      if (retired || !current() || !requestCurrent()) return fail("GENERATION_EXECUTION_STALE");
      if (started) return fail("GENERATION_EXECUTION_ALREADY_PREPARED");
      if (!bridge.prepareFilmGenerationExecution || !bridge.retireFilmGenerationExecution)
        return fail("GENERATION_EXECUTION_UNAVAILABLE");
      started = true;
      let result: FilmGenerationExecutionResult;
      try {
        result = await bridge.prepareFilmGenerationExecution(input);
      } catch {
        return fail("GENERATION_EXECUTION_UNCONFIRMED");
      }
      if (!validGenerationExecution(result, input)) {
        if (
          exact(result, ["kind", "code"]) &&
          result.kind === "FAILED" &&
          typeof result.code === "string" &&
          failures.has(result.code)
        )
          return fail(result.code);
        return fail("GENERATION_EXECUTION_UNCONFIRMED");
      }
      prepared = result;
      if (retired || !current() || !requestCurrent()) {
        retired = true;
        notifyRetire({ executionId: result.executionId });
        return fail("GENERATION_EXECUTION_STALE");
      }
    },
    preparation(shotId: string, index?: number): "CLIENT_IMAGES" | "STORYFILM_CACHE" {
      const target = alive().targets.find((target) => target.shotId === shotId);
      if (!target) return fail("GENERATION_EXECUTION_SLOT_UNAVAILABLE");
      if (index === undefined)
        return target.slotPreparations.some((slot) => slot.preparation === "CLIENT_IMAGES")
          ? "CLIENT_IMAGES"
          : "STORYFILM_CACHE";
      const slot =
        Number.isSafeInteger(index) && index >= 0 ? target.slotPreparations[index] : undefined;
      return slot?.preparation ?? fail("GENERATION_EXECUTION_SLOT_UNAVAILABLE");
    },
    continuity(targetId: string, sourceShotId: string): FilmGenerationExtractionExecution {
      try {
        const plan = alive(),
          matches = plan.stages.filter(
            (s) =>
              s.kind === "continuity-frame" &&
              s.targetId === targetId &&
              s.sourceShotId === sourceShotId,
          );
        if (matches.length !== 1) return fail("GENERATION_EXECUTION_STAGE_UNAVAILABLE");
        return { executionId: plan.executionId, stageId: matches[0]!.stageId };
      } catch (error) {
        const code =
          error && typeof error === "object" && "code" in error && typeof error.code === "string"
            ? error.code
            : "GENERATION_EXECUTION_STAGE_UNAVAILABLE";
        throw protectedGenerationFailure(code);
      }
    },
    image(
      kind: FilmGenerationImageStage["kind"],
      targetId: string,
      view?: string,
    ): FilmGenerationStillExecution {
      try {
        const plan = alive(),
          matches = plan.stages.filter(
            (s) =>
              s.kind !== "continuity-frame" &&
              s.kind === kind &&
              s.targetId === targetId &&
              s.view === view,
          );
        if (matches.length !== 1) return fail("GENERATION_EXECUTION_STAGE_UNAVAILABLE");
        return { executionId: plan.executionId, stageId: matches[0]!.stageId };
      } catch (error) {
        const code =
          error && typeof error === "object" && "code" in error && typeof error.code === "string"
            ? error.code
            : "GENERATION_EXECUTION_STAGE_UNAVAILABLE";
        throw protectedGenerationFailure(code);
      }
    },
    video(shotId: string, index: number, takeId: string): FilmGenerationVideoExecution {
      const plan = alive(),
        target = plan.targets.find((t) => t.shotId === shotId),
        slot = Number.isSafeInteger(index) && index >= 0 ? target?.videoSlotIds[index] : undefined;
      if (!slot || retiredSlots.has(slot) || !takeId)
        return fail("GENERATION_EXECUTION_SLOT_UNAVAILABLE");
      return { executionId: plan.executionId, videoSlotId: slot, shotId, takeId };
    },
    retireSlot(shotId: string, index: number) {
      if (!prepared || retired) return;
      const slot = prepared.targets.find((t) => t.shotId === shotId)?.videoSlotIds[index];
      if (slot && !retiredSlots.has(slot)) {
        retiredSlots.add(slot);
        notifyRetire({ executionId: prepared.executionId, videoSlotId: slot });
      }
    },
    retire() {
      if (retired) return;
      retired = true;
      if (prepared) notifyRetire({ executionId: prepared.executionId });
    },
  };
}
export type GenerationExecutionSession = ReturnType<typeof createGenerationExecutionSession>;

/** Read an already saved, accepted baseline. Never adopt a same-ID raw record here. */
export async function prepareCurrentGenerationExecution(
  session: GenerationExecutionSession,
  base: FilmProject,
  scope: Pick<FilmGenerationExecutionInput, "mode" | "targets">,
  host: {
    current: () => FilmProject | null;
    valid: () => boolean;
    read: (id: string) => Promise<unknown>;
  },
) {
  const guard = () => host.valid() && host.current() === base;
  if (!guard()) return fail("GENERATION_EXECUTION_STALE");
  const raw = await host.read(base.id);
  if (!guard() || !record(raw) || raw.id !== base.id) return fail("GENERATION_EXECUTION_STALE");
  const business = (value: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(value).filter(([key]) => key !== "savedAt" && key !== "directory"),
    );
  const [acceptedKey, rawKey, expectedProjectHash] = await Promise.all([
    historyRecordHash(business(base as unknown as Record<string, unknown>)),
    historyRecordHash(business(raw)),
    historyRecordHash(raw),
  ]);
  if (!guard() || acceptedKey !== rawKey) return fail("GENERATION_EXECUTION_STALE");
  await session.prepare({ projectId: base.id, expectedProjectHash, ...scope }, guard);
}

export function protectedGenerationFailure(code: string) {
  return new ProtectedGenerationFailure(code, generationExecutionNotice({ code }).text);
}

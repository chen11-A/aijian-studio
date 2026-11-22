import type {
  FilmGenerationExecutionInput,
  FilmGenerationVideoSelection,
  FilmImageModelSelection,
  FilmGenerationExecutionFailure,
  FilmGenerationExecutionResult,
} from "@aijian/contracts/film-generation-execution";
import {
  createFilmGenerationExecutionRegistry,
  GenerationExecutionRegistryError,
  type GenerationExecutionOwner,
  type GenerationExecutionRegistration,
} from "./film-generation-execution-registry";
import type { FilmGenerationExecutionService } from "./film-generation-execution-ipc";

/** Only trusted native adapters may construct this error, never provider reason text. */
export class GenerationExecutionServiceError extends Error {
  constructor(readonly code: FilmGenerationExecutionFailure) {
    super(code);
  }
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
function videoSelection(raw: unknown): FilmGenerationVideoSelection | null {
  if (
    !object(raw) ||
    !exact(
      raw,
      raw.connectionId === undefined
        ? ["provider", "modelId"]
        : ["provider", "modelId", "connectionId"],
    ) ||
    !["XAI_API", "CHATGPT_OFFICIAL", "GROK_LOGIN", "CONNECTION"].includes(String(raw.provider)) ||
    typeof raw.modelId !== "string" ||
    !/^[A-Za-z0-9._-]{1,80}$/.test(raw.modelId) ||
    (raw.provider === "CONNECTION"
      ? typeof raw.connectionId !== "string" || !/^[A-Za-z0-9._-]{1,200}$/.test(raw.connectionId)
      : raw.connectionId !== undefined)
  )
    return null;
  return {
    provider: raw.provider as FilmGenerationVideoSelection["provider"],
    modelId: raw.modelId,
    ...(typeof raw.connectionId === "string" ? { connectionId: raw.connectionId } : {}),
  };
}
// Match valid model-center IDs, including gateway model names with slashes.
// This is shape validation only: unsupported preferences are decided at an actual image sink.
function imageSelection(raw: unknown): FilmImageModelSelection | null {
  if (
    !object(raw) ||
    typeof raw.provider !== "string" ||
    !["XAI_API", "CHATGPT_OFFICIAL", "GROK_LOGIN", "CONNECTION"].includes(raw.provider)
  )
    return null;
  const id = (value: unknown): value is string =>
    typeof value === "string" && value.length > 0 && value.length <= 200 && !/\s/u.test(value);
  const fields =
    raw.provider === "CONNECTION"
      ? ["provider", "modelId", "connectionId"]
      : ["provider", "modelId"];
  if (
    !exact(raw, fields) ||
    !id(raw.modelId) ||
    (raw.provider === "CONNECTION" && !id(raw.connectionId))
  )
    return null;
  return {
    provider: raw.provider,
    modelId: raw.modelId,
    ...(typeof raw.connectionId === "string" ? { connectionId: raw.connectionId } : {}),
  };
}
function parse(raw: unknown): FilmGenerationExecutionInput | null {
  if (
    !object(raw) ||
    !exact(raw, [
      "projectId",
      "expectedProjectHash",
      "mode",
      "targets",
      ...(Object.hasOwn(raw, "videoSelection") ? ["videoSelection"] : []),
      ...(Object.hasOwn(raw, "imageSelection") ? ["imageSelection"] : []),
    ]) ||
    typeof raw.projectId !== "string" ||
    !/^film_[a-z0-9]{16,40}$/.test(raw.projectId) ||
    typeof raw.expectedProjectHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(raw.expectedProjectHash) ||
    (raw.mode !== "video" && raw.mode !== "pipeline") ||
    !Array.isArray(raw.targets) ||
    !raw.targets.length ||
    raw.targets.length > 1024
  )
    return null;
  const selection = Object.hasOwn(raw, "videoSelection")
    ? videoSelection(raw.videoSelection)
    : undefined;
  const image = Object.hasOwn(raw, "imageSelection")
    ? imageSelection(raw.imageSelection)
    : undefined;
  if (selection === null || image === null) return null;
  const ids = new Set<string>(),
    targets: FilmGenerationExecutionInput["targets"][number][] = [];
  for (const target of raw.targets) {
    if (
      !object(target) ||
      !exact(target, ["shotId", "versions"]) ||
      typeof target.shotId !== "string" ||
      !target.shotId ||
      target.shotId.length > 160 ||
      target.shotId.trim() !== target.shotId ||
      target.shotId.includes("\0") ||
      ids.has(target.shotId) ||
      (target.versions !== 1 && target.versions !== 2 && target.versions !== 3)
    )
      return null;
    ids.add(target.shotId);
    targets.push({ shotId: target.shotId, versions: target.versions });
  }
  return {
    projectId: raw.projectId,
    expectedProjectHash: raw.expectedProjectHash,
    mode: raw.mode,
    targets,
    ...(selection ? { videoSelection: selection } : {}),
    ...(image ? { imageSelection: image } : {}),
  };
}
/** Lifecycle around the trusted canonical/source/cache/ledger compiler, not a replacement
 * for it. No PREPARED is published until the adapter completes every required capability. */
export function createFilmGenerationExecutionService<State>(host: {
  prepare: (
    input: FilmGenerationExecutionInput,
    owner: GenerationExecutionOwner,
  ) => Promise<
    | GenerationExecutionRegistration<State>
    | Extract<FilmGenerationExecutionResult, { kind: "NOT_NEEDED" }>
  >;
  retire: (state: State, slot?: { shotId: string; index: number }) => Promise<void>;
}) {
  const registry = createFilmGenerationExecutionRegistry<State>();
  const ownerEpochs = new Map<number, symbol>();
  const cleanup = async (state: State, slot?: { shotId: string; index: number }) => {
    try {
      await host.retire(state, slot);
    } catch {
      /* Local retirement stays final; no UNKNOWN release or HTTP-stop claim. */
    }
  };
  const service: FilmGenerationExecutionService = {
    async prepare(owner, raw) {
      const input = parse(raw);
      if (!input) return { kind: "FAILED", code: "INVALID_INPUT" };
      let epoch = ownerEpochs.get(owner.id);
      if (!epoch) {
        epoch = Symbol("native-document");
        ownerEpochs.set(owner.id, epoch);
      }
      const ownerId = owner.id,
        nativeCurrent = owner.current;
      const capturedOwner = Object.freeze({
        id: ownerId,
        current: () => ownerEpochs.get(ownerId) === epoch && nativeCurrent(),
      });
      let release: (() => void) | undefined,
        registration: GenerationExecutionRegistration<State> | undefined;
      try {
        release = registry.beginPreparation(capturedOwner, input.projectId);
        // Preserve the captured native owner predicate across every adapter await.
        const result = await host.prepare(input, capturedOwner);
        if ("kind" in result) {
          if (
            input.mode !== "pipeline" ||
            result.kind !== "NOT_NEEDED" ||
            !exact(result, ["kind", "projectId", "projectHash", "reason", "selected"]) ||
            result.projectId !== input.projectId ||
            result.projectHash !== input.expectedProjectHash ||
            result.reason !== "LOCAL_SELECTED_MEDIA" ||
            !Array.isArray(result.selected) ||
            result.selected.length !== input.targets.length ||
            !result.selected.every(
              (selection, index) =>
                object(selection) &&
                exact(selection, ["shotId", "takeId"]) &&
                selection.shotId === input.targets[index]?.shotId &&
                typeof selection.takeId === "string" &&
                selection.takeId.length > 0 &&
                selection.takeId.length <= 160 &&
                selection.takeId.trim() === selection.takeId &&
                !selection.takeId.includes("\0"),
            )
          )
            throw new GenerationExecutionServiceError("EXECUTION_UNAVAILABLE");
          if (!capturedOwner.current())
            throw new GenerationExecutionServiceError("EXECUTION_UNAVAILABLE");
          return structuredClone(result);
        }
        registration = result;
        const published = registration.public;
        let cursor = 0;
        if (
          published.projectId !== input.projectId ||
          published.projectHash !== input.expectedProjectHash ||
          !published.targets.length ||
          (input.mode === "video" && published.targets.length !== input.targets.length) ||
          !published.targets.every((target) => {
            if (input.mode === "pipeline")
              while (
                cursor < input.targets.length &&
                input.targets[cursor]?.shotId !== target.shotId
              )
                cursor++;
            const expected = input.targets[cursor++];
            return (
              expected?.shotId === target.shotId && target.videoSlotIds.length === expected.versions
            );
          })
        )
          throw new GenerationExecutionServiceError("EXECUTION_UNAVAILABLE");
        return registry.register(capturedOwner, registration);
      } catch (error) {
        if (registration) await cleanup(registration.privateState);
        return {
          kind: "FAILED",
          code:
            error instanceof GenerationExecutionRegistryError ||
            error instanceof GenerationExecutionServiceError
              ? error.code
              : "EXECUTION_UNAVAILABLE",
        };
      } finally {
        release?.();
      }
    },
    async retire(owner, raw) {
      if (!object(raw)) return { kind: "FAILED", code: "INVALID_INPUT" };
      try {
        // Registry closes captured stage/video predicates synchronously, before cleanup awaits.
        const retired = registry.retire(
          owner,
          raw as { executionId: string; videoSlotId?: string },
        );
        await cleanup(
          retired.privateState,
          typeof retired.shotId === "string" && typeof retired.index === "number"
            ? { shotId: retired.shotId, index: retired.index }
            : undefined,
        );
        return { kind: "RETIRED" };
      } catch (error) {
        return {
          kind: "FAILED",
          code:
            error instanceof GenerationExecutionRegistryError && error.code === "INVALID_INPUT"
              ? "INVALID_INPUT"
              : "EXECUTION_UNAVAILABLE",
        };
      }
    },
  };
  return {
    ...service,
    stage: registry.stage,
    video: registry.video,
    disposeOwner(ownerId: number) {
      ownerEpochs.delete(ownerId);
      const states = registry.disposeOwner(ownerId);
      return Promise.all(states.map((state) => cleanup(state))).then(() => undefined);
    },
  };
}

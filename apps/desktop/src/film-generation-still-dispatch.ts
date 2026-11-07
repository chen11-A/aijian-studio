import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { GenerationExecutionServiceError } from "./film-generation-execution-service";
import { readMedia, requestStill } from "./film-library";
import { GenerationExecutionRegistryError } from "./film-generation-execution-registry";
import type {
  FilmGenerationExecutionFailure,
  FilmGenerationStillResult,
} from "@aijian/contracts/film-generation-execution";

export class GenerationStillDispatchError extends Error {
  constructor(readonly code: FilmGenerationExecutionFailure) {
    super(code);
  }
}
type Wire = { input: Parameters<typeof fetch>[0]; init: RequestInit };
type OriginalOptions = Parameters<typeof requestStill>[0];
export type ProtectedStillDispatch = Omit<OriginalOptions, "fetcher" | "onImageBytes"> & {
  fetcher: typeof fetch;
  current: () => boolean;
  /** Trusted adapter verifies the actual wire body and reserves before calling dispatch.
   * It may invoke dispatch inside the original project queue, without awaiting HTTP there. */
  beforePost: (wire: Wire, dispatch: () => Promise<Response>) => Promise<Response>;
  /** Adapter releases only its own proven-not-sent pending reservation, never UNKNOWN. */
  notSent: () => Promise<void>;
  /** Native path only; the adapter hashes/verifies bytes and writes durable private facts. */
  observed: (
    path: string | null,
    facts: { transportUnconfirmed: boolean; outputUnconfirmed?: true; outputSha256?: string },
  ) => Promise<void>;
};
const current = (guard: () => boolean) => {
  try {
    return guard() === true;
  } catch {
    return false;
  }
};
const failureCode = (error: unknown): FilmGenerationExecutionFailure =>
  error instanceof GenerationStillDispatchError ||
  error instanceof GenerationExecutionRegistryError ||
  error instanceof GenerationExecutionServiceError
    ? error.code
    : "WRITE_UNCONFIRMED";
const reason = "生成记录尚未确认，请先核对任务和素材。";

/** Reuse the one production image serializer/downloader. Only the final real provider
 * transport sets dispatched; a reservation or attempted gate is not a model dispatch. */
export async function dispatchProtectedGenerationStill(
  options: ProtectedStillDispatch,
): Promise<FilmGenerationStillResult> {
  let dispatched = false,
    transportUnconfirmed = false,
    outputUnconfirmed = false;
  let failure: FilmGenerationExecutionFailure | undefined;
  let originalOutputSha256: string | undefined;
  if (!options.token || !current(options.current))
    return {
      path: "",
      reason,
      code: options.token ? "EXECUTION_UNAVAILABLE" : "ACCOUNT_UNAVAILABLE",
    };
  let made: { path: string; reason: string } = { path: "", reason };
  try {
    made = await requestStill({
      ...options,
      onImageBytes: (bytes) => {
        originalOutputSha256 = createHash("sha256").update(bytes).digest("hex");
      },
      fetcher: async (input, init) => {
        if (init?.method !== "POST") {
          try {
            const response = await options.fetcher(input, init);
            if (!response.ok) {
              outputUnconfirmed = true;
              failure = "WRITE_UNCONFIRMED";
            }
            return response;
          } catch (error) {
            transportUnconfirmed = true;
            outputUnconfirmed = true;
            failure = "WRITE_UNCONFIRMED";
            throw error;
          }
        }
        try {
          const response = await options.beforePost({ input, init }, () => {
            if (dispatched) {
              failure = "WRITE_UNCONFIRMED";
              throw new GenerationStillDispatchError(failure);
            }
            // No await between this check, the dispatch fact, and the actual fetch call.
            if (!current(options.current))
              throw new GenerationStillDispatchError("EXECUTION_UNAVAILABLE");
            dispatched = true;
            return options.fetcher(input, init);
          });
          if (!dispatched) throw new GenerationStillDispatchError("EXECUTION_UNAVAILABLE");
          if (response.status === 401 || response.status === 403) failure = "ACCOUNT_UNAVAILABLE";
          return response;
        } catch (error) {
          if (dispatched) {
            transportUnconfirmed = true;
            failure = "WRITE_UNCONFIRMED";
          } else failure = failureCode(error);
          throw error;
        }
      },
    });
  } catch {
    // requestStill may throw after POST, while reading download bytes or writing the file.
    // An output failure never proves that the paid request was not sent.
    outputUnconfirmed = dispatched;
    failure = "WRITE_UNCONFIRMED";
  }
  if (dispatched && !made.path) {
    outputUnconfirmed = true;
    failure ??= "WRITE_UNCONFIRMED";
  }
  if (!dispatched) {
    try {
      await options.notSent();
    } catch {
      failure = "WRITE_UNCONFIRMED";
    }
    return {
      path: "",
      reason: failure ? reason : made.reason,
      code: failure ?? "UNSUPPORTED_SCOPE",
    };
  }
  let observedPath = made.path || null;
  if (observedPath) {
    try {
      if (!originalOutputSha256 || observedPath !== options.destination)
        throw Error("output unconfirmed");
      await readMedia([dirname(options.destination)], observedPath, {
        maxBytes: 12_000_000,
        expectedSha256: originalOutputSha256,
      });
    } catch {
      observedPath = null;
      outputUnconfirmed = true;
      failure = "WRITE_UNCONFIRMED";
    }
  }
  try {
    await options.observed(observedPath, {
      transportUnconfirmed,
      ...(outputUnconfirmed ? { outputUnconfirmed: true } : {}),
      ...(observedPath ? { outputSha256: originalOutputSha256 } : {}),
    });
  } catch {
    failure = "WRITE_UNCONFIRMED";
  }
  if (!current(options.current)) failure ??= "EXECUTION_UNAVAILABLE";
  if (failure) return { path: current(options.current) ? made.path : "", reason, code: failure };
  return made;
}

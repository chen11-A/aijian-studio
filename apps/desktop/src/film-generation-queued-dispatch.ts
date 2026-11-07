import { transactFilmProject, type FilmRecord } from "./film-library";
import { GenerationExecutionServiceError } from "./film-generation-execution-service";

/** Reserve/arm outside this helper. Re-read and verify the actual canonical project on
 * its existing save queue, then synchronously enter transport. Never hold that queue
 * while awaiting provider HTTP. The verifier is the native bounded source/body check,
 * not a renderer hash, permission callback or second persistence engine. */
export async function dispatchGenerationOnProjectQueue(options: {
  filmsRoot: string;
  projectId: string;
  current: () => boolean;
  verifyCanonical: (record: FilmRecord) => Promise<void>;
  dispatch: () => Promise<Response>;
}): Promise<Response> {
  const check = () => {
    let valid = false;
    try {
      valid = options.current() === true;
    } catch {
      /* Closed native predicate. */
    }
    if (!valid) throw new GenerationExecutionServiceError("EXECUTION_UNAVAILABLE");
  };
  check();
  type Outcome = { kind: "response"; response: Response } | { kind: "error"; error: unknown };
  let outcome: Promise<Outcome> | undefined;
  await transactFilmProject(options.filmsRoot, options.projectId, async (record) => {
    if (!record) throw new GenerationExecutionServiceError("PROJECT_CHANGED");
    check();
    await options.verifyCanonical(record);
    // No await between this final owner/account/retirement gate and actual transport.
    check();
    try {
      outcome = options.dispatch().then(
        (response): Outcome => ({ kind: "response", response }),
        (error: unknown): Outcome => ({ kind: "error", error }),
      );
    } catch (error) {
      outcome = Promise.resolve({ kind: "error", error });
    }
    // Returning an empty completion releases the original save queue now. Rejection
    // is observed synchronously above so an early transport failure cannot go unhandled.
  });
  if (!outcome) throw new GenerationExecutionServiceError("EXECUTION_UNAVAILABLE");
  const result = await outcome;
  if (result.kind === "error") throw result.error;
  return result.response;
}

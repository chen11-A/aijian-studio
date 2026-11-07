import type { FilmGenerationExecutionGateway } from "@aijian/contracts/film-generation-execution";
import type { GenerationExecutionOwner } from "./film-generation-execution-registry";

/** Internal service boundary; these callbacks must re-read/verify canonical inputs.
 * IPC supplies only the real sender's owner/document scope, never renderer metadata. */
export type FilmGenerationExecutionService = {
  prepare(
    owner: GenerationExecutionOwner,
    input: unknown,
  ): ReturnType<FilmGenerationExecutionGateway["prepareFilmGenerationExecution"]>;
  retire(
    owner: GenerationExecutionOwner,
    input: unknown,
  ): ReturnType<FilmGenerationExecutionGateway["retireFilmGenerationExecution"]>;
};
export const FILM_GENERATION_EXECUTION_CHANNELS = {
  prepare: "film:generation-execution-prepare",
  retire: "film:generation-execution-retire",
} as const;
export function registerFilmGenerationExecutions<Event>(
  handle: (channel: string, run: (event: Event, ...args: unknown[]) => Promise<unknown>) => void,
  authorized: (event: Event) => boolean,
  owner: (event: Event) => GenerationExecutionOwner,
  service: FilmGenerationExecutionService,
) {
  for (const action of ["prepare", "retire"] as const) {
    handle(FILM_GENERATION_EXECUTION_CHANNELS[action], async (event, ...args) => {
      if (!authorized(event)) throw Error("Unauthorized generation execution sender");
      if (args.length !== 1) return { kind: "FAILED", code: "INVALID_INPUT" };
      return service[action](owner(event), args[0]);
    });
  }
}

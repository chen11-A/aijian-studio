import { getModelCenterSnapshot } from "../account/model-center";
import type { FilmGenerationVideoSelection } from "@aijian/contracts/film-generation-execution";

/** Call synchronously at the existing human consent/run boundary, before awaits.
 * Later model-center edits apply only to a later run, not this execution. */
export function snapshotVideoSelection(): FilmGenerationVideoSelection | undefined {
  const choice = getModelCenterSnapshot().choices.VIDEO;
  return choice ? { ...choice } : undefined;
}

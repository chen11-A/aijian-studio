import { parseStoryFilmCreate, type StoryFilmCreateInput } from "./story-film-client";
import type * as Producer from "./film-generation-producer.js";

export type CanonicalGenerationProducer = typeof Producer;

/** One fixed compiled module; no renderer path, runtime repo lookup or loader fallback. */
export async function loadCanonicalGenerationProducer(): Promise<CanonicalGenerationProducer> {
  return import(/* @vite-ignore */ "./film-generation-producer.js");
}

/** Recompile the original effective request on native canonical data. The result still
 * passes the existing strict request parser and materialized-reference/send gates. */
export function compileCanonicalGenerationTarget(
  producer: CanonicalGenerationProducer,
  record: Record<string, unknown>,
  shotId: string,
): StoryFilmCreateInput {
  if (!Array.isArray(record.shots)) throw Error("UNSUPPORTED_SCOPE");
  const shots = record.shots.filter(
    (row): row is Record<string, unknown> =>
      row !== null && typeof row === "object" && !Array.isArray(row) && row.id === shotId,
  );
  if (shots.length !== 1) throw Error("UNSUPPORTED_SCOPE");
  const batches = producer.storyFilmBatches(record, shots, record.draft === true);
  if (batches.length !== 1) throw Error("UNSUPPORTED_SCOPE");
  const parsed = parseStoryFilmCreate(batches[0]);
  if (parsed.provider !== "grok_subscription" || parsed.shots?.length !== 1)
    throw Error("UNSUPPORTED_SCOPE");
  return parsed;
}

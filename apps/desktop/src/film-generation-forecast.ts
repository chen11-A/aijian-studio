import type { CanonicalGenerationProducer } from "./film-generation-compiler";
import { compileCanonicalGenerationTarget } from "./film-generation-compiler";
import {
  compileCanonicalStageImage,
  generationObject,
  generationRows,
  type CanonicalGenerationPlan,
  type PlannedGenerationStage,
} from "./film-generation-plan";
import { IMAGE_MODEL, normalizeFilmStillPrompt } from "./film-library";
import type { StoryFilmCreateInput } from "./story-film-client";

export type ForecastImageCreator = {
  model: typeof IMAGE_MODEL;
  prompt: string;
  aspectRatio: "9:16" | "16:9";
  /** May reference a prior forecast marker, never a future stage or invented file. */
  references: readonly string[];
};
export type ForecastStageInput = {
  stageId: string;
  creator: ForecastImageCreator;
};
export type ForecastGenerationTarget = {
  key: string;
  body: StoryFilmCreateInput;
  clientFrame?: ForecastImageCreator;
};
export type GenerationReferenceForecast = {
  targets: ForecastGenerationTarget[];
  stages: ForecastStageInput[];
  /** Private compiler locators only. These URLs are NEVER media or output proof. */
  plannedSources: ReadonlyMap<string, ForecastImageCreator>;
};
const fail = (): never => {
  throw Error("UNSUPPORTED_SCOPE");
};

function shotFrame(
  producer: CanonicalGenerationProducer,
  record: Record<string, unknown>,
  targetId: string,
): ForecastImageCreator {
  const shot = generationRows(record.shots).find((row) => row.id === targetId);
  if (!shot) return fail();
  const frame = generationObject(
    producer.shotStillInput(record, shot, producer.keyframePrompt(shot, record)),
  );
  if (
    !frame ||
    frame.kind !== "READY" ||
    typeof frame.prompt !== "string" ||
    !Array.isArray(frame.references) ||
    frame.references.some((value) => typeof value !== "string") ||
    frame.references.length > 5
  )
    return fail();
  return {
    model: IMAGE_MODEL,
    prompt: normalizeFilmStillPrompt(frame.prompt),
    aspectRatio: record.aspectRatio === "16:9" ? "16:9" : "9:16",
    references: [...frame.references] as string[],
  };
}

/** Execute only the original pure creative reducers/selectors on a private view.
 * No placeholder is written to FilmProject, sent to a provider or accepted as bytes.
 * Stage IDs locate execution entries; callers must replace selected marker references
 * with creator input before computing a failure identity, never hash these locators. */
export function forecastGenerationReferences(
  producer: CanonicalGenerationProducer,
  plan: CanonicalGenerationPlan,
  intent: Record<string, unknown>,
): GenerationReferenceForecast {
  const view = generationObject(producer.prepareSceneLocations(structuredClone(intent)));
  if (!view) return fail();
  const stages: ForecastStageInput[] = [];
  const plannedSources = new Map<string, ForecastImageCreator>();
  const rememberStage = (stage: PlannedGenerationStage, creator: ForecastImageCreator) => {
    const actual = plan.stages.filter(
      (candidate) =>
        candidate.public.kind === stage.public.kind &&
        candidate.public.targetId === stage.public.targetId &&
        (candidate.public.kind !== "portrait" ||
          (stage.public.kind === "portrait" && candidate.public.view === stage.public.view)),
    );
    if (actual.length > 1) return fail();
    if (actual[0]) stages.push({ stageId: actual[0].public.stageId, creator });
  };
  const apply = (stage: PlannedGenerationStage, index: number) => {
    const descriptor = stage.public;
    if (descriptor.kind === "continuity-frame") return fail();
    if (descriptor.kind === "shot-frame") {
      rememberStage(stage, shotFrame(producer, view!, descriptor.targetId));
      return;
    }
    const marker = `https://aivora-planned.invalid/internal-${index}.png`;
    if (
      generationRows(view!.locations).some((place) => place.referenceImage === marker) ||
      generationRows(view!.characters).some(
        (person) =>
          Array.isArray(person.portraits) &&
          person.portraits.some((raw) => generationObject(raw)?.url === marker),
      )
    )
      return fail();
    const input = compileCanonicalStageImage(producer, view!, stage);
    const creator: ForecastImageCreator = {
      model: IMAGE_MODEL,
      prompt: normalizeFilmStillPrompt(input.prompt),
      aspectRatio: input.aspectRatio,
      references: [...input.references],
    };
    if (descriptor.kind === "location-reference") {
      const place = generationRows(view!.locations).find((row) => row.id === descriptor.targetId);
      if (!place) return fail();
      const fields = generationObject(producer.locationImageFields(view, place, marker));
      if (!fields) return fail();
      Object.assign(place, fields);
    } else {
      const person = generationRows(view!.characters).find((row) => row.id === descriptor.targetId);
      if (!person || !Array.isArray(person.portraits)) return fail();
      const portraits = person.portraits.map(generationObject);
      if (portraits.some((row) => !row)) return fail();
      const matching = portraits.filter((row) => row?.view === descriptor.view);
      if (matching.length > 1) return fail();
      if (matching[0]) matching[0].url = marker;
      else person.portraits.push({ view: descriptor.view, url: marker });
    }
    plannedSources.set(marker, creator);
    rememberStage(stage, creator);
  };
  for (const [index, stage] of (plan.intentStages ?? plan.stages).entries()) apply(stage, index);
  const targets = plan.targets.map((target): ForecastGenerationTarget => ({
    key: target.key,
    body: compileCanonicalGenerationTarget(producer, view!, target.shotId),
    ...(target.clientFrame ? { clientFrame: shotFrame(producer, view!, target.shotId) } : {}),
  }));
  return { targets, stages, plannedSources };
}

export type ForecastReferenceIdentity =
  | { sha256: string; mime: string }
  | {
      plannedImage: {
        model: typeof IMAGE_MODEL;
        prompt: string;
        aspectRatio: "9:16" | "16:9";
        references: ForecastReferenceIdentity[];
      };
    };

/** Resolve only the references actually selected by the original consumer. It does
 * not include unused global stages or their execution IDs. Existing references
 * require real trusted bytes; planned ones retain recursively consumed creator inputs. */
export async function forecastReferenceInputs(
  forecast: GenerationReferenceForecast,
  references: readonly string[],
  capture: (source: string) => Promise<{ sha256: string; mime: string }>,
): Promise<ForecastReferenceIdentity[]> {
  if (references.length > 13 || forecast.plannedSources.size > 1024) return fail();
  const active = new Set<string>();
  let count = 0;
  const resolve = async (source: string, depth: number): Promise<ForecastReferenceIdentity> => {
    if (++count > 2048 || depth > 8 || active.has(source)) return fail();
    const creator = forecast.plannedSources.get(source);
    if (!creator) {
      if (source.startsWith("https://aivora-planned.invalid/")) return fail();
      const captured = await capture(source);
      if (
        !/^[a-f0-9]{64}$/.test(captured.sha256) ||
        !["image/png", "image/jpeg", "image/webp"].includes(captured.mime)
      )
        return fail();
      return { sha256: captured.sha256, mime: captured.mime };
    }
    active.add(source);
    const nested: ForecastReferenceIdentity[] = [];
    for (const reference of creator.references) nested.push(await resolve(reference, depth + 1));
    active.delete(source);
    return {
      plannedImage: {
        model: creator.model,
        prompt: creator.prompt,
        aspectRatio: creator.aspectRatio,
        references: nested,
      },
    };
  };
  const result: ForecastReferenceIdentity[] = [];
  for (const reference of references) result.push(await resolve(reference, 0));
  return result;
}

export type GenerationForecastInput = {
  body: StoryFilmCreateInput;
  client_frame?: {
    model: typeof IMAGE_MODEL;
    prompt: string;
    aspect_ratio: "9:16" | "16:9";
    references: string[];
  };
  sources: {
    source: string;
    identity: Extract<ForecastReferenceIdentity, { plannedImage: unknown }>;
  }[];
};

/** Typed private protocol projection. This does not register an execution or enable
 * a missing native capability. A caller must also close actual stage reference/lineage
 * checks before enabling these scopes; the existing fixed-reference builder stays closed. */
export async function buildGenerationForecastInputs(
  forecast: GenerationReferenceForecast,
  capture: (source: string) => Promise<{ sha256: string; mime: string }>,
): Promise<
  {
    key: string;
    forecast?: GenerationForecastInput;
    fixedSources: { source: string; sha256: string }[];
  }[]
> {
  const result: {
    key: string;
    forecast?: GenerationForecastInput;
    fixedSources: { source: string; sha256: string }[];
  }[] = [];
  for (const target of forecast.targets) {
    const frame = target.clientFrame;
    const references = new Set<string>(frame?.references ?? []);
    for (const shot of target.body.shots ?? []) {
      if (shot.still) references.add(shot.still);
      if (shot.reference) references.add(shot.reference);
      for (const reference of shot.references ?? []) references.add(reference);
    }
    const planned: GenerationForecastInput["sources"] = [];
    const fixedSources: { source: string; sha256: string }[] = [];
    for (const source of references) {
      const identity = (await forecastReferenceInputs(forecast, [source], capture))[0]!;
      if ("plannedImage" in identity) planned.push({ source, identity });
      else fixedSources.push({ source, sha256: identity.sha256 });
    }
    result.push({
      key: target.key,
      fixedSources,
      ...(planned.length
        ? {
            forecast: {
              body: structuredClone(target.body),
              ...(frame
                ? {
                    client_frame: {
                      model: frame.model,
                      prompt: frame.prompt,
                      aspect_ratio: frame.aspectRatio,
                      references: [...frame.references],
                    },
                  }
                : {}),
              sources: planned,
            },
          }
        : {}),
    });
  }
  return result;
}

/** Closed validation of the symbolic identity graph received only from private
 * account/project-scoped lineage facts. Creative metadata is never read as proof. */
export function validForecastReferenceInputs(
  values: unknown,
): values is ForecastReferenceIdentity[] {
  if (!Array.isArray(values) || values.length > 13) return false;
  const pending = values.map((value) => ({ value, depth: 0 }));
  let count = 0;
  while (pending.length) {
    const { value, depth } = pending.pop()!;
    if (++count > 2048 || depth > 8) return false;
    const row = generationObject(value);
    if (!row) return false;
    if (Object.keys(row).length === 2 && "sha256" in row && "mime" in row) {
      if (
        typeof row.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(row.sha256) ||
        !["image/png", "image/jpeg", "image/webp"].includes(String(row.mime))
      )
        return false;
      continue;
    }
    if (Object.keys(row).length !== 1 || !Object.hasOwn(row, "plannedImage")) return false;
    const creator = generationObject(row.plannedImage);
    if (
      !creator ||
      Object.keys(creator).length !== 4 ||
      creator.model !== IMAGE_MODEL ||
      typeof creator.prompt !== "string" ||
      !creator.prompt ||
      creator.prompt.length > 2000 ||
      !["9:16", "16:9"].includes(String(creator.aspectRatio)) ||
      !Array.isArray(creator.references) ||
      creator.references.length > 13
    )
      return false;
    pending.push(...creator.references.map((value) => ({ value, depth: depth + 1 })));
  }
  return true;
}

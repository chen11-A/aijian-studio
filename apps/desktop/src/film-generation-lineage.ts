import type { CanonicalGenerationProducer } from "./film-generation-compiler";
import { compileCanonicalGenerationTarget } from "./film-generation-compiler";
import type { GenerationImageSources } from "./film-generation-sources";
import { generationObject as object, generationRows } from "./film-generation-plan";
import { filmHistoryRecordText } from "./film-history";
import type { StoryFilmCreateInput } from "./story-film-client";
import { IMAGE_MODEL, normalizeFilmStillPrompt } from "./film-library";

type ImageLineage = {
  output_sha256: string;
  stage: {
    kind: "location-reference" | "portrait" | "shot-frame";
    target_id: string;
    view?: string;
    origin: Record<string, unknown>;
  };
};
const fail = (): never => {
  throw Error("SOURCE_UNVERIFIABLE");
};
const same = (a: unknown, b: unknown) => filmHistoryRecordText(a) === filmHistoryRecordText(b);

export async function generationBodyIdentity(
  body: StoryFilmCreateInput,
  sources: GenerationImageSources,
) {
  const snapshot = structuredClone(body);
  delete snapshot.regenerate;
  const shots = [];
  for (const row of snapshot.shots ?? []) {
    const references: { sha256: string; mime: string }[] = [];
    for (const ref of row.references ?? []) {
      const image = await sources.capture(ref);
      references.push({ sha256: image.sha256, mime: image.mime });
    }
    const still = row.still ? await sources.capture(row.still) : null;
    const reference = row.reference ? await sources.capture(row.reference) : null;
    shots.push({
      ...row,
      still: still ? { sha256: still.sha256, mime: still.mime } : null,
      reference: reference ? { sha256: reference.sha256, mime: reference.mime } : null,
      references,
    });
  }
  return filmHistoryRecordText({ ...snapshot, shots });
}

/** Private native/API facts only. None of these fields is read from FilmProject's
 * metadata as a proof. Account/project scope was already checked by the API lookup. */
function lineages(values: readonly unknown[]): ImageLineage[] {
  if (values.length > 2048) return fail();
  const result: ImageLineage[] = [];
  for (const value of values) {
    const row = object(value),
      stage = object(row?.stage),
      origin = object(stage?.origin);
    if (
      !row ||
      !stage ||
      !origin ||
      typeof row.output_sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(row.output_sha256) ||
      !["location-reference", "portrait", "shot-frame"].includes(String(stage.kind)) ||
      typeof stage.target_id !== "string" ||
      !stage.target_id ||
      stage.target_id.length > 160 ||
      (stage.kind === "portrait" &&
        !["正面", "侧面", "背面", "脸部"].includes(String(stage.view))) ||
      (stage.kind !== "portrait" && Object.hasOwn(stage, "view"))
    )
      return fail();
    result.push({
      output_sha256: row.output_sha256,
      stage: {
        kind: stage.kind as ImageLineage["stage"]["kind"],
        target_id: stage.target_id,
        ...(typeof stage.view === "string" ? { view: stage.view } : {}),
        origin,
      },
    });
  }
  return result;
}

/** Project only field-specific, byte-proven automatic effects back to their original
 * input. The returned record is a read-only compiler view and is NEVER written back.
 * Distinct plausible origins are rejected, never chosen by their available budget. */
export async function restoreGenerationIntent(
  producer: CanonicalGenerationProducer,
  record: Record<string, unknown>,
  targetIds: readonly string[],
  sources: GenerationImageSources,
  facts: readonly unknown[],
): Promise<Record<string, unknown>> {
  const result = structuredClone(record),
    proofs = lineages(facts);
  const shots = generationRows(result.shots),
    people = generationRows(result.characters),
    places = generationRows(result.locations);
  const referencesMatch = async (
    origin: Record<string, unknown>,
    references: readonly string[],
  ) => {
    if (!Array.isArray(origin.references)) return false; // Older facts carry no reference proof.
    if (
      origin.references.length > 13 ||
      origin.references.some((raw) => {
        const row = object(raw);
        return (
          !row ||
          Object.keys(row).length !== 2 ||
          typeof row.sha256 !== "string" ||
          !/^[a-f0-9]{64}$/.test(row.sha256) ||
          !["image/png", "image/jpeg", "image/webp"].includes(String(row.mime))
        );
      })
    )
      return fail();
    const actual: { sha256: string; mime: string }[] = [];
    for (const source of references) {
      const value = await sources.capture(source);
      actual.push({ sha256: value.sha256, mime: value.mime });
    }
    return same(origin.references, actual);
  };
  const applied = new Map<string, unknown>();
  const accept = (field: string, previous: unknown) => {
    if (applied.has(field) && !same(applied.get(field), previous)) return fail();
    applied.set(field, previous);
  };
  for (const proof of proofs) {
    const { stage } = proof,
      origin = stage.origin;
    if (
      origin.imageModel !== IMAGE_MODEL ||
      origin.aspectRatio !== (record.aspectRatio === "16:9" ? "16:9" : "9:16")
    )
      continue;
    if (stage.kind === "shot-frame") continue;
    if (stage.kind === "portrait") {
      for (const person of people) {
        if (!Array.isArray(person.portraits)) return fail();
        const current = person.portraits.map(object).filter((row) => row?.view === stage.view);
        if (current.length > 1) return fail();
        if (
          !current[0] ||
          typeof current[0].url !== "string" ||
          !current[0].url ||
          !sources.has(current[0].url)
        )
          continue;
        if ((await sources.capture(current[0].url)).sha256 !== proof.output_sha256) continue;
        const prompts = producer.portraitPrompts(person.name, person.identity, result.styleZh, {
          gender: person.gender,
          ageBand: person.ageBand,
        });
        if (!Array.isArray(prompts)) return fail();
        const prompt = prompts.map(object).find((row) => row?.view === stage.view);
        if (
          typeof prompt?.prompt !== "string" ||
          normalizeFilmStillPrompt(
            producer.withStyleBible(prompt.prompt, String(result.styleZh ?? "")),
          ) !== origin.prompt
        )
          continue;
        const front = person.portraits.map(object).find((row) => row?.view === "正面" && row.url);
        const originalReferences =
          stage.view === "正面" ? [] : front && typeof front.url === "string" ? [front.url] : [];
        if (!(await referencesMatch(origin, originalReferences))) continue;
        if (origin.previous !== null && !object(origin.previous)) return fail();
        accept(`person:${person.id}:${stage.view}`, origin.previous);
      }
    } else {
      for (const place of places) {
        if (
          typeof place.referenceImage !== "string" ||
          !place.referenceImage ||
          !sources.has(place.referenceImage)
        )
          continue;
        if ((await sources.capture(place.referenceImage)).sha256 !== proof.output_sha256) continue;
        if (
          normalizeFilmStillPrompt(
            producer.withStyleBible(
              producer.locationGenerationPrompt(result, place),
              String(result.styleZh ?? ""),
            ),
          ) !== origin.prompt
        )
          continue;
        if (origin.previous !== null && !object(origin.previous)) return fail();
        if (!(await referencesMatch(origin, []))) continue;
        const base = object(origin.base);
        if (!base) return fail();
        const consumed = ["name", "prompt", "layout"];
        if (
          !same(
            consumed.map((key) => place[key]),
            consumed.map((key) => base[key]),
          )
        )
          continue;
        accept(`location:${place.id}`, origin.previous);
      }
    }
  }
  for (const person of people) {
    if (!Array.isArray(person.portraits)) return fail();
    const retained = [];
    for (const raw of person.portraits) {
      const portrait = object(raw);
      if (!portrait) return fail();
      const key = `person:${person.id}:${portrait.view}`;
      if (!applied.has(key)) retained.push(portrait);
      else if (applied.get(key) !== null) retained.push(applied.get(key));
    }
    person.portraits = retained;
  }
  const restoredPlaces = [];
  for (const place of places) {
    const field = `location:${place.id}`;
    if (!applied.has(field)) restoredPlaces.push(place);
    else if (applied.get(field) !== null) {
      const old = object(applied.get(field));
      if (!old) return fail();
      // Restore only the image/currentness cache fields. A real later layout/name
      // decision is retained and participates in the original producer's output.
      const next = { ...place };
      for (const key of [
        "referenceImage",
        "referenceStyleRevision",
        "referenceLayout",
        "referenceSceneSignature",
      ]) {
        if (Object.hasOwn(old, key)) next[key] = old[key];
        else delete next[key];
      }
      restoredPlaces.push(next);
    }
  }
  result.locations = restoredPlaces;
  // First restore proven automatic reference fields. The original frame producer
  // may include IMAGE labels and identity/location text derived from those fields.
  // Comparing against the unprojected live frame prompt would reject a legitimate
  // first generation merely because its own references have just arrived.
  for (const proof of proofs) {
    if (proof.stage.kind !== "shot-frame") continue;
    const origin = proof.stage.origin;
    if (
      origin.imageModel !== IMAGE_MODEL ||
      origin.aspectRatio !== (record.aspectRatio === "16:9" ? "16:9" : "9:16")
    )
      continue;
    for (const shot of shots.filter((row) => targetIds.includes(String(row.id)))) {
      if (typeof shot.poster !== "string" || !shot.poster || !sources.has(shot.poster)) continue;
      if ((await sources.capture(shot.poster)).sha256 !== proof.output_sha256) continue;
      const input = object(
        producer.shotStillInput(result, shot, producer.keyframePrompt(shot, result)),
      );
      if (
        !input ||
        input.kind !== "READY" ||
        typeof input.prompt !== "string" ||
        origin.prompt !== normalizeFilmStillPrompt(input.prompt)
      )
        continue;
      if (
        !Array.isArray(input.references) ||
        input.references.some((value) => typeof value !== "string") ||
        !(await referencesMatch(origin, input.references as string[]))
      )
        continue;
      if (typeof origin.previousPoster !== "string") return fail();
      accept(`shot:${shot.id}:poster`, origin.previousPoster);
    }
  }
  for (const shot of shots) {
    const field = `shot:${shot.id}:poster`;
    if (applied.has(field)) shot.poster = applied.get(field);
  }
  // Exercise the actual complete producer before returning a supposedly restorable
  // intent. It remains authoritative for all creative fields and review guards.
  for (const target of targetIds) compileCanonicalGenerationTarget(producer, result, target);
  return result;
}

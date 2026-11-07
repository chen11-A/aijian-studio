import { randomBytes } from "node:crypto";
import type {
  FilmGenerationExecutionInput,
  FilmGenerationImageStage,
  FilmGenerationContinuityStage,
} from "@aijian/contracts/film-generation-execution";
import type { StoryFilmCreateInput } from "./story-film-client";
import { IMAGE_MODEL, normalizeFilmStillPrompt } from "./film-library";
import {
  compileCanonicalGenerationTarget,
  type CanonicalGenerationProducer,
} from "./film-generation-compiler";

export const generationObject = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const fail = (): never => {
  throw Error("UNSUPPORTED_SCOPE");
};
const string = (value: unknown): string => (typeof value === "string" ? value : "");
export function generationRows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > 1024) return fail();
  const rows: Record<string, unknown>[] = [];
  const ids = new Set<string>();
  for (const valueRow of value) {
    const row = generationObject(valueRow);
    if (
      !row ||
      typeof row.id !== "string" ||
      !row.id ||
      row.id.length > 160 ||
      row.id.includes("\0") ||
      ids.has(row.id)
    )
      return fail();
    ids.add(row.id);
    rows.push(row);
  }
  return rows;
}
export type PlannedGenerationTarget = {
  shotId: string;
  key: string;
  originalShot: Record<string, unknown>;
  originalBody: StoryFilmCreateInput;
  /** Private actual client image input, absent when no image POST is consumed. */
  clientFrame?: {
    model: string;
    prompt: string;
    aspectRatio: "9:16" | "16:9";
    references: string[];
  };
  videoSlots: { id: string; index: number; takeId: string | null; retired: boolean }[];
  preparation: "CLIENT_IMAGES" | "STORYFILM_CACHE";
};
export type PlannedGenerationStage = {
  public: FilmGenerationImageStage | FilmGenerationContinuityStage;
  dependencies: string[];
  origin: Record<string, unknown>;
};
export type CanonicalGenerationPlan = {
  targets: PlannedGenerationTarget[];
  stages: PlannedGenerationStage[];
  /** Identity-only prerequisite view, including proven automatic outputs restored
   * to their original intent. Never an issued dispatch stage table. */
  intentStages?: PlannedGenerationStage[];
};
const opaque = (prefix: string) => `${prefix}_${randomBytes(16).toString("hex")}`;

/** Original producer owns all creative text and reference selection. This function
 * adds only native execution/dependency/slot locators, not failure-bucket fields. */
export function compileCanonicalGenerationPlan(
  producer: CanonicalGenerationProducer,
  record: Record<string, unknown>,
  intentRecord: Record<string, unknown>,
  input: FilmGenerationExecutionInput,
  pendingPipelineShots: ReadonlySet<string>,
): CanonicalGenerationPlan {
  const shots = generationRows(record.shots);
  const scenes = generationRows(record.scenes);
  const people = generationRows(record.characters);
  generationRows(record.locations);
  for (const shot of shots) {
    if (!scenes.some((scene) => scene.id === shot.sceneId)) return fail();
    generationRows(shot.takes);
  }
  const targets: PlannedGenerationTarget[] = [];
  for (const requested of input.targets) {
    const shot = shots.find((row) => row.id === requested.shotId);
    if (!shot) return fail();
    if (input.mode === "pipeline" && !pendingPipelineShots.has(requested.shotId)) continue;
    targets.push({
      shotId: requested.shotId,
      key: opaque("target"),
      originalShot: structuredClone(shot),
      originalBody: compileCanonicalGenerationTarget(producer, intentRecord, requested.shotId),
      videoSlots: Array.from({ length: requested.versions }, (_, index) => ({
        id: opaque("gvs"),
        index,
        takeId: null,
        retired: false,
      })),
      preparation: "CLIENT_IMAGES",
    });
  }
  if (!targets.length) return fail();
  const targetKeys = targets.map((row) => row.key);
  const selected =
    input.mode === "pipeline"
      ? shots
      : shots.filter((shot) => targets.some((target) => target.shotId === shot.id));
  const prepared = generationObject(
    producer.prepareSceneLocations(record, [
      ...new Set(selected.map((shot) => string(shot.sceneId))),
    ]),
  );
  if (!prepared) return fail();
  const intentPrepared = generationObject(
    producer.prepareSceneLocations(intentRecord, [
      ...new Set(targets.map((target) => string(target.originalShot.sceneId))),
    ]),
  );
  if (!intentPrepared) return fail();
  for (const target of targets) {
    const original = generationRows(intentRecord.shots).find((shot) => shot.id === target.shotId);
    if (!original || original.continuityFromShotId || target.originalBody.shots?.[0]?.still)
      continue;
    const frame = generationObject(
      producer.shotStillInput(
        intentPrepared,
        original,
        producer.keyframePrompt(original, intentPrepared),
      ),
    );
    if (
      !frame ||
      frame.kind !== "READY" ||
      typeof frame.prompt !== "string" ||
      !Array.isArray(frame.references) ||
      frame.references.some((reference) => typeof reference !== "string")
    )
      return fail();
    target.clientFrame = {
      model: IMAGE_MODEL,
      prompt: normalizeFilmStillPrompt(frame.prompt),
      aspectRatio: intentRecord.aspectRatio === "16:9" ? "16:9" : "9:16",
      references: [...frame.references] as string[],
    };
  }
  const places = generationRows(prepared.locations);
  const stages: PlannedGenerationStage[] = [];
  const seenPlaces = new Set<string>();
  for (const shot of selected) {
    const place = generationObject(producer.sceneLocation(prepared, string(shot.sceneId)));
    if (!place || typeof place.id !== "string") return fail();
    if (seenPlaces.has(place.id) || producer.locationImageCurrent(prepared, place)) continue;
    seenPlaces.add(place.id);
    const original = generationRows(record.locations).find((row) => row.id === place.id);
    const dependencies =
      input.mode === "pipeline"
        ? targetKeys
        : targets
            .filter(
              (target) => shots.find((row) => row.id === target.shotId)?.sceneId === shot.sceneId,
            )
            .map((target) => target.key);
    const sourceScene = scenes.find((scene) => scene.id === place.sceneId);
    if (
      place.sceneId &&
      (!sourceScene || (!string(sourceScene.text).trim() && !string(sourceScene.where).trim()))
    )
      return fail();
    stages.push({
      public: { stageId: opaque("gis"), kind: "location-reference", targetId: place.id },
      dependencies,
      origin: {
        imageModel: IMAGE_MODEL,
        aspectRatio: record.aspectRatio === "16:9" ? "16:9" : "9:16",
        previous: original ? structuredClone(original) : null,
        base: structuredClone(place),
        prompt: normalizeFilmStillPrompt(
          producer.withStyleBible(
            producer.locationGenerationPrompt(prepared, place),
            string(record.styleZh),
          ),
        ),
      },
    });
  }
  if (input.mode === "pipeline") {
    for (const person of people) {
      if (!Array.isArray(person.portraits)) return fail();
      const prompts = producer.portraitPrompts(person.name, person.identity, record.styleZh, {
        gender: person.gender,
        ageBand: person.ageBand,
      });
      if (!Array.isArray(prompts)) return fail();
      for (const item of prompts) {
        const row = generationObject(item);
        if (
          !row ||
          typeof row.prompt !== "string" ||
          !["正面", "侧面", "背面", "脸部"].includes(string(row.view))
        )
          return fail();
        const matching = person.portraits
          .map(generationObject)
          .filter((portrait) => portrait?.view === row.view);
        if (matching.length > 1 || person.portraits.some((portrait) => !generationObject(portrait)))
          return fail();
        if (matching[0]?.url) continue;
        if (!string(person.identity).trim()) return fail();
        stages.push({
          public: {
            stageId: opaque("gis"),
            kind: "portrait",
            targetId: string(person.id),
            view: row.view as "正面" | "侧面" | "背面" | "脸部",
          },
          dependencies: targetKeys,
          origin: {
            previous: structuredClone(matching[0] ?? null),
            imageModel: IMAGE_MODEL,
            aspectRatio: record.aspectRatio === "16:9" ? "16:9" : "9:16",
            prompt: normalizeFilmStillPrompt(
              producer.withStyleBible(row.prompt, string(record.styleZh)),
            ),
          },
        });
      }
    }
  }
  for (const shot of selected) {
    const dependencies =
      input.mode === "pipeline"
        ? targetKeys
        : targets.filter((target) => target.shotId === shot.id).map((target) => target.key);
    if (shot.continuityFromShotId) {
      const index = shots.indexOf(shot),
        previous = shots[index - 1];
      if (
        !previous ||
        previous.id !== shot.continuityFromShotId ||
        previous.sceneId !== shot.sceneId
      )
        return fail();
      stages.push({
        public: {
          stageId: opaque("gls"),
          kind: "continuity-frame",
          targetId: string(shot.id),
          sourceShotId: string(previous.id),
        },
        dependencies,
        origin: {
          previousPoster: shot.poster ?? "",
          previousContinuity: shot.continuityFrame ?? null,
        },
      });
      continue;
    }
    const references = generationObject(producer.shotReference(shot, record));
    if (!references) return fail();
    if (references.still) continue;
    const frameInput = generationObject(
      producer.shotStillInput(prepared, shot, producer.keyframePrompt(shot, prepared)),
    );
    if (!frameInput || frameInput.kind !== "READY" || typeof frameInput.prompt !== "string")
      return fail();
    stages.push({
      public: { stageId: opaque("gis"), kind: "shot-frame", targetId: string(shot.id) },
      dependencies,
      origin: {
        previousPoster: shot.poster ?? "",
        imageModel: IMAGE_MODEL,
        aspectRatio: record.aspectRatio === "16:9" ? "16:9" : "9:16",
        prompt: normalizeFilmStillPrompt(frameInput.prompt),
      },
    });
  }
  if (stages.length > 1024 || places.length > 1024) return fail();
  const intentStages =
    record === intentRecord
      ? stages
      : compileCanonicalGenerationPlan(
          producer,
          intentRecord,
          intentRecord,
          input,
          pendingPipelineShots,
        ).stages;
  return { targets, stages, intentStages };
}

/** Expected current client image recipe, before the original sink's normalization.
 * Generated references are allowed only after native validates their exact lineage. */
export function compileCanonicalStageImage(
  producer: CanonicalGenerationProducer,
  record: Record<string, unknown>,
  stage: PlannedGenerationStage,
): { prompt: string; references: string[]; aspectRatio: "9:16" | "16:9" } {
  const descriptor = stage.public;
  const aspectRatio = record.aspectRatio === "16:9" ? "16:9" : "9:16";
  if (descriptor.kind === "continuity-frame") return fail();
  if (descriptor.kind === "location-reference") {
    const prepared = generationObject(producer.prepareSceneLocations(record));
    if (!prepared) return fail();
    const location = generationRows(prepared.locations).find(
      (row) => row.id === descriptor.targetId,
    );
    if (!location) return fail();
    return {
      prompt: producer.withStyleBible(
        producer.locationGenerationPrompt(prepared, location),
        string(record.styleZh),
      ),
      references: [],
      aspectRatio,
    };
  }
  if (descriptor.kind === "portrait") {
    const person = generationRows(record.characters).find((row) => row.id === descriptor.targetId);
    if (!person || !Array.isArray(person.portraits)) return fail();
    const prompts = producer.portraitPrompts(person.name, person.identity, record.styleZh, {
      gender: person.gender,
      ageBand: person.ageBand,
    });
    if (!Array.isArray(prompts)) return fail();
    const prompt = prompts.map(generationObject).find((row) => row?.view === descriptor.view);
    if (!prompt || typeof prompt.prompt !== "string") return fail();
    const front = person.portraits
      .map(generationObject)
      .find((row) => row?.view === "正面" && row.url);
    if (descriptor.view !== "正面" && (!front || typeof front.url !== "string")) return fail();
    return {
      prompt: producer.withStyleBible(prompt.prompt, string(record.styleZh)),
      references: descriptor.view === "正面" ? [] : [String(front!.url)],
      aspectRatio,
    };
  }
  const shot = generationRows(record.shots).find((row) => row.id === descriptor.targetId);
  if (!shot) return fail();
  const input = generationObject(
    producer.shotStillInput(record, shot, producer.keyframePrompt(shot, record)),
  );
  if (
    !input ||
    input.kind !== "READY" ||
    typeof input.prompt !== "string" ||
    !Array.isArray(input.references) ||
    input.references.some((value) => typeof value !== "string")
  )
    return fail();
  return { prompt: input.prompt, references: input.references as string[], aspectRatio };
}

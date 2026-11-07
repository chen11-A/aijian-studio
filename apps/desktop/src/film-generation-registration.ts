import { randomUUID } from "node:crypto";
import type { CanonicalGenerationProducer } from "./film-generation-compiler";
import {
  generationObject,
  generationRows,
  type CanonicalGenerationPlan,
  type PlannedGenerationStage,
} from "./film-generation-plan";
import type { GenerationImageSources } from "./film-generation-sources";
import type { StoryFilmCreateInput } from "./story-film-client";
import { IMAGE_MODEL } from "./film-library";

export type GenerationReferenceIdentity = { sha256: string; mime: string };
export type GenerationRegistrationInput = {
  key: string;
  targets: {
    key: string;
    versions: 1 | 2 | 3;
    first_regenerate: boolean;
    body: StoryFilmCreateInput;
    sources: { source: string; sha256: string }[];
    client_frame?: {
      model: typeof IMAGE_MODEL;
      prompt: string;
      aspect_ratio: "9:16" | "16:9";
      references: string[];
    };
  }[];
  stages: {
    key: string;
    kind: "location-reference" | "portrait" | "shot-frame";
    target_id: string;
    view?: "正面" | "侧面" | "背面" | "脸部";
    origin: Record<string, unknown> & { references: GenerationReferenceIdentity[] };
    target_keys: string[];
  }[];
};
const fail = (): never => {
  throw Error("UNSUPPORTED_SCOPE");
};

function withPlannedImage(
  producer: CanonicalGenerationProducer,
  record: Record<string, unknown>,
  stage: PlannedGenerationStage,
  marker: string,
): Record<string, unknown> {
  const next = structuredClone(record),
    descriptor = stage.public;
  if (descriptor.kind === "continuity-frame") return fail();
  if (descriptor.kind === "location-reference") {
    const prepared = generationObject(producer.prepareSceneLocations(next));
    if (!prepared) return fail();
    const place = generationRows(prepared.locations).find((row) => row.id === descriptor.targetId);
    if (!place) return fail();
    const fields = generationObject(producer.locationImageFields(prepared, place, marker));
    if (!fields) return fail();
    Object.assign(place, fields);
    return prepared;
  }
  if (descriptor.kind === "portrait") {
    const person = generationRows(next.characters).find((row) => row.id === descriptor.targetId);
    if (!person || !Array.isArray(person.portraits)) return fail();
    const portraits = person.portraits.map(generationObject);
    if (portraits.some((row) => !row)) return fail();
    const existing = portraits.find((row) => row?.view === descriptor.view);
    if (existing) existing.url = marker;
    else person.portraits.push({ view: descriptor.view, url: marker });
    return next;
  }
  return next;
}

/** The current adapter handles complete fixed-reference intentions. A forthcoming
 * planned-reference compiler must replace this explicit guard before any scope
 * whose missing automatic references affect the effective target can be enabled.
 * The marker exists only in this temporary pure selector view, never on disk/API. */
function requireCompleteIntent(
  producer: CanonicalGenerationProducer,
  plan: CanonicalGenerationPlan,
  intent: Record<string, unknown>,
) {
  const prepared = generationObject(producer.prepareSceneLocations(intent));
  if (!prepared) return fail();
  for (const stage of plan.stages) {
    if (stage.public.kind === "continuity-frame") return fail();
    if (stage.public.kind === "shot-frame") continue;
    const marker = "https://aivora-planned.invalid/check-reference.png";
    const projected = withPlannedImage(producer, prepared, stage, marker);
    for (const target of plan.targets) {
      const shot = generationRows(projected.shots).find((row) => row.id === target.shotId);
      if (!shot) return fail();
      const video = generationObject(producer.shotReference(shot, projected));
      if (!video || !Array.isArray(video.references)) return fail();
      if (
        !String(target.originalBody.video_model ?? "").includes("lite") &&
        video.references.some((row) => generationObject(row)?.url === marker)
      )
        return fail();
      if (target.clientFrame) {
        const frame = generationObject(
          producer.shotStillInput(projected, shot, producer.keyframePrompt(shot, projected)),
        );
        if (!frame || frame.kind !== "READY" || !Array.isArray(frame.references)) return fail();
        if (frame.references.includes(marker)) return fail();
      }
    }
  }
}

/** Single native-owned protocol mapping. It performs bounded actual source checks;
 * no renderer digest, source root, dependency set, success or account is accepted. */
export async function buildGenerationRegistration(
  producer: CanonicalGenerationProducer,
  plan: CanonicalGenerationPlan,
  intent: Record<string, unknown>,
  sources: GenerationImageSources,
): Promise<GenerationRegistrationInput> {
  requireCompleteIntent(producer, plan, intent);
  const prepared = generationObject(producer.prepareSceneLocations(intent));
  if (!prepared) return fail();
  const targets: GenerationRegistrationInput["targets"] = [];
  for (const target of plan.targets) {
    if (![1, 2, 3].includes(target.videoSlots.length)) return fail();
    const declared = new Map(
      (await sources.requestSources(target.originalBody)).map((row) => [row.source, row]),
    );
    if (target.clientFrame) {
      for (const source of target.clientFrame.references) {
        const value = await sources.capture(source);
        declared.set(source, { source, sha256: value.sha256 });
      }
    }
    targets.push({
      key: target.key,
      versions: target.videoSlots.length as 1 | 2 | 3,
      first_regenerate:
        target.originalBody.regenerate === true ||
        target.originalBody.shots?.[0]?.regenerate === true ||
        producer.generationHadTakes(target.originalShot),
      body: structuredClone(target.originalBody),
      sources: [...declared.values()],
      ...(target.clientFrame
        ? {
            client_frame: {
              model: IMAGE_MODEL,
              prompt: target.clientFrame.prompt,
              aspect_ratio: target.clientFrame.aspectRatio,
              references: [...target.clientFrame.references],
            },
          }
        : {}),
    });
  }
  const stages: GenerationRegistrationInput["stages"] = [];
  for (const stage of plan.stages) {
    const descriptor = stage.public;
    if (descriptor.kind === "continuity-frame") return fail();
    let references: string[] = [];
    if (descriptor.kind === "portrait" && descriptor.view !== "正面") {
      const person = generationRows(intent.characters).find(
        (row) => row.id === descriptor.targetId,
      );
      if (!person || !Array.isArray(person.portraits)) return fail();
      const front = person.portraits.map(generationObject).find((row) => row?.view === "正面");
      if (!front || typeof front.url !== "string" || !front.url) return fail();
      references = [front.url];
    } else if (descriptor.kind === "shot-frame") {
      const shot = generationRows(prepared.shots).find((row) => row.id === descriptor.targetId);
      if (!shot) return fail();
      const frame = generationObject(
        producer.shotStillInput(prepared, shot, producer.keyframePrompt(shot, prepared)),
      );
      if (
        !frame ||
        frame.kind !== "READY" ||
        !Array.isArray(frame.references) ||
        frame.references.some((value) => typeof value !== "string")
      )
        return fail();
      references = frame.references as string[];
    }
    const identities: GenerationReferenceIdentity[] = [];
    for (const source of references) {
      const value = await sources.capture(source);
      identities.push({ sha256: value.sha256, mime: value.mime });
    }
    stages.push({
      key: descriptor.stageId,
      kind: descriptor.kind,
      target_id: descriptor.targetId,
      ...(descriptor.kind === "portrait" ? { view: descriptor.view } : {}),
      origin: { ...structuredClone(stage.origin), references: identities },
      target_keys: [...stage.dependencies],
    });
  }
  await sources.verify();
  return { key: `execution_${randomUUID()}`, targets, stages };
}

import { randomUUID } from "node:crypto";
import {
  forecastGenerationReferences,
  buildGenerationForecastInputs,
  forecastReferenceInputs,
  type ForecastReferenceIdentity,
  type GenerationForecastInput,
} from "./film-generation-forecast";
import type { CanonicalGenerationProducer } from "./film-generation-compiler";
import {
  generationObject,
  generationRows,
  type CanonicalGenerationPlan,
} from "./film-generation-plan";
import type { GenerationImageSources } from "./film-generation-sources";
import type { StoryFilmCreateInput } from "./story-film-client";
import { IMAGE_MODEL } from "./film-library";

export type GenerationReferenceIdentity = ForecastReferenceIdentity;
export type GenerationRegistrationInput = {
  key: string;
  targets: {
    key: string;
    versions: 1 | 2 | 3;
    first_regenerate: boolean;
    body: StoryFilmCreateInput;
    forecast?: GenerationForecastInput;
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

/** Keep the current fixed-reference capability closed until actual dynamic stage
 * observations and lineage consumers have been connected to this same forecast. */
function requireCompleteIntent(
  producer: CanonicalGenerationProducer,
  plan: CanonicalGenerationPlan,
  intent: Record<string, unknown>,
) {
  const forecast = forecastGenerationReferences(producer, plan, intent);
  for (const target of forecast.targets) {
    const references = [
      ...(target.clientFrame?.references ?? []),
      ...(!String(target.body.video_model ?? "").includes("lite")
        ? (target.body.shots ?? []).flatMap((shot) => [
            ...(shot.references ?? []),
            ...(shot.reference ? [shot.reference] : []),
          ])
        : []),
    ];
    if (references.some((source) => forecast.plannedSources.has(source))) return fail();
  }
}

/** Single native-owned protocol mapping. It performs bounded actual source checks;
 * no renderer digest, source root, dependency set, success or account is accepted. */
export async function buildGenerationRegistration(
  producer: CanonicalGenerationProducer,
  plan: CanonicalGenerationPlan,
  intent: Record<string, unknown>,
  sources: GenerationImageSources,
  capabilities: { plannedReferences?: boolean } = {},
): Promise<GenerationRegistrationInput> {
  if (!capabilities.plannedReferences) requireCompleteIntent(producer, plan, intent);
  const forecast = capabilities.plannedReferences
    ? forecastGenerationReferences(producer, plan, intent)
    : undefined;
  const forecastInputs = forecast
    ? await buildGenerationForecastInputs(forecast, (source) => sources.capture(source))
    : undefined;
  const prepared = generationObject(producer.prepareSceneLocations(intent));
  if (!prepared) return fail();
  const targets: GenerationRegistrationInput["targets"] = [];
  for (const target of plan.targets) {
    if (![1, 2, 3].includes(target.videoSlots.length)) return fail();
    const forecastInput = forecastInputs?.find((row) => row.key === target.key);
    if (forecastInputs && !forecastInput) return fail();
    const declared = new Map(
      (forecastInput?.fixedSources ?? (await sources.requestSources(target.originalBody))).map(
        (row) => [row.source, row],
      ),
    );
    if (!forecastInput && target.clientFrame) {
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
      ...(forecastInput?.forecast ? { forecast: forecastInput.forecast } : {}),
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
    const forecastCreator = forecast?.stages.find(
      (row) => row.stageId === descriptor.stageId,
    )?.creator;
    if (forecast && !forecastCreator) return fail();
    let references: readonly string[] = [];
    if (forecastCreator) references = forecastCreator.references;
    else if (descriptor.kind === "portrait" && descriptor.view !== "正面") {
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
    const identities: GenerationReferenceIdentity[] = forecast
      ? await forecastReferenceInputs(forecast, references, (source) => sources.capture(source))
      : [];
    if (!forecast)
      for (const source of references) {
        const value = await sources.capture(source);
        identities.push({ sha256: value.sha256, mime: value.mime });
      }
    stages.push({
      key: descriptor.stageId,
      kind: descriptor.kind,
      target_id: descriptor.targetId,
      ...(descriptor.kind === "portrait" ? { view: descriptor.view } : {}),
      origin: {
        ...structuredClone(stage.origin),
        ...(forecastCreator
          ? {
              imageModel: forecastCreator.model,
              prompt: forecastCreator.prompt,
              aspectRatio: forecastCreator.aspectRatio,
              referenceMode: "planned-v1",
            }
          : {}),
        references: identities,
      },
      target_keys: [...stage.dependencies],
    });
  }
  await sources.verify();
  return { key: `execution_${randomUUID()}`, targets, stages };
}

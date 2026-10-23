import type { Capability } from "../../domain/provider-settings-model";

const ORDER: readonly Capability[] = ["TEXT", "IMAGE", "VIDEO", "SPEECH"];

/** Output modalities from a live catalog, when the provider includes them. */
export function capabilitiesFromModalities(
  modalities: readonly string[] | undefined,
): Capability[] {
  if (!modalities?.length) return [];
  const found = new Set<Capability>();
  for (const raw of modalities) {
    const value = raw.trim().toLowerCase();
    if (value === "text") found.add("TEXT");
    else if (value === "image") found.add("IMAGE");
    else if (value === "video") found.add("VIDEO");
    else if (value === "audio" || value === "speech") found.add("SPEECH");
  }
  return ORDER.filter((item) => found.has(item));
}

/**
 * Documented id families. Used only when the live catalog did not say which
 * modalities a listed model serves. A model that was not listed is not offered.
 */
export function capabilitiesForModelId(id: string): Capability[] {
  const key = id.trim().toLowerCase();
  if (!key) return [];
  if (/imagine-image|^grok-2-image|\bdall-e|gpt-image|chatgpt-image/.test(key)) return ["IMAGE"];
  if (/imagine-video|^sora/.test(key)) return ["VIDEO"];
  if (/^grok-tts|^grok-voice|^tts-|^gpt-4o-mini-tts/.test(key)) return ["SPEECH"];
  return ["TEXT"];
}

export function capabilitiesForListedModel(model: {
  id: string;
  outputModalities?: readonly string[];
}): Capability[] {
  const fromApi = capabilitiesFromModalities(model.outputModalities);
  return fromApi.length > 0 ? fromApi : capabilitiesForModelId(model.id);
}

import type { components } from "@aijian/contracts";
import type { CreativeVersion } from "./creativeLibrary";
import type { StoryboardShot } from "./episodeStoryboard";
export type EnvironmentBinding = components["schemas"]["EpisodeStoryboardEnvironmentBindingV1"];
export const shotEnvironment = (shot: StoryboardShot): EnvironmentBinding =>
  "environment_binding" in shot
    ? shot.environment_binding
    : { variant_id: null, reference_ids: [] };
export function environmentForLocation(
  shot: StoryboardShot,
  library: CreativeVersion,
  locationId: string | null,
): EnvironmentBinding {
  const before = shotEnvironment(shot),
    details = library.content;
  if (details.schema_version !== "1.3.0") return { variant_id: null, reference_ids: [] };
  const variantId = details.scene_variants.some(
    (item) => item.variant_id === before.variant_id && item.scene_id === locationId,
  )
    ? before.variant_id
    : null;
  return {
    variant_id: variantId,
    reference_ids: before.reference_ids.filter((id) =>
      details.environment_references.some(
        (ref) =>
          ref.reference_id === id &&
          (ref.scene_id === null || ref.scene_id === locationId) &&
          (ref.variant_id === null || ref.variant_id === variantId),
      ),
    ),
  };
}
export function environmentReferencesForState(
  library: CreativeVersion,
  locationId: string | null,
  variantId: string | null,
) {
  return library.content.schema_version === "1.3.0"
    ? library.content.environment_references.filter(
        (ref) =>
          (ref.scene_id === null || ref.scene_id === locationId) &&
          (ref.variant_id === null || ref.variant_id === variantId),
      )
    : [];
}

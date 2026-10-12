import type { components } from "@aijian/contracts";
import type { CreativeContent } from "./creativeLibrary";
import { withCreativeReferences } from "./creativeCharacterDetails";

export type EnvironmentContent = components["schemas"]["ProjectCreativeLibraryContentV4"];
export type SceneVariant = components["schemas"]["ProjectSceneVariantV1"];
export function withCreativeEnvironment(content: CreativeContent): EnvironmentContent {
  return content.schema_version === "1.3.0"
    ? content
    : {
        ...withCreativeReferences(content),
        schema_version: "1.3.0",
        scene_variants: [],
        environment_references: [],
      };
}
export function removeSceneVariant(content: CreativeContent, id: string): CreativeContent {
  if (content.schema_version !== "1.3.0") return content;
  return {
    ...content,
    scene_variants: content.scene_variants
      .filter((item) => item.variant_id !== id)
      .map((item, i) => ({ ...item, ordinal: i + 1 })),
    environment_references: content.environment_references
      .filter((item) => item.variant_id !== id)
      .map((item, i) => ({ ...item, ordinal: i + 1 })),
  };
}
export function removeCreativeScene(content: CreativeContent, id: string): CreativeContent {
  const scenes = content.scenes
    .filter((item) => item.scene_id !== id)
    .map((item, i) => ({ ...item, ordinal: i + 1 }));
  if (content.schema_version !== "1.3.0") return { ...content, scenes };
  return {
    ...content,
    scenes,
    scene_variants: content.scene_variants
      .filter((item) => item.scene_id !== id)
      .map((item, i) => ({ ...item, ordinal: i + 1 })),
    environment_references: content.environment_references
      .filter((item) => item.scene_id !== id)
      .map((item, i) => ({ ...item, ordinal: i + 1 })),
  };
}

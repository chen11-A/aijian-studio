import type { components } from "@aijian/contracts";
import type { CreativeContent } from "./creativeLibrary";

export type CreativeDetailsContent =
  | components["schemas"]["ProjectCreativeLibraryContentV2"]
  | components["schemas"]["ProjectCreativeLibraryContentV3"]
  | components["schemas"]["ProjectCreativeLibraryContentV4"];
export function withCreativeDetails(content: CreativeContent): CreativeDetailsContent {
  return content.schema_version !== "1.0.0"
    ? content
    : {
        ...content,
        schema_version: "1.1.0",
        relationships: [],
        costumes: [],
      };
}
export function withCreativeReferences(
  content: CreativeContent,
):
  | components["schemas"]["ProjectCreativeLibraryContentV3"]
  | components["schemas"]["ProjectCreativeLibraryContentV4"] {
  const details = withCreativeDetails(content);
  return details.schema_version === "1.2.0" || details.schema_version === "1.3.0"
    ? details
    : { ...details, schema_version: "1.2.0", references: [] };
}
export function normalizeCreativeContent(content: CreativeContent): CreativeContent {
  const shared = {
    characters: content.characters.map((item, i) => ({
      ...item,
      name: item.name.trim(),
      ordinal: i + 1,
    })),
    scenes: content.scenes.map((item, i) => ({ ...item, name: item.name.trim(), ordinal: i + 1 })),
  };
  return content.schema_version === "1.0.0"
    ? { ...content, ...shared }
    : {
        ...content,
        ...shared,
        relationships: content.relationships.map((item, i) => ({
          ...item,
          label: item.label.trim(),
          ordinal: i + 1,
        })),
        costumes: content.costumes.map((item, i) => ({
          ...item,
          name: item.name.trim(),
          ordinal: i + 1,
        })),
        ...(content.schema_version === "1.2.0" || content.schema_version === "1.3.0"
          ? {
              references: content.references.map((item, i) => ({
                ...item,
                label: item.label.trim(),
                ordinal: i + 1,
              })),
            }
          : {}),
        ...(content.schema_version === "1.3.0"
          ? {
              scene_variants: content.scene_variants.map((item, i) => ({
                ...item,
                name: item.name.trim(),
                ordinal: i + 1,
              })),
              environment_references: content.environment_references.map((item, i) => ({
                ...item,
                label: item.label.trim(),
                ordinal: i + 1,
              })),
            }
          : {}),
      };
}
export function characterRemovalDetails(content: CreativeContent, id: string): string {
  if (content.schema_version === "1.0.0") return "";
  const relationships = content.relationships.filter(
    (item) => item.from_character_id === id || item.to_character_id === id,
  ).length;
  const costumes = content.costumes.filter((item) => item.character_id === id).length;
  const references =
    content.schema_version === "1.2.0" || content.schema_version === "1.3.0"
      ? content.references.filter((item) => item.character_id === id).length
      : 0;
  return `同时从当前草稿移除 ${relationships} 条关系、${costumes} 个服装${references ? `、${references} 个参考关联` : ""}；历史版本保留。`;
}
export function removeCreativeCharacter(content: CreativeContent, id: string): CreativeContent {
  const characters = content.characters
    .filter((item) => item.character_id !== id)
    .map((item, i) => ({ ...item, ordinal: i + 1 }));
  return content.schema_version === "1.0.0"
    ? { ...content, characters }
    : {
        ...content,
        characters,
        relationships: content.relationships
          .filter((item) => item.from_character_id !== id && item.to_character_id !== id)
          .map((item, i) => ({ ...item, ordinal: i + 1 })),
        costumes: content.costumes
          .filter((item) => item.character_id !== id)
          .map((item, i) => ({ ...item, ordinal: i + 1 })),
        ...(content.schema_version === "1.2.0" || content.schema_version === "1.3.0"
          ? {
              references: content.references
                .filter((item) => item.character_id !== id)
                .map((item, i) => ({ ...item, ordinal: i + 1 })),
            }
          : {}),
      };
}

export function removeCreativeCostume(content: CreativeContent, id: string): CreativeContent {
  if (content.schema_version === "1.0.0") return content;
  return {
    ...content,
    costumes: content.costumes
      .filter((item) => item.costume_id !== id)
      .map((item, i) => ({ ...item, ordinal: i + 1 })),
    ...(content.schema_version === "1.2.0" || content.schema_version === "1.3.0"
      ? {
          references: content.references
            .filter((item) => item.costume_id !== id)
            .map((item, i) => ({ ...item, ordinal: i + 1 })),
        }
      : {}),
  };
}

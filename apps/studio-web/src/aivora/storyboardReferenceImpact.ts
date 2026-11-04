import { validScriptVersion, type ScriptVersion } from "./adapters/episodeScript";
import { validCreativeVersion, type CreativeVersion } from "./adapters/creativeLibrary";
import {
  sameStoryboardJson,
  type StoryboardContent,
  type StoryboardShot,
} from "./adapters/episodeStoryboard";

export type ReferenceKind = "script" | "library";
export type ReferenceVersion = ScriptVersion | CreativeVersion;
export const referencePin = (kind: ReferenceKind, content: StoryboardContent) =>
  kind === "script" ? content.script_version_id : content.creative_library_version_id;
export function validReferenceVersion(
  kind: ReferenceKind,
  value: unknown,
  content: StoryboardContent,
): value is ReferenceVersion {
  return kind === "script"
    ? validScriptVersion(value, content.project_id, content.episode_id)
    : validCreativeVersion(value, content.project_id);
}
function references(kind: ReferenceKind, shot: StoryboardShot) {
  return kind === "script"
    ? shot.script_scene_id
      ? [{ id: shot.script_scene_id, label: "场次" }]
      : []
    : [
        ...shot.character_ids.map((id) => ({ id, label: "角色" })),
        ...(shot.location_id ? [{ id: shot.location_id, label: "地点" }] : []),
        ...("character_bindings" in shot
          ? shot.character_bindings.flatMap((item) => [
              ...(item.costume_id ? [{ id: item.costume_id, label: "服装" }] : []),
              ...item.reference_ids.map((id) => ({ id, label: "参考" })),
            ])
          : []),
        ...("environment_binding" in shot
          ? [
              ...(shot.environment_binding.variant_id
                ? [{ id: shot.environment_binding.variant_id, label: "环境状态" }]
                : []),
              ...shot.environment_binding.reference_ids.map((id) => ({ id, label: "环境参考" })),
            ]
          : []),
      ];
}
export const hasReferences = (kind: ReferenceKind, content: StoryboardContent) =>
  content.shots.some((shot) => references(kind, shot).length > 0);
function records(version: ReferenceVersion): Map<string, unknown> {
  if (version.episode_id !== null)
    return new Map(version.content.scenes.map((scene) => [scene.scene_id, scene]));
  return new Map<string, unknown>([
    ...version.content.characters.map((character): [string, unknown] => [
      character.character_id,
      character,
    ]),
    ...version.content.scenes.map((scene): [string, unknown] => [scene.scene_id, scene]),
    ...(version.content.schema_version !== "1.0.0"
      ? version.content.costumes.map((item): [string, unknown] => [item.costume_id, item])
      : []),
    ...(version.content.schema_version === "1.2.0" || version.content.schema_version === "1.3.0"
      ? version.content.references.map((item): [string, unknown] => [item.reference_id, item])
      : []),
    ...(version.content.schema_version === "1.3.0"
      ? [
          ...version.content.scene_variants.map((item): [string, unknown] => [
            item.variant_id,
            item,
          ]),
          ...version.content.environment_references.map((item): [string, unknown] => [
            item.reference_id,
            item,
          ]),
        ]
      : []),
  ]);
}
/** Compare identities across every shot; a selected shot alone cannot authorize a whole-episode pin. */
export function referenceImpact(
  kind: ReferenceKind,
  content: StoryboardContent,
  current: ReferenceVersion,
  target: ReferenceVersion,
) {
  const before = records(current);
  const after = records(target);
  const missing: string[] = [];
  const changed: string[] = [];
  let referencedShots = 0;
  for (const shot of content.shots) {
    const members = references(kind, shot);
    if (members.length) referencedShots += 1;
    const shotLabel = `镜头 ${shot.ordinal}「${shot.title}」`;
    for (const member of members)
      if (!after.has(member.id)) missing.push(`${shotLabel}：${member.label} ${member.id}`);
    if (kind === "library" && target.episode_id === null && "character_bindings" in shot) {
      const library = target.content;
      for (const binding of shot.character_bindings) {
        const costume =
          library.schema_version !== "1.0.0"
            ? library.costumes.find((item) => item.costume_id === binding.costume_id)
            : null;
        if (binding.costume_id && costume?.character_id !== binding.character_id)
          missing.push(`${shotLabel}：服装归属不一致`);
        for (const refId of binding.reference_ids) {
          const ref =
            library.schema_version === "1.2.0" || library.schema_version === "1.3.0"
              ? library.references.find((item) => item.reference_id === refId)
              : null;
          if (
            !ref ||
            ref.character_id !== binding.character_id ||
            (ref.costume_id !== null && ref.costume_id !== binding.costume_id)
          )
            missing.push(`${shotLabel}：参考归属不一致`);
        }
      }
    }
    if (kind === "library" && target.episode_id === null && "environment_binding" in shot) {
      const library = target.content,
        binding = shot.environment_binding;
      if (
        binding.variant_id &&
        (library.schema_version !== "1.3.0" ||
          !library.scene_variants.some(
            (item) => item.variant_id === binding.variant_id && item.scene_id === shot.location_id,
          ))
      )
        missing.push(`${shotLabel}：环境状态归属不一致`);
      for (const id of binding.reference_ids) {
        const ref =
          library.schema_version === "1.3.0"
            ? library.environment_references.find((item) => item.reference_id === id)
            : null;
        if (
          !ref ||
          (ref.scene_id !== null && ref.scene_id !== shot.location_id) ||
          (ref.variant_id !== null && ref.variant_id !== binding.variant_id)
        )
          missing.push(`${shotLabel}：环境参考归属不一致`);
      }
    }
    if (
      members.some(
        (member) =>
          after.has(member.id) && !sameStoryboardJson(before.get(member.id), after.get(member.id)),
      )
    )
      changed.push(shotLabel);
  }
  const worldChanged =
    current.episode_id === null &&
    target.episode_id === null &&
    !sameStoryboardJson(current.content.world, target.content.world);
  return { missing, changed, referencedShots, worldChanged };
}
export function withReferencePin(
  kind: ReferenceKind,
  content: StoryboardContent,
  versionId: string | null,
): StoryboardContent {
  return kind === "script"
    ? { ...content, script_version_id: versionId }
    : { ...content, creative_library_version_id: versionId };
}

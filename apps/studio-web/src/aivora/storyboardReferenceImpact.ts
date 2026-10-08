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

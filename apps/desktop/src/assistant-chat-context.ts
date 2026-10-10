import { createHash } from "node:crypto";
import type { AssistantChatReference, AssistantChatScope } from "@aijian/contracts/official-text";
import type { LocalApiClient } from "./api-client";

export type AssistantContextClient = Pick<
  LocalApiClient,
  | "getProject"
  | "getEpisode"
  | "getEpisodeScript"
  | "getEpisodeStoryboard"
  | "getProjectCreativeLibrary"
>;
export type AssistantContext = {
  text: string;
  includedSources: string[];
  truncated: boolean;
  hash: string;
};
const MAX_FRAGMENT = 4000;
const MAX_CONTEXT = 12000;
const OMITTED = "\n[片段已截断]";
const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

function fields(parts: Array<[string, string | number | null]>): string {
  return parts
    .filter(([, value]) => value !== null && value !== "")
    .map(([label, value]) => `${label}：${value}`)
    .join("\n");
}
function current(
  reference: AssistantChatReference,
  version: { version_id: string; head_revision: number; content_hash: string },
): boolean {
  return (
    reference.versionId === version.version_id &&
    reference.headRevision === version.head_revision &&
    reference.contentHash === version.content_hash
  );
}
function fragment(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_FRAGMENT) return { text, truncated: false };
  return { text: `${text.slice(0, MAX_FRAGMENT - OMITTED.length)}${OMITTED}`, truncated: true };
}

/** All reads are current, validated local API receipts; renderer excerpts are never accepted. */
export async function readAssistantContext(
  api: AssistantContextClient,
  scope: AssistantChatScope,
  references: AssistantChatReference[],
): Promise<AssistantContext> {
  if (scope.projectId === null) {
    if (scope.episodeId !== null || references.length) throw new Error("CONTEXT_SCOPE_INVALID");
    const text = `当前页面：${scope.page}\n当前未选择项目。`;
    return { text, includedSources: [], truncated: false, hash: sha(text) };
  }
  const project = await api.getProject(scope.projectId);
  if (project.data.id !== scope.projectId) throw new Error("CONTEXT_SCOPE_INVALID");
  const episode =
    scope.episodeId === null ? null : await api.getEpisode(scope.projectId, scope.episodeId);
  if (
    episode &&
    (episode.data.id !== scope.episodeId || episode.data.project_id !== scope.projectId)
  )
    throw new Error("CONTEXT_SCOPE_INVALID");
  const chunks = [
    fields([
      ["当前页面", scope.page],
      ["项目", `${project.data.name} (${scope.projectId})`],
      ["分集", episode ? `${episode.data.title} (${episode.data.id})` : null],
    ]),
  ];
  const includedSources: string[] = [];
  let truncated = false;
  let script: Awaited<ReturnType<typeof api.getEpisodeScript>> | null = null;
  let storyboard: Awaited<ReturnType<typeof api.getEpisodeStoryboard>> | null = null;
  let creative: Awaited<ReturnType<typeof api.getProjectCreativeLibrary>> | null = null;
  function addSource(source: string, body: string): void {
    if (includedSources.includes(source)) return;
    const clipped = fragment(body);
    truncated ||= clipped.truncated;
    const prefix = `已保存作品片段 ${source}\n`;
    const available = MAX_CONTEXT - chunks.join("\n\n").length - 2;
    if (available <= prefix.length + OMITTED.length) {
      truncated = true;
      return;
    }
    const visible =
      clipped.text.length <= available - prefix.length
        ? clipped.text
        : `${clipped.text.slice(0, Math.max(0, available - prefix.length - OMITTED.length))}${OMITTED}`;
    truncated ||= visible.length < clipped.text.length;
    includedSources.push(source);
    chunks.push(`${prefix}${visible}`);
  }
  for (const reference of references) {
    let selected: string | null = null;
    const related: Array<{ source: string; body: string }> = [];
    if (reference.objectKind === "SCRIPT_SCENE" || reference.objectKind === "SCRIPT_BLOCK") {
      if (!scope.episodeId) throw new Error("CONTEXT_SCOPE_INVALID");
      script ??= await api.getEpisodeScript(scope.projectId, scope.episodeId);
      if (script.kind !== "FOUND" || !current(reference, script.receipt.data))
        throw new Error("CONTEXT_CHANGED");
      if (reference.objectKind === "SCRIPT_SCENE") {
        const scenes = script.receipt.data.content.scenes;
        const index = scenes.findIndex((item) => item.scene_id === reference.objectId);
        const scene = scenes[index];
        if (scene)
          selected = fields([
            ["场次", `${scene.ordinal} ${scene.heading}`],
            ...scene.blocks.map((block): [string, string] => [
              block.kind === "DIALOGUE" ? (block.speaker ?? "对白") : "动作",
              block.text,
            ]),
          ]);
        for (const neighbor of [scenes[index - 1], scenes[index + 1]]) {
          if (neighbor)
            related.push({
              source: `SCRIPT_SCENE/${neighbor.scene_id}@${reference.versionId}`,
              body: fields([
                ["相邻场次", `${neighbor.ordinal} ${neighbor.heading}`],
                ["开头", neighbor.blocks[0]?.text ?? ""],
              ]),
            });
        }
      } else {
        const block = script.receipt.data.content.scenes
          .flatMap((scene) => scene.blocks)
          .find((item) => item.block_id === reference.objectId);
        if (block)
          selected = fields([
            ["剧本块", `${block.ordinal} ${block.kind}`],
            ["说话人", block.speaker],
            ["内容", block.text],
          ]);
      }
    } else if (reference.objectKind === "STORYBOARD_SHOT") {
      if (!scope.episodeId) throw new Error("CONTEXT_SCOPE_INVALID");
      storyboard ??= await api.getEpisodeStoryboard(scope.projectId, scope.episodeId);
      if (storyboard.kind !== "FOUND" || !current(reference, storyboard.receipt.data))
        throw new Error("CONTEXT_CHANGED");
      const shots = storyboard.receipt.data.content.shots;
      const index = shots.findIndex((item) => item.shot_id === reference.objectId);
      const shot = shots[index];
      if (shot)
        selected = fields([
          ["镜头", `${shot.ordinal} ${shot.title}`],
          ["画面", shot.description],
          ["动作", shot.action],
          ["对白", shot.dialogue],
          ["机位", shot.camera],
        ]);
      for (const neighbor of [shots[index - 1], shots[index + 1]]) {
        if (neighbor)
          related.push({
            source: `STORYBOARD_SHOT/${neighbor.shot_id}@${reference.versionId}`,
            body: fields([
              ["相邻镜头", `${neighbor.ordinal} ${neighbor.title}`],
              ["画面", neighbor.description],
              ["动作", neighbor.action],
            ]),
          });
      }
      if (shot && (shot.character_ids.length || shot.location_id)) {
        const libraryVersionId = storyboard.receipt.data.content.creative_library_version_id;
        if (libraryVersionId === null) {
          related.push({
            source: "关联创作资料库/未绑定",
            body: "当前分镜未绑定角色与场景资料版本。",
          });
        } else {
          creative ??= await api.getProjectCreativeLibrary(scope.projectId);
          if (creative.kind !== "FOUND" || creative.receipt.data.version_id !== libraryVersionId)
            throw new Error("CONTEXT_CHANGED");
          const library = creative.receipt.data.content;
          for (const characterId of shot.character_ids) {
            const character = library.characters.find((item) => item.character_id === characterId);
            if (!character) throw new Error("CONTEXT_OBJECT_MISSING");
            related.push({
              source: `CREATIVE_CHARACTER/${characterId}@${libraryVersionId}/${creative.receipt.data.content_hash}/${creative.receipt.data.head_revision}`,
              body: fields([
                ["关联角色", character.name],
                ["身份", character.role],
                ["经历与关系", character.description],
                ["性格", character.personality],
              ]),
            });
          }
          if (shot.location_id) {
            const location = library.scenes.find((item) => item.scene_id === shot.location_id);
            if (!location) throw new Error("CONTEXT_OBJECT_MISSING");
            related.push({
              source: `CREATIVE_SCENE/${shot.location_id}@${libraryVersionId}/${creative.receipt.data.content_hash}/${creative.receipt.data.head_revision}`,
              body: fields([
                ["关联场景", location.name],
                ["地点", location.location],
                ["空间与叙事", location.description],
                ["时间", location.time_of_day],
              ]),
            });
          }
        }
      }
    } else {
      creative ??= await api.getProjectCreativeLibrary(scope.projectId);
      if (creative.kind !== "FOUND" || !current(reference, creative.receipt.data))
        throw new Error("CONTEXT_CHANGED");
      const content = creative.receipt.data.content;
      if (reference.objectKind === "CREATIVE_CHARACTER") {
        const item = content.characters.find((entry) => entry.character_id === reference.objectId);
        if (item)
          selected = fields([
            ["角色", item.name],
            ["身份", item.role],
            ["经历与关系", item.description],
            ["外观", item.appearance],
            ["性格", item.personality],
          ]);
      } else if (reference.objectKind === "CREATIVE_SCENE") {
        const item = content.scenes.find((entry) => entry.scene_id === reference.objectId);
        if (item)
          selected = fields([
            ["场景", item.name],
            ["地点", item.location],
            ["空间与叙事", item.description],
            ["时间", item.time_of_day],
            ["天气", item.weather],
            ["连续性", item.continuity],
          ]);
      } else if (reference.objectKind === "CREATIVE_WORLD" && reference.objectId === "world") {
        const world = content.world;
        selected = fields([
          ["世界定位", world.premise],
          ["核心规则", world.rules],
          ["时代", world.era],
          ["视觉风格", world.visual_style],
          ["色彩", world.palette],
          ["材质", world.materials],
        ]);
      }
    }
    if (!selected) throw new Error("CONTEXT_OBJECT_MISSING");
    const source = `${reference.objectKind}/${reference.objectId}@${reference.versionId}`;
    addSource(source, selected);
    for (const item of related) addSource(item.source, item.body);
  }
  const text = chunks.join("\n\n");
  return {
    text,
    includedSources,
    truncated,
    hash: sha(JSON.stringify({ scope, references, text })),
  };
}

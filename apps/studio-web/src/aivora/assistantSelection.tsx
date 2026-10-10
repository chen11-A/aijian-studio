import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { PageId } from "./data";
import type { ScriptVersion } from "./adapters/episodeScript";
import type { StoryboardVersion } from "./adapters/episodeStoryboard";
import type { CreativeVersion } from "./adapters/creativeLibrary";
import type { AssistantChatReference } from "@aijian/contracts/official-text";

export type AssistantSelectionScope = {
  fixture: boolean;
  projectId: string | null;
  episodeId: string | null;
  page: PageId;
};
export type AssistantSelection = {
  projectId: string;
  episodeId: string | null;
  page: "script" | "storyboard" | "characters" | "scenes" | "world";
  objectKind: AssistantChatReference["objectKind"];
  objectId: string;
  versionId: string;
  headRevision: number;
  contentHash: string;
  excerpt: string;
};
export type AssistantSelectionPublication =
  | { kind: "AVAILABLE"; selection: AssistantSelection }
  | {
      kind: "UNSAVED" | "UNAVAILABLE" | "DIRECTOR_VIEW" | "NONE";
      projectId?: string;
      episodeId?: string | null;
      page?: AssistantSelection["page"];
    };

/** IPC receives saved identities only; the native preview builds the actual outbound text. */
export function assistantChatReferences(
  publication: AssistantSelectionPublication,
  included: boolean,
): AssistantChatReference[] {
  if (!included || publication.kind !== "AVAILABLE") return [];
  const selection = publication.selection;
  return [
    {
      objectKind: selection.objectKind,
      objectId: selection.objectId,
      versionId: selection.versionId,
      contentHash: selection.contentHash,
      headRevision: selection.headRevision,
    },
  ];
}

type ReadState = "loading" | "ready" | "empty" | "error";
type SavedVersion = Pick<ScriptVersion, "version_id" | "head_revision" | "content_hash">;
const MAX_EXCERPT = 4000;
const TRUNCATED = "\n[内容已截断]";
function excerpt(parts: string[]): string {
  const text = parts.filter(Boolean).join("\n").trim();
  return text.length <= MAX_EXCERPT
    ? text
    : `${text.slice(0, MAX_EXCERPT - TRUNCATED.length)}${TRUNCATED}`;
}
function unavailable(
  kind: "UNSAVED" | "UNAVAILABLE" | "DIRECTOR_VIEW" | "NONE",
  projectId: string,
  episodeId: string | null,
  page: AssistantSelection["page"],
): AssistantSelectionPublication {
  return { kind, projectId, episodeId, page };
}
function available(
  projectId: string,
  episodeId: string | null,
  page: AssistantSelection["page"],
  objectKind: AssistantSelection["objectKind"],
  objectId: string,
  version: SavedVersion,
  parts: string[],
): AssistantSelectionPublication {
  const text = excerpt(parts);
  if (!text) return unavailable("NONE", projectId, episodeId, page);
  return {
    kind: "AVAILABLE",
    selection: {
      projectId,
      episodeId,
      page,
      objectKind,
      objectId,
      versionId: version.version_id,
      headRevision: version.head_revision,
      contentHash: version.content_hash,
      excerpt: text,
    },
  };
}

export function buildScriptSelection(input: {
  projectId: string;
  episodeId: string;
  version: ScriptVersion | null;
  selectedSceneId: string | null;
  dirty: boolean;
  readState: ReadState;
}): AssistantSelectionPublication {
  const { projectId, episodeId, version } = input;
  if (input.dirty) return unavailable("UNSAVED", projectId, episodeId, "script");
  if (input.readState === "error" || input.readState === "loading")
    return unavailable("UNAVAILABLE", projectId, episodeId, "script");
  if (input.readState !== "ready" || !version)
    return unavailable("NONE", projectId, episodeId, "script");
  if (version.project_id !== projectId || version.episode_id !== episodeId)
    return unavailable("UNAVAILABLE", projectId, episodeId, "script");
  const scene = version.content.scenes.find((item) => item.scene_id === input.selectedSceneId);
  if (!scene) return unavailable("NONE", projectId, episodeId, "script");
  return available(projectId, episodeId, "script", "SCRIPT_SCENE", scene.scene_id, version, [
    `场次 ${scene.ordinal}：${scene.heading}`,
    ...scene.blocks.map((block) =>
      block.kind === "DIALOGUE"
        ? `${block.speaker ?? "对白"}：${block.text}`
        : `动作：${block.text}`,
    ),
  ]);
}

export function buildStoryboardSelection(input: {
  projectId: string;
  episodeId: string;
  version: StoryboardVersion | null;
  selectedShotId: string | null;
  dirty: boolean;
  readState: ReadState;
  directorView: boolean;
}): AssistantSelectionPublication {
  const { projectId, episodeId, version } = input;
  if (input.directorView) return unavailable("DIRECTOR_VIEW", projectId, episodeId, "storyboard");
  if (input.dirty) return unavailable("UNSAVED", projectId, episodeId, "storyboard");
  if (input.readState === "error" || input.readState === "loading")
    return unavailable("UNAVAILABLE", projectId, episodeId, "storyboard");
  if (input.readState !== "ready" || !version)
    return unavailable("NONE", projectId, episodeId, "storyboard");
  if (version.project_id !== projectId || version.episode_id !== episodeId)
    return unavailable("UNAVAILABLE", projectId, episodeId, "storyboard");
  const shot = version.content.shots.find((item) => item.shot_id === input.selectedShotId);
  if (!shot) return unavailable("NONE", projectId, episodeId, "storyboard");
  return available(projectId, episodeId, "storyboard", "STORYBOARD_SHOT", shot.shot_id, version, [
    `镜头 ${shot.ordinal}：${shot.title}`,
    `画面：${shot.description}`,
    `动作：${shot.action}`,
    `对白：${shot.dialogue}`,
    `机位：${shot.camera}`,
  ]);
}

export function buildCreativeSelection(input: {
  projectId: string;
  episodeId: string | null;
  kind: "characters" | "world" | "scenes";
  version: CreativeVersion | null;
  selectedId: string | null;
  dirty: boolean;
  readState: ReadState;
}): AssistantSelectionPublication {
  const { projectId, episodeId, version, kind } = input;
  if (input.dirty) return unavailable("UNSAVED", projectId, episodeId, kind);
  if (input.readState === "error" || input.readState === "loading")
    return unavailable("UNAVAILABLE", projectId, episodeId, kind);
  if (input.readState !== "ready" || !version)
    return unavailable("NONE", projectId, episodeId, kind);
  if (version.project_id !== projectId || version.episode_id !== null)
    return unavailable("UNAVAILABLE", projectId, episodeId, kind);
  if (kind === "world") {
    const world = version.content.world;
    if (!Object.values(world).some((value) => value.trim()))
      return unavailable("NONE", projectId, episodeId, kind);
    return available(projectId, episodeId, kind, "CREATIVE_WORLD", "world", version, [
      `世界定位：${world.premise}`,
      `核心规则：${world.rules}`,
      `时代：${world.era}`,
      `视觉风格：${world.visual_style}`,
      `色彩：${world.palette}`,
      `材质：${world.materials}`,
    ]);
  }
  if (kind === "characters") {
    const item = version.content.characters.find(
      (entry) => entry.character_id === input.selectedId,
    );
    return item
      ? available(projectId, episodeId, kind, "CREATIVE_CHARACTER", item.character_id, version, [
          `角色：${item.name}`,
          `身份：${item.role}`,
          `经历与关系：${item.description}`,
          `外观：${item.appearance}`,
          `性格：${item.personality}`,
        ])
      : unavailable("NONE", projectId, episodeId, kind);
  }
  const item = version.content.scenes.find((entry) => entry.scene_id === input.selectedId);
  return item
    ? available(projectId, episodeId, kind, "CREATIVE_SCENE", item.scene_id, version, [
        `场景：${item.name}`,
        `地点：${item.location}`,
        `空间与叙事：${item.description}`,
        `时间：${item.time_of_day}`,
        `天气：${item.weather}`,
        `连续性：${item.continuity}`,
      ])
    : unavailable("NONE", projectId, episodeId, kind);
}

type AssistantSelectionContext = {
  publication: AssistantSelectionPublication;
  included: boolean;
  setIncluded: (included: boolean) => void;
  publish: (owner: symbol, publication: AssistantSelectionPublication) => void;
  clear: (owner: symbol) => void;
};
const Context = createContext<AssistantSelectionContext | null>(null);
const none: AssistantSelectionPublication = { kind: "NONE" };
function selectionKey(selection: AssistantSelection): string {
  return JSON.stringify(selection);
}
export function AssistantSelectionProvider({
  scope,
  children,
}: {
  scope: AssistantSelectionScope;
  children: ReactNode;
}) {
  const [published, setPublished] = useState<{
    owner: symbol;
    value: AssistantSelectionPublication;
  } | null>(null);
  const [approvedKey, setApprovedKey] = useState<string | null>(null);
  useEffect(() => {
    setApprovedKey(null);
  }, [scope.fixture, scope.projectId, scope.episodeId, scope.page]);
  const publish = useCallback((owner: symbol, value: AssistantSelectionPublication) => {
    setPublished((current) =>
      current?.owner === owner && JSON.stringify(current.value) === JSON.stringify(value)
        ? current
        : { owner, value },
    );
  }, []);
  const clear = useCallback((owner: symbol) => {
    setPublished((current) => (current?.owner === owner ? null : current));
  }, []);
  const candidate = published?.value ?? none;
  const projectId =
    candidate.kind === "AVAILABLE" ? candidate.selection.projectId : candidate.projectId;
  const episodeId =
    candidate.kind === "AVAILABLE" ? candidate.selection.episodeId : candidate.episodeId;
  const page = candidate.kind === "AVAILABLE" ? candidate.selection.page : candidate.page;
  const publication =
    !scope.fixture &&
    projectId === scope.projectId &&
    episodeId === scope.episodeId &&
    page === scope.page
      ? candidate
      : none;
  const key = publication.kind === "AVAILABLE" ? selectionKey(publication.selection) : null;
  useEffect(() => {
    setApprovedKey(null);
  }, [key]);
  return (
    <Context.Provider
      value={{
        publication,
        included: key !== null && approvedKey === key,
        setIncluded: (included) => setApprovedKey(included ? key : null),
        publish,
        clear,
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function useAssistantSelection() {
  const context = useContext(Context);
  if (!context) throw new Error("AssistantSelectionProvider is required");
  return context;
}
export function useOptionalAssistantSelection() {
  return useContext(Context);
}
export function usePublishAssistantSelection(publication: AssistantSelectionPublication) {
  const context = useContext(Context);
  const owner = useRef(Symbol("assistant-selection"));
  useEffect(() => {
    if (context) context.publish(owner.current, publication);
  }, [context?.publish, publication]);
  useEffect(() => () => context?.clear(owner.current), [context?.clear]);
}

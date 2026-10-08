import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode, SetStateAction } from "react";
import { initialCharacters, initialProjects, initialShots, pages } from "./data";
import type { PageId, Scenario } from "./data";
import type { V2ViewerImage } from "./V2ImageViewer";
import {
  createStudioTransport,
  type CreateEpisodeInput,
  type CreateProjectInput,
  type EpisodeListResponse,
  type ProjectData,
  type SourceManifestResponse,
  type SourceManifestReviewIdentity,
  type SourceDocumentResponse,
  type ProductionBriefCreateCommand,
  type ProductionBriefResponse,
} from "../api/studio";
import {
  LatestRequestGate,
  connectWorkspace,
  createWorkspaceProject,
  restoreLatestSource,
} from "./adapters/projectWorkspace";
import {
  importTextSource,
  readSourceDocumentText,
  sourceFileSha256,
  validateSourceFile,
} from "./adapters/sourceImport";
import {
  clearSourceImportMarker,
  readSourceImportMarker,
  writeSourceImportMarker,
  type SourceImportMarker,
} from "./adapters/sourceImportJournal";
import {
  createEpisodeWorkspace,
  listEpisodeWorkspace,
  readEpisodeWorkspace,
} from "./adapters/episodeWorkspace";
import {
  persistWorkspaceSelection,
  readWorkspaceSelection,
  withEpisodeCreateMarker,
  withWorkspaceSelection,
  type WorkspaceSelectionSnapshot,
} from "./adapters/workspaceSelection";
import { createSourceReviewRunner, sourceReviewIdentity } from "./adapters/sourceManifest";
import { type ProductionSourceStage } from "./adapters/productionSourceStage";
import { loadStoryWorkspace } from "./adapters/storyWorkspace";
import {
  clearPendingProductionBriefCommand,
  readPendingProductionBriefCommand,
  readProductionBrief,
  retainProductionBriefCommand,
  writeProductionBrief,
} from "./adapters/productionBriefWorkspace";
import { useInvalidationHistory } from "../domain/use-invalidation-history";
import { createTimelineWorkspaceGateway } from "../domain/timeline-workspace-controller";
import { useTimelineWorkspace } from "../domain/use-timeline-workspace";
import { useProviderSettings } from "../domain/use-provider-settings";
import { useTaskQueue } from "../domain/use-task-queue";
import { readAppPreferences, type AppPreferencesGateway } from "./adapters/appPreferences";

export type Field = {
  key: string;
  label: string;
  value: string;
  type?: "text" | "number" | "textarea";
  options?: string[];
  required?: boolean;
  min?: number;
  max?: number;
};
export type Editor = {
  title: string;
  description?: string;
  fields?: Field[];
  confirm?: string;
  validate?: () => string | undefined;
  image?: string;
  images?: readonly V2ViewerImage[];
  presentation?: "drawer" | "dialog";
  imageCrop?: { x: number; y: number; width: number; height: number; sourceWidth: number };
  save?: (values: Record<string, string>) => void | false | Promise<void | false>;
};
export type ProjectCreateUiState =
  { kind: "idle" } | { kind: "SUBMITTING" } | { kind: "REMOTE_UNKNOWN" };
export type SourceImportUiState =
  | { kind: "idle" }
  | { kind: "pending"; projectId: string }
  | { kind: "saved"; filename: string }
  | { kind: "invalid"; message: string }
  | { kind: "unknown"; message: string };
export type Annotation = {
  id: number;
  start: number;
  end: number;
  text: string;
  category: string;
  included: boolean;
};

export function sourceStageFromManifest(
  manifest: SourceManifestResponse | null,
  projectId: string,
): ProductionSourceStage {
  if (!manifest) return { kind: "empty" };
  if (!sourceReviewIdentity(manifest, projectId)) return { kind: "inconsistent" };
  const { head, latest_version: latest, accepted_version: accepted } = manifest.data;
  if (head.accepted_version_id === latest.id)
    return { kind: "approved", versionNumber: latest.version_number };
  const acceptedVersionNumber = accepted?.version_number ?? null;
  return head.review_version_id === latest.id
    ? { kind: "review", acceptedVersionNumber }
    : { kind: "draft", acceptedVersionNumber };
}
export type Task = { id: number; name: string; status: string; page: PageId };
export type Outfit = {
  id: number;
  characterId: number;
  episode: string;
  name: string;
  startShot: number;
  endShot: number;
  rangeBindingExplicit?: boolean;
  version: number;
  confirmed: boolean;
};
export type LocalAsset = { id: string; name: string; image: string; category: string };
type WorkspaceProject = (typeof initialProjects)[number] & {
  backendId?: string;
  revision?: number;
};
type WorkspaceState = "idle" | "loading" | "connected" | "error";
type EpisodeState = "idle" | "loading" | "ready" | "error" | "unavailable" | "storage-error";
type WorkspaceEpisode = EpisodeListResponse["data"][number];
export type DemoFixture = Partial<{
  values: Record<string, string>;
  characters: typeof initialCharacters;
  outfits: Outfit[];
  locations: { id: number; name: string; image: string }[];
  shots: typeof initialShots;
  annotations: Annotation[];
  time: number;
  selectedShot: number;
  projects: WorkspaceProject[];
}>;

/** Test-only sample data. Production callers must leave this undefined. */
export function createAivoraSampleFixture(): Required<DemoFixture> {
  const characters = initialCharacters.map((person) => ({ ...person }));
  return {
    values: {
      title: "星夜之城",
      projectId: "1",
      episode: "第 1 集 · 重逢",
      relation: "苏晚 → 程野：追查异常记忆中的旧识",
      worldNote: "近未来滨海城市。记忆可以买卖，真实记忆与人造记忆之间的界限正在消失。",
      sceneName: "雨夜街道",
      sceneState: "夜 · 雨",
      sceneView: "主参考图",
      budget: "150.00",
    },
    characters,
    outfits: characters.flatMap((person) =>
      (person.id === 1 ? ["雨夜调查", "日常职业装", "医院工作服", "居家服"] : ["日常造型"]).map(
        (name, index) => ({
          id: person.id * 100 + index,
          characterId: person.id,
          episode: "第 1 集 · 重逢",
          name,
          startShot: 1,
          endShot: 8,
          rangeBindingExplicit: false,
          version: 1,
          confirmed: false,
        }),
      ),
    ),
    locations: [
      { id: 1, name: "雨夜街道", image: "street" },
      { id: 2, name: "记忆修复中心", image: "morning" },
      { id: 3, name: "滨海城区", image: "sea" },
    ],
    shots: initialShots.map((shot) => ({ ...shot })),
    annotations: [
      {
        id: 1,
        start: 14,
        end: 14,
        text: "回头后留一点停顿，让观众感受到她的迟疑。",
        category: "剪辑节奏",
        included: true,
      },
      {
        id: 2,
        start: 32,
        end: 37,
        text: "对白字幕向上移动，避开下方画面细节。",
        category: "字幕",
        included: true,
      },
      {
        id: 3,
        start: 130,
        end: 130,
        text: "这里的表情需要更克制，保留角色的迟疑。",
        category: "角色表演",
        included: true,
      },
      {
        id: 4,
        start: 198,
        end: 205,
        text: "结尾音乐淡出，给城市空镜留一点呼吸。",
        category: "声音",
        included: true,
      },
    ],
    time: 84.75,
    selectedShot: 3,
    projects: initialProjects.map((project) => ({ ...project })),
  };
}
export function shotAtTime(shots: typeof initialShots, time: number) {
  let end = 0;
  return (
    shots.find((shot) => {
      end += shot.duration;
      return time < end;
    }) ?? shots.at(-1)
  );
}
export function moveShot(shots: typeof initialShots, id: number, target: number) {
  const from = shots.findIndex((shot) => shot.id === id);
  const to = shots.findIndex((shot) => shot.id === target);
  if (from < 0 || to < 0 || from === to) return shots;
  const copy = [...shots];
  const item = copy.splice(from, 1)[0]!;
  copy.splice(to, 0, item);
  return copy;
}
function initialPage(): PageId {
  const hash = window.location.hash.slice(1);
  return hash in pages ? (hash as PageId) : "project";
}
function useDemoModel(fixture?: DemoFixture) {
  const [page, setPage] = useState<PageId>(initialPage);
  const [scenario, setScenario] = useState<Scenario>("normal");
  const [professional, setProfessional] = useState(false);
  const [inspector, setInspector] = useState(false);
  const [aiOpen, setAiOpen] = useState(true);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [projectCreateState, setProjectCreateState] = useState<ProjectCreateUiState>({
    kind: "idle",
  });
  const [toast, setToast] = useState("");
  const [values, setValues] = useState<Record<string, string>>(() => ({
    source: "",
    title: "",
    input: "",
    ...(!fixture ? { userName: "本地用户" } : {}),
    ...fixture?.values,
  }));
  // Project cards only represent records read from the desktop workspace.
  const [projects, setProjects] = useState<WorkspaceProject[]>(() => fixture?.projects ?? []);
  const [workspaceState, setWorkspaceState] = useState<WorkspaceState>("idle");
  const [episodes, setEpisodes] = useState<WorkspaceEpisode[]>([]);
  const [episodeState, setEpisodeState] = useState<EpisodeState>("idle");
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string | null>(null);
  const [episodeCreateMarker, setEpisodeCreateMarker] = useState<"PENDING" | "UNKNOWN" | null>(
    null,
  );
  const [episodeAcknowledgementReady, setEpisodeAcknowledgementReady] = useState(false);
  const [episodeCreateInFlightProjectId, setEpisodeCreateInFlightProjectId] = useState<
    string | null
  >(null);
  const [storyWorkspaceState, setStoryWorkspaceState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [sourceStage, setSourceStage] = useState<ProductionSourceStage>({ kind: "empty" });
  const [sourceDocument, setSourceDocument] = useState<SourceDocumentResponse | null>(null);
  const [sourceImportState, setSourceImportState] = useState<SourceImportUiState>({ kind: "idle" });
  const [sourceManifest, setSourceManifest] = useState<SourceManifestResponse | null>(null);
  const productionBriefGate = useRef(new LatestRequestGate()).current;
  const productionBriefRecoveryInFlight = useRef(false);
  const [productionBrief, setProductionBrief] = useState<ProductionBriefResponse | null>(null);
  const [pendingProductionBrief, setPendingProductionBrief] =
    useState<ProductionBriefCreateCommand | null>(null);
  const [pendingProductionBriefProject, setPendingProductionBriefProject] = useState<string | null>(
    null,
  );
  const [productionBriefState, setProductionBriefState] = useState<
    "idle" | "loading" | "ready" | "empty" | "error" | "unavailable" | "unknown"
  >("idle");
  const studio = useRef(createStudioTransport()).current;
  const selectionStorage = useRef<Pick<Storage, "getItem" | "setItem"> | null>(
    (() => {
      try {
        return window.localStorage;
      } catch {
        return null;
      }
    })(),
  ).current;
  const selectionRead = useRef(
    selectionStorage ? readWorkspaceSelection(selectionStorage) : { kind: "UNAVAILABLE" as const },
  ).current;
  const selectionSnapshot = useRef<WorkspaceSelectionSnapshot>(
    selectionRead.kind === "READY"
      ? selectionRead.snapshot
      : { selection: null, createMarkers: {} },
  );
  const selectionAvailable = useRef(selectionRead.kind === "READY");
  const persistSelection = (snapshot: WorkspaceSelectionSnapshot) => {
    if (
      !selectionStorage ||
      !selectionAvailable.current ||
      !persistWorkspaceSelection(selectionStorage, snapshot)
    ) {
      selectionAvailable.current = false;
      setEpisodeState("storage-error");
      return false;
    }
    selectionSnapshot.current = snapshot;
    setEpisodeCreateMarker(
      backendProjectRef.current
        ? (snapshot.createMarkers[backendProjectRef.current] ?? null)
        : null,
    );
    return true;
  };
  const episodeMarkerTokens = useRef(new Map<string, number>()).current;
  function persistEpisodeMarker(projectId: string, marker: "PENDING" | "UNKNOWN" | null) {
    const previous = selectionSnapshot.current.createMarkers[projectId] ?? null;
    if (!persistSelection(withEpisodeCreateMarker(selectionSnapshot.current, projectId, marker)))
      return false;
    if (previous !== marker)
      episodeMarkerTokens.set(projectId, (episodeMarkerTokens.get(projectId) ?? 0) + 1);
    if (projectId === currentBackendProjectId()) setEpisodeAcknowledgementReady(false);
    return true;
  }
  const timelineGateway = useRef(createTimelineWorkspaceGateway(studio)).current;
  // This ref advances before React schedules a render, so a project-scoped read
  // cannot reject its own result just after a workspace switch.
  const initialBackendProjectId =
    (fixture?.projects ?? []).find(
      (project) => String(project.id) === (fixture?.values?.projectId ?? "1"),
    )?.backendId ?? null;
  const backendProjectRef = useRef<string | null>(initialBackendProjectId);
  const [backendProjectId, setActiveBackendProjectId] = useState<string | null>(
    initialBackendProjectId,
  );
  const projectGate = useRef(new LatestRequestGate()).current;
  const sourceGate = useRef(new LatestRequestGate()).current;
  const sourceImportPending = useRef(new Set<string>()).current;
  const sourceImportUnknown = useRef(
    new Map<
      string,
      { operationId: string; sourceId?: string; projectId: string; rawSha256?: string }
    >(),
  ).current;
  const sourceImportStorage = useRef<Pick<Storage, "getItem" | "setItem" | "removeItem"> | null>(
    (() => {
      try {
        return window.localStorage;
      } catch {
        return null;
      }
    })(),
  ).current;
  const sourceStageGate = useRef(new LatestRequestGate()).current;
  const storyGate = useRef(new LatestRequestGate()).current;
  const episodeGate = useRef(new LatestRequestGate()).current;
  const episodeCreateGate = useRef(new LatestRequestGate()).current;
  const episodeCreatePending = useRef(new Set<string>()).current;
  const createPending = useRef(false);
  const createUnknown = useRef(false);
  const reviewRunner = useRef(createSourceReviewRunner(studio.sourceManifestReview)).current;
  // Keep the confirmation pending through its authoritative readback.  The review
  // runner only serializes the bridge call itself, which is too short to prevent a
  // second click from issuing another confirmation while the first readback is open.
  const baselineConfirmPending = useRef(new Set<string>()).current;
  const [characters, setCharacters] = useState(() => fixture?.characters ?? []);
  const [selectedCharacter, setSelectedCharacter] = useState(
    () => fixture?.characters?.[0]?.id ?? 0,
  );
  const [outfits, setOutfits] = useState<Outfit[]>(() => fixture?.outfits ?? []);
  const [locations, setLocations] = useState(() => fixture?.locations ?? []);
  const [selectedLocation, setSelectedLocation] = useState(() => fixture?.locations?.[0]?.id ?? 0);
  const [localAssets, setLocalAssets] = useState<LocalAsset[]>([]);
  const [shots, setShots] = useState(() => fixture?.shots ?? []);
  const [selectedShot, setSelectedShot] = useState(
    () => fixture?.selectedShot ?? fixture?.shots?.[0]?.id ?? 0,
  );
  const [time, setTime] = useState(() => fixture?.time ?? 0);
  const [playing, setPlaying] = useState(false);
  const [annotations, setAnnotations] = useState<Annotation[]>(() => fixture?.annotations ?? []);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [aiDrafts, setAiDrafts] = useState<Partial<Record<PageId, string>>>({});
  const aiDraft = aiDrafts[page] ?? "";
  const setAiDraft = (next: SetStateAction<string>) =>
    setAiDrafts((old) => ({
      ...old,
      [page]: typeof next === "function" ? next(old[page] ?? "") : next,
    }));
  const [messages, setMessages] = useState<{ role: string; text: string }[]>([]);
  const [references, setReferences] = useState<string[]>([]);
  const [rightTabs, setRightTabs] = useState<Partial<Record<PageId, "inspector" | "ai">>>({});
  const rightTab = rightTabs[page] ?? "inspector";
  const selectRightTab = (tab: "inspector" | "ai") =>
    setRightTabs((old) => ({ ...old, [page]: tab }));
  function focusAssistant(request: string) {
    selectRightTab("ai");
    setAiOpen(true);
    setAiDraft(request);
  }
  const history = useRef<PageId[]>([]);
  const scroll = useRef<Partial<Record<PageId, number>>>({});
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const total = shots.reduce((sum, shot) => sum + shot.duration, 0);
  const value = (key: string, fallback = "") => values[key] ?? fallback;
  function updateValues(updates: Record<string, string>) {
    setValues((old) => {
      const next = { ...old, ...updates };
      if ("source" in updates && updates.source !== old.source) {
        next.sourceVersion = String(Number(old.sourceVersion ?? "1") + 1);
        next.sourceApproved = "false";
        next.sourceReviewSubmitted = "false";
        next.storyConfirmed = "false";
        next.storySourceVersion = "";
        for (let i = 0; i < 5; i++) next[`storyCheck${i}`] = "false";
      }
      if (
        Object.entries(updates).some(
          ([key, value]) => /^(summary|conflict|event-\d+)$/.test(key) && old[key] !== value,
        )
      ) {
        next.storyConfirmed = "false";
      }
      return next;
    });
  }
  const put = (key: string, next: string) => updateValues({ [key]: next });
  const currentBackendProjectId = () => backendProjectRef.current;
  function setBackendProjectId(projectId: string | null) {
    backendProjectRef.current = projectId;
    setActiveBackendProjectId(projectId);
    put("backendProjectId", projectId ?? "");
    setEpisodeCreateMarker(
      projectId ? (selectionSnapshot.current.createMarkers[projectId] ?? null) : null,
    );
    setEpisodeAcknowledgementReady(false);
  }
  async function selectRealEpisode(
    episodeId: string,
    projectId = currentBackendProjectId(),
    allowUnlisted = false,
  ) {
    if (!projectId || (!allowUnlisted && !episodes.some((episode) => episode.id === episodeId)))
      return;
    const generation = episodeGate.begin();
    setSelectedEpisodeId(null);
    setEpisodeState("loading");
    updateValues({
      episode: "",
      storyConfirmed: "false",
      storySourceVersion: "",
      storyBibleVersion: "",
    });
    setStoryWorkspaceState("idle");
    const outcome = await readEpisodeWorkspace(studio, projectId, episodeId);
    if (!episodeGate.isCurrent(generation) || projectId !== currentBackendProjectId()) return;
    if (outcome.kind !== "SUCCEEDED") {
      setEpisodeState(outcome.kind === "UNAVAILABLE" ? "unavailable" : "error");
      return;
    }
    setSelectedEpisodeId(outcome.receipt.data.id);
    setEpisodeState("ready");
    setEpisodes((old) =>
      old.some((episode) => episode.id === outcome.receipt.data.id)
        ? old
        : [outcome.receipt.data, ...old],
    );
    put("episode", outcome.receipt.data.title);
    persistSelection(withWorkspaceSelection(selectionSnapshot.current, { projectId, episodeId }));
  }
  async function refreshRealEpisodes(
    projectId = currentBackendProjectId(),
    allowAcknowledgement = true,
  ) {
    if (!projectId) {
      episodeGate.invalidate();
      setEpisodes([]);
      setSelectedEpisodeId(null);
      setEpisodeState("idle");
      return;
    }
    if (!selectionAvailable.current) {
      setEpisodeState("storage-error");
      return;
    }
    const markerAtStart = selectionSnapshot.current.createMarkers[projectId] ?? null;
    const markerTokenAtStart = episodeMarkerTokens.get(projectId) ?? 0;
    const canAcknowledgeAtStart = !!markerAtStart && !episodeCreatePending.has(projectId);
    const generation = episodeGate.begin();
    setSelectedEpisodeId(null);
    updateValues({
      episode: "",
      storyConfirmed: "false",
      storySourceVersion: "",
      storyBibleVersion: "",
    });
    setStoryWorkspaceState("idle");
    setEpisodeState("loading");
    const outcome = await listEpisodeWorkspace(studio, projectId);
    if (!episodeGate.isCurrent(generation) || projectId !== currentBackendProjectId()) return;
    if (outcome.kind !== "SUCCEEDED") {
      setEpisodeState(outcome.kind === "UNAVAILABLE" ? "unavailable" : "error");
      return;
    }
    setEpisodes(outcome.receipt.data);
    setEpisodeState("ready");
    const markerIsUnchanged =
      markerAtStart === (selectionSnapshot.current.createMarkers[projectId] ?? null) &&
      markerTokenAtStart === (episodeMarkerTokens.get(projectId) ?? 0);
    setEpisodeAcknowledgementReady(
      allowAcknowledgement && canAcknowledgeAtStart && markerIsUnchanged,
    );
    const restored = selectionSnapshot.current.selection;
    const episodeId = restored?.projectId === projectId ? restored.episodeId : null;
    const defaultEpisodeId = outcome.receipt.data.find((episode) => episode.is_default)?.id;
    if (episodeId) await selectRealEpisode(episodeId, projectId, true);
    else if (defaultEpisodeId) await selectRealEpisode(defaultEpisodeId, projectId, true);
  }
  function acknowledgeEpisodeCreation() {
    const projectId = currentBackendProjectId();
    if (
      !projectId ||
      episodeState !== "ready" ||
      !episodeAcknowledgementReady ||
      episodeCreatePending.has(projectId)
    )
      return;
    const marker = selectionSnapshot.current.createMarkers[projectId];
    if (!marker) return;
    if (persistEpisodeMarker(projectId, null)) notify("已记录你的核对；现在可以新建剧集。");
  }
  async function createRealEpisode(input: CreateEpisodeInput) {
    const projectId = currentBackendProjectId();
    if (!projectId || !selectionAvailable.current) return { kind: "UNAVAILABLE" } as const;
    if (episodeCreatePending.has(projectId)) {
      notify("正在创建剧集，请等待结果后再试。");
      return { kind: "REMOTE_UNKNOWN" } as const;
    }
    if (selectionSnapshot.current.createMarkers[projectId]) {
      notify("上一项剧集创建结果尚未确认。请手动刷新剧集列表后再继续。");
      return { kind: "REMOTE_UNKNOWN" } as const;
    }
    if (!persistEpisodeMarker(projectId, "PENDING")) return { kind: "UNAVAILABLE" } as const;
    episodeCreatePending.add(projectId);
    setEpisodeCreateInFlightProjectId(projectId);
    const generation = episodeCreateGate.begin();
    const outcome = await createEpisodeWorkspace(studio, projectId, input);
    episodeCreatePending.delete(projectId);
    setEpisodeCreateInFlightProjectId((active) => (active === projectId ? null : active));
    // A project change (including A -> B -> A) invalidates this scope.  Keep
    // the conservative marker, but never let an old response select or alter
    // the currently displayed project.
    if (!episodeCreateGate.isCurrent(generation) || projectId !== currentBackendProjectId())
      return outcome;
    if (outcome.kind === "SUCCEEDED") {
      persistEpisodeMarker(projectId, null);
      if (projectId !== currentBackendProjectId()) return outcome;
      setEpisodes((old) => [
        outcome.receipt.data,
        ...old.filter((episode) => episode.id !== outcome.receipt.data.id),
      ]);
      setEpisodeState("ready");
      await selectRealEpisode(outcome.receipt.data.id, projectId, true);
    } else if (outcome.kind === "REMOTE_UNKNOWN") {
      persistEpisodeMarker(projectId, "UNKNOWN");
      notify("剧集创建结果未知。请手动刷新剧集列表确认，系统不会自动重试。");
    } else persistEpisodeMarker(projectId, null);
    return outcome;
  }
  function clearProjectScopedState() {
    const cleared: Record<string, string> = {
      episode: "",
      source: "",
      importedName: "",
      sourceApproved: "false",
      sourceReviewSubmitted: "false",
      storyConfirmed: "false",
      storySourceVersion: "",
      storyBibleVersion: "",
      summary: "",
      conflict: "",
    };
    for (let i = 0; i < 5; i++) {
      cleared[`storyCheck${i}`] = "false";
      cleared[`event-${i}`] = "";
    }
    updateValues(cleared);
    setStoryWorkspaceState("idle");
    episodeGate.invalidate();
    episodeCreateGate.invalidate();
    setEpisodes([]);
    setEpisodeState("idle");
    setSelectedEpisodeId(null);
    setEpisodeAcknowledgementReady(false);
    setSourceStage({ kind: "empty" });
    setSourceDocument(null);
    setSourceImportState({ kind: "idle" });
    setSourceManifest(null);
    productionBriefGate.invalidate();
    setProductionBrief(null);
    setPendingProductionBrief(null);
    setPendingProductionBriefProject(null);
    setProductionBriefState("idle");
    setCharacters([]);
    setSelectedCharacter(0);
    setOutfits([]);
    setLocations([]);
    setSelectedLocation(0);
    setLocalAssets([]);
    setShots([]);
    setSelectedShot(0);
    setTime(0);
    setAnnotations([]);
  }
  function restoreSourceImportMarker(projectId: string) {
    if (!sourceImportStorage) {
      setSourceImportState({ kind: "unknown", message: "无法读取来源保存记录；已阻止自动重试。" });
      return;
    }
    const stored = readSourceImportMarker(sourceImportStorage, projectId);
    if (stored.kind !== "READY") {
      setSourceImportState({
        kind: "unknown",
        message: "来源保存记录不可读；请人工核对后再继续。",
      });
    } else if (stored.marker) {
      setSourceImportState({
        kind: "unknown",
        message: "上次来源保存未完成；请刷新来源状态后人工核对。",
      });
      sourceImportUnknown.set(projectId, {
        operationId: stored.marker.operationId,
        sourceId: stored.marker.sourceId ?? undefined,
        projectId,
        rawSha256: stored.marker.rawSha256,
      });
    }
  }
  async function refreshProductionBrief(projectId = currentBackendProjectId()) {
    if (!projectId) {
      productionBriefGate.invalidate();
      setProductionBrief(null);
      setProductionBriefState("empty");
      return;
    }
    const generation = productionBriefGate.begin();
    setProductionBriefState("loading");
    const outcome = await readProductionBrief(studio, projectId);
    if (!productionBriefGate.isCurrent(generation) || projectId !== currentBackendProjectId())
      return;
    if (outcome.kind === "SUCCEEDED") {
      setProductionBrief(outcome.receipt);
      const pending = readPendingProductionBriefCommand(projectId);
      setPendingProductionBrief(pending.kind === "READY" ? pending.command : null);
      setPendingProductionBriefProject(
        pending.kind === "READY" && pending.command ? projectId : null,
      );
      setProductionBriefState(
        pending.kind !== "READY"
          ? "error"
          : pending.command
            ? "unknown"
            : outcome.receipt
              ? "ready"
              : "empty",
      );
    } else {
      const pending = readPendingProductionBriefCommand(projectId);
      setPendingProductionBrief(pending.kind === "READY" ? pending.command : null);
      setPendingProductionBriefProject(
        pending.kind === "READY" && pending.command ? projectId : null,
      );
      setProductionBriefState(pending.kind === "READY" && pending.command ? "unknown" : "error");
    }
  }
  async function saveProductionBrief(command: ProductionBriefCreateCommand, recovery = false) {
    const projectId = currentBackendProjectId();
    if (!projectId) return { kind: "UNAVAILABLE" } as const;
    const retained = readPendingProductionBriefCommand(projectId);
    if (retained.kind !== "READY") return { kind: "UNAVAILABLE" } as const;
    if (retained.command && !recovery) return { kind: "REMOTE_UNKNOWN" } as const;
    if (!retainProductionBriefCommand(projectId, command)) return { kind: "UNAVAILABLE" } as const;
    setPendingProductionBrief(command);
    setPendingProductionBriefProject(projectId);
    const generation = productionBriefGate.begin();
    const outcome = await writeProductionBrief(studio, projectId, command);
    if (!productionBriefGate.isCurrent(generation) || projectId !== currentBackendProjectId())
      return outcome;
    if (outcome.kind === "SUCCEEDED") {
      if (clearPendingProductionBriefCommand(projectId, command.operation_id)) {
        setPendingProductionBrief(null);
        setPendingProductionBriefProject(null);
        setProductionBrief(outcome.receipt);
        setProductionBriefState("ready");
      } else setProductionBriefState("unknown");
    } else if (outcome.kind === "REMOTE_UNKNOWN" || outcome.kind === "UNAVAILABLE")
      setProductionBriefState("unknown");
    else {
      if (clearPendingProductionBriefCommand(projectId, command.operation_id)) {
        setPendingProductionBrief(null);
        setPendingProductionBriefProject(null);
        setProductionBriefState("error");
      } else setProductionBriefState("unknown");
    }
    return outcome;
  }
  async function recoverProductionBrief() {
    if (!pendingProductionBrief || pendingProductionBriefProject !== currentBackendProjectId())
      return { kind: "UNAVAILABLE" } as const;
    if (productionBriefRecoveryInFlight.current) return { kind: "REMOTE_UNKNOWN" } as const;
    productionBriefRecoveryInFlight.current = true;
    try {
      return await saveProductionBrief(pendingProductionBrief, true);
    } finally {
      productionBriefRecoveryInFlight.current = false;
    }
  }
  async function refreshRealSourceStage(projectId = currentBackendProjectId()) {
    if (!projectId) {
      sourceStageGate.invalidate();
      setSourceStage({ kind: "empty" });
      setSourceDocument(null);
      setSourceManifest(null);
      return;
    }
    const generation = sourceStageGate.begin();
    setSourceStage({ kind: "loading" });
    put("sourceApproved", "false");
    try {
      const pendingUnknown = sourceImportUnknown.get(projectId);
      if (pendingUnknown) {
        let reconciled: SourceDocumentResponse | null = null;
        if (pendingUnknown.sourceId) {
          reconciled = await studio.getSource(projectId, pendingUnknown.sourceId);
        } else if (pendingUnknown.rawSha256) {
          const sources = await studio.listSources(projectId);
          const candidate = sources.data.find(
            (source) =>
              source.project_id === pendingUnknown.projectId &&
              source.raw_sha256 === pendingUnknown.rawSha256,
          );
          if (candidate) reconciled = await studio.getSource(projectId, candidate.id);
        }
        if (!sourceStageGate.isCurrent(generation) || projectId !== currentBackendProjectId())
          return;
        if (
          reconciled &&
          (!pendingUnknown.sourceId || reconciled.data.id === pendingUnknown.sourceId) &&
          reconciled.data.project_id === pendingUnknown.projectId &&
          !!pendingUnknown.rawSha256 &&
          reconciled.data.raw_sha256 === pendingUnknown.rawSha256
        ) {
          const normalizedText = await readSourceDocumentText(studio, projectId, reconciled.data);
          if (!sourceStageGate.isCurrent(generation) || projectId !== currentBackendProjectId())
            return;
          const cleared =
            !!sourceImportStorage &&
            clearSourceImportMarker(sourceImportStorage, projectId, pendingUnknown.operationId);
          if (!cleared) {
            setSourceImportState({
              kind: "unknown",
              message: "来源已找到，但保存记录未能清除；请人工核对。",
            });
            return;
          }
          sourceImportUnknown.delete(projectId);
          put("source", normalizedText);
          put("importedName", reconciled.data.filename);
          setSourceDocument(reconciled);
          setSourceImportState({ kind: "saved", filename: reconciled.data.filename });
        }
      }
      const manifest = await studio.getSourceManifest(projectId);
      if (!sourceStageGate.isCurrent(generation) || projectId !== currentBackendProjectId()) return;
      const stage = sourceStageFromManifest(manifest, projectId);
      setSourceManifest(manifest);
      setSourceStage(stage);
      if (stage.kind !== "approved") put("sourceApproved", "false");
    } catch {
      if (sourceStageGate.isCurrent(generation) && projectId === currentBackendProjectId())
        setSourceStage({ kind: "error" });
    }
  }
  const mapProject = (project: ProjectData, index: number): WorkspaceProject => ({
    id: index + 1,
    backendId: project.id,
    name: project.name,
    episode: `REV ${project.revision}`,
    image: initialProjects[index % initialProjects.length]?.image ?? initialProjects[0]!.image,
    status: project.status === "archived" ? "已归档" : "进行中",
    favorite: false,
    updated: project.updated_at,
    revision: project.revision,
  });
  async function connectRealWorkspace() {
    const generation = projectGate.begin();
    sourceGate.invalidate();
    sourceStageGate.invalidate();
    storyGate.invalidate();
    // A real refresh has no authoritative project until its list read succeeds.
    // Keep the persisted opaque selection intact so a later successful read restores it.
    if (!fixture) {
      clearProjectScopedState();
      setProjects([]);
      setBackendProjectId(null);
      put("projectId", "");
      put("title", "");
    }
    setWorkspaceState("loading");
    try {
      const remote = await connectWorkspace(studio);
      if (!projectGate.isCurrent(generation)) return;
      const mapped = remote.map(mapProject);
      // A successful authoritative list read is the reconciliation point for an
      // earlier create whose outcome was unknown.
      createUnknown.current = false;
      setProjects(mapped);
      const savedProjectId = selectionAvailable.current
        ? selectionSnapshot.current.selection?.projectId
        : null;
      const restored =
        fixture || !savedProjectId
          ? mapped[0]
          : mapped.find((project) => project.backendId === savedProjectId);
      if (savedProjectId && !restored)
        persistSelection(withWorkspaceSelection(selectionSnapshot.current, null));
      clearProjectScopedState();
      setBackendProjectId(restored?.backendId ?? null);
      put("projectId", String(restored?.id ?? ""));
      put("title", restored?.name ?? "");
      setWorkspaceState("connected");
      if (restored?.backendId) {
        restoreSourceImportMarker(restored.backendId);
        void refreshRealEpisodes(restored.backendId, false);
        void refreshProductionBrief(restored.backendId);
        const source = await restoreLatestSource(studio, restored.backendId);
        if (!projectGate.isCurrent(generation)) return;
        if (source) {
          put("importedName", source.data.filename);
          try {
            const normalizedText = await readSourceDocumentText(
              studio,
              restored.backendId,
              source.data,
            );
            if (!projectGate.isCurrent(generation)) return;
            put("source", normalizedText);
            setSourceDocument(source);
          } catch {
            if (!projectGate.isCurrent(generation)) return;
            put("source", "");
            setSourceDocument(null);
            setSourceImportState({
              kind: "unknown",
              message: "来源记录已找到，但完整正文读取或哈希核验失败。",
            });
          }
        }
        void refreshRealSourceStage(restored.backendId);
      }
    } catch {
      if (projectGate.isCurrent(generation)) setWorkspaceState("error");
    }
  }
  async function createRealProject(input: CreateProjectInput) {
    if (createPending.current || createUnknown.current) {
      notify(
        createUnknown.current
          ? "上次创建结果未知。请刷新项目列表后确认，未自动重试。"
          : "正在创建项目，请等待结果后再试。",
      );
      return { kind: "REMOTE_UNKNOWN" } as const;
    }
    createPending.current = true;
    setProjectCreateState({ kind: "SUBMITTING" });
    const generation = projectGate.begin();
    sourceGate.invalidate();
    sourceStageGate.invalidate();
    storyGate.invalidate();
    episodeGate.invalidate();
    const outcome = await createWorkspaceProject(studio, input);
    createPending.current = false;
    if (outcome.kind !== "SUCCEEDED") {
      setProjectCreateState(outcome);
      createUnknown.current = true;
      notify("创建结果未知。请刷新项目列表后确认，未自动重试。");
      return outcome;
    }
    setProjectCreateState({ kind: "idle" });
    if (!projectGate.isCurrent(generation)) return outcome;
    const mapped = mapProject(outcome.project, 0);
    clearProjectScopedState();
    setBackendProjectId(mapped.backendId ?? null);
    put("projectId", String(mapped.id));
    put("title", mapped.name);
    if (mapped.backendId)
      persistSelection(
        withWorkspaceSelection(selectionSnapshot.current, {
          projectId: mapped.backendId,
          episodeId: null,
        }),
      );
    setProjects((old) => [mapped, ...old.map((project, index) => ({ ...project, id: index + 2 }))]);
    if (mapped.backendId) {
      restoreSourceImportMarker(mapped.backendId);
      void refreshRealEpisodes(mapped.backendId, false);
      void refreshProductionBrief(mapped.backendId);
    }
    notify("项目已由本地工作区创建。");
    return outcome;
  }
  async function selectRealProject(localId: number) {
    const selected = projects.find((project) => project.id === localId);
    if (!selected) return;
    if (!selected.backendId) {
      notify("该项目没有本地工作区标识，无法打开。");
      return;
    }
    const generation = projectGate.begin();
    sourceGate.invalidate();
    sourceStageGate.invalidate();
    storyGate.invalidate();
    clearProjectScopedState();
    put("projectId", String(selected.id));
    const existingSelection = selectionSnapshot.current.selection;
    const preservedEpisodeId =
      existingSelection?.projectId === selected.backendId ? existingSelection.episodeId : null;
    setBackendProjectId(selected.backendId ?? null);
    put("title", selected.name);
    persistSelection(
      withWorkspaceSelection(selectionSnapshot.current, {
        projectId: selected.backendId,
        episodeId: preservedEpisodeId,
      }),
    );
    try {
      restoreSourceImportMarker(selected.backendId);
      void refreshRealEpisodes(selected.backendId, false);
      void refreshProductionBrief(selected.backendId);
      const source = await restoreLatestSource(studio, selected.backendId);
      if (!projectGate.isCurrent(generation)) return;
      if (source) {
        put("importedName", source.data.filename);
        try {
          const normalizedText = await readSourceDocumentText(
            studio,
            selected.backendId,
            source.data,
          );
          if (!projectGate.isCurrent(generation)) return;
          put("source", normalizedText);
          setSourceDocument(source);
        } catch {
          if (!projectGate.isCurrent(generation)) return;
          put("source", "");
          setSourceDocument(null);
          setSourceImportState({
            kind: "unknown",
            message: "来源记录已找到，但完整正文读取或哈希核验失败。",
          });
        }
      }
      void refreshRealSourceStage(selected.backendId);
    } catch {
      if (projectGate.isCurrent(generation))
        notify("项目已切换，但原文恢复失败；请重新连接后再试。");
    }
  }
  async function importRealSource(file: File) {
    const projectId = currentBackendProjectId();
    if (!projectId) {
      setSourceImportState({
        kind: "invalid",
        message: "当前项目尚未连接本地工作区，无法导入来源。",
      });
      notify("当前项目尚未连接本地工作区，无法导入来源。");
      return {
        kind: "INVALID_INPUT",
        message: "当前项目尚未连接本地工作区，无法导入来源。",
      } as const;
    }
    if (sourceImportPending.has(projectId)) {
      notify("来源正在保存，请等待明确回执后再试。");
      return { kind: "REMOTE_UNKNOWN", message: "来源正在保存，请等待明确回执后再试。" } as const;
    }
    if (sourceImportUnknown.has(projectId)) {
      notify("上次来源保存结果未知。请先刷新来源状态，系统不会自动重试。");
      return {
        kind: "REMOTE_UNKNOWN",
        message: "上次来源保存结果未知。请先刷新来源状态，系统不会自动重试。",
      } as const;
    }
    const invalid = validateSourceFile(file);
    if (invalid) {
      setSourceImportState({ kind: "invalid", message: invalid });
      notify(invalid);
      return { kind: "INVALID_INPUT", message: invalid } as const;
    }
    storyGate.invalidate();
    const generation = sourceGate.begin();
    sourceImportPending.add(projectId);
    setSourceImportState({ kind: "pending", projectId });
    let marker: SourceImportMarker;
    try {
      marker = {
        operationId: crypto.randomUUID(),
        rawSha256: await sourceFileSha256(file),
        filename: file.name,
        sourceId: null,
        state: "PENDING",
      };
    } catch {
      sourceImportPending.delete(projectId);
      if (projectId === currentBackendProjectId() && sourceGate.isCurrent(generation))
        setSourceImportState({
          kind: "unknown",
          message: "无法建立来源保存记录；未发送导入请求。",
        });
      return { kind: "REMOTE_UNKNOWN", message: "无法建立来源保存记录；未发送导入请求。" } as const;
    }
    if (!sourceGate.isCurrent(generation) || projectId !== currentBackendProjectId()) {
      sourceImportPending.delete(projectId);
      return { kind: "STALE" } as const;
    }
    if (!sourceImportStorage || !writeSourceImportMarker(sourceImportStorage, projectId, marker)) {
      sourceImportPending.delete(projectId);
      if (projectId === currentBackendProjectId() && sourceGate.isCurrent(generation))
        setSourceImportState({ kind: "unknown", message: "来源保存记录不可写；未发送导入请求。" });
      return { kind: "REMOTE_UNKNOWN", message: "来源保存记录不可写；未发送导入请求。" } as const;
    }
    const result = await importTextSource(studio, projectId, file);
    sourceImportPending.delete(projectId);
    if (!sourceGate.isCurrent(generation) || projectId !== currentBackendProjectId()) {
      if (sourceImportStorage) {
        if (result.kind === "SUCCEEDED")
          clearSourceImportMarker(sourceImportStorage, projectId, marker.operationId);
        else if (result.kind === "REMOTE_UNKNOWN")
          writeSourceImportMarker(sourceImportStorage, projectId, {
            ...marker,
            sourceId: result.sourceId ?? null,
            state: "UNKNOWN",
          });
        else clearSourceImportMarker(sourceImportStorage, projectId, marker.operationId);
      }
      return { kind: "STALE" } as const;
    }
    if (result.kind !== "SUCCEEDED") {
      if (result.kind === "REMOTE_UNKNOWN") {
        if (sourceImportStorage)
          writeSourceImportMarker(sourceImportStorage, projectId, {
            ...marker,
            sourceId: result.sourceId ?? null,
            state: "UNKNOWN",
          });
        if (result.projectId)
          sourceImportUnknown.set(projectId, {
            operationId: marker.operationId,
            sourceId: result.sourceId,
            projectId: result.projectId,
            rawSha256: result.rawSha256,
          });
        setSourceImportState({ kind: "unknown", message: result.message });
      } else {
        const cleared =
          !!sourceImportStorage &&
          clearSourceImportMarker(sourceImportStorage, projectId, marker.operationId);
        setSourceImportState(
          cleared
            ? { kind: "invalid", message: result.message }
            : { kind: "unknown", message: "来源输入无效，但保存记录未能清除；请人工核对。" },
        );
      }
      notify(result.message);
      return result;
    }
    if (
      !sourceImportStorage ||
      !clearSourceImportMarker(sourceImportStorage, projectId, marker.operationId)
    ) {
      sourceImportUnknown.set(projectId, {
        operationId: marker.operationId,
        sourceId: result.response.data.id,
        projectId,
        rawSha256: marker.rawSha256,
      });
      setSourceImportState({
        kind: "unknown",
        message: "来源已读回，但保存记录未能清除；请人工核对。",
      });
      return {
        kind: "REMOTE_UNKNOWN",
        message: "来源已读回，但保存记录未能清除；请人工核对。",
      } as const;
    }
    sourceImportUnknown.delete(projectId);
    put("source", result.normalizedText);
    put("importedName", result.response.data.filename);
    setSourceDocument(result.response);
    put("sourceApproved", "false");
    setSourceImportState({ kind: "saved", filename: result.response.data.filename });
    void refreshRealSourceStage(projectId);
    notify("来源已导入；请先完成真实来源审核。");
    return result;
  }
  async function importPastedSource(text: string) {
    if (!text.trim()) {
      setSourceImportState({ kind: "invalid", message: "请先粘贴完整的外部原文。" });
      notify("请先粘贴完整的外部原文。");
      return { kind: "INVALID_INPUT", message: "请先粘贴完整的外部原文。" } as const;
    }
    return importRealSource(new File([text], "pasted-source.txt", { type: "text/plain" }));
  }
  async function reviewRealSource(
    capturedIdentity?: SourceManifestReviewIdentity,
    capturedSourceDocumentId?: string,
  ) {
    const projectId = currentBackendProjectId();
    if (!projectId || !capturedIdentity || capturedIdentity.project_id !== projectId ||
        !capturedSourceDocumentId) {
      notify("当前项目或来源审核目标未核实，未发送审核。");
      return false;
    }
    storyGate.invalidate();
    let manifest: SourceManifestResponse | null;
    try {
      manifest = await studio.getSourceManifest(projectId);
    } catch {
      if (projectId === currentBackendProjectId())
        notify("来源清单读取失败，未发送审核；请手动刷新后重试。");
      return false;
    }
    try {
      if (projectId !== currentBackendProjectId()) return false;
      // A rejected mutation remains locked.  A later user-initiated manifest
      // read is only a reconciliation step; it never replays the mutation.
      if (reviewRunner.isLocked(projectId)) {
        reviewRunner.clear(projectId);
        notify("审核状态已刷新；请重新核对后再提交。");
        return false;
      }
      const identity = sourceReviewIdentity(manifest, projectId);
      if (!manifest || !identity || sourceStageFromManifest(manifest, projectId).kind !== "draft" ||
          identity.version_id !== capturedIdentity.version_id ||
          identity.content_hash !== capturedIdentity.content_hash ||
          identity.expected_revision !== capturedIdentity.expected_revision ||
          !manifest.data.latest_version.content.documents.some(
            (document) => document.source_document_id === capturedSourceDocumentId,
          )) {
        notify("来源审核目标已变化；请刷新清单并重新核对，未发送审核。");
        return false;
      }
      const result = await reviewRunner.run("submit", identity, "");
      if (projectId !== currentBackendProjectId()) return false;
      if (!result) {
        notify("当前来源没有可提交的审核版本。");
        return false;
      }
      if (result.kind !== "SUCCEEDED") {
        notify(
          result.kind === "REMOTE_UNKNOWN"
            ? "审核结果未知；请刷新来源清单后确认。"
            : "来源审核未完成。",
        );
        return false;
      }
      put("sourceApproved", "false");
      put("sourceReviewSubmitted", "true");
      void refreshRealSourceStage(projectId);
      return true;
    } catch {
      notify("审核结果未知；请刷新来源清单后确认。");
      return false;
    }
  }
  async function confirmRealSourceBaseline(
    capturedIdentity: SourceManifestReviewIdentity,
    rationale: string,
  ) {
    const projectId = currentBackendProjectId();
    if (!projectId || ![...rationale.trim()].length || [...rationale.trim()].length > 1000)
      return false;
    if (capturedIdentity.project_id !== projectId) return false;
    if (baselineConfirmPending.has(projectId)) return false;
    baselineConfirmPending.add(projectId);
    const generation = sourceStageGate.begin();
    try {
      const manifest = await studio.getSourceManifest(projectId);
      if (!sourceStageGate.isCurrent(generation) || projectId !== currentBackendProjectId())
        return false;
      const identity = sourceReviewIdentity(manifest, projectId);
      const targetContent = JSON.stringify(manifest?.data.latest_version.content);
      if (
        !identity ||
        sourceStageFromManifest(manifest, projectId).kind !== "review" ||
        identity.project_id !== capturedIdentity.project_id ||
        identity.version_id !== capturedIdentity.version_id ||
        identity.content_hash !== capturedIdentity.content_hash ||
        identity.expected_revision !== capturedIdentity.expected_revision
      )
        return false;
      const result = await reviewRunner.run("confirm_baseline", capturedIdentity, rationale);
      if (!sourceStageGate.isCurrent(generation) || projectId !== currentBackendProjectId())
        return false;
      if (!result || result.kind !== "SUCCEEDED") {
        if (result?.kind === "REMOTE_UNKNOWN")
          notify("确认结果未知；请刷新来源状态后再决定下一步。");
        return false;
      }
      // A successful bridge receipt is not acceptance proof.  Read the manifest
      // again and require the accepted, latest and captured target to agree.
      let acceptedManifest: SourceManifestResponse | null;
      try {
        acceptedManifest = await studio.getSourceManifest(projectId);
      } catch {
        if (sourceStageGate.isCurrent(generation) && projectId === currentBackendProjectId()) {
          setSourceStage({ kind: "error" });
          notify("确认已提交，但无法读回来源基线；请刷新来源状态。");
        }
        return false;
      }
      if (!sourceStageGate.isCurrent(generation) || projectId !== currentBackendProjectId())
        return false;
      const accepted = acceptedManifest?.data.accepted_version;
      const latest = acceptedManifest?.data.latest_version;
      const acceptedCurrent =
        !!acceptedManifest &&
        !!latest &&
        acceptedManifest.data.project_id === projectId &&
        sourceStageFromManifest(acceptedManifest, projectId).kind === "approved" &&
        acceptedManifest.data.head.artifact_id === latest.artifact_id &&
        acceptedManifest.data.head.latest_version_id === capturedIdentity.version_id &&
        acceptedManifest.data.head.accepted_version_id === capturedIdentity.version_id &&
        latest.id === capturedIdentity.version_id &&
        latest.content_hash === capturedIdentity.content_hash &&
        accepted?.id === capturedIdentity.version_id &&
        accepted.content_hash === capturedIdentity.content_hash &&
        accepted.artifact_id === latest.artifact_id &&
        JSON.stringify(latest.content) === targetContent &&
        JSON.stringify(accepted.content) === targetContent;
      if (!acceptedCurrent) {
        setSourceManifest(acceptedManifest);
        setSourceStage({ kind: "error" });
        put("sourceApproved", "false");
        notify("确认已提交，但尚未读到已接受的目标基线；请刷新来源状态。");
        return false;
      }
      setSourceManifest(acceptedManifest);
      setSourceStage(sourceStageFromManifest(acceptedManifest, projectId));
      put("sourceApproved", "false");
      return true;
    } catch {
      if (sourceStageGate.isCurrent(generation) && projectId === currentBackendProjectId())
        notify("确认结果未知；请刷新来源状态后再决定下一步。");
      return false;
    } finally {
      baselineConfirmPending.delete(projectId);
    }
  }
  async function readRealStoryWorkspace() {
    const projectId = currentBackendProjectId();
    if (!projectId) return;
    const generation = storyGate.begin();
    const sourceGeneration = sourceStageGate.begin();
    setSourceStage({ kind: "loading" });
    put("sourceApproved", "false");
    setStoryWorkspaceState("loading");
    try {
      const manifest = await studio.getSourceManifest(projectId);
      if (
        !storyGate.isCurrent(generation) ||
        !sourceStageGate.isCurrent(sourceGeneration) ||
        projectId !== currentBackendProjectId()
      )
        return;
      const stage = sourceStageFromManifest(manifest, projectId);
      setSourceManifest(manifest);
      setSourceStage(stage);
      if (stage.kind === "inconsistent") {
        put("sourceApproved", "false");
        setStoryWorkspaceState("error");
        return;
      }
      reviewRunner.clear(projectId);
      const acceptedVersionId = manifest?.data.head.accepted_version_id ?? null;
      const state = await loadStoryWorkspace(studio, projectId, acceptedVersionId);
      if (
        !storyGate.isCurrent(generation) ||
        !sourceStageGate.isCurrent(sourceGeneration) ||
        projectId !== currentBackendProjectId()
      )
        return;
      const acceptedCurrentSource =
        !!acceptedVersionId && acceptedVersionId === manifest?.data.head.latest_version_id;
      put("sourceApproved", String(acceptedCurrentSource && !!state.storyBibleVersion));
      if (acceptedCurrentSource && state.storyBibleVersion)
        put("storySourceVersion", value("sourceVersion", "1"));
      setStoryWorkspaceState(state.storyBibleVersion ? "ready" : "idle");
    } catch {
      if (
        storyGate.isCurrent(generation) &&
        sourceStageGate.isCurrent(sourceGeneration) &&
        projectId === currentBackendProjectId()
      ) {
        setSourceStage({ kind: "error" });
        put("sourceApproved", "false");
        setStoryWorkspaceState("error");
      }
    }
  }
  const invalidationGateway = useRef({
    list: (projectId: string, query: Parameters<typeof studio.listInvalidationOperations>[1]) =>
      studio.listInvalidationOperations(projectId, query),
    get: (projectId: string, operationId: string) =>
      studio.getInvalidationOperation(projectId, operationId),
  }).current;
  const [invalidationHistoryController, invalidationHistory] = useInvalidationHistory(
    invalidationGateway,
    backendProjectId ?? "",
  );
  const [timelineWorkspaceController, timelineWorkspace] = useTimelineWorkspace(
    timelineGateway,
    backendProjectId ?? "",
  );
  const providerGateway = useRef({
    listConnections: () => studio.listProviderConnections(),
    createConnection: (input: Parameters<typeof studio.createProviderConnection>[0]) =>
      studio.createProviderConnection(input),
    deleteConnection: (connectionId: string) => studio.deleteProviderConnection(connectionId),
  }).current;
  const providerSettings = useProviderSettings(providerGateway);
  const taskQueueGateway = useRef({
    loadTasks: (projectId: string) => studio.listProjectTasks(projectId),
  }).current;
  const taskQueue = useTaskQueue({
    projectId: backendProjectId ?? "",
    loadTasks: taskQueueGateway.loadTasks,
  });
  function notify(message: string) {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4500);
  }
  function go(next: PageId) {
    if (next !== "source") sourceStageGate.invalidate();
    scroll.current[page] = document.getElementById("demo-scroll")?.scrollTop ?? 0;
    if (next !== page) history.current.push(page);
    if (page === "storyboard") setSelectedShot(shotAtTime(shots, time)?.id ?? 1);
    if (pages[next][2] >= 0 && !["project", "projectSettings"].includes(next))
      put("lastPage", next);
    setPage(next);
    setScenario("normal");
    setPlaying(false);
    window.history.pushState({}, "", `#${next}`);
  }
  function back() {
    const next = history.current.pop() ?? "projects";
    if (next !== "source") sourceStageGate.invalidate();
    if (page === "storyboard") setSelectedShot(shotAtTime(shots, time)?.id ?? 1);
    scroll.current[page] = document.getElementById("demo-scroll")?.scrollTop ?? 0;
    setPage(next);
    setScenario("normal");
    setPlaying(false);
    window.history.replaceState({}, "", `#${next}`);
  }
  useEffect(() => {
    const el = document.getElementById("demo-scroll");
    if (el) el.scrollTop = scroll.current[page] ?? 0;
  }, [page]);
  useEffect(() => {
    void connectRealWorkspace();
  }, []);
  useEffect(() => {
    if (fixture || !studio.getAppPreferences || !studio.saveAppPreferences) return;
    let active = true;
    void readAppPreferences(studio as AppPreferencesGateway).then((result) => {
      if (!active || result.kind !== "READY") return;
      setValues((old) => old.userName === "本地用户" && old.bio === undefined
        ? { ...old, userName: result.response.data.user_name || "本地用户",
            bio: result.response.data.display_bio }
        : old);
    });
    return () => { active = false; };
  }, [fixture, studio]);
  useEffect(() => {
    const pop = () => {
      const next = initialPage();
      if (next !== "source") sourceStageGate.invalidate();
      setPage(next);
      setPlaying(false);
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  useEffect(() => {
    if (!playing || page !== "storyboard") return;
    const timer = setInterval(() => setTime((old) => Math.min(total, old + 0.25)), 250);
    return () => clearInterval(timer);
  }, [playing, page, total]);
  useEffect(() => {
    if (playing && time >= total) {
      setPlaying(false);
      setSelectedShot(shots.at(-1)?.id ?? 1);
    }
  }, [playing, time, total, shots]);
  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      clearTimeout(toastTimer.current);
    },
    [],
  );
  function simulate(name: string) {
    const id = Date.now();
    setTasks((old) => [{ id, name, status: "本地意图 · 尚未执行", page }, ...old]);
    notify(`${name}已记为本地草稿，未执行生成`);
  }
  function propose(
    title: string,
    description: string,
    save?: (data: Record<string, string>) => void,
  ) {
    setEditor({
      title,
      description: `${description}\n仅修改演示数据。预计真实费用：未知。`,
      fields: [
        {
          key: "request",
          label: "要求与范围",
          value: "仅调整当前对象，保留其他已确认内容。",
          type: "textarea",
          required: true,
        },
      ],
      confirm: "确认演示方案",
      save: (data) => {
        save?.(data);
        simulate(title);
      },
    });
  }
  function edit(
    title: string,
    fields: Field[],
    onSave?: (data: Record<string, string>) => void | false | Promise<void | false>,
  ) {
    const creatingRealProject = !fixture && title === "新建项目" && !!onSave;
    if (title === "新建项目") setProjectCreateState({ kind: "idle" });
    setEditor({
      title,
      fields,
      confirm: creatingRealProject ? "创建真实项目" : "保存演示修改",
      save: async (data) => {
        if (onSave) {
          if ((await onSave(data)) === false) return false;
        } else updateValues(data);
        if (!creatingRealProject) notify("演示修改已保存；刷新后恢复样例");
      },
    });
  }
  return {
    page,
    go,
    back,
    scenario,
    setScenario,
    professional,
    setProfessional,
    inspector,
    setInspector,
    aiOpen,
    setAiOpen,
    editor,
    setEditor,
    projectCreateState,
    toast,
    notify,
    values,
    value,
    put,
    projects,
    setProjects,
    characters,
    setCharacters,
    selectedCharacter,
    setSelectedCharacter,
    outfits,
    setOutfits,
    locations,
    setLocations,
    selectedLocation,
    setSelectedLocation,
    localAssets,
    setLocalAssets,
    shots,
    setShots,
    selectedShot,
    setSelectedShot,
    time,
    setTime,
    playing,
    setPlaying,
    total,
    annotations,
    setAnnotations,
    tasks,
    setTasks,
    simulate,
    propose,
    edit,
    aiDraft,
    setAiDraft,
    messages,
    setMessages,
    references,
    setReferences,
    workspaceState,
    storyWorkspaceState,
    sourceStage,
    sourceDocument,
    sourceImportState,
    sourceManifest,
    backendProjectId,
    episodes,
    episodeState,
    episodeCreateMarker,
    episodeAcknowledgementReady,
    episodeCreateInFlight: episodeCreateInFlightProjectId === backendProjectId,
    selectedEpisodeId,
    refreshRealEpisodes,
    acknowledgeEpisodeCreation,
    selectRealEpisode,
    createRealEpisode,
    isFixture: !!fixture,
    timelineWorkspace,
    timelineWorkspaceController,
    providerSettings,
    taskQueue,
    invalidationHistory,
    invalidationHistoryController,
    connectRealWorkspace,
    createRealProject,
    selectRealProject,
    importRealSource,
    importPastedSource,
    reviewRealSource,
    confirmRealSourceBaseline,
    readRealStoryWorkspace,
    refreshRealSourceStage,
    productionBrief,
    productionBriefState,
    refreshProductionBrief,
    saveProductionBrief,
    recoverProductionBrief,
    pendingProductionBrief,
    rightTab,
    selectRightTab,
    focusAssistant,
  };
}
type DemoModel = ReturnType<typeof useDemoModel>;
const DemoContext = createContext<DemoModel | null>(null);
export function DemoProvider({
  children,
  fixture,
}: {
  children: ReactNode;
  fixture?: DemoFixture;
}) {
  const model = useDemoModel(fixture);
  return <DemoContext.Provider value={model}>{children}</DemoContext.Provider>;
}
export function useDemo() {
  const model = useContext(DemoContext);
  if (!model) throw new Error("DemoProvider required");
  return model;
}

import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode, SetStateAction } from "react";
import { initialCharacters, initialProjects, initialShots, pages } from "./data";
import type { PageId, Scenario } from "./data";
import type { V2ViewerImage } from "./V2ImageViewer";
import {
  createStudioTransport,
  type CreateProjectInput,
  type ProjectData,
  type SourceManifestResponse,
} from "../api/studio";
import {
  LatestRequestGate,
  connectWorkspace,
  createWorkspaceProject,
  restoreLatestSource,
} from "./adapters/projectWorkspace";
import { importTextSource } from "./adapters/sourceImport";
import { createSourceReviewRunner, sourceReviewIdentity } from "./adapters/sourceManifest";
import { type ProductionSourceStage } from "./adapters/productionSourceStage";
import { loadStoryWorkspace } from "./adapters/storyWorkspace";
import { useInvalidationHistory } from "../domain/use-invalidation-history";
import { createTimelineWorkspaceGateway } from "../domain/timeline-workspace-controller";
import { useTimelineWorkspace } from "../domain/use-timeline-workspace";
import { useProviderSettings } from "../domain/use-provider-settings";
import { useTaskQueue } from "../domain/use-task-queue";

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
  save?: (values: Record<string, string>) => void | false;
};
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
  const [toast, setToast] = useState("");
  const [values, setValues] = useState<Record<string, string>>(() => ({
    source: "",
    title: "",
    input: "",
    ...fixture?.values,
  }));
  // Project cards only represent records read from the desktop workspace.
  const [projects, setProjects] = useState<WorkspaceProject[]>(() => fixture?.projects ?? []);
  const [workspaceState, setWorkspaceState] = useState<WorkspaceState>("idle");
  const [storyWorkspaceState, setStoryWorkspaceState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [sourceStage, setSourceStage] = useState<ProductionSourceStage>({ kind: "empty" });
  const studio = useRef(createStudioTransport()).current;
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
  const sourceStageGate = useRef(new LatestRequestGate()).current;
  const storyGate = useRef(new LatestRequestGate()).current;
  const createPending = useRef(false);
  const createUnknown = useRef(false);
  const reviewRunner = useRef(createSourceReviewRunner(studio.sourceManifestReview)).current;
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
  }
  function clearProjectScopedState() {
    const cleared: Record<string, string> = {
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
    setSourceStage({ kind: "empty" });
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
  async function refreshRealSourceStage(projectId = currentBackendProjectId()) {
    if (!projectId) {
      sourceStageGate.invalidate();
      setSourceStage({ kind: "empty" });
      return;
    }
    const generation = sourceStageGate.begin();
    setSourceStage({ kind: "loading" });
    put("sourceApproved", "false");
    try {
      const manifest = await studio.getSourceManifest(projectId);
      if (!sourceStageGate.isCurrent(generation) || projectId !== currentBackendProjectId()) return;
      const stage = sourceStageFromManifest(manifest, projectId);
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
    setWorkspaceState("loading");
    try {
      const remote = await connectWorkspace(studio);
      if (!projectGate.isCurrent(generation)) return;
      const mapped = remote.map(mapProject);
      // A successful authoritative list read is the reconciliation point for an
      // earlier create whose outcome was unknown.
      createUnknown.current = false;
      setProjects(mapped);
      const first = mapped[0];
      clearProjectScopedState();
      setBackendProjectId(first?.backendId ?? null);
      put("projectId", String(first?.id ?? ""));
      put("title", first?.name ?? "");
      setWorkspaceState("connected");
      if (first?.backendId) {
        const source = await restoreLatestSource(studio, first.backendId);
        if (!projectGate.isCurrent(generation)) return;
        if (source) {
          put("source", source.data.blocks.map((block) => block.text).join("\n\n"));
          put("importedName", source.data.filename);
        }
        void refreshRealSourceStage(first.backendId);
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
    const generation = projectGate.begin();
    sourceGate.invalidate();
    sourceStageGate.invalidate();
    storyGate.invalidate();
    const outcome = await createWorkspaceProject(studio, input);
    createPending.current = false;
    if (outcome.kind !== "SUCCEEDED") {
      createUnknown.current = true;
      notify("创建结果未知。请刷新项目列表后确认，未自动重试。");
      return outcome;
    }
    if (!projectGate.isCurrent(generation)) return outcome;
    setProjects((old) => {
      const mapped = mapProject(outcome.project, 0);
      const next = [mapped, ...old.map((project, index) => ({ ...project, id: index + 2 }))];
      clearProjectScopedState();
      setBackendProjectId(mapped.backendId ?? null);
      put("projectId", String(mapped.id));
      put("title", mapped.name);
      return next;
    });
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
    setBackendProjectId(selected.backendId ?? null);
    put("title", selected.name);
    try {
      const source = await restoreLatestSource(studio, selected.backendId);
      if (!projectGate.isCurrent(generation)) return;
      if (source) {
        put("source", source.data.blocks.map((block) => block.text).join("\n\n"));
        put("importedName", source.data.filename);
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
      notify("当前项目尚未连接本地工作区，无法导入来源。");
      return;
    }
    storyGate.invalidate();
    const generation = sourceGate.begin();
    const result = await importTextSource(studio, projectId, file);
    if (!sourceGate.isCurrent(generation) || projectId !== currentBackendProjectId()) return;
    if (result.kind !== "SUCCEEDED") {
      notify(result.message);
      return;
    }
    put("source", result.response.data.blocks.map((block) => block.text).join("\n\n"));
    put("importedName", result.response.data.filename);
    put("sourceApproved", "false");
    void refreshRealSourceStage(projectId);
    notify("来源已导入；请先完成真实来源审核。");
  }
  async function reviewRealSource() {
    const projectId = currentBackendProjectId();
    if (!projectId) {
      notify("当前项目尚未连接本地工作区，无法提交来源审核。");
      return false;
    }
    storyGate.invalidate();
    try {
      const manifest = await studio.getSourceManifest(projectId);
      if (projectId !== currentBackendProjectId()) return false;
      // A rejected mutation remains locked.  A later user-initiated manifest
      // read is only a reconciliation step; it never replays the mutation.
      if (reviewRunner.isLocked(projectId)) {
        reviewRunner.clear(projectId);
        notify("审核状态已刷新；请重新核对后再提交。");
        return false;
      }
      const identity = sourceReviewIdentity(manifest, projectId);
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
    const pop = () => {
      setPage(initialPage());
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
    onSave?: (data: Record<string, string>) => void | false,
  ) {
    setEditor({
      title,
      fields,
      confirm: "保存演示修改",
      save: (data) => {
        if (onSave) {
          if (onSave(data) === false) return false;
        } else updateValues(data);
        notify("演示修改已保存；刷新后恢复样例");
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
    backendProjectId,
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
    reviewRealSource,
    readRealStoryWorkspace,
    refreshRealSourceStage,
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

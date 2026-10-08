import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EpisodeStoryboardPanel } from "./EpisodeStoryboardPanel";
import { createStudioTransport } from "../api/studio";
import {
  cloneStoryboardContent,
  type StoryboardGateway,
  type StoryboardVersion,
} from "./adapters/episodeStoryboard";
import { emptyCreativeContent, type CreativeVersion } from "./adapters/creativeLibrary";
import type { ScriptVersion } from "./adapters/episodeScript";
import type * as Common from "./Common";
import type { ShotPlanProposalReviewProps } from "./ShotPlanProposalReview";
const planView = vi.hoisted(() => ({ current: null as ShotPlanProposalReviewProps | null }));
// The real proposal component has its own serialized-contract flow tests. These
// host tests isolate navigation and the retained storyboard controller.
vi.mock("./ShotPlanProposalReview", () => ({
  ShotPlanProposalReview: (props: ShotPlanProposalReviewProps) => {
    planView.current = props;
    return <section aria-label="director host test" />;
  },
}));
vi.mock("../api/studio", () => ({ createStudioTransport: vi.fn() }));
vi.mock("./Common", async (load) => {
  const actual = await load<typeof Common>();
  return {
    ...actual,
    PageTitle: ({ actions }: { actions: React.ReactNode }) => <header>{actions}</header>,
  };
});
const project = `prj_${"a".repeat(32)}`;
const episode = `ep_${"b".repeat(32)}`;
const otherEpisode = `ep_${"c".repeat(32)}`;
const requestId = "123e4567-e89b-42d3-a456-426614174000";
function makeGateway() {
  const heads = new Map<string, StoryboardVersion>();
  const versions = new Map<string, StoryboardVersion>();
  const operations = new Map<string, StoryboardVersion>();
  let serial = 0;
  const api: StoryboardGateway = {
    getEpisodeStoryboard: vi.fn<StoryboardGateway["getEpisodeStoryboard"]>(async (p, e) => {
      const value = heads.get(`${p}/${e}`);
      return value
        ? { kind: "FOUND", receipt: { data: value, request_id: requestId } }
        : { kind: "EMPTY" };
    }),
    getEpisodeStoryboardVersion: vi.fn<StoryboardGateway["getEpisodeStoryboardVersion"]>(
      async (_p, _e, id) => {
        const value = versions.get(id);
        return value
          ? { kind: "FOUND", receipt: { data: value, request_id: requestId } }
          : { kind: "REMOTE_UNKNOWN" };
      },
    ),
    createEpisodeStoryboardVersion: vi.fn<StoryboardGateway["createEpisodeStoryboardVersion"]>(
      async (p, e, key, payload) => {
        const previous = operations.get(key);
        if (previous)
          return {
            kind: "CREATED",
            receipt: { data: { version: previous, replayed: true }, request_id: requestId },
          };
        const head = heads.get(`${p}/${e}`);
        if (
          payload.parent_version_id !== (head?.version_id ?? null) ||
          payload.expected_revision !== (head?.head_revision ?? null)
        )
          return {
            kind: "DEFINITE_SERVER_ERROR",
            status: 409,
            code: "STORYBOARD_CONFLICT",
            request_id: requestId,
          };
        const revision = (head?.head_revision ?? 0) + 1;
        const value: StoryboardVersion = {
          project_id: p,
          episode_id: e,
          version_id: `ver_${(++serial).toString(16).padStart(32, "0")}`,
          version_number: revision,
          head_revision: revision,
          parent_version_id: payload.parent_version_id,
          content: cloneStoryboardContent(payload.content),
          content_hash: `sha256:${"e".repeat(64)}`,
          author_actor_id: "local-user",
          change_summary: payload.change_summary,
          created_at: "2026-10-08T04:00:00Z",
        };
        heads.set(`${p}/${e}`, value);
        versions.set(value.version_id, value);
        operations.set(key, value);
        return {
          kind: "CREATED",
          receipt: { data: { version: value, replayed: false }, request_id: requestId },
        };
      },
    ),
  };
  return { api, heads, versions, operations };
}
const guard = vi.fn<(value: (() => boolean) | null) => void>();
let service: ReturnType<typeof makeGateway>;
function mount(id = episode) {
  return render(
    <EpisodeStoryboardPanel
      key={id}
      projectId={project}
      episodeId={id}
      setNavigationGuard={guard}
    />,
  );
}
const fill = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
async function add(title: string) {
  await waitFor(() => expect(screen.getByRole("button", { name: "添加镜头" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "添加镜头" }));
  fill("镜头标题", title);
}
async function save() {
  fireEvent.click(screen.getByRole("button", { name: "保存分镜草稿" }));
  await screen.findByText(/已保存，并已回读核对/);
}
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  guard.mockClear();
  planView.current = null;
  service = makeGateway();
  vi.mocked(createStudioTransport).mockReturnValue(
    service.api as ReturnType<typeof createStudioTransport>,
  );
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("native manual episode storyboard", () => {
  it("starts empty, saves a text-only storyboard, reopens it and isolates the next episode", async () => {
    let view = mount();
    await screen.findByText("本集还没有镜头。");
    expect(screen.getByRole("button", { name: "创建第一个镜头" })).toBeEnabled();
    await add("桥边相遇");
    fill("画面描述", "两人隔河看见彼此");
    fill("景别与机位", "远景 / 平视");
    fill("动作", "停下脚步");
    fill("对白", "终于找到你了");
    fill("镜头时长（帧）", "96");
    await save();
    const saved = service.heads.get(`${project}/${episode}`)!;
    expect(saved.content.shots[0]).toMatchObject({
      ordinal: 1,
      duration_frames: 96,
      title: "桥边相遇",
      camera: "远景 / 平视",
      action: "停下脚步",
      dialogue: "终于找到你了",
      script_scene_id: null,
      character_ids: [],
      location_id: null,
    });
    expect(saved.content.shots[0]!.shot_id).toMatch(/^shp_[0-9a-f]{32}$/);
    expect(service.api.getEpisodeStoryboardVersion).toHaveBeenCalledWith(
      project,
      episode,
      saved.version_id,
    );
    expect(localStorage.length).toBe(0);
    view.unmount();
    view = mount();
    await screen.findByDisplayValue("桥边相遇");
    expect(screen.getByLabelText("镜头时长（帧）")).toHaveValue(96);
    view.unmount();
    mount(otherEpisode);
    await screen.findByText("本集还没有镜头。");
    expect(screen.queryByDisplayValue("桥边相遇")).toBeNull();
  });
  it("reorders and deletes by stable shot identity while retaining the prior version", async () => {
    mount();
    await add("第一镜");
    await add("第二镜");
    await save();
    const first = service.heads.get(`${project}/${episode}`)!;
    fireEvent.click(screen.getByRole("button", { name: "上移" }));
    await save();
    const second = service.heads.get(`${project}/${episode}`)!;
    expect(second.content.shots.map((shot) => shot.shot_id)).toEqual(
      [...first.content.shots.map((shot) => shot.shot_id)].reverse(),
    );
    expect(second.content.shots.map((shot) => shot.ordinal)).toEqual([1, 2]);
    fireEvent.click(screen.getByRole("button", { name: "删除镜头" }));
    await save();
    const third = service.heads.get(`${project}/${episode}`)!;
    expect(third.content.shots).toHaveLength(1);
    expect(third.content.shots[0]!.shot_id).toBe(first.content.shots[0]!.shot_id);
    expect(service.versions.get(first.version_id)!.content.shots).toHaveLength(2);
  });
  it("blocks new writes after a lost result, recovers the original operation after reopening", async () => {
    const original = service.api.createEpisodeStoryboardVersion;
    vi.mocked(original).mockImplementationOnce(async (...args) => {
      const result = await makeGateway().api.createEpisodeStoryboardVersion(...args);
      if (result.kind === "CREATED") {
        const v = result.receipt.data.version;
        service.heads.set(`${project}/${episode}`, v);
        service.versions.set(v.version_id, v);
        service.operations.set(args[2], v);
      }
      return { kind: "REMOTE_UNKNOWN" };
    });
    let view = mount();
    await add("待核对的镜头");
    fireEvent.click(screen.getByRole("button", { name: "保存分镜草稿" }));
    await screen.findByText(/保存结果待核对。请使用/);
    expect(screen.getByRole("button", { name: "添加镜头" })).toBeDisabled();
    const [p, e, key, payload] = vi.mocked(original).mock.calls[0]!;
    view.unmount();
    view = mount();
    await screen.findByDisplayValue("待核对的镜头");
    fireEvent.click(screen.getByRole("button", { name: "核对原提交" }));
    await screen.findByText(/已保存，并已回读核对/);
    expect(original).toHaveBeenNthCalledWith(2, p, e, key, payload);
    expect(service.versions.size).toBe(1);
    expect(localStorage.length).toBe(0);
    view.unmount();
  });
  it("retains edits after a conflict and guards unsaved navigation", async () => {
    mount();
    await add("未保存镜头");
    const check = guard.mock.calls.at(-1)?.[0];
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    expect(check?.()).toBe(false);
    vi.mocked(service.api.createEpisodeStoryboardVersion).mockResolvedValueOnce({
      kind: "DEFINITE_SERVER_ERROR",
      status: 409,
      code: "STORYBOARD_CONFLICT",
      request_id: requestId,
    });
    fireEvent.click(screen.getByRole("button", { name: "保存分镜草稿" }));
    await screen.findByText(/本集分镜已有更新/);
    expect(screen.getByLabelText("镜头标题")).toHaveValue("未保存镜头");
    expect(screen.getByRole("button", { name: "保存分镜草稿" })).toBeDisabled();
    expect(localStorage.length).toBe(0);
  });
  it("pins actual script/library versions and saves member IDs; references are optional", async () => {
    const script: ScriptVersion = {
      version_id: `ver_${"1".repeat(32)}`,
      project_id: project,
      episode_id: episode,
      version_number: 3,
      head_revision: 3,
      parent_version_id: `ver_${"0".repeat(32)}`,
      content: {
        schema_version: "1.0.0",
        project_id: project,
        episode_id: episode,
        scenes: [
          { scene_id: `scn_${"2".repeat(32)}`, ordinal: 1, heading: "桥边 / 夜", blocks: [] },
        ],
      },
      content_hash: `sha256:${"e".repeat(64)}`,
      author_actor_id: "local-user",
      change_summary: "剧本",
      created_at: "2026-10-08T04:00:00Z",
    };
    const libraryContent = emptyCreativeContent(project);
    libraryContent.characters = [
      {
        character_id: `chr_${"3".repeat(32)}`,
        ordinal: 1,
        name: "沈遥",
        role: "",
        description: "",
        appearance: "",
        personality: "",
      },
    ];
    libraryContent.scenes = [
      {
        scene_id: `loc_${"4".repeat(32)}`,
        ordinal: 1,
        name: "旧桥",
        description: "",
        location: "",
        time_of_day: "",
        weather: "",
        continuity: "",
      },
    ];
    const library: CreativeVersion = {
      ...script,
      episode_id: null,
      version_id: `ver_${"5".repeat(32)}`,
      content: libraryContent,
    };
    const sources = {
      ...service.api,
      getEpisodeScript: vi
        .fn()
        .mockResolvedValue({ kind: "FOUND", receipt: { data: script, request_id: requestId } }),
      getEpisodeScriptVersion: vi
        .fn()
        .mockResolvedValue({ kind: "FOUND", receipt: { data: script, request_id: requestId } }),
      getProjectCreativeLibrary: vi
        .fn()
        .mockResolvedValue({ kind: "FOUND", receipt: { data: library, request_id: requestId } }),
      getProjectCreativeLibraryVersion: vi
        .fn()
        .mockResolvedValue({ kind: "FOUND", receipt: { data: library, request_id: requestId } }),
    };
    vi.mocked(createStudioTransport).mockReturnValue(
      sources as unknown as ReturnType<typeof createStudioTransport>,
    );
    mount();
    await add("关联镜头");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "关联此剧本版本" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "关联此剧本版本" }));
    await waitFor(() => expect(screen.getByLabelText("对应剧本场次")).toBeEnabled());
    fill("对应剧本场次", script.content.scenes[0]!.scene_id);
    fireEvent.click(screen.getByRole("button", { name: "关联此设定版本" }));
    await waitFor(() => expect(screen.getByLabelText("镜头地点")).toBeEnabled());
    fill("镜头地点", libraryContent.scenes[0]!.scene_id);
    fireEvent.click(screen.getByLabelText("沈遥"));
    await save();
    const saved = service.heads.get(`${project}/${episode}`)!;
    expect(saved.content.script_version_id).toBe(script.version_id);
    expect(saved.content.creative_library_version_id).toBe(library.version_id);
    expect(saved.content.shots[0]).toMatchObject({
      script_scene_id: script.content.scenes[0]!.scene_id,
      location_id: libraryContent.scenes[0]!.scene_id,
      character_ids: [libraryContent.characters[0]!.character_id],
    });
    expect(sources.getEpisodeScriptVersion).toHaveBeenCalledWith(
      project,
      episode,
      script.version_id,
    );
    expect(sources.getProjectCreativeLibraryVersion).toHaveBeenCalledWith(
      project,
      library.version_id,
    );
  });
  it("previews authored timed cards, validates timing and lets an empty draft be saved", async () => {
    mount();
    await screen.findByText("本集还没有镜头。");
    await save();
    expect(service.heads.get(`${project}/${episode}`)!.content.shots).toEqual([]);
    await add("第一张文字卡");
    fill("镜头时长（帧）", "24");
    await add("第二张文字卡");
    fill("镜头时长（帧）", "48");
    const preview = screen.getByRole("region", { name: "分镜文字预演" });
    expect(within(preview).getByText("文字卡片 · 无生成画面或声音")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("分镜预演进度"), { target: { value: "24" } });
    expect(within(preview).getByText("第二张文字卡")).toBeInTheDocument();
    fill("镜头时长（帧）", "0");
    fireEvent.click(screen.getByRole("button", { name: "保存分镜草稿" }));
    await screen.findByText(/请填写镜头标题/);
    expect(service.api.createEpisodeStoryboardVersion).toHaveBeenCalledTimes(1);
  });
  it("keeps unsaved manual content while switching the two storyboard views", async () => {
    mount();
    await add("保留手工修改");
    fireEvent.click(screen.getByRole("button", { name: "导演提案" }));
    expect(planView.current).toMatchObject({
      projectId: project,
      episodeId: episode,
      storyboardDirty: true,
      pendingOperations: false,
    });
    expect(screen.getByRole("region", { name: "director host test" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "返回手写分镜" }));
    expect(screen.getByDisplayValue("保留手工修改")).toBeVisible();
    expect(service.api.createEpisodeStoryboardVersion).not.toHaveBeenCalled();
    expect(window.confirm).not.toHaveBeenCalled();
  });
  it("combines director dirty and busy guards without losing the storyboard guard", async () => {
    mount();
    await screen.findByText("本集还没有镜头。");
    fireEvent.click(screen.getByRole("button", { name: "导演提案" }));
    act(() => planView.current!.onWorkStateChange!({ dirty: true, pending: false, busy: false }));
    vi.mocked(window.confirm).mockReturnValue(false);
    expect(guard.mock.calls.at(-1)![0]!()).toBe(false);
    expect(window.confirm).toHaveBeenCalledWith("人工导演提案有未保存修改。放弃修改并离开吗？");
    vi.mocked(window.confirm).mockClear();
    act(() => planView.current!.onWorkStateChange!({ dirty: false, pending: false, busy: true }));
    expect(guard.mock.calls.at(-1)![0]!()).toBe(false);
    expect(window.confirm).not.toHaveBeenCalled();
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    expect(screen.getByRole("button", { name: "返回手写分镜" })).toBeDisabled();
    act(() => planView.current!.onWorkStateChange!({ dirty: false, pending: true, busy: false }));
    expect(guard.mock.calls.at(-1)![0]!()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "返回手写分镜" }));
    expect(screen.getByRole("button", { name: "保存分镜草稿" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "添加镜头" })).toBeDisabled();
  });
  it.each([
    `aivora.episode-script.pending.v1.${project}.${episode}`,
    `aivora.episode-script.confirmation.pending.v1.${project}.${episode}`,
    "aivora.production-brief.pending.v1",
  ])("blocks proposal adoption when upstream recovery state is unreadable: %s", async (key) => {
    localStorage.setItem(key, "{invalid");
    mount();
    await screen.findByText("本集还没有镜头。");
    fireEvent.click(screen.getByRole("button", { name: "导演提案" }));
    expect(planView.current?.pendingOperations).toBe(true);
    expect(localStorage.getItem(key)).toBe("{invalid");
    localStorage.removeItem(key);
    fireEvent(window, new Event("focus"));
    expect(planView.current?.pendingOperations).toBe(false);
  });
});

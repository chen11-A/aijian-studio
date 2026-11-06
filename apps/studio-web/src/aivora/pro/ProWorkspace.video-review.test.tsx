import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { sampleFilm, type FilmProject } from "../film/project";
import { storyFilmBatches } from "../film/operations";
import { historyRecordHash } from "./actions/persistent-history";
import * as editorModule from "./actions/editor-host";
import { ProWorkspace } from "./ProWorkspace";
const createHost = editorModule.createEditorHost;
async function open(withFailedHistory = false) {
  const film = sampleFilm();
  film.backendProjectId = `prj_${"a".repeat(32)}`;
  film.characters = [];
  film.props = [];
  film.audioClips = [];
  film.scenes = [{ ...film.scenes[0]!, where: "空街", text: "雨落在空街。" }];
  const scene = film.scenes[0]!;
  film.locations = [
    {
      id: "street-place",
      sceneId: scene.id,
      name: "空街",
      prompt: "空街",
      ambience: "",
      referenceImage: "/media/scene.png",
      referenceStyleRevision: film.styleRevision ?? 0,
      referenceLayout: "",
      referenceSceneSignature: JSON.stringify([scene.id, scene.title, scene.where, scene.text]),
    },
  ];
  film.shots = [
    {
      ...film.shots[0]!,
      sceneId: scene.id,
      characters: [],
      picture: "空街积水反光。",
      action: "雨水沿街面流动。",
      performance: "",
      directorPlan: undefined,
      actionPlan: undefined,
      performancePlan: undefined,
      seconds: 4,
      line: "",
      lines: [],
      userFields: ["picture", "action"],
      selectedTakeId: "",
      takes: [],
      poster: "/media/frame.png",
    },
  ];
  if (withFailedHistory) {
    film.shots[0]!.takes.push({
      id: "cancelled-old-take",
      shotId: film.shots[0]!.id,
      index: 1,
      status: "failed",
      videoPath: "",
      videoUrl: "",
      stillUrl: "/media/old-start.png",
      prompt: "旧失败版本说明",
      reason: "已取消",
      createdAt: "",
    });
  }
  const other = {
    ...structuredClone(film),
    id: "film_anotherwork000001",
    episodeTitle: "另一集",
    episodeNo: 2,
  };
  let disk = structuredClone(film),
    host!: Parameters<typeof createHost>[0];
  vi.spyOn(editorModule, "createEditorHost").mockImplementation((value) => {
    host = value;
    return createHost(value);
  });
  const writes = vi.fn(async (value: FilmProject) => {
    disk = structuredClone(value);
    return structuredClone(disk);
  });
  const provider = vi.fn(async () => ({
    data: { status: "SUCCEEDED", output_path: "/media/new.mp4", duration_seconds: 4 },
  }));
  const still = vi.fn();
  const text = vi.fn();
  window.aijian = {
    readFilmProject: vi.fn(async (id: string) => structuredClone(id === other.id ? other : disk)),
    writeFilmProject: writes,
    prepareFilmProject: vi.fn(async (value: FilmProject) => structuredClone(value)),
    listFilmSeries: vi.fn(async () => []),
    listFilmEpisodes: vi.fn(async () => [
      {
        id: other.id,
        seriesId: other.seriesId,
        title: "另一集",
        no: 2,
        shots: 1,
        done: 0,
        savedAt: "",
      },
    ]),
    listFilmHistory: vi.fn(async () => ({ kind: "LIST", entries: [], unreadable: 0 })),
    captureFilmHistory: vi.fn(async (input: { expectedHash: string }) => {
      expect(input.expectedHash).toBe(await historyRecordHash(disk));
      return {
        kind: "CAPTURED",
        entry: {
          id: `hst_${"b".repeat(32)}`,
          createdAt: new Date().toISOString(),
          reason: "before-batch-generation",
          summary: { scenes: 1, shots: 1, done: 0 },
        },
      };
    }),
    restoreFilmHistory: vi.fn(),
    generateFilmStill: still,
    createStoryFilm: provider,
    readFilmMedia: vi.fn(async () => new Uint8Array([1, 2, 3])),
  } as unknown as Window["aijian"];
  window.aijianGrok = {
    status: vi.fn(async () => ({
      provider: "GROK_LOGIN",
      runtime: "DESKTOP",
      state: "CONNECTED",
      secureStorage: "AVAILABLE",
      accountLabel: "test",
      lastError: null,
    })),
    models: vi.fn(async () => ({
      kind: "OK",
      models: [
        "grok-4.7",
        "grok-imagine-video-1.5",
        "grok-imagine-video-1.5-lite",
        "grok-imagine-image-2.0",
      ].map((id) => ({ id, label: id })),
    })),
    completeText: text,
  } as unknown as Window["aijianGrok"];
  localStorage.setItem("aivora.film.activeId", film.id);
  render(<ProWorkspace />);
  await screen.findByLabelText("这一场");
  await waitFor(() =>
    expect(document.querySelector(".pro-root")).toHaveAttribute("data-generate", "on"),
  );
  fireEvent.click(
    within(screen.getByRole("navigation", { name: "创作阶段" })).getByRole("button", {
      name: /分镜/,
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "属性" }));
  const summary = [...document.querySelectorAll<HTMLElement>(".pgroup > summary")].find(
    (item) => item.textContent === "高级",
  )!;
  if (!(summary.parentElement as HTMLDetailsElement).open) fireEvent.click(summary);
  return { film, other, writes, provider, still, text, host: () => host, saved: () => disk };
}
const request = () => fireEvent.click(screen.getByRole("button", { name: "整理视频说明" }));
const review = () => screen.getByRole("region", { name: "七段视频说明" });
beforeEach(() => {
  localStorage.clear();
  delete window.aijian;
  delete window.aijianGrok;
});
afterEach(() => vi.restoreAllMocks());
it("real Board entry previews one field without editing/generating, confirms via the host, and actual video request consumes it", async () => {
  const env = await open();
  request();
  expect(review()).toHaveTextContent("身份 · 待决定");
  expect(review()).toHaveTextContent("关闭原生声音");
  expect(env.host().current()!.shots[0]!.reviewedVideoPrompt).toBeUndefined();
  expect(env.writes.mock.calls.some(([film]) => film.shots[0]!.reviewedVideoPrompt)).toBe(false);
  expect(env.provider).not.toHaveBeenCalled();
  expect(env.still).not.toHaveBeenCalled();
  expect(env.text).not.toHaveBeenCalled();
  fireEvent.click(within(review()).getByRole("button", { name: "确认视频说明" }));
  await within(review()).findByText("视频说明已确认并保存。此次确认没有生成媒体。");
  const current = env.host().current()!,
    shot = current.shots[0]!,
    draft = shot.reviewedVideoPrompt!;
  expect(draft).toBeDefined();
  expect(env.saved().shots[0]!.reviewedVideoPrompt).toEqual(draft);
  expect(shot.promptZh).toBe(env.film.shots[0]!.promptZh);
  const expected = storyFilmBatches(current, [shot], current.draft)[0]!.shots![0]!.prompt;
  fireEvent.click(screen.getByRole("button", { name: "单个镜头" }));
  fireEvent.click(screen.getByRole("button", { name: "AI 助手" }));
  const scrollHost = review().closest<HTMLElement>(".shot-assistant-scroll");
  expect(scrollHost).not.toBeNull();
  expect(within(scrollHost!).getByRole("button", { name: "整理视频说明" })).toBeEnabled();
  expect(within(scrollHost!).getByRole("textbox", { name: "跟助手说" })).toBeEnabled();
  expect(within(scrollHost!).getByRole("button", { name: "确认视频说明" })).toBeDisabled();
  fireEvent.click(within(scrollHost!).getByRole("button", { name: "关闭说明" }));
  expect(screen.queryByRole("region", { name: "七段视频说明" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "属性" }));
  fireEvent.click(screen.getByRole("button", { name: "生成 1 个版本" }));
  fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
  await waitFor(() => expect(env.provider).toHaveBeenCalledOnce(), { timeout: 5000 });
  expect(
    (env.provider.mock.calls[0] as unknown as [string, { shots: { prompt: string }[] }])[1]
      .shots[0]!.prompt,
  ).toBe(expected);
  expect(env.text).not.toHaveBeenCalled();
  expect(env.still).not.toHaveBeenCalled();
}, 15000);
it("preserves arriving media/old versions through confirmation and actual top-bar undo", async () => {
  const env = await open();
  request();
  const later = structuredClone(env.host().current()!);
  later.shots[0]!.poster = "/media/arrived.png";
  later.shots[0]!.takes.push({
    id: "late-media",
    shotId: later.shots[0]!.id,
    index: 1,
    status: "done",
    videoPath: "/media/old.mp4",
    videoUrl: "",
    stillUrl: "",
    prompt: "old",
    reason: "",
    createdAt: "",
  });
  act(() => env.host().applyLive(later));
  fireEvent.click(within(review()).getByRole("button", { name: "确认视频说明" }));
  await within(review()).findByText("视频说明已确认并保存。此次确认没有生成媒体。");
  fireEvent.click(screen.getByRole("button", { name: "撤销" }));
  expect(env.host().current()!.shots[0]!.reviewedVideoPrompt).toBeUndefined();
  expect(env.host().current()!.shots[0]!.poster).toBe("/media/arrived.png");
  expect(env.host().current()!.shots[0]!.takes[0]!.videoPath).toBe("/media/old.mp4");
  expect(env.provider).not.toHaveBeenCalled();
});
it.each(["picture", "selectedTakeId", "sourceText"] as const)(
  "rejects changed %s without applying a stale review",
  async (field) => {
    const env = await open();
    request();
    const later = structuredClone(env.host().current()!);
    if (field === "sourceText") later.sourceText = "后来改变的剧本输入";
    else Object.assign(later.shots[0]!, { [field]: "later" });
    act(() => env.host().applyLive(later));
    expect(within(review()).getByRole("button", { name: "确认视频说明" })).toBeDisabled();
    expect(review()).toHaveTextContent("本次未应用");
    expect(env.host().current()!.shots[0]!.reviewedVideoPrompt).toBeUndefined();
    expect(env.provider).not.toHaveBeenCalled();
  },
);
it("keeps an applied but failed save honest and blocks duplicate confirmation", async () => {
  const env = await open();
  request();
  env.writes.mockRejectedValueOnce(new Error("synthetic-disk-failure"));
  fireEvent.click(within(review()).getByRole("button", { name: "确认视频说明" }));
  await within(review()).findByText("视频说明已应用，但尚未保存。请重试保存。");
  expect(env.host().current()!.shots[0]!.reviewedVideoPrompt).toBeDefined();
  expect(within(review()).getByRole("button", { name: "确认视频说明" })).toBeDisabled();
  expect(env.provider).not.toHaveBeenCalled();
});
it("does not write or report old review completion after switching the real page or work", async () => {
  const env = await open();
  request();
  fireEvent.click(
    within(screen.getByRole("navigation", { name: "创作阶段" })).getByRole("button", {
      name: /剪辑/,
    }),
  );
  const visible = screen.queryByRole("region", { name: "七段视频说明" });
  if (visible) expect(within(visible).getByRole("button", { name: "确认视频说明" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "作品" }));
  fireEvent.click(await screen.findByRole("button", { name: /第2集 · 另一集|另一集/ }));
  await waitFor(() => expect(env.host().current()!.id).toBe(env.other.id));
  expect(screen.queryByRole("region", { name: "七段视频说明" })).toBeNull();
  expect(env.host().current()!.shots[0]!.reviewedVideoPrompt).toBeUndefined();
});

it("locks duplicate/close actions during persistence and ignores completion after an actual work switch", async () => {
  const env = await open();
  request();
  let release!: () => void;
  env.writes.mockImplementationOnce(async (value) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return structuredClone(value);
  });
  const confirm = within(review()).getByRole("button", { name: "确认视频说明" });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  await waitFor(() => expect(release).toBeTypeOf("function"));
  expect(confirm).toBeDisabled();
  expect(within(review()).getByRole("button", { name: "关闭说明" })).toBeDisabled();
  const applied = env.host().current()!.shots[0]!.reviewedVideoPrompt;
  expect(applied).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "作品" }));
  fireEvent.click(await screen.findByRole("button", { name: /第2集 · 另一集|另一集/ }));
  await waitFor(() => expect(env.host().current()!.id).toBe(env.other.id));
  await act(async () => release());
  expect(env.host().current()!.id).toBe(env.other.id);
  expect(env.host().current()!.shots[0]!.reviewedVideoPrompt).toBeUndefined();
  expect(screen.queryByText("视频说明已确认并保存。此次确认没有生成媒体。")).toBeNull();
  expect(env.provider).not.toHaveBeenCalled();
});
it("shows no field changes on repeated organization and does not claim a second apply/save", async () => {
  await open();
  request();
  fireEvent.click(within(review()).getByRole("button", { name: "确认视频说明" }));
  await within(review()).findByText("视频说明已确认并保存。此次确认没有生成媒体。");
  request();
  expect(review()).toHaveTextContent("视频说明 · 没有字段改动");
  expect(within(review()).getByRole("button", { name: "确认视频说明" })).toBeDisabled();
});

it("can generate again after importing only failed/cancelled history with no selected or usable video, retaining the failed version", async () => {
  const env = await open(true);
  request();
  fireEvent.click(within(review()).getByRole("button", { name: "确认视频说明" }));
  await within(review()).findByText("视频说明已确认并保存。此次确认没有生成媒体。");
  expect(env.host().current()!.shots[0]!.selectedTakeId).toBe("");
  const old = structuredClone(env.host().current()!.shots[0]!.takes[0]);
  fireEvent.click(screen.getByRole("button", { name: "单个镜头" }));
  fireEvent.click(screen.getByRole("button", { name: "生成 1 个版本" }));
  fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
  await waitFor(() => expect(env.provider).toHaveBeenCalledOnce(), { timeout: 5000 });
  expect(env.host().current()!.shots[0]!.takes[0]).toEqual(old);
  expect(env.host().current()!.shots[0]!.takes).toHaveLength(2);
  expect(
    (env.provider.mock.calls[0] as unknown as [string, { shots: { prompt: string }[] }])[1]
      .shots[0]!.prompt,
  ).toContain("雨水沿街面流动");
});

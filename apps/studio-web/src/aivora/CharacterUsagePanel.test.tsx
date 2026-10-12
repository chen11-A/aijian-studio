import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createStudioTransport } from "../api/studio";
import { CharacterUsagePanel } from "./CharacterUsagePanel";
import type { StoryboardGateway, StoryboardVersion } from "./adapters/episodeStoryboard";

vi.mock("../api/studio", () => ({ createStudioTransport: vi.fn() }));
const project = `prj_${"a".repeat(32)}`;
const other = `prj_${"b".repeat(32)}`;
const charA = `chr_${"c".repeat(32)}`;
const charB = `chr_${"d".repeat(32)}`;
const episodes = [1, 2].map((n) => ({
  id: `ep_${String(n).repeat(32)}`,
  project_id: project,
  title: `第${n}集`,
}));
function board(episodeId: string, charId = charA): StoryboardVersion {
  return {
    project_id: project,
    episode_id: episodeId,
    version_id: `ver_${"e".repeat(32)}`,
    version_number: 1,
    head_revision: 1,
    parent_version_id: null,
    content: {
      schema_version: "1.0.0",
      project_id: project,
      episode_id: episodeId,
      fps: 25,
      script_version_id: null,
      creative_library_version_id: `ver_${"f".repeat(32)}`,
      shots: [
        {
          shot_id: `shp_${"9".repeat(32)}`,
          ordinal: 1,
          duration_frames: 75,
          title: "雨夜回望",
          description: "",
          action: "回望",
          dialogue: "",
          camera: "中景",
          script_scene_id: null,
          character_ids: [charId],
          location_id: null,
        },
      ],
    },
    content_hash: `sha256:${"1".repeat(64)}`,
    author_actor_id: "human",
    change_summary: "保存分镜",
    created_at: "2026-10-11T00:00:00Z",
  };
}
let get: ReturnType<typeof vi.fn<StoryboardGateway["getEpisodeStoryboard"]>>;
beforeEach(() => {
  get = vi.fn<StoryboardGateway["getEpisodeStoryboard"]>(async (_project, episode) => ({
    kind: "FOUND",
    receipt: { data: board(episode), request_id: "123e4567-e89b-42d3-a456-426614174000" },
  }));
  vi.mocked(createStudioTransport).mockReturnValue({
    getEpisodeStoryboard: get,
  } as unknown as ReturnType<typeof createStudioTransport>);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function mount(charId = charA, ready = true) {
  return render(
    <CharacterUsagePanel
      projectId={project}
      characterId={charId}
      episodes={episodes}
      episodeListReady={ready}
      selectedEpisodeId={episodes[0]!.id}
      dirty
    />,
  );
}
it("lists exact saved usage in two episodes and filters another character without new reads", async () => {
  const view = mount();
  await screen.findByText("已读取 2 个分集的保存分镜");
  expect(screen.getAllByText("雨夜回望")).toHaveLength(2);
  expect(screen.getAllByText(`ver_${"f".repeat(32)}`)).toHaveLength(2);
  expect(screen.getAllByText(`shp_${"9".repeat(32)}`)).toHaveLength(2);
  expect(screen.getByText(/共享设定有未保存修改/)).toBeInTheDocument();
  view.rerender(
    <CharacterUsagePanel
      projectId={project}
      characterId={charB}
      episodes={episodes}
      episodeListReady
      selectedEpisodeId={null}
      dirty={false}
    />,
  );
  expect(screen.getAllByText("该已保存分镜未引用此角色")).toHaveLength(2);
  expect(get).toHaveBeenCalledTimes(2);
});
it("distinguishes an unreadable episode from no saved storyboard and refreshes through GET only", async () => {
  get.mockResolvedValueOnce({ kind: "REMOTE_UNKNOWN" }).mockResolvedValueOnce({ kind: "EMPTY" });
  mount();
  await screen.findByText("第1集：使用情况未知，读取结果待核对");
  expect(screen.getByText("第2集：尚无已保存分镜")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "刷新角色使用" }));
  await screen.findByText("已读取 2 个分集的保存分镜");
  expect(get).toHaveBeenCalledTimes(4);
});
it("shows each saved episode's exact draft choices without resolving names from the current library", async () => {
  get.mockImplementation(async (_project, episode) => {
    const version = board(episode);
    const value: StoryboardVersion = {
      ...version,
      content: {
        ...version.content,
        schema_version: "1.1.0",
        shots: version.content.shots.map((shot) => ({
          ...shot,
          character_bindings: [
            {
              character_id: charA,
              costume_id: episode === episodes[0]!.id ? `cst_${"6".repeat(32)}` : null,
              reference_ids: episode === episodes[0]!.id ? [`crf_${"7".repeat(32)}`] : [],
            },
          ],
        })),
      },
    };
    return {
      kind: "FOUND",
      receipt: { data: value, request_id: "123e4567-e89b-42d3-a456-426614174000" },
    };
  });
  mount();
  await screen.findByText("已读取 2 个分集的保存分镜");
  expect(screen.getByText(`cst_${"6".repeat(32)}`)).toBeInTheDocument();
  expect(screen.getByText(`crf_${"7".repeat(32)}`)).toBeInTheDocument();
  expect(get).toHaveBeenCalledTimes(2);
});
it("rejects foreign episode lists and waits for verified episode loading", async () => {
  const view = mount(charA, false);
  expect(screen.getByText(/分集列表尚未核对/)).toBeInTheDocument();
  expect(get).not.toHaveBeenCalled();
  view.rerender(
    <CharacterUsagePanel
      projectId={other}
      characterId={charA}
      episodes={episodes}
      episodeListReady
      selectedEpisodeId={null}
      dirty={false}
    />,
  );
  await screen.findByText(/分集作用域不一致/);
  expect(get).not.toHaveBeenCalled();
});
it("rejects malformed or wrong-project storyboard receipts instead of reporting zero usage", async () => {
  get.mockResolvedValueOnce({
    kind: "FOUND",
    receipt: {
      data: { ...board(episodes[0]!.id), project_id: other },
      request_id: "123e4567-e89b-42d3-a456-426614174000",
    },
  });
  mount();
  await screen.findByText("第1集：使用情况未知，读取结果待核对");
  expect(screen.getAllByText("雨夜回望")).toHaveLength(1);
});
it("discards the stale A result after A to B to A", async () => {
  let resolve: (
    value: Awaited<ReturnType<StoryboardGateway["getEpisodeStoryboard"]>>,
  ) => void = () => {
    throw new Error("No pending read");
  };
  get.mockImplementationOnce(
    () =>
      new Promise((reply) => {
        resolve = reply;
      }),
  );
  const view = mount();
  view.rerender(
    <CharacterUsagePanel
      projectId={other}
      characterId={charA}
      episodes={[]}
      episodeListReady
      selectedEpisodeId={null}
      dirty={false}
    />,
  );
  await screen.findByText("作品尚无分集");
  view.rerender(
    <CharacterUsagePanel
      projectId={project}
      characterId={charA}
      episodes={episodes}
      episodeListReady
      selectedEpisodeId={null}
      dirty={false}
    />,
  );
  await screen.findByText("已读取 2 个分集的保存分镜");
  await act(async () => {
    resolve({ kind: "EMPTY" });
  });
  expect(screen.getAllByText("雨夜回望")).toHaveLength(2);
  expect(screen.queryByText("第1集：尚无已保存分镜")).not.toBeInTheDocument();
});

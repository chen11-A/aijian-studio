import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EpisodeMediaAssemblyPanel } from "./EpisodeMediaAssemblyPanel";
import { useEpisodeAssembly } from "./useEpisodeAssembly";
import { bindAssemblyShot } from "./adapters/assemblyStoryboard";
import { staticAnimaticContent } from "./adapters/episodeMediaAssembly";
import type { AssetLibraryGateway, AssetVersion, MediaAsset } from "./adapters/assetLibrary";
import type {
  AssemblyContent,
  AssemblyReceipt,
  CreateAssemblyCommand,
  EpisodeMediaAssemblyGateway,
} from "./adapters/episodeMediaAssembly";

const projectId = `prj_${"1".repeat(32)}`,
  episodeId = "ep_edit";
function asset(kind: "video" | "image" | "audio", digit: string): MediaAsset {
  const version: AssetVersion = {
    id: `asv_${digit.repeat(32)}`,
    ordinal: 1,
    filename: `${kind}-local.${kind === "audio" ? "wav" : kind === "video" ? "mp4" : "png"}`,
    kind,
    mime_type: kind === "video" ? "video/mp4" : kind === "audio" ? "audio/wav" : "image/png",
    byte_size: 4,
    sha256: digit.repeat(64),
    rights_status: "PENDING_REVIEW",
    source_kind: "LOCAL_IMPORT",
    technical_metadata: {},
    created_at: "2026-10-08",
    availability: "VERIFIED",
  };
  return {
    id: `asset_${digit.repeat(32)}`,
    project_id: projectId,
    created_at: "2026-10-08",
    latest_version: version,
    versions: [version],
    episode_references: [],
  };
}
const library = [asset("video", "2"), asset("image", "3"), asset("audio", "4")];
function makeReceipt(
  content: AssemblyContent,
  parent: string | null,
  revision: number,
): AssemblyReceipt {
  return {
    request_id: "assembly-test",
    data: {
      artifact_id: `art_${"5".repeat(32)}`,
      version_id: `ver_${String(revision).repeat(32)}`,
      content_hash: `sha256:${"6".repeat(64)}`,
      head_revision: revision,
      parent_version_id: parent,
      content,
      playback_status: "BLOCKED_MEDIA_PROBE",
      export_status: "NO_EXPORT_CLAIM",
      media_checks: library.map((item) => ({
        media: {
          asset_id: item.id,
          asset_version_id: item.latest_version.id,
          sha256: item.latest_version.sha256,
        },
        kind: item.latest_version.kind,
        availability: "VERIFIED",
        technical_status:
          item.latest_version.kind === "image" ? "STILL_HEADER_ONLY" : "PENDING_MEDIA_PROBE",
        rights_status: "PENDING_REVIEW",
      })),
    },
  };
}
function setup() {
  let stored: AssemblyReceipt | null = null;
  const assets: AssetLibraryGateway = {
    listProjectMediaAssets: vi.fn().mockResolvedValue({
      kind: "LISTED",
      receipt: { request_id: "library-test", data: library },
    }),
    getProjectMediaAsset: vi.fn(),
    importProjectMediaAssetFromPicker: vi.fn(),
    importProjectMediaAssetVersionFromPicker: vi.fn(),
    readProjectMediaAssetPreview: vi.fn(async (_p: string, id: string) => {
      const item = library.find((candidate) => candidate.id === id)!;
      return {
        kind: "READY" as const,
        mime_type: item.latest_version.mime_type,
        sha256: item.latest_version.sha256,
        bytes: new Uint8Array(4),
      };
    }),
    addProjectMediaAssetEpisodeReference: vi.fn(),
    removeProjectMediaAssetEpisodeReference: vi.fn(),
    deleteProjectMediaAsset: vi.fn(),
  };
  const assembly: EpisodeMediaAssemblyGateway = {
    readLatest: vi.fn(async () =>
      stored
        ? { kind: "FOUND" as const, receipt: stored }
        : { kind: "NOT_FOUND" as const, request_id: "empty" },
    ),
    createVersion: vi.fn(async (_p: string, _e: string, command: CreateAssemblyCommand) => {
      stored = makeReceipt(
        command.content,
        command.parent_version_id,
        (command.expected_revision ?? 0) + 1,
      );
      return { kind: "CREATED" as const, receipt: stored };
    }),
  };
  const setNavigationGuard = vi.fn<(guard: (() => boolean) | null) => void>();
  return { assets, assembly, setNavigationGuard, stored: () => stored };
}
function draftContent() {
  const item = library[1]!;
  return staticAnimaticContent(projectId, episodeId, [
    {
      media: {
        asset_id: item.id,
        asset_version_id: item.latest_version.id,
        sha256: item.latest_version.sha256,
      },
      frames: 50,
    },
  ]);
}
function unloadPrevented() {
  const event = new Event("beforeunload", { cancelable: true });
  act(() => {
    window.dispatchEvent(event);
  });
  return event.defaultPrevented;
}
async function add(kind: "video" | "image" | "audio") {
  const choice = library.find((item) => item.latest_version.kind === kind)!;
  fireEvent.change(screen.getByLabelText("选择已导入素材版本"), {
    target: { value: `${choice.id}/${choice.latest_version.id}` },
  });
  fireEvent.click(
    screen.getByRole("button", { name: kind === "audio" ? "加入音频片段" : "加入画面轨" }),
  );
}
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:verified-local-original"),
    revokeObjectURL: vi.fn(),
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("native local-media episode assembly panel", () => {
  it("saves exact shot links through undo, readback and reopening without changing old content", async () => {
    const env = setup();
    let view = renderHook(() => useEpisodeAssembly({ projectId, episodeId, ...env }));
    await waitFor(() => expect(view.result.current.locked).toBe(false));
    const original = draftContent();
    act(() => {
      view.result.current.edit(original);
    });
    await act(async () => {
      await view.result.current.save();
    });
    const first = env.stored()!;
    const reference = {
      storyboard_version_id: `ver_${"c".repeat(32)}`,
      shot_id: `shp_${"d".repeat(32)}`,
    };
    act(() => {
      view.result.current.edit(
        bindAssemblyShot(original, original.visual_segments[0]!.segment_id, reference),
      );
    });
    act(() => {
      view.result.current.undo();
    });
    expect(view.result.current.content).toEqual(original);
    act(() => {
      view.result.current.undo(true);
    });
    await act(async () => {
      await view.result.current.save();
    });
    expect(view.result.current.writeUnknown).toBe(false);
    expect(view.result.current.dirty).toBe(false);
    expect(view.result.current.content.visual_segments[0]!.storyboard_ref).toEqual(reference);
    expect(first.data.content.visual_segments[0]).not.toHaveProperty("storyboard_ref");
    view.unmount();
    view = renderHook(() => useEpisodeAssembly({ projectId, episodeId, ...env }));
    await waitFor(() => expect(view.result.current.locked).toBe(false));
    expect(view.result.current.content.visual_segments[0]!.storyboard_ref).toEqual(reference);
    expect(view.result.current.content.total_frames).toBe(original.total_frames);
  });
  it("adds/cuts/trims/reorders/deletes true asset references and saves/reopens the rational sequence", async () => {
    const env = setup();
    const view = render(
      <EpisodeMediaAssemblyPanel projectId={projectId} episodeId={episodeId} {...env} />,
    );
    await waitFor(() => expect(screen.getByLabelText("选择已导入素材版本")).toBeEnabled());
    fireEvent.change(screen.getByLabelText("序列帧率"), { target: { value: "3" } });
    await add("video");
    await waitFor(() =>
      expect(screen.getByLabelText("所选视频原件")).toHaveAttribute(
        "src",
        "blob:verified-local-original",
      ),
    );
    fireEvent.change(screen.getByLabelText("剪切位置（序列帧）"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "在此帧分割" }));
    expect(
      within(screen.getByRole("list", { name: "画面片段" })).getAllByRole("button"),
    ).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "向后移动" }));
    const clips = within(screen.getByRole("list", { name: "画面片段" })).getAllByRole("button");
    fireEvent.click(clips[0]!);
    fireEvent.change(screen.getByLabelText("片段时长（帧）"), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText("视频源入点（帧）"), { target: { value: "32" } });
    fireEvent.click(screen.getByRole("button", { name: "应用裁剪" }));
    await add("image");
    fireEvent.click(screen.getByRole("button", { name: "删除所选片段" }));
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    fireEvent.click(screen.getByRole("button", { name: "重做" }));
    await add("audio");
    fireEvent.click(screen.getByRole("button", { name: "保存集级媒体装配版本" }));
    await waitFor(() => expect(screen.getByText("已读回保存版本")).toBeInTheDocument());
    const saved = env.stored()!.data.content;
    expect(saved.sequence_timebase.frame_rate).toEqual({ num: 30000, den: 1001 });
    expect(
      saved.visual_segments.map((clip) => [clip.start_frame, clip.end_frame, clip.source_in_frame]),
    ).toEqual([
      [0, 20, 32],
      [20, 50, 0],
    ]);
    expect(saved.audio_segments[0]!.track_kind).toBe("BGM");
    expect(localStorage.length).toBe(0);
    view.unmount();
    render(<EpisodeMediaAssemblyPanel projectId={projectId} episodeId={episodeId} {...env} />);
    await waitFor(() => expect(screen.getByText("已读回保存版本")).toBeInTheDocument());
    expect(
      within(screen.getByRole("list", { name: "画面片段" })).getAllByRole("button"),
    ).toHaveLength(2);
    expect(
      within(screen.getByRole("list", { name: "音频片段" })).getAllByRole("button"),
    ).toHaveLength(1);
    expect(env.assembly.createVersion).toHaveBeenCalledTimes(1);
  });
  it("keeps unknown writes locked across reopen and never resubmits", async () => {
    const env = setup();
    vi.mocked(env.assembly.createVersion).mockResolvedValue({ kind: "REMOTE_UNKNOWN" });
    const view = render(
      <EpisodeMediaAssemblyPanel projectId={projectId} episodeId={episodeId} {...env} />,
    );
    await waitFor(() => expect(screen.getByLabelText("选择已导入素材版本")).toBeEnabled());
    await add("video");
    fireEvent.click(screen.getByRole("button", { name: "保存集级媒体装配版本" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("先前写入结果未知"));
    view.unmount();
    render(<EpisodeMediaAssemblyPanel projectId={projectId} episodeId={episodeId} {...env} />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "保存集级媒体装配版本" })).toBeDisabled();
    expect(env.assembly.createVersion).toHaveBeenCalledTimes(1);
  });
  it("guards the latest dirty edits on navigation and close, and requires discard for a manual reload", async () => {
    const env = setup();
    const view = renderHook(() => useEpisodeAssembly({ projectId, episodeId, ...env }));
    await waitFor(() => expect(view.result.current.locked).toBe(false));
    const guard = env.setNavigationGuard.mock.calls.at(-1)?.[0];
    expect(guard).toBeTypeOf("function");
    expect(guard?.()).toBe(true);
    expect(unloadPrevented()).toBe(false);
    act(() => {
      view.result.current.edit(draftContent());
    });
    vi.mocked(window.confirm).mockReturnValue(false);
    act(() => {
      expect(guard?.()).toBe(false);
    });
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("放弃"));
    expect(unloadPrevented()).toBe(true);
    await act(async () => {
      await view.result.current.load();
    });
    expect(env.assembly.readLatest).toHaveBeenCalledTimes(1);
    expect(view.result.current.content.visual_segments).toHaveLength(1);
    vi.mocked(window.confirm).mockReturnValue(true);
    await act(async () => {
      await view.result.current.load();
    });
    expect(env.assembly.readLatest).toHaveBeenCalledTimes(2);
    expect(view.result.current.dirty).toBe(false);
    act(() => {
      view.result.current.edit(draftContent());
    });
    act(() => {
      expect(guard?.()).toBe(true);
    });
    expect(view.result.current.dirty).toBe(false);
    expect(unloadPrevented()).toBe(false);
    view.unmount();
    expect(env.setNavigationGuard).toHaveBeenLastCalledWith(null);
  });
  it("blocks duplicate work and leaving during save/readback without prompting to discard the submitted edit", async () => {
    const env = setup();
    const view = renderHook(() => useEpisodeAssembly({ projectId, episodeId, ...env }));
    await waitFor(() => expect(view.result.current.locked).toBe(false));
    const guard = env.setNavigationGuard.mock.calls.at(-1)?.[0];
    act(() => {
      view.result.current.edit(draftContent());
    });
    let finishSave: () => void = () => {
      throw new Error("save was not started");
    };
    const originalSave = vi.mocked(env.assembly.createVersion).getMockImplementation();
    if (!originalSave) throw new Error("save fixture is missing");
    vi.mocked(env.assembly.createVersion).mockImplementationOnce(
      (...args) =>
        new Promise((resolve) => {
          finishSave = () => {
            void originalSave(...args).then(resolve);
          };
        }),
    );
    let finishRead: () => void = () => {
      throw new Error("readback was not started");
    };
    vi.mocked(env.assembly.readLatest).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRead = () => resolve({ kind: "FOUND", receipt: env.stored()! });
        }),
    );
    vi.mocked(window.confirm).mockReturnValue(false);
    let saving: Promise<void>;
    act(() => {
      const current = view.result.current;
      saving = current.save();
      void current.save();
      void current.load();
      expect(guard?.()).toBe(false);
    });
    expect(env.assembly.createVersion).toHaveBeenCalledTimes(1);
    expect(env.assembly.readLatest).toHaveBeenCalledTimes(1);
    expect(unloadPrevented()).toBe(true);
    await act(async () => {
      finishSave();
    });
    expect(env.assembly.readLatest).toHaveBeenCalledTimes(2);
    act(() => {
      expect(guard?.()).toBe(false);
    });
    expect(unloadPrevented()).toBe(true);
    expect(window.confirm).not.toHaveBeenCalled();
    await act(async () => {
      finishRead();
      await saving;
    });
    expect(view.result.current.dirty).toBe(false);
    expect(view.result.current.writeUnknown).toBe(false);
    expect(env.assembly.createVersion).toHaveBeenCalledTimes(1);
    expect(guard?.()).toBe(true);
    expect(unloadPrevented()).toBe(false);
  });
  it("preserves unresolved submitted edits on reload and protects pending writes even after a clean reopen", async () => {
    const env = setup();
    vi.mocked(env.assembly.createVersion).mockResolvedValue({ kind: "REMOTE_UNKNOWN" });
    let view = renderHook(() => useEpisodeAssembly({ projectId, episodeId, ...env }));
    await waitFor(() => expect(view.result.current.locked).toBe(false));
    act(() => {
      view.result.current.edit(draftContent());
    });
    await act(async () => {
      await view.result.current.save();
    });
    const marker = localStorage.getItem(
      `aivora:episode-media-assembly:pending:${projectId}:${episodeId}`,
    );
    await act(async () => {
      await view.result.current.load();
    });
    expect(view.result.current.content.visual_segments).toHaveLength(1);
    expect(view.result.current.writeUnknown).toBe(true);
    view.unmount();
    view = renderHook(() => useEpisodeAssembly({ projectId, episodeId, ...env }));
    await waitFor(() => expect(view.result.current.busy).toBe(false));
    expect(view.result.current.dirty).toBe(false);
    const guard = env.setNavigationGuard.mock.calls.at(-1)?.[0];
    vi.mocked(window.confirm).mockReturnValue(false);
    act(() => {
      expect(guard?.()).toBe(false);
    });
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("核对"));
    expect(unloadPrevented()).toBe(true);
    vi.mocked(window.confirm).mockReturnValue(true);
    act(() => {
      expect(guard?.()).toBe(true);
    });
    expect(
      localStorage.getItem(`aivora:episode-media-assembly:pending:${projectId}:${episodeId}`),
    ).toBe(marker);
    expect(env.assembly.createVersion).toHaveBeenCalledTimes(1);
  });
  it("rejects mismatched preview bytes and explicitly preserves an unsupported source", async () => {
    const env = setup();
    vi.mocked(env.assets.readProjectMediaAssetPreview).mockResolvedValue({
      kind: "READY",
      mime_type: "video/mp4",
      sha256: "0".repeat(64),
      bytes: new Uint8Array(4),
    });
    render(<EpisodeMediaAssemblyPanel projectId={projectId} episodeId={episodeId} {...env} />);
    await waitFor(() => expect(screen.getByLabelText("选择已导入素材版本")).toBeEnabled());
    await add("video");
    await waitFor(() =>
      expect(screen.getByText("原素材字节、大小或哈希身份不符；未播放。")).toBeInTheDocument(),
    );
    expect(screen.queryByLabelText("所选视频原件")).not.toBeInTheDocument();
    expect(env.assembly.createVersion).not.toHaveBeenCalled();
  });
});

it("saves literal subtitle IDs and exact frames, protects unapplied input, and reopens unchanged", async () => {
  const env = setup();
  const view = render(
    <EpisodeMediaAssemblyPanel projectId={projectId} episodeId={episodeId} {...env} />,
  );
  await screen.findByText("从项目素材库选择真实视频、图片或音频，开始本集剪辑草稿。");
  await add("image");
  fireEvent.click(screen.getByRole("button", { name: "添加文字字幕" }));
  fireEvent.change(screen.getByLabelText("字幕文字"), {
    target: { value: "你好 AIVORA\n100% 字幕" },
  });
  fireEvent.change(screen.getByLabelText("字幕入点（帧）"), { target: { value: "3" } });
  fireEvent.change(screen.getByLabelText("字幕出点（不含此帧）"), { target: { value: "20" } });
  expect(screen.getByRole("button", { name: "保存集级媒体装配版本" })).toBeDisabled();
  expect(unloadPrevented()).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "应用字幕" }));
  fireEvent.click(screen.getByRole("button", { name: "保存集级媒体装配版本" }));
  await waitFor(() => expect(env.stored()?.data.content.subtitle_segments).toHaveLength(1));
  await screen.findByText("已从项目重新读回装配版本。");
  const first = env.stored()!.data.content.subtitle_segments[0]!;
  expect(first).toMatchObject({
    text: "你好 AIVORA\n100% 字幕",
    start_frame: 3,
    end_frame: 20,
    render_profile: "noto-cjk-sc-bottom-v1",
  });
  expect(unloadPrevented()).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "编辑字幕" }));
  fireEvent.change(screen.getByLabelText("字幕文字"), { target: { value: "修改字幕" } });
  expect(unloadPrevented()).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "放弃字幕输入" }));
  expect(unloadPrevented()).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "编辑字幕" }));
  fireEvent.change(screen.getByLabelText("字幕文字"), { target: { value: "修改字幕" } });
  fireEvent.click(screen.getByRole("button", { name: "应用字幕" }));
  fireEvent.click(screen.getByRole("button", { name: "保存集级媒体装配版本" }));
  await waitFor(() => expect(env.stored()?.data.head_revision).toBe(2));
  await screen.findByText("已从项目重新读回装配版本。");
  expect(env.stored()!.data.content.subtitle_segments[0]!.segment_id).toBe(first.segment_id);
  view.unmount();
  render(<EpisodeMediaAssemblyPanel projectId={projectId} episodeId={episodeId} {...env} />);
  await screen.findByText("修改字幕");
  fireEvent.click(screen.getByRole("button", { name: "删除字幕" }));
  expect(screen.queryByText("修改字幕")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "撤销" }));
  expect(screen.getByText("修改字幕")).toBeInTheDocument();
});

it("rejects unsupported subtitle text and overlap without silently saving or clipping", async () => {
  const env = setup();
  render(<EpisodeMediaAssemblyPanel projectId={projectId} episodeId={episodeId} {...env} />);
  await screen.findByText("从项目素材库选择真实视频、图片或音频，开始本集剪辑草稿。");
  await add("image");
  fireEvent.click(screen.getByRole("button", { name: "添加文字字幕" }));
  fireEvent.change(screen.getByLabelText("字幕文字"), { target: { value: "不支持😀" } });
  fireEvent.click(screen.getByRole("button", { name: "应用字幕" }));
  expect(screen.getByRole("alert")).toHaveTextContent("暂不支持 emoji");
  expect(env.assembly.createVersion).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("字幕文字"), { target: { value: "第一条" } });
  fireEvent.click(screen.getByRole("button", { name: "应用字幕" }));
  fireEvent.click(screen.getByRole("button", { name: "添加文字字幕" }));
  fireEvent.change(screen.getByLabelText("字幕文字"), { target: { value: "重叠条目" } });
  fireEvent.click(screen.getByRole("button", { name: "应用字幕" }));
  expect(screen.getByText("字幕范围不能重叠；请调整入点或出点。")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "保存集级媒体装配版本" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "放弃字幕输入" }));
  expect(screen.getByRole("button", { name: "保存集级媒体装配版本" })).toBeEnabled();
});

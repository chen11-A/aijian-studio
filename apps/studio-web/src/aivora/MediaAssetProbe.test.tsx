import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AijianDesktopBridge } from "../api/studio";
import type {
  MediaAssetProbeWriteResult,
  MediaAssetProbeReadResult,
} from "./adapters/mediaAssetProbe";
import { noProbe, probeProjectId, probeReceipt, videoAsset } from "../test/mediaAssetProbeFixture";
import { AssetsPage } from "./SceneAndAssets";
const model = vi.hoisted(() => ({ projectId: `prj_${"1".repeat(32)}` }));
vi.mock("./model", () => ({
  useDemo: () => ({
    isFixture: false,
    backendProjectId: model.projectId,
    selectedEpisodeId: null,
    page: "assets",
    value: (_key: string, fallback = "") => fallback,
    setEditor: vi.fn(),
    go: vi.fn(),
    put: vi.fn(),
  }),
}));
function setup() {
  const items = [videoAsset(), videoAsset("3")];
  const saved = new Map<string, ReturnType<typeof probeReceipt>>();
  const native = {
    listProjectMediaAssets: vi.fn(async (projectId: string) => ({
      kind: "LISTED",
      receipt: {
        data: items.filter((asset) => asset.project_id === projectId),
        request_id: "assets",
      },
    })),
    getProjectMediaAsset: vi.fn(),
    importProjectMediaAssetFromPicker: vi.fn(),
    importProjectMediaAssetVersionFromPicker: vi.fn(),
    readProjectMediaAssetPreview: vi.fn(),
    addProjectMediaAssetEpisodeReference: vi.fn(),
    removeProjectMediaAssetEpisodeReference: vi.fn(),
    deleteProjectMediaAsset: vi.fn(),
    getMediaToolchainStatus: vi.fn().mockResolvedValue({
      kind: "STATUS",
      status: {
        schema_version: 1,
        state: "AVAILABLE",
        source: "EXTERNAL",
        profile_id: "windows-x86_64-gyan-full-8.1.2-dev",
        version: "8.1.2",
        directory: "C:\\Tools\\bin",
        diagnostic: "Verified",
        can_probe: true,
        can_preview: true,
        can_draft_export: true,
        formal_release_approved: false,
      },
    }),
    selectMediaToolchain: vi.fn(),
    clearMediaToolchain: vi.fn(),
    getMediaAssetProbeEvidence: vi.fn(
      async (_p: string, _a: string, v: string): Promise<MediaAssetProbeReadResult> =>
        saved.has(v) ? { kind: "FOUND", receipt: saved.get(v)! } : noProbe,
    ),
    probeSelectedMediaAssetVersion: vi.fn(
      async (_p: string, a: string, v: string): Promise<MediaAssetProbeWriteResult> => {
        const receipt = probeReceipt(items.find((asset) => asset.id === a)!);
        saved.set(v, receipt);
        return { kind: "PROBED", receipt };
      },
    ),
  };
  window.aijian = native as unknown as AijianDesktopBridge;
  return { native, items, saved };
}
const start = () => screen.getByRole("button", { name: "探测选中视频版本" });
const refresh = () => screen.getByRole("button", { name: "重新读取此版本探测记录" });
beforeEach(() => {
  localStorage.clear();
  model.projectId = probeProjectId;
});
afterEach(() => {
  cleanup();
  delete window.aijian;
  vi.restoreAllMocks();
});
describe("production asset page exact-version probing through native bridge", () => {
  it("clicks the real asset action, invokes native exact IDs and displays durable real metadata", async () => {
    const { native, items } = setup();
    render(<AssetsPage />);
    await waitFor(() => expect(start()).toBeEnabled());
    expect(native.probeSelectedMediaAssetVersion).not.toHaveBeenCalled();
    fireEvent.click(start());
    await screen.findByText(/已验证探测：320 × 180 · 5 帧 · 25\/1 fps/);
    expect(native.probeSelectedMediaAssetVersion).toHaveBeenCalledExactlyOnceWith(
      probeProjectId,
      items[0]!.id,
      items[0]!.latest_version.id,
    );
    expect(native.getMediaAssetProbeEvidence).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/源入点加片段时长不可超过 5 帧/)).toBeInTheDocument();
    expect(screen.getByText(/无内嵌音频/)).toBeInTheDocument();
    expect(start()).toBeDisabled();
  });
  it("preserves a specific selected version and blocks duplicate clicks while native probe is pending", async () => {
    const { native, items } = setup();
    let finish!: (value: MediaAssetProbeWriteResult) => void;
    native.probeSelectedMediaAssetVersion.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<AssetsPage />);
    await waitFor(() => expect(start()).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "选择 video-3.mp4" }));
    await waitFor(() => expect(start()).toBeEnabled());
    fireEvent.click(start());
    fireEvent.click(start());
    await waitFor(() => expect(native.probeSelectedMediaAssetVersion).toHaveBeenCalledTimes(1));
    expect(native.probeSelectedMediaAssetVersion).toHaveBeenCalledWith(
      probeProjectId,
      items[1]!.id,
      items[1]!.latest_version.id,
    );
    expect(start()).toBeDisabled();
    await act(async () => {
      finish({ kind: "PROBE_UNKNOWN" });
    });
    await screen.findByText(/探测结果不确定/);
    expect(start()).toBeDisabled();
  });
  it("never adopts mismatched version/hash evidence or silently replays an unknown result", async () => {
    const { native } = setup();
    render(<AssetsPage />);
    await waitFor(() => expect(start()).toBeEnabled());
    const wrong = probeReceipt(videoAsset("3"));
    native.probeSelectedMediaAssetVersion.mockResolvedValue({ kind: "PROBED", receipt: wrong });
    native.getMediaAssetProbeEvidence.mockResolvedValue({ kind: "FOUND", receipt: wrong });
    fireEvent.click(start());
    await screen.findByText(/探测结果不确定/);
    expect(screen.queryByText(/已验证探测：/)).not.toBeInTheDocument();
    expect(start()).toBeDisabled();
    fireEvent.click(refresh());
    await waitFor(() => expect(refresh()).toBeEnabled());
    expect(native.probeSelectedMediaAssetVersion).toHaveBeenCalledTimes(1);
  });
  it("keeps unknown-plus-404 locked after leaving and reopening, requiring explicit user recovery", async () => {
    const { native } = setup();
    native.probeSelectedMediaAssetVersion.mockResolvedValue({ kind: "PROBE_UNKNOWN" });
    const view = render(<AssetsPage />);
    await waitFor(() => expect(start()).toBeEnabled());
    fireEvent.click(start());
    await screen.findByText(/探测结果不确定/);
    view.unmount();
    render(<AssetsPage />);
    await screen.findByText(/未查到记录不代表旧请求已结束/);
    expect(start()).toBeDisabled();
    expect(native.probeSelectedMediaAssetVersion).toHaveBeenCalledTimes(1);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(
      screen.getByRole("button", { name: "确认上次探测已结束，解除锁定", hidden: true }),
    );
    expect(start()).toBeDisabled();
    confirm.mockReturnValue(true);
    fireEvent.click(
      screen.getByRole("button", { name: "确认上次探测已结束，解除锁定", hidden: true }),
    );
    await waitFor(() => expect(start()).toBeEnabled());
    expect(native.probeSelectedMediaAssetVersion).toHaveBeenCalledTimes(1);
  });
  it("does not show a late result from a previous selection in the new selected video", async () => {
    const { native, items, saved } = setup();
    let finish!: (value: MediaAssetProbeWriteResult) => void;
    native.probeSelectedMediaAssetVersion.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<AssetsPage />);
    await waitFor(() => expect(start()).toBeEnabled());
    fireEvent.click(start());
    await waitFor(() => expect(native.probeSelectedMediaAssetVersion).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "选择 video-3.mp4" }));
    await waitFor(() => expect(start()).toBeEnabled());
    saved.set(items[0]!.latest_version.id, probeReceipt());
    await act(async () => {
      finish({ kind: "PROBED", receipt: probeReceipt() });
    });
    expect(screen.getByRole("heading", { name: "视频探测 · video-3.mp4" })).toBeInTheDocument();
    expect(screen.queryByText(/已验证探测：/)).not.toBeInTheDocument();
    expect(start()).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "选择 video-2.mp4" }));
    await screen.findByText(/已验证探测：/);
    expect(native.probeSelectedMediaAssetVersion).toHaveBeenCalledTimes(1);
  });
  it("keeps a missing runtime capability disabled while displaying existing version evidence", async () => {
    const { native, saved, items } = setup();
    saved.set(items[0]!.latest_version.id, probeReceipt());
    native.getMediaToolchainStatus.mockResolvedValue({ kind: "REMOTE_UNKNOWN" });
    render(<AssetsPage />);
    await screen.findByText(/已验证探测：/);
    expect(start()).toBeDisabled();
    expect(screen.getByText(/当前媒体工具未通过校验/)).toBeInTheDocument();
    expect(native.probeSelectedMediaAssetVersion).not.toHaveBeenCalled();
  });
});

it("keeps a late probe attached to its original project after project navigation", async () => {
  const { native, items, saved } = setup();
  let finish!: (value: MediaAssetProbeWriteResult) => void;
  native.probeSelectedMediaAssetVersion.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(<AssetsPage />);
  await waitFor(() => expect(start()).toBeEnabled());
  fireEvent.click(start());
  await waitFor(() => expect(native.probeSelectedMediaAssetVersion).toHaveBeenCalledTimes(1));
  const nextProject = `prj_${"9".repeat(32)}`;
  items.push(videoAsset("8", nextProject));
  model.projectId = nextProject;
  view.rerender(<AssetsPage />);
  await screen.findByRole("heading", { name: "视频探测 · video-8.mp4" });
  saved.set(items[0]!.latest_version.id, probeReceipt());
  await act(async () => {
    finish({ kind: "PROBED", receipt: probeReceipt() });
  });
  expect(screen.queryByText(/已验证探测：/)).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "视频探测 · video-8.mp4" })).toBeInTheDocument();
  expect(native.probeSelectedMediaAssetVersion).toHaveBeenCalledExactlyOnceWith(
    probeProjectId,
    items[0]!.id,
    items[0]!.latest_version.id,
  );
});

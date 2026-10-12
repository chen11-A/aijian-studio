import { webcrypto } from "node:crypto";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AijianDesktopBridge } from "../api/studio";
import type {
  AudioAssetProbeWriteResult,
  AudioAssetProbeReadResult,
} from "./adapters/audioAssetProbe";
import { noProbe, probeProjectId } from "../test/mediaAssetProbeFixture";
import { audioReceipt, audioAsset } from "../test/audioAssetProbeFixture";
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
  const items = [audioAsset(), audioAsset("3")];
  const saved = new Map<string, ReturnType<typeof audioReceipt>>();
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
    getAudioAssetProbeEvidence: vi.fn(
      async (_p: string, _a: string, v: string): Promise<AudioAssetProbeReadResult> =>
        saved.has(v) ? { kind: "FOUND", receipt: saved.get(v)! } : noProbe,
    ),
    probeSelectedAudioAssetVersion: vi.fn(
      async (_p: string, a: string, v: string): Promise<AudioAssetProbeWriteResult> => {
        const receipt = audioReceipt(items.find((asset) => asset.id === a)!);
        saved.set(v, receipt);
        return { kind: "PROBED", receipt };
      },
    ),
  };
  window.aijian = native as unknown as AijianDesktopBridge;
  return { native, items, saved };
}
const start = () => screen.getByRole("button", { name: "探测选中音频版本" });
const refresh = () => screen.getByRole("button", { name: "重新读取此版本探测记录" });
beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, "crypto", { configurable: true, value: webcrypto });
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
    expect(native.probeSelectedAudioAssetVersion).not.toHaveBeenCalled();
    fireEvent.click(start());
    await screen.findByText(/源音频：32000 Hz · 2 声道 · 16000 样本/);
    expect(native.probeSelectedAudioAssetVersion).toHaveBeenCalledExactlyOnceWith(
      probeProjectId,
      items[0]!.id,
      items[0]!.latest_version.id,
    );
    expect(native.getAudioAssetProbeEvidence).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/样本入点按源采样率换算/)).toBeInTheDocument();
    expect(screen.getByText(/不能证明对白内容/)).toBeInTheDocument();
    expect(start()).toBeDisabled();
  });
  it("preserves a specific selected version and blocks duplicate clicks while native probe is pending", async () => {
    const { native, items } = setup();
    let finish!: (value: AudioAssetProbeWriteResult) => void;
    native.probeSelectedAudioAssetVersion.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<AssetsPage />);
    await waitFor(() => expect(start()).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "选择 录音-3.wav" }));
    await waitFor(() => expect(start()).toBeEnabled());
    fireEvent.click(start());
    fireEvent.click(start());
    await waitFor(() => expect(native.probeSelectedAudioAssetVersion).toHaveBeenCalledTimes(1));
    expect(native.probeSelectedAudioAssetVersion).toHaveBeenCalledWith(
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
    const wrong = audioReceipt(audioAsset("3"));
    native.probeSelectedAudioAssetVersion.mockResolvedValue({ kind: "PROBED", receipt: wrong });
    native.getAudioAssetProbeEvidence.mockResolvedValue({ kind: "FOUND", receipt: wrong });
    fireEvent.click(start());
    await screen.findByText(/探测结果不确定/);
    expect(screen.queryByText(/源音频：/)).not.toBeInTheDocument();
    expect(start()).toBeDisabled();
    fireEvent.click(refresh());
    await waitFor(() => expect(refresh()).toBeEnabled());
    expect(native.probeSelectedAudioAssetVersion).toHaveBeenCalledTimes(1);
  });
  it("keeps unknown-plus-404 locked after leaving and reopening, requiring explicit user recovery", async () => {
    const { native } = setup();
    native.probeSelectedAudioAssetVersion.mockResolvedValue({ kind: "PROBE_UNKNOWN" });
    const view = render(<AssetsPage />);
    await waitFor(() => expect(start()).toBeEnabled());
    fireEvent.click(start());
    await screen.findByText(/探测结果不确定/);
    view.unmount();
    render(<AssetsPage />);
    await screen.findByText(/未查到记录不代表旧请求已结束/);
    expect(start()).toBeDisabled();
    expect(native.probeSelectedAudioAssetVersion).toHaveBeenCalledTimes(1);
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
    expect(native.probeSelectedAudioAssetVersion).toHaveBeenCalledTimes(1);
  });
  it("does not show a late result from a previous selection in the new selected video", async () => {
    const { native, items, saved } = setup();
    let finish!: (value: AudioAssetProbeWriteResult) => void;
    native.probeSelectedAudioAssetVersion.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<AssetsPage />);
    await waitFor(() => expect(start()).toBeEnabled());
    fireEvent.click(start());
    await waitFor(() => expect(native.probeSelectedAudioAssetVersion).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "选择 录音-3.wav" }));
    await waitFor(() => expect(start()).toBeEnabled());
    saved.set(items[0]!.latest_version.id, audioReceipt());
    await act(async () => {
      finish({ kind: "PROBED", receipt: audioReceipt() });
    });
    expect(screen.getByRole("heading", { name: "音频探测 · 录音-3.wav" })).toBeInTheDocument();
    expect(screen.queryByText(/源音频：/)).not.toBeInTheDocument();
    expect(start()).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "选择 录音-2.wav" }));
    await screen.findByText(/源音频：/);
    expect(native.probeSelectedAudioAssetVersion).toHaveBeenCalledTimes(1);
  });
  it("keeps a missing runtime capability disabled while displaying existing version evidence", async () => {
    const { native, saved, items } = setup();
    saved.set(items[0]!.latest_version.id, audioReceipt());
    native.getMediaToolchainStatus.mockResolvedValue({ kind: "REMOTE_UNKNOWN" });
    render(<AssetsPage />);
    await screen.findByText(/源音频：/);
    expect(start()).toBeDisabled();
    expect(screen.getByText(/当前媒体工具未通过校验/)).toBeInTheDocument();
    expect(native.probeSelectedAudioAssetVersion).not.toHaveBeenCalled();
  });
});

it("keeps a late probe attached to its original project after project navigation", async () => {
  const { native, items, saved } = setup();
  let finish!: (value: AudioAssetProbeWriteResult) => void;
  native.probeSelectedAudioAssetVersion.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(<AssetsPage />);
  await waitFor(() => expect(start()).toBeEnabled());
  fireEvent.click(start());
  await waitFor(() => expect(native.probeSelectedAudioAssetVersion).toHaveBeenCalledTimes(1));
  const nextProject = `prj_${"9".repeat(32)}`;
  items.push(audioAsset("8", nextProject));
  model.projectId = nextProject;
  view.rerender(<AssetsPage />);
  await screen.findByRole("heading", { name: "音频探测 · 录音-8.wav" });
  saved.set(items[0]!.latest_version.id, audioReceipt());
  await act(async () => {
    finish({ kind: "PROBED", receipt: audioReceipt() });
  });
  expect(screen.queryByText(/源音频：/)).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "音频探测 · 录音-8.wav" })).toBeInTheDocument();
  expect(native.probeSelectedAudioAssetVersion).toHaveBeenCalledExactlyOnceWith(
    probeProjectId,
    items[0]!.id,
    items[0]!.latest_version.id,
  );
});

it("keeps saved audio timing readable but blocks a new probe when the original is missing", async () => {
  const { native, items, saved } = setup();
  saved.set(items[0]!.latest_version.id, audioReceipt(items[0]!));
  Object.assign(items[0]!.latest_version, { availability: "MISSING" });
  render(<AssetsPage />);
  await screen.findByText(/源音频：/);
  expect(start()).toBeDisabled();
  expect(native.probeSelectedAudioAssetVersion).not.toHaveBeenCalled();
  expect(screen.getByText(/原件缺失或损坏/)).toBeInTheDocument();
});

it("reads source timing for a historical audio version while the catalog head is newer", async () => {
  const { native, items, saved } = setup();
  const original = items[0]!;
  const oldVersion = original.latest_version;
  saved.set(oldVersion.id, audioReceipt(original));
  const newer = {
    ...oldVersion,
    id: `asv_${"a".repeat(32)}`,
    ordinal: 2,
    filename: "audio-next.wav",
    sha256: "a".repeat(64),
  };
  Object.assign(original, { latest_version: newer, versions: [oldVersion, newer] });
  render(<AssetsPage />);
  await screen.findByRole("heading", { name: "音频探测 · audio-next.wav" });
  fireEvent.change(screen.getByLabelText("查看素材版本"), { target: { value: oldVersion.id } });
  await screen.findByText(/源音频：32000 Hz/);
  expect(native.getAudioAssetProbeEvidence).toHaveBeenCalledWith(
    probeProjectId,
    original.id,
    oldVersion.id,
  );
  expect(native.probeSelectedAudioAssetVersion).not.toHaveBeenCalled();
  expect(screen.getByLabelText("查看素材版本")).toHaveValue(oldVersion.id);
});

import { webcrypto } from "node:crypto";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NativePreviewPlanResult } from "@aijian/contracts/native-preview-plan";
import { NativeAssemblyPreview } from "./NativeAssemblyPreview";
import { previewFixture, previewSaved, rehashPreview } from "../test/nativePreviewFixture";
import { verifyNativePreviewPlan } from "./adapters/nativePreviewPlan";
import type {
  MediaPreviewResult,
  MediaPreviewSessionGateway,
  MediaPreviewStatus,
} from "./adapters/mediaPreviewSession";
import { createStudioTransport } from "../api/studio";
import type { AijianDesktopBridge } from "../api/studio";
import { EpisodeMediaAssemblyPanel } from "./EpisodeMediaAssemblyPanel";
import type { AssetLibraryGateway } from "./adapters/assetLibrary";

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, "crypto", { configurable: true, value: webcrypto });
});
afterEach(() => vi.restoreAllMocks());
function setup() {
  const receipt = previewFixture(),
    saved = previewSaved(receipt);
  const planGateway = {
    getNativeMediaPreviewPlan: vi
      .fn<() => Promise<NativePreviewPlanResult>>()
      .mockResolvedValue({ kind: "READY", receipt }),
  };
  const unavailable = { kind: "UNAVAILABLE", reason: "NATIVE_HOST_NOT_INSTALLED" } as const;
  const sessionGateway: MediaPreviewSessionGateway = {
    openMediaPreviewSession: vi.fn().mockResolvedValue(unavailable),
    playMediaPreviewSession: vi.fn(),
    pauseMediaPreviewSession: vi.fn(),
    seekMediaPreviewSession: vi.fn(),
    readMediaPreviewSessionStatus: vi.fn().mockResolvedValue(unavailable),
    closeMediaPreviewSession: vi.fn().mockResolvedValue({ kind: "UNKNOWN" }),
  };
  const props = {
    projectId: saved.content.project_id,
    episodeId: saved.content.episode_id,
    savedVersion: saved,
    eligible: true,
    planGateway,
    sessionGateway,
  };
  return { receipt, saved, planGateway, sessionGateway, props };
}
const check = () => screen.getByRole("button", { name: "核对原生预览计划" });
const open = () => screen.getByRole("button", { name: "打开本地预览" });
async function readySession() {
  const fixture = setup();
  let status!: MediaPreviewStatus;
  vi.mocked(fixture.sessionGateway.openMediaPreviewSession).mockImplementation(async (command) => {
    status = {
      session_id: "pvs_" + "c".repeat(32),
      generation: 1,
      open_request_id: command.open_request_id,
      identity: command.identity,
      state: "READY_PAUSED",
      transport: { kind: "NATIVE_SDL2_WINDOW", embedded: false },
      clock: {
        shown_frame_index: 0,
        audio_output_sample_index: null,
        audio_sample_rate_hz: null,
        authority: "SHOWN_FRAME",
      },
      expires_at: "2026-10-11T10:00:00Z",
      failure: null,
    };
    return { kind: "STATUS", status };
  });
  const view = render(<NativeAssemblyPreview {...fixture.props} />);
  fireEvent.click(check());
  await waitFor(() => expect(open()).toBeEnabled(), { timeout: 5_000 });
  fireEvent.click(open());
  await waitFor(() => expect(screen.getByRole("button", { name: "播放" })).toBeEnabled());
  return { ...fixture, view, status };
}
describe("saved assembly native preview entry", () => {
  it.each(["query", "play"])(
    "discards a late %s result after the assembly becomes ineligible",
    async (kind) => {
      const { props, sessionGateway: api, status, view } = await readySession();
      let complete!: (result: MediaPreviewResult) => void;
      const delayed = () =>
        new Promise<MediaPreviewResult>((resolve) => {
          complete = resolve;
        });
      if (kind === "query")
        vi.mocked(api.readMediaPreviewSessionStatus).mockImplementation(delayed);
      else vi.mocked(api.playMediaPreviewSession).mockImplementation(delayed);
      fireEvent.click(
        screen.getByRole("button", { name: kind === "query" ? "查询原会话" : "播放" }),
      );
      view.rerender(<NativeAssemblyPreview {...props} eligible={false} />);
      await act(async () => complete({ kind: "STATUS", status: { ...status, state: "PLAYING" } }));
      expect(open()).toBeDisabled();
      expect(screen.getByRole("button", { name: "暂停" })).toBeDisabled();
      expect(screen.queryByText(/已读回原生预览状态 PLAYING/)).not.toBeInTheDocument();
      expect(api.openMediaPreviewSession).toHaveBeenCalledTimes(1);
    },
  );
  it("retains an UNKNOWN open after a thrown host request without automatically resending", async () => {
    const { props, sessionGateway: api } = setup();
    vi.mocked(api.openMediaPreviewSession).mockRejectedValue(new Error("host lost"));
    render(<NativeAssemblyPreview {...props} />);
    fireEvent.click(check());
    await waitFor(() => expect(open()).toBeEnabled(), { timeout: 5_000 });
    fireEvent.click(open());
    await screen.findByText(/预览命令结果未知/);
    expect(open()).toBeDisabled();
    expect(screen.getByRole("button", { name: "查询原会话" })).toBeEnabled();
    expect(api.openMediaPreviewSession).toHaveBeenCalledTimes(1);
  });
  it("retains the original session after a thrown playback command", async () => {
    const { sessionGateway: api, status } = await readySession();
    vi.mocked(api.playMediaPreviewSession).mockRejectedValue(new Error("host lost"));
    fireEvent.click(screen.getByRole("button", { name: "播放" }));
    await screen.findByText(/预览命令结果未知/);
    expect(screen.getByText(status.open_request_id)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "播放" })).toBeDisabled();
    expect(api.playMediaPreviewSession).toHaveBeenCalledTimes(1);
  });
  it("uses exact session commands for play, pause, seek and close before allowing a new session", async () => {
    const { sessionGateway: api, status } = await readySession();
    vi.mocked(api.playMediaPreviewSession).mockResolvedValue({
      kind: "STATUS",
      status: { ...status, state: "PLAYING" },
    });
    fireEvent.click(screen.getByRole("button", { name: "播放" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "暂停" })).toBeEnabled());
    vi.mocked(api.pauseMediaPreviewSession).mockResolvedValue({
      kind: "STATUS",
      status: { ...status, state: "PAUSED" },
    });
    fireEvent.click(screen.getByRole("button", { name: "暂停" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "播放" })).toBeEnabled());
    fireEvent.change(screen.getByLabelText("定位到帧"), { target: { value: "1" } });
    vi.mocked(api.seekMediaPreviewSession).mockResolvedValue({
      kind: "STATUS",
      status: { ...status, state: "PAUSED", clock: { ...status.clock, shown_frame_index: 1 } },
    });
    fireEvent.click(screen.getByRole("button", { name: "精确定位" }));
    await waitFor(() =>
      expect(api.seekMediaPreviewSession).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ session_id: status.session_id, generation: 1, frame_index: 1 }),
      ),
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "查询原会话" })).toBeEnabled());
    vi.mocked(api.readMediaPreviewSessionStatus).mockResolvedValue({
      kind: "STATUS",
      status: { ...status, state: "PAUSED" },
    });
    fireEvent.click(screen.getByRole("button", { name: "查询原会话" }));
    await waitFor(() =>
      expect(api.readMediaPreviewSessionStatus).toHaveBeenCalledExactlyOnceWith({
        session_id: status.session_id,
        generation: 1,
      }),
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "关闭会话" })).toBeEnabled());
    vi.mocked(api.closeMediaPreviewSession).mockResolvedValue({
      kind: "STATUS",
      status: { ...status, state: "CLOSED" },
    });
    fireEvent.click(screen.getByRole("button", { name: "关闭会话" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "新会话" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "新会话" }));
    expect(open()).toBeEnabled();
    expect(api.openMediaPreviewSession).toHaveBeenCalledTimes(1);
    expect(api.playMediaPreviewSession).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        session_id: status.session_id,
        generation: 1,
        command_id: expect.stringMatching(/^pvc_/),
      }),
    );
  });
  it.each(["null", "frame", "throw", "stale"])(
    "locks controls after a %s session reply without reopening",
    async (fault) => {
      const { sessionGateway: api, status } = await readySession();
      if (fault === "throw")
        vi.mocked(api.readMediaPreviewSessionStatus).mockRejectedValue(new Error("offline"));
      else
        vi.mocked(api.readMediaPreviewSessionStatus).mockResolvedValue(
          fault === "null"
            ? (null as never)
            : fault === "stale"
              ? { kind: "STALE_SESSION" }
              : {
                  kind: "STATUS",
                  status: {
                    ...status,
                    clock: { ...status.clock, shown_frame_index: Number.MAX_SAFE_INTEGER },
                  },
                },
        );
      fireEvent.click(screen.getByRole("button", { name: "查询原会话" }));
      await screen.findByText(
        fault === "null"
          ? /预览回执结构不符/
          : fault === "frame"
            ? /预览回执身份、generation/
            : fault === "stale"
              ? /预览会话已过期/
              : /预览命令结果未知/,
      );
      expect(screen.getByRole("button", { name: "播放" })).toBeDisabled();
      expect(open()).toBeDisabled();
      expect(api.openMediaPreviewSession).toHaveBeenCalledTimes(1);
      expect(api.playMediaPreviewSession).not.toHaveBeenCalled();
    },
  );
  it("does not send a control command when secure command IDs are unavailable", async () => {
    const { sessionGateway: api } = await readySession();
    const descriptor = Object.getOwnPropertyDescriptor(window, "crypto")!;
    try {
      Object.defineProperty(window, "crypto", { configurable: true, value: {} });
      fireEvent.click(screen.getByRole("button", { name: "播放" }));
      await screen.findByText("无法生成原生命令 ID；未发送播放控制。");
      expect(api.playMediaPreviewSession).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, "crypto", descriptor);
    }
  });
  it("blocks preview startup when its intent cannot be durably recorded", async () => {
    const { props, sessionGateway } = setup();
    render(<NativeAssemblyPreview {...props} />);
    fireEvent.click(check());
    await waitFor(() => expect(open()).toBeEnabled(), { timeout: 5_000 });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    fireEvent.click(open());
    await screen.findByText("预览启动意图未能持久保存；未调用原生宿主。");
    expect(sessionGateway.openMediaPreviewSession).not.toHaveBeenCalled();
    expect(open()).toBeDisabled();
  });
  it("does not open a preview when local session storage cannot be read", async () => {
    const { props, sessionGateway } = setup();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("unavailable");
    });
    render(<NativeAssemblyPreview {...props} />);
    await screen.findByText("本地会话记录不可用；预览启动已阻止。");
    expect(open()).toBeDisabled();
    expect(sessionGateway.openMediaPreviewSession).not.toHaveBeenCalled();
  });
  it("requires explicit plan check, then separate explicit open and truthful uninstalled receipt", async () => {
    const { props, planGateway, sessionGateway, saved } = setup();
    render(<NativeAssemblyPreview {...props} />);
    expect(open()).toBeDisabled();
    expect(planGateway.getNativeMediaPreviewPlan).not.toHaveBeenCalled();
    fireEvent.click(check());
    await waitFor(() => expect(open()).toBeEnabled(), { timeout: 5_000 });
    expect(planGateway.getNativeMediaPreviewPlan).toHaveBeenCalledExactlyOnceWith(
      props.projectId,
      props.episodeId,
      saved.version_id,
    );
    expect(sessionGateway.openMediaPreviewSession).not.toHaveBeenCalled();
    fireEvent.click(open());
    await screen.findByText("本机未安装经核验的 MLT 预览宿主。");
    expect(sessionGateway.openMediaPreviewSession).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "播放" })).toBeDisabled();
  });
  it("blocks unsaved inputs and invalidates an earlier plan until explicitly rechecked", async () => {
    const { props, planGateway } = setup();
    const view = render(<NativeAssemblyPreview {...props} />);
    fireEvent.click(check());
    await waitFor(() => expect(open()).toBeEnabled(), { timeout: 5_000 });
    view.rerender(<NativeAssemblyPreview {...props} eligible={false} />);
    expect(open()).toBeDisabled();
    expect(check()).toBeDisabled();
    view.rerender(<NativeAssemblyPreview {...props} />);
    await waitFor(() => expect(check()).toBeEnabled());
    expect(open()).toBeDisabled();
    expect(planGateway.getNativeMediaPreviewPlan).toHaveBeenCalledTimes(1);
  });
  it.each(["hash", "foreign", "artifact", "revision"])(
    "refuses %s and never invokes native open",
    async (fault) => {
      const { props, receipt, planGateway, sessionGateway } = setup();
      if (fault === "hash") receipt.data.plan_hash = "sha256:" + "0".repeat(64);
      if (fault === "foreign") receipt.data.plan.source.episode_id = "ep_" + "f".repeat(32);
      if (fault === "artifact")
        receipt.data.plan.source.assembly_artifact_id = "art_" + "f".repeat(32);
      if (fault === "revision") receipt.data.plan.source.assembly_head_revision = 99;
      if (fault !== "hash") rehashPreview(receipt);
      planGateway.getNativeMediaPreviewPlan.mockResolvedValue({ kind: "READY", receipt });
      render(<NativeAssemblyPreview {...props} />);
      fireEvent.click(check());
      await screen.findByText(/计划回执未知或不匹配/);
      expect(open()).toBeDisabled();
      expect(sessionGateway.openMediaPreviewSession).not.toHaveBeenCalled();
    },
  );
  it("retains earlier evidence under UNKNOWN while controls stay closed and no automatic reread occurs", async () => {
    const { props, planGateway } = setup();
    render(<NativeAssemblyPreview {...props} />);
    fireEvent.click(check());
    await waitFor(() => expect(open()).toBeEnabled(), { timeout: 5_000 });
    planGateway.getNativeMediaPreviewPlan.mockResolvedValueOnce({ kind: "UNKNOWN" });
    fireEvent.click(check());
    await screen.findByText(/先前记录，当前未确认/);
    expect(open()).toBeDisabled();
    expect(planGateway.getNativeMediaPreviewPlan).toHaveBeenCalledTimes(2);
  });
  it.each(["project", "episode", "version"])("discards late %s A→B→A receipts", async (scope) => {
    const { props, planGateway } = setup();
    let finish!: (result: NativePreviewPlanResult) => void;
    planGateway.getNativeMediaPreviewPlan.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(<NativeAssemblyPreview {...props} />);
    fireEvent.click(check());
    const other = { ...props };
    if (scope === "project") other.projectId = "prj_" + "f".repeat(32);
    if (scope === "episode") other.episodeId = "ep_" + "f".repeat(32);
    if (scope === "version")
      other.savedVersion = { ...props.savedVersion, version_id: "ver_" + "f".repeat(32) };
    view.rerender(<NativeAssemblyPreview {...other} />);
    view.rerender(<NativeAssemblyPreview {...props} />);
    await act(async () => finish({ kind: "READY", receipt: previewFixture() }));
    expect(open()).toBeDisabled();
    expect(planGateway.getNativeMediaPreviewPlan).toHaveBeenCalledTimes(1);
  });
  it("preserves UNKNOWN open marker when status says only that the host is uninstalled", async () => {
    const { props, sessionGateway } = setup();
    const request = "pvo_" + "a".repeat(32),
      key = `aivora:mlt-preview:open:${props.projectId}:${props.episodeId}`;
    localStorage.setItem(key, request);
    render(<NativeAssemblyPreview {...props} />);
    fireEvent.click(check());
    await waitFor(() => expect(screen.getByRole("button", { name: "查询原会话" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "查询原会话" }));
    await screen.findByText("本机未安装经核验的 MLT 预览宿主。");
    expect(localStorage.getItem(key)).toBe(request);
    expect(open()).toBeDisabled();
    expect(sessionGateway.openMediaPreviewSession).not.toHaveBeenCalled();
    expect(sessionGateway.readMediaPreviewSessionStatus).toHaveBeenCalledWith({
      open_request_id: request,
    });
  });
  it("requires every session bridge method and provides no web fallback", () => {
    const { planGateway, sessionGateway } = setup();
    window.aijian = { ...planGateway, ...sessionGateway } as unknown as AijianDesktopBridge;
    expect(createStudioTransport().nativePreviewPlan).toBeDefined();
    expect(createStudioTransport().mediaPreviewSession).toBeDefined();
    delete window.aijian.closeMediaPreviewSession;
    expect(createStudioTransport().mediaPreviewSession).toBeUndefined();
    delete window.aijian;
    expect(createStudioTransport().nativePreviewPlan).toBeUndefined();
    expect(createStudioTransport().mediaPreviewSession).toBeUndefined();
  });
  it("does not let a mutated receipt after digest begins replace the captured plan", async () => {
    const receipt = previewFixture();
    const promise = verifyNativePreviewPlan(receipt, previewSaved());
    receipt.data.plan_hash = "sha256:" + "0".repeat(64);
    expect(await promise).not.toBeNull();
  });
  it("mounts the existing native panel in the actual assembly page through the desktop bridge", async () => {
    const { props, planGateway, sessionGateway, saved } = setup();
    window.aijian = { ...planGateway, ...sessionGateway } as unknown as AijianDesktopBridge;
    const media = saved.content.visual_segments[0]!.media;
    const version = {
      id: media.asset_version_id,
      ordinal: 1,
      filename: "synthetic.mp4",
      kind: "video",
      mime_type: "video/mp4",
      byte_size: 100,
      sha256: media.sha256,
      rights_status: "PENDING_REVIEW",
      source_kind: "LOCAL_IMPORT",
      technical_metadata: {},
      created_at: "2026-10-11T00:00:00Z",
      availability: "VERIFIED",
    };
    const assets = {
      listProjectMediaAssets: vi.fn().mockResolvedValue({
        kind: "LISTED",
        receipt: {
          data: [
            {
              id: media.asset_id,
              project_id: props.projectId,
              created_at: version.created_at,
              latest_version: version,
              versions: [version],
              episode_references: [],
            },
          ],
          request_id: "synthetic-assets",
        },
      }),
    } as unknown as AssetLibraryGateway;
    const assembly = {
      readLatest: vi.fn().mockResolvedValue({
        kind: "FOUND",
        receipt: { data: saved, request_id: "synthetic-assembly" },
      }),
      createVersion: vi.fn(),
    };
    render(
      <EpisodeMediaAssemblyPanel
        projectId={props.projectId}
        episodeId={props.episodeId}
        assets={assets}
        assembly={assembly}
        setNavigationGuard={vi.fn()}
      />,
    );
    await waitFor(() => expect(check()).toBeEnabled());
    expect(planGateway.getNativeMediaPreviewPlan).not.toHaveBeenCalled();
    fireEvent.click(check());
    await waitFor(() => expect(open()).toBeEnabled(), { timeout: 5_000 });
    expect(screen.getByRole("region", { name: "MLT 原生预览会话" })).toBeInTheDocument();
    expect(assembly.createVersion).not.toHaveBeenCalled();
    delete window.aijian;
  });
  it("reconciles UNKNOWN playback by original open ID instead of its obsolete generation", async () => {
    const { props, sessionGateway } = setup();
    let observed!: MediaPreviewStatus;
    vi.mocked(sessionGateway.openMediaPreviewSession).mockImplementationOnce(async (command) => {
      observed = {
        session_id: "pvs_" + "c".repeat(32),
        generation: 1,
        open_request_id: command.open_request_id,
        identity: command.identity,
        state: "READY_PAUSED",
        transport: { kind: "NATIVE_SDL2_WINDOW", embedded: false },
        clock: {
          shown_frame_index: 0,
          audio_output_sample_index: null,
          audio_sample_rate_hz: null,
          authority: "SHOWN_FRAME",
        },
        expires_at: "2026-10-11T10:00:00Z",
        failure: null,
      };
      return { kind: "STATUS", status: observed };
    });
    vi.mocked(sessionGateway.playMediaPreviewSession).mockResolvedValueOnce({ kind: "UNKNOWN" });
    render(<NativeAssemblyPreview {...props} />);
    fireEvent.click(check());
    await waitFor(() => expect(open()).toBeEnabled(), { timeout: 5_000 });
    fireEvent.click(open());
    await waitFor(() => expect(screen.getByRole("button", { name: "播放" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "播放" }));
    await screen.findByText(/预览命令结果未知/);
    expect(screen.getByRole("button", { name: "播放" })).toBeDisabled();
    vi.mocked(sessionGateway.readMediaPreviewSessionStatus).mockResolvedValueOnce({
      kind: "STATUS",
      status: { ...observed, generation: 2, state: "PLAYING" },
    });
    fireEvent.click(screen.getByRole("button", { name: "查询原会话" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "暂停" })).toBeEnabled());
    expect(sessionGateway.readMediaPreviewSessionStatus).toHaveBeenCalledExactlyOnceWith({
      open_request_id: observed.open_request_id,
    });
    expect(sessionGateway.playMediaPreviewSession).toHaveBeenCalledTimes(1);
  });
});

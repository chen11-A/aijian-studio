import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DraftExportPanel } from "./DraftExportPanel";
import type { AijianDesktopBridge } from "../api/studio";
import type { MediaToolchainStatus } from "./mediaToolchainContract";
import {
  draftExportProblem,
  draftExportFailure,
  type DraftExportGateway,
  type DraftExportJob,
  type DraftExportCommand,
} from "./adapters/draftExport";
import {
  staticAnimaticContent,
  type AssemblyReceipt,
  type AssemblyVersion,
  type EpisodeMediaAssemblyGateway,
} from "./adapters/episodeMediaAssembly";
const mediaStatus: MediaToolchainStatus = {
  schema_version: 1, state: "AVAILABLE", source: "EXTERNAL",
  profile_id: "windows-x86_64-gyan-full-8.1.2-dev", version: "8.1.2", directory: "C:\\Tools\\bin",
  diagnostic: "Verified", can_probe: true, can_preview: true, can_draft_export: true,
  formal_release_approved: false,
};
function setMediaStatus(status: MediaToolchainStatus) {
  window.aijian = {
    getMediaToolchainStatus: vi.fn().mockResolvedValue({ kind: "STATUS", status }),
    selectMediaToolchain: vi.fn(), clearMediaToolchain: vi.fn(),
  } as unknown as AijianDesktopBridge;
}
const projectId = `prj_${"1".repeat(32)}`,
  episodeId = `ep_${"2".repeat(32)}`;
const media = {
  asset_id: `asset_${"3".repeat(32)}`,
  asset_version_id: `asv_${"4".repeat(32)}`,
  sha256: "5".repeat(64),
};
const saved: AssemblyReceipt = {
  request_id: "assembly-draft-test",
  data: {
    artifact_id: `art_${"6".repeat(32)}`,
    version_id: `ver_${"7".repeat(32)}`,
    content_hash: `sha256:${"8".repeat(64)}`,
    parent_version_id: null,
    head_revision: 1,
    content: staticAnimaticContent(projectId, episodeId, [{ media, frames: 50 }]),
    media_checks: [
      {
        media,
        kind: "image",
        availability: "VERIFIED",
        technical_status: "STILL_HEADER_ONLY",
        rights_status: "PENDING_REVIEW",
      },
    ],
    playback_status: "DRAFT_STATIC_ANIMATIC",
    export_status: "NO_EXPORT_CLAIM",
  },
};
function jobFor(command: DraftExportCommand, patch: Partial<DraftExportJob> = {}): DraftExportJob {
  return {
    ...command,
    project_id: projectId,
    episode_id: episodeId,
    status: "QUEUED",
    total_frames: 50,
    progress_frames: 0,
    output_filename: "test-DRAFT.mp4",
    output_path: null,
    output_sha256: null,
    output_bytes: null,
    error_code: null,
    error_message: null,
    created_at: "2026-10-08T00:00:00Z",
    updated_at: "2026-10-08T00:00:00Z",
    toolchain_profile_id: "pinned",
    draft: true,
    ...patch,
  };
}
function setup() {
  let jobs: DraftExportJob[] = [];
  const assembly: EpisodeMediaAssemblyGateway = {
    readLatest: vi.fn().mockResolvedValue({ kind: "FOUND", receipt: structuredClone(saved) }),
    createVersion: vi.fn(),
  };
  const exports: DraftExportGateway = {
    list: vi.fn<DraftExportGateway["list"]>(async () => ({
      kind: "LISTED",
      receipt: { data: { items: jobs }, request_id: "draft-test" },
    })),
    get: vi.fn<DraftExportGateway["get"]>(async (_p, _e, id) => {
      const job = jobs.find((item) => item.operation_id === id);
      return job
        ? { kind: "FOUND", receipt: { data: job, request_id: "draft-test" } }
        : { kind: "NOT_FOUND", request_id: "draft-test" };
    }),
    createFromPicker: vi.fn<DraftExportGateway["createFromPicker"]>(async (_p, _e, command) => {
      const job = jobFor(command);
      jobs = [job];
      return { kind: "FOUND", receipt: { data: job, request_id: "draft-test" } };
    }),
    cancel: vi.fn<DraftExportGateway["cancel"]>(async (_p, _e, id) => {
      jobs = jobs.map((item) =>
        item.operation_id === id ? { ...item, status: "CANCELLED" } : item,
      );
      return { kind: "FOUND", receipt: { data: jobs[0]!, request_id: "draft-test" } };
    }),
  };
  return {
    assembly,
    exports,
    setJobs: (next: DraftExportJob[]) => {
      jobs = next;
    },
    jobs: () => jobs,
  };
}
const submit = () => screen.getByRole("button", { name: "选择保存位置并导出草稿 MP4" });
async function ready() {
  await screen.findByText(/已读回保存版本/);
  await waitFor(() => expect(screen.getByText("尚无草稿导出记录。")).toBeInTheDocument());
}
function declareRights() {
  fireEvent.click(screen.getByRole("checkbox"));
}
beforeEach(() => { localStorage.clear(); setMediaStatus(mediaStatus); });
afterEach(() => {
  cleanup();
  delete window.aijian;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("real saved-assembly DRAFT export", () => {
  it("disables encoding without verified runtime capability while preserving saved input and history reads", async () => {
    setMediaStatus({ ...mediaStatus, state: "NOT_CONFIGURED", source: "NONE", directory: null,
      profile_id: null, version: null, can_probe: false, can_preview: false, can_draft_export: false });
    const state = setup();
    render(<DraftExportPanel projectId={projectId} episodeId={episodeId} {...state} />);
    await ready();
    expect(screen.getByText(/尚未配置媒体工具/)).toBeInTheDocument();
    expect(submit()).toBeDisabled();
    expect(screen.getByRole("checkbox")).toBeDisabled();
    fireEvent.click(submit());
    expect(state.exports.createFromPicker).not.toHaveBeenCalled();
    expect(state.assembly.readLatest).toHaveBeenCalled();
    expect(state.exports.list).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "重新读取保存版本与任务" })).toBeEnabled();
  });
  it("requires explicit rights and sends exact saved identity without a destination path", async () => {
    const env = setup();
    render(<DraftExportPanel projectId={projectId} episodeId={episodeId} {...env} />);
    await ready();
    expect(submit()).toBeDisabled();
    declareRights();
    expect(submit()).toBeEnabled();
    fireEvent.click(submit());
    await screen.findByText("排队中 · DRAFT");
    expect(env.exports.createFromPicker).toHaveBeenCalledTimes(1);
    expect(vi.mocked(env.exports.createFromPicker).mock.calls[0]![2]).toEqual({
      operation_id: expect.stringMatching(/^dmp_[0-9a-f]{32}$/),
      assembly_version_id: saved.data.version_id,
      assembly_content_hash: saved.data.content_hash,
      rights_declaration: "OWNED_OR_SYNTHETIC",
    });
    expect(screen.queryByText(/草稿文件已验证并保存/)).not.toBeInTheDocument();
    expect(submit()).toBeDisabled();
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "0");
  });
  it("reopens durable jobs, displays verified output only on success, and cancels via operation id", async () => {
    const env = setup();
    const view = render(<DraftExportPanel projectId={projectId} episodeId={episodeId} {...env} />);
    await ready();
    declareRights();
    fireEvent.click(submit());
    await screen.findByText("排队中 · DRAFT");
    const original = env.jobs()[0]!;
    fireEvent.click(screen.getByRole("button", { name: "取消此草稿任务" }));
    await screen.findByText("已取消 · DRAFT");
    expect(env.exports.cancel).toHaveBeenCalledWith(projectId, episodeId, original.operation_id);
    view.unmount();
    env.setJobs([{ ...original, status: "VERIFYING", progress_frames: 50 }]);
    const second = render(
      <DraftExportPanel projectId={projectId} episodeId={episodeId} {...env} />,
    );
    await screen.findByText("正在校验 MP4 文件 · DRAFT");
    expect(screen.queryByText(/保存位置：/)).not.toBeInTheDocument();
    second.unmount();
    env.setJobs([
      {
        ...original,
        status: "SUCCEEDED",
        progress_frames: 50,
        output_path: "/tmp/test-DRAFT.mp4",
        output_sha256: "a".repeat(64),
        output_bytes: 1024,
      },
    ]);
    render(<DraftExportPanel projectId={projectId} episodeId={episodeId} {...env} />);
    await screen.findByText("草稿文件已验证并保存 · DRAFT");
    expect(screen.getByText("保存位置：/tmp/test-DRAFT.mp4")).toBeInTheDocument();
    expect(screen.getByText("已验证大小：1024 字节")).toBeInTheDocument();
  });
  it("keeps a lost submit reply recoverable across remount without resubmitting", async () => {
    const env = setup();
    vi.mocked(env.exports.createFromPicker).mockImplementation(async (_p, _e, command) => {
      env.setJobs([jobFor(command)]);
      return { kind: "REMOTE_UNKNOWN" };
    });
    const first = render(<DraftExportPanel projectId={projectId} episodeId={episodeId} {...env} />);
    await ready();
    declareRights();
    fireEvent.click(submit());
    await screen.findByText(/提交结果未知/);
    expect(submit()).toBeDisabled();
    first.unmount();
    render(<DraftExportPanel projectId={projectId} episodeId={episodeId} {...env} />);
    await screen.findByText("排队中 · DRAFT");
    expect(env.exports.createFromPicker).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(`aivora:draft-mp4:pending:${projectId}:${episodeId}`)).toBeNull();
  });
  it("cancelling Save creates no task and allows choosing again", async () => {
    const env = setup();
    vi.mocked(env.exports.createFromPicker).mockResolvedValue({ kind: "PICKER_CANCELLED" });
    render(<DraftExportPanel projectId={projectId} episodeId={episodeId} {...env} />);
    await ready();
    declareRights();
    fireEvent.click(submit());
    await screen.findByText("已取消保存位置选择，未创建导出任务。");
    expect(submit()).toBeEnabled();
    expect(env.jobs()).toEqual([]);
  });
  it("disables the browser-only fallback honestly", async () => {
    const env = setup();
    render(
      <DraftExportPanel
        projectId={projectId}
        episodeId={episodeId}
        assembly={env.assembly}
        exports={undefined}
      />,
    );
    expect(screen.getByText(/当前浏览器无法导出草稿 MP4/)).toBeInTheDocument();
    await waitFor(() => expect(submit()).toBeDisabled());
  });
  it("rejects mismatched success identity instead of showing a saved file", async () => {
    const env = setup();
    vi.mocked(env.exports.createFromPicker).mockImplementation(async (_p, _e, command) => ({
      kind: "FOUND",
      receipt: {
        data: jobFor(command, {
          episode_id: `ep_${"f".repeat(32)}`,
          status: "SUCCEEDED",
          progress_frames: 50,
          output_path: "/tmp/wrong.mp4",
          output_sha256: "f".repeat(64),
          output_bytes: 200,
        }),
        request_id: "wrong",
      },
    }));
    render(<DraftExportPanel projectId={projectId} episodeId={episodeId} {...env} />);
    await ready();
    declareRights();
    fireEvent.click(submit());
    await screen.findByText(/提交结果未知/);
    expect(screen.queryByText(/草稿文件已验证并保存/)).not.toBeInTheDocument();
    expect(submit()).toBeDisabled();
  });
  it("polls actual checkpoints and stops polling when verified completion arrives", async () => {
    const env = setup();
    const command: DraftExportCommand = {
      operation_id: `dmp_${"a".repeat(32)}`,
      assembly_version_id: saved.data.version_id,
      assembly_content_hash: saved.data.content_hash,
      rights_declaration: "OWNED_OR_SYNTHETIC",
    };
    env.setJobs([jobFor(command)]);
    vi.useFakeTimers();
    await act(async () => {
      render(<DraftExportPanel projectId={projectId} episodeId={episodeId} {...env} />);
    });
    expect(screen.getByText("排队中 · DRAFT")).toBeInTheDocument();
    env.setJobs([jobFor(command, { status: "RUNNING", progress_frames: 17 })]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(screen.getByText("正在编码 · DRAFT")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "17");
    env.setJobs([
      jobFor(command, {
        status: "SUCCEEDED",
        progress_frames: 50,
        output_path: "/tmp/test-DRAFT.mp4",
        output_sha256: "b".repeat(64),
        output_bytes: 2048,
      }),
    ]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(screen.getByText("草稿文件已验证并保存 · DRAFT")).toBeInTheDocument();
    const count = vi.mocked(env.exports.list).mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(env.exports.list).toHaveBeenCalledTimes(count);
  });
  it("preserves unresolved input identity across reload and rejects another version under that operation", async () => {
    const env = setup();
    const command: DraftExportCommand = {
      operation_id: `dmp_${"a".repeat(32)}`,
      assembly_version_id: saved.data.version_id,
      assembly_content_hash: saved.data.content_hash,
      rights_declaration: "OWNED_OR_SYNTHETIC",
    };
    localStorage.setItem(
      `aivora:draft-mp4:pending:${projectId}:${episodeId}`,
      JSON.stringify(command),
    );
    env.setJobs([jobFor(command, { assembly_version_id: `ver_${"f".repeat(32)}` })]);
    render(<DraftExportPanel projectId={projectId} episodeId={episodeId} {...env} />);
    await screen.findByText(/任务身份与先前保存的提交记录不符/);
    expect(submit()).toBeDisabled();
    expect(env.exports.createFromPicker).not.toHaveBeenCalled();
    expect(screen.queryByText("排队中 · DRAFT")).not.toBeInTheDocument();
  });
  it("recovers a dismissed-before-submit operation only after a definitive readback absence", async () => {
    const env = setup();
    const command: DraftExportCommand = {
      operation_id: `dmp_${"a".repeat(32)}`,
      assembly_version_id: saved.data.version_id,
      assembly_content_hash: saved.data.content_hash,
      rights_declaration: "OWNED_OR_SYNTHETIC",
    };
    localStorage.setItem(
      `aivora:draft-mp4:pending:${projectId}:${episodeId}`,
      JSON.stringify(command),
    );
    render(<DraftExportPanel projectId={projectId} episodeId={episodeId} {...env} />);
    await screen.findByText("已核实先前任务未被接收，可重新选择保存位置。");
    expect(env.exports.get).toHaveBeenCalledWith(projectId, episodeId, command.operation_id);
    expect(env.exports.createFromPicker).not.toHaveBeenCalled();
    declareRights();
    expect(submit()).toBeEnabled();
  });
  it("allows only size-unverified originals for full native verification", () => {
    const version = structuredClone(saved.data);
    version.media_checks[0]!.availability = "UNVERIFIED_SIZE_LIMIT";
    expect(draftExportProblem(version)).toBeNull();
    for (const availability of [
      "MISSING",
      "CORRUPT",
      "UNKNOWN_UNSAFE_PATH",
      "UNKNOWN_MEDIA_READ",
      "UNKNOWN_MEDIA_CHANGED",
    ] as const) {
      version.media_checks[0]!.availability = availability;
      expect(draftExportProblem(version)).toContain("原素材尚未验证可用");
    }
  });
  it("explains unavailable pinned local encoding tools without suggesting submission succeeded", () => {
    expect(
      draftExportFailure({
        kind: "DEFINITE_SERVER_ERROR",
        status: 503,
        code: "DRAFT_TOOLCHAIN_UNAVAILABLE",
        request_id: "missing-tool",
      }),
    ).toBe("本地锁定的 FFmpeg 编码工具不可用，当前无法导出草稿。请检查桌面编码工具配置后重试。");
  });
  it("blocks unsupported tracks, restricted rights, excessive duration/count/dimensions", () => {
    expect(draftExportProblem(saved.data)).toBeNull();
    const copy = () => structuredClone(saved.data);
    let version = copy();
    version.media_checks[0]!.rights_status = "RESTRICTED";
    expect(draftExportProblem(version)).toContain("权利受限");
    version = copy();
    version.content.canvas_width = 1921;
    expect(draftExportProblem(version)).toContain("偶数");
    version = copy();
    version.content.total_frames = 45001;
    expect(draftExportProblem(version)).toContain("30 分钟");
    version = copy();
    version.content.visual_segments = Array(33).fill(version.content.visual_segments[0]);
    expect(draftExportProblem(version)).toContain("32 个");
    version = copy();
    version.content.subtitle_segments = [{}] as AssemblyVersion["content"]["subtitle_segments"];
    expect(draftExportProblem(version)).toContain("旧版剧本绑定字幕");
    version = copy();
    version.content.audio_segments = [
      { track_kind: "DIALOGUE" },
    ] as AssemblyVersion["content"]["audio_segments"];
    expect(draftExportProblem(version)).toContain("对白轨");
  });
});

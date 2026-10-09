import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SavedCompositionPreview } from "./SavedCompositionPreview";
import type { AijianDesktopBridge } from "../api/studio";
import type { MediaToolchainStatus } from "./mediaToolchainContract";
import type {
  DraftExportCommand,
  DraftExportGateway,
  DraftExportJob,
  DraftExportPreviewResult,
} from "./adapters/draftExport";
import { staticAnimaticContent, type AssemblyVersion } from "./adapters/episodeMediaAssembly";
const mediaStatus: MediaToolchainStatus = {
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
};
function setMediaStatus(status: MediaToolchainStatus) {
  window.aijian = {
    getMediaToolchainStatus: vi.fn().mockResolvedValue({ kind: "STATUS", status }),
    selectMediaToolchain: vi.fn(),
    clearMediaToolchain: vi.fn(),
  } as unknown as AijianDesktopBridge;
}
const projectId = `prj_${"1".repeat(32)}`;
const episodeId = `ep_${"2".repeat(32)}`;
const media = {
  asset_id: `asset_${"3".repeat(32)}`,
  asset_version_id: `asv_${"4".repeat(32)}`,
  sha256: "5".repeat(64),
};
const savedVersion: AssemblyVersion = {
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
};
const command: DraftExportCommand = {
  operation_id: `dmp_${"9".repeat(32)}`,
  assembly_version_id: savedVersion.version_id,
  assembly_content_hash: savedVersion.content_hash,
  rights_declaration: "OWNED_OR_SYNTHETIC",
};
function jobFor(input = command, patch: Partial<DraftExportJob> = {}): DraftExportJob {
  return {
    ...input,
    project_id: projectId,
    episode_id: episodeId,
    status: "QUEUED",
    total_frames: 50,
    progress_frames: 0,
    output_filename: `Aivora-PREVIEW-DRAFT-${input.operation_id}.mp4`,
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
function succeeded(): DraftExportJob {
  return jobFor(command, {
    status: "SUCCEEDED",
    progress_frames: 50,
    output_path: "/local/preview.mp4",
    output_sha256: "a".repeat(64),
    output_bytes: 12,
  });
}
function ready(job = succeeded()): DraftExportPreviewResult {
  return {
    kind: "READY",
    mime_type: "video/mp4",
    bytes: new Uint8Array(12),
    identity: {
      project_id: projectId,
      episode_id: episodeId,
      operation_id: job.operation_id,
      output_sha256: job.output_sha256!,
      output_bytes: 12,
    },
  };
}
function setup(initial: DraftExportJob[] = []) {
  let jobs = initial;
  const exports: DraftExportGateway = {
    list: vi.fn(async () => ({
      kind: "LISTED" as const,
      receipt: { data: { items: jobs }, request_id: "list-preview" },
    })),
    get: vi.fn(async (_p, _e, id) => {
      const job = jobs.find((value) => value.operation_id === id);
      return job
        ? { kind: "FOUND" as const, receipt: { data: job, request_id: "read-preview" } }
        : { kind: "NOT_FOUND" as const, request_id: "not-found" };
    }),
    createFromPicker: vi.fn(),
    createPreview: vi.fn(async (_p, _e, input) => {
      const job = jobFor(input);
      jobs = [job, ...jobs];
      return { kind: "FOUND" as const, receipt: { data: job, request_id: "create-preview" } };
    }),
    cancel: vi.fn(async (_p, _e, id) => {
      jobs = jobs.map((job) =>
        job.operation_id === id ? { ...job, status: "CANCELLED" as const } : job,
      );
      return {
        kind: "FOUND" as const,
        receipt: {
          data: jobs.find((job) => job.operation_id === id)!,
          request_id: "cancel-preview",
        },
      };
    }),
    preview: vi.fn().mockResolvedValue(ready()),
    reveal: vi.fn(),
  };
  return {
    exports,
    setJobs: (value: DraftExportJob[]) => {
      jobs = value;
    },
  };
}
const props = { projectId, episodeId, savedVersion, dirty: false, disabled: false };
const pendingKey = `aivora:composition-preview:pending:${projectId}:${episodeId}`;
const expand = () => fireEvent.click(screen.getByRole("button", { name: "展开连续预览" }));
const generate = () => screen.getByRole("button", { name: /^(重新)?生成已保存版本预览$/ });
const declare = () => fireEvent.click(screen.getByRole("checkbox"));
const refresh = () => fireEvent.click(screen.getByRole("button", { name: "重新核对预览任务" }));
async function loaded() {
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "重新核对预览任务" })).toBeEnabled(),
  );
}
beforeEach(() => {
  localStorage.clear();
  setMediaStatus(mediaStatus);
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = vi.fn(() => "blob:composition");
      static revokeObjectURL = vi.fn();
    },
  );
});
afterEach(() => {
  cleanup();
  delete window.aijian;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("saved composition playback", () => {
  it("keeps verified output playback available but blocks new encoding without runtime capability", async () => {
    setMediaStatus({
      ...mediaStatus,
      state: "NOT_CONFIGURED",
      source: "NONE",
      directory: null,
      profile_id: null,
      version: null,
      can_probe: false,
      can_preview: false,
      can_draft_export: false,
    });
    const state = setup([succeeded()]);
    render(
      <SavedCompositionPreview
        projectId={projectId}
        episodeId={episodeId}
        savedVersion={savedVersion}
        dirty={false}
        disabled={false}
        exports={state.exports}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "展开连续预览" }));
    await screen.findByText("已保存版本的连续预览可播放 · DRAFT");
    expect(screen.getByText(/尚未配置媒体工具/)).toBeInTheDocument();
    const generate = screen.getByRole("button", { name: "重新生成已保存版本预览" });
    expect(generate).toBeDisabled();
    expect(screen.getByRole("checkbox")).toBeDisabled();
    fireEvent.click(generate);
    expect(state.exports.createPreview).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "播放已验证草稿" }));
    await waitFor(() => expect(state.exports.preview).toHaveBeenCalled());
  });
  it("starts compact, requires explicit rights, and submits saved identity only without opening a picker", async () => {
    const env = setup();
    render(<SavedCompositionPreview {...props} {...env} dirty />);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expand();
    await loaded();
    expect(generate()).toBeDisabled();
    expect(screen.getByText(/有未保存修改：此预览只使用上次保存版本/)).toBeInTheDocument();
    declare();
    expect(generate()).toBeEnabled();
    fireEvent.click(generate());
    await screen.findByText("预览排队中 · DRAFT");
    expect(env.exports.createPreview).toHaveBeenCalledExactlyOnceWith(projectId, episodeId, {
      ...command,
      operation_id: expect.stringMatching(/^dmp_[0-9a-f]{32}$/),
    });
    expect(env.exports.createFromPicker).not.toHaveBeenCalled();
    expect(generate()).toBeDisabled();
    expect(localStorage.getItem(`aivora:draft-mp4:pending:${projectId}:${episodeId}`)).toBeNull();
  });
  it("reuses verified saved-version output and releases playback on collapse without cancelling work", async () => {
    const env = setup([succeeded()]);
    render(<SavedCompositionPreview {...props} {...env} />);
    expand();
    await screen.findByText("已保存版本的连续预览可播放 · DRAFT");
    fireEvent.click(screen.getByRole("button", { name: "播放已验证草稿" }));
    await screen.findByLabelText("已验证 DRAFT 草稿视频");
    expect(env.exports.createPreview).not.toHaveBeenCalled();
    expect(env.exports.preview).toHaveBeenCalledWith(projectId, episodeId, command.operation_id);
    fireEvent.click(screen.getByRole("button", { name: "收起连续预览" }));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:composition");
    expect(screen.queryByLabelText("已验证 DRAFT 草稿视频")).not.toBeInTheDocument();
    expect(env.exports.cancel).not.toHaveBeenCalled();
    expand();
    expect(screen.queryByLabelText("已验证 DRAFT 草稿视频")).not.toBeInTheDocument();
  });
  it("does not reopen a collapsed player after a late verified read", async () => {
    const env = setup([succeeded()]);
    let finish!: (value: DraftExportPreviewResult) => void;
    vi.mocked(env.exports.preview!).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(<SavedCompositionPreview {...props} {...env} />);
    expand();
    await screen.findByText("已保存版本的连续预览可播放 · DRAFT");
    fireEvent.click(screen.getByRole("button", { name: "播放已验证草稿" }));
    fireEvent.click(screen.getByRole("button", { name: "收起连续预览" }));
    await act(async () => finish(ready()));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(env.exports.cancel).not.toHaveBeenCalled();
  });
  it("recovers unknown submit after remount using its own pending journal without resubmitting", async () => {
    const env = setup();
    vi.mocked(env.exports.createPreview!).mockImplementation(async (_p, _e, input) => {
      env.setJobs([jobFor(input)]);
      return { kind: "REMOTE_UNKNOWN" };
    });
    const view = render(<SavedCompositionPreview {...props} {...env} />);
    expand();
    await loaded();
    declare();
    fireEvent.click(generate());
    await screen.findByText(/提交结果未知/);
    expect(localStorage.getItem(pendingKey)).not.toBeNull();
    view.unmount();
    render(<SavedCompositionPreview {...props} {...env} />);
    expand();
    await screen.findByText("预览排队中 · DRAFT");
    expect(localStorage.getItem(pendingKey)).toBeNull();
    expect(env.exports.createPreview).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "取消连续预览生成" }));
    await screen.findByText("预览任务已取消 · DRAFT");
  });
  it("keeps ambiguous or mismatched pending identities blocked instead of starting another render", async () => {
    localStorage.setItem(pendingKey, JSON.stringify(command));
    const env = setup([jobFor(command, { assembly_content_hash: `sha256:${"c".repeat(64)}` })]);
    render(<SavedCompositionPreview {...props} {...env} />);
    expand();
    await screen.findByText(/任务身份与先前保存的提交记录不符/);
    declare();
    expect(generate()).toBeDisabled();
    expect(localStorage.getItem(pendingKey)).not.toBeNull();
    expect(env.exports.createPreview).not.toHaveBeenCalled();
  });
  it("closes old playback and resets rights when the saved version changes", async () => {
    const env = setup([succeeded()]);
    const view = render(<SavedCompositionPreview {...props} {...env} />);
    expand();
    await screen.findByText("已保存版本的连续预览可播放 · DRAFT");
    declare();
    fireEvent.click(screen.getByRole("button", { name: "播放已验证草稿" }));
    await screen.findByLabelText("已验证 DRAFT 草稿视频");
    view.rerender(
      <SavedCompositionPreview
        {...props}
        {...env}
        savedVersion={{
          ...savedVersion,
          version_id: `ver_${"b".repeat(32)}`,
          content_hash: `sha256:${"c".repeat(64)}`,
        }}
      />,
    );
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:composition");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expand();
    await loaded();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.queryByRole("button", { name: "播放已验证草稿" })).not.toBeInTheDocument();
  });
  it("keeps interrupted jobs honest and permits explicit retry after pre-claim cache failure", async () => {
    const env = setup([
      jobFor(command, {
        status: "INTERRUPTED",
        error_code: "PROCESS_INTERRUPTED",
        error_message: "Process stopped",
      }),
    ]);
    vi.mocked(env.exports.createPreview!).mockResolvedValue({ kind: "CACHE_UNAVAILABLE" });
    render(<SavedCompositionPreview {...props} {...env} />);
    expand();
    await screen.findByText("预览任务已中断，不会自动重试 · DRAFT");
    expect(env.exports.createPreview).not.toHaveBeenCalled();
    declare();
    fireEvent.click(generate());
    await screen.findByText(/本机预览缓存目录不可用或不安全/);
    expect(localStorage.getItem(pendingKey)).toBeNull();
    expect(generate()).toBeEnabled();
    expect(screen.queryByRole("button", { name: "播放已验证草稿" })).not.toBeInTheDocument();
  });
  it("preserves active job status while collapsed and exposes cancellation when reopened", async () => {
    const env = setup([jobFor()]);
    render(<SavedCompositionPreview {...props} {...env} />);
    await screen.findByText("预览排队中");
    expand();
    await loaded();
    env.setJobs([jobFor(command, { status: "VERIFYING", progress_frames: 50 })]);
    refresh();
    await screen.findByText("正在校验预览 MP4 · DRAFT");
    expect(screen.queryByRole("button", { name: "播放已验证草稿" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "收起连续预览" }));
    expect(screen.getByText("正在校验预览 MP4")).toBeInTheDocument();
    expect(env.exports.cancel).not.toHaveBeenCalled();
  });
});

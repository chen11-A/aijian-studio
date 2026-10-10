import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useDraftExports } from "./useDraftExports";
import type {
  DraftExportCommand,
  DraftExportGateway,
  DraftExportJob,
} from "./adapters/draftExport";
import { staticAnimaticContent, type AssemblyVersion } from "./adapters/episodeMediaAssembly";

const projectId = `prj_${"1".repeat(32)}`;
const episodeId = `ep_${"2".repeat(32)}`;
const media = {
  asset_id: `asset_${"3".repeat(32)}`,
  asset_version_id: `asv_${"4".repeat(32)}`,
  sha256: "5".repeat(64),
};
const saved: AssemblyVersion = {
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
  assembly_version_id: saved.version_id,
  assembly_content_hash: saved.content_hash,
  rights_declaration: "OWNED_OR_SYNTHETIC",
};
const key = `aivora:composition-preview:pending:${projectId}:${episodeId}`;
function job(patch: Partial<DraftExportJob> = {}): DraftExportJob {
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
    created_at: "2026-10-10T00:00:00Z",
    updated_at: "2026-10-10T00:00:00Z",
    toolchain_profile_id: "synthetic",
    draft: true,
    ...patch,
  };
}
function gateway() {
  return {
    list: vi
      .fn<DraftExportGateway["list"]>()
      .mockResolvedValue({ kind: "LISTED", receipt: { data: { items: [] }, request_id: "list" } }),
    get: vi.fn<DraftExportGateway["get"]>().mockResolvedValue({ kind: "REMOTE_UNKNOWN" }),
    createFromPicker: vi
      .fn<DraftExportGateway["createFromPicker"]>()
      .mockResolvedValue({ kind: "REMOTE_UNKNOWN" }),
    createPreview: vi
      .fn<NonNullable<DraftExportGateway["createPreview"]>>()
      .mockResolvedValue({ kind: "REMOTE_UNKNOWN" }),
    cancel: vi.fn<DraftExportGateway["cancel"]>().mockResolvedValue({ kind: "REMOTE_UNKNOWN" }),
  };
}
let api = gateway();
beforeEach(() => {
  api = gateway();
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});
async function mount() {
  const mounted = renderHook(() =>
    useDraftExports(
      { projectId, episodeId, assembly: undefined, exports: api },
      { mode: "composition-preview", savedVersion: saved },
    ),
  );
  await waitFor(() => expect(mounted.result.current.busy).toBe(false));
  return mounted;
}
describe("draft export hook keeps cancellation and recovery non-replaying", () => {
  test.each(["PICKER_BUSY", "INVALID_DESTINATION", "CACHE_UNAVAILABLE"] as const)(
    "definitive submit %s clears only its recovery marker",
    async (kind) => {
      api.createPreview.mockResolvedValue({ kind });
      const { result } = await mount();
      await act(async () => result.current.submit());
      expect(result.current.pending).toBeNull();
      expect(localStorage.getItem(key)).toBeNull();
      expect(api.createPreview).toHaveBeenCalledTimes(1);
      expect(result.current.jobs).toEqual([]);
      expect(result.current.notice).not.toContain("已读取草稿任务记录");
    },
  );
  test("storage removal failure remains blocked after a known task read", async () => {
    localStorage.setItem(key, JSON.stringify(command));
    api.list.mockResolvedValue({
      kind: "LISTED",
      receipt: { data: { items: [job()] }, request_id: "list" },
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { result } = await mount();
    expect(result.current.pending).toBeUndefined();
    expect(result.current.notice).toContain("无法保存任务恢复记录");
    await act(async () => result.current.submit());
    expect(api.createPreview).not.toHaveBeenCalled();
    expect(localStorage.getItem(key)).toBe(JSON.stringify(command));
  });
  test("storage write failure blocks submission before the bridge", async () => {
    const { result } = await mount();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    await act(async () => result.current.submit());
    expect(result.current.pending).toBeUndefined();
    expect(result.current.notice).toContain("导出尚未提交");
    expect(api.createPreview).not.toHaveBeenCalled();
  });
  test("list rejection marks the queue unreliable without claiming no jobs", async () => {
    api.list.mockRejectedValue(new Error("offline"));
    const { result } = await mount();
    expect(result.current.reliable).toBe(false);
    expect(result.current.notice).toContain("暂时无法读取草稿任务");
    await act(async () => result.current.submit());
    expect(api.createPreview).not.toHaveBeenCalled();
  });
  test("wrong scoped cancellation receipt is never accepted", async () => {
    const { result } = await mount();
    api.cancel.mockResolvedValue({
      kind: "FOUND",
      receipt: { data: job({ episode_id: `ep_${"a".repeat(32)}` }), request_id: "cancel" },
    });
    await act(async () => result.current.cancel(command.operation_id));
    expect(result.current.jobs).toEqual([]);
    expect(result.current.notice).toContain("暂未可靠读回");
  });
  test("a late cancellation cannot update an unmounted hook", async () => {
    let finish!: (value: Awaited<ReturnType<DraftExportGateway["cancel"]>>) => void;
    api.cancel.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { result, unmount } = await mount();
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.cancel(command.operation_id);
    });
    unmount();
    await act(async () => {
      finish({
        kind: "FOUND",
        receipt: { data: job({ status: "CANCELLED" }), request_id: "cancel" },
      });
      await pending;
    });
    expect(result.current.jobs).toEqual([]);
  });
  test("assembly read failure reports a read error and never begins queue mutations", async () => {
    const readLatest = vi.fn().mockRejectedValue(new Error("offline"));
    const assembly = { readLatest, createVersion: vi.fn() };
    const { result } = renderHook(() =>
      useDraftExports({
        projectId,
        episodeId,
        exports: api,
        assembly,
      }),
    );
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(result.current.version).toBeNull();
    expect(result.current.notice).toBe("读取本集装配失败，请重新读取。");
    expect(api.createFromPicker).not.toHaveBeenCalled();
  });
  test.each([
    ["CANCELLED", "草稿任务已取消。"],
    ["SUCCEEDED", "任务已在取消前完成"],
    ["RUNNING", "正在核对取消结果"],
    ["FAILED", "任务已结束"],
  ] as const)("cancel readback %s displays actual outcome", async (status, notice) => {
    const { result } = await mount();
    api.cancel.mockResolvedValue({
      kind: "FOUND",
      receipt: {
        data: job({
          status,
          ...(status === "SUCCEEDED"
            ? {
                progress_frames: 50,
                output_path: "C:\\synthetic\\test-DRAFT.mp4",
                output_sha256: "a".repeat(64),
                output_bytes: 100,
              }
            : {}),
        }),
        request_id: "cancel",
      },
    });
    await act(async () => result.current.cancel(command.operation_id));
    expect(result.current.notice).toContain(notice);
    expect(result.current.jobs[0]?.status).toBe(status);
    expect(api.cancel).toHaveBeenCalledExactlyOnceWith(projectId, episodeId, command.operation_id);
    expect(api.createPreview).not.toHaveBeenCalled();
  });
  test("cancel transport rejection keeps uncertainty without replay", async () => {
    const { result } = await mount();
    api.cancel.mockRejectedValue(new Error("offline"));
    await act(async () => result.current.cancel(command.operation_id));
    expect(result.current.notice).toContain("取消结果未知");
    expect(result.current.busy).toBe(false);
    expect(api.cancel).toHaveBeenCalledTimes(1);
  });
  test("pending recovery NOT_FOUND unlocks without calling create", async () => {
    localStorage.setItem(key, JSON.stringify(command));
    api.get.mockResolvedValue({ kind: "NOT_FOUND", request_id: "get" });
    const { result } = await mount();
    expect(result.current.pending).toBeNull();
    expect(result.current.notice).toContain("先前预览任务未被接收");
    expect(localStorage.getItem(key)).toBeNull();
    expect(api.createPreview).not.toHaveBeenCalled();
  });
});

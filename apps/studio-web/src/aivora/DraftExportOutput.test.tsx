import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DraftExportOutput } from "./DraftExportOutput";
import type {
  DraftExportGateway,
  DraftExportJob,
  DraftExportPreviewResult,
  DraftExportRevealResult,
} from "./adapters/draftExport";

const job: DraftExportJob = {
  project_id: `prj_${"1".repeat(32)}`,
  episode_id: `ep_${"2".repeat(32)}`,
  operation_id: `dmp_${"3".repeat(32)}`,
  assembly_version_id: `ver_${"4".repeat(32)}`,
  assembly_content_hash: `sha256:${"5".repeat(64)}`,
  rights_declaration: "OWNED_OR_SYNTHETIC",
  status: "SUCCEEDED",
  total_frames: 50,
  progress_frames: 50,
  output_filename: "test-DRAFT.mp4",
  output_path: "/local/test-DRAFT.mp4",
  output_sha256: "6".repeat(64),
  output_bytes: 12,
  error_code: null,
  error_message: null,
  created_at: "2026-10-08T00:00:00Z",
  updated_at: "2026-10-08T00:00:00Z",
  toolchain_profile_id: "pinned",
  draft: true,
};
const props = { projectId: job.project_id, episodeId: job.episode_id, job };
const identity = {
  project_id: job.project_id,
  episode_id: job.episode_id,
  operation_id: job.operation_id,
  output_sha256: "6".repeat(64),
  output_bytes: 12,
};
function ready(): DraftExportPreviewResult {
  return { kind: "READY", bytes: new Uint8Array(12), mime_type: "video/mp4", identity };
}
function setup() {
  return {
    preview: vi.fn<NonNullable<DraftExportGateway["preview"]>>().mockResolvedValue(ready()),
    reveal: vi
      .fn<NonNullable<DraftExportGateway["reveal"]>>()
      .mockResolvedValue({ kind: "REVEALED", identity }),
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const play = () => fireEvent.click(screen.getByRole("button", { name: "播放已验证草稿" }));
const close = () => fireEvent.click(screen.getByRole("button", { name: "关闭草稿预览" }));
const reveal = () => fireEvent.click(screen.getByRole("button", { name: "打开所在文件夹" }));
beforeEach(() => {
  let next = 0;
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = vi.fn(() => `blob:draft-${++next}`);
      static revokeObjectURL = vi.fn();
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("verified DRAFT output actions", () => {
  it("requests IDs only, creates a bounded MP4 blob, and never autoplays", async () => {
    const gateway = setup();
    render(<DraftExportOutput {...props} gateway={gateway} />);
    play();
    const video = await screen.findByLabelText("已验证 DRAFT 草稿视频");
    expect(gateway.preview).toHaveBeenCalledWith(job.project_id, job.episode_id, job.operation_id);
    expect(video).toHaveAttribute("src", "blob:draft-1");
    expect(video).toHaveAttribute("controls");
    expect(video).not.toHaveAttribute("autoplay");
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0]?.[0] as Blob;
    expect(blob.type).toBe("video/mp4");
    expect(blob.size).toBe(12);
    expect(screen.getByText(/不代表帧精确审片或正式发布批准/)).toBeInTheDocument();
  });
  it("suppresses repeated preview clicks, revokes on close, and rereads for a new preview", async () => {
    const gateway = setup();
    const pending = deferred<DraftExportPreviewResult>();
    gateway.preview.mockReturnValueOnce(pending.promise);
    const view = render(<DraftExportOutput {...props} gateway={gateway} />);
    play();
    play();
    expect(gateway.preview).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/正在重新核验草稿文件/)).toBeInTheDocument();
    await act(async () => pending.resolve(ready()));
    close();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:draft-1");
    expect(screen.queryByLabelText("已验证 DRAFT 草稿视频")).not.toBeInTheDocument();
    play();
    await screen.findByLabelText("已验证 DRAFT 草稿视频");
    expect(gateway.preview).toHaveBeenCalledTimes(2);
    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:draft-2");
  });
  it("discards a closed pending response even if a newer preview already opened", async () => {
    const gateway = setup();
    const old = deferred<DraftExportPreviewResult>();
    gateway.preview.mockReturnValueOnce(old.promise);
    render(<DraftExportOutput {...props} gateway={gateway} />);
    play();
    close();
    play();
    await screen.findByLabelText("已验证 DRAFT 草稿视频");
    await act(async () => old.resolve(ready()));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("已验证 DRAFT 草稿视频")).toHaveAttribute("src", "blob:draft-1");
  });
  it("revokes an open preview before replacing it with a newly verified read", async () => {
    const gateway = setup();
    render(<DraftExportOutput {...props} gateway={gateway} />);
    play();
    await screen.findByLabelText("已验证 DRAFT 草稿视频");
    play();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:draft-1");
    await waitFor(() =>
      expect(screen.getByLabelText("已验证 DRAFT 草稿视频")).toHaveAttribute("src", "blob:draft-2"),
    );
  });
  it("discards old gateway responses when the desktop capability changes", async () => {
    const oldGateway = setup();
    const pending = deferred<DraftExportPreviewResult>();
    oldGateway.preview.mockReturnValue(pending.promise);
    const view = render(<DraftExportOutput {...props} gateway={oldGateway} />);
    play();
    view.rerender(<DraftExportOutput {...props} gateway={setup()} />);
    await act(async () => pending.resolve(ready()));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(screen.queryByText(/正在重新核验草稿文件/)).not.toBeInTheDocument();
  });
  it("discards preview replies after unmount", async () => {
    const gateway = setup();
    const pending = deferred<DraftExportPreviewResult>();
    gateway.preview.mockReturnValue(pending.promise);
    const view = render(<DraftExportOutput {...props} gateway={gateway} />);
    play();
    view.unmount();
    await act(async () => pending.resolve(ready()));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
  it.each([
    { operation_id: `dmp_${"7".repeat(32)}` },
    { output_sha256: "7".repeat(64) },
    { output_bytes: 13 },
    { output_path: "/local/other-DRAFT.mp4" },
  ])("revokes and resets when immutable displayed job identity changes: %j", async (patch) => {
    const gateway = setup();
    const view = render(<DraftExportOutput {...props} gateway={gateway} />);
    play();
    await screen.findByLabelText("已验证 DRAFT 草稿视频");
    view.rerender(<DraftExportOutput {...props} job={{ ...job, ...patch }} gateway={gateway} />);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:draft-1");
    expect(screen.queryByLabelText("已验证 DRAFT 草稿视频")).not.toBeInTheDocument();
  });
  it("discards a pending response after job/scope switch and hides mismatched scope", async () => {
    const gateway = setup();
    const pending = deferred<DraftExportPreviewResult>();
    gateway.preview.mockReturnValue(pending.promise);
    const view = render(<DraftExportOutput {...props} gateway={gateway} />);
    play();
    view.rerender(
      <DraftExportOutput {...props} episodeId={`ep_${"7".repeat(32)}`} gateway={gateway} />,
    );
    await act(async () => pending.resolve(ready()));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "播放已验证草稿" })).not.toBeInTheDocument();
  });
  it.each([
    { identity: { ...identity, project_id: `prj_${"7".repeat(32)}` } },
    { identity: { ...identity, episode_id: `ep_${"7".repeat(32)}` } },
    { identity: { ...identity, operation_id: `dmp_${"7".repeat(32)}` } },
    { identity: { ...identity, output_sha256: "7".repeat(64) } },
    { identity: { ...identity, output_bytes: 11 } },
    { identity: null },
    { mime_type: "text/html" },
    { bytes: new Uint8Array(11) },
    { bytes: [1, 2] },
  ])("rejects mismatched or malformed preview before Blob construction: %j", async (patch) => {
    const gateway = setup();
    gateway.preview.mockResolvedValue({ ...ready(), ...patch } as DraftExportPreviewResult);
    render(<DraftExportOutput {...props} gateway={gateway} />);
    play();
    await screen.findByText(/字节、大小或任务身份不符/);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
  it("explains oversized previews while leaving verified folder reveal available", async () => {
    const gateway = setup();
    gateway.preview.mockResolvedValue({
      kind: "PREVIEW_TOO_LARGE",
      output_bytes: 40 * 1024 * 1024,
      limit_bytes: 32 * 1024 * 1024,
    });
    render(<DraftExportOutput {...props} gateway={gateway} />);
    play();
    await screen.findByText(/超过 32 MiB 内嵌预览上限/);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "打开所在文件夹" })).toBeEnabled();
  });
  it("bounds even a READY response with matching excessive byte size", async () => {
    const gateway = setup();
    const size = 32 * 1024 * 1024 + 1;
    gateway.preview.mockResolvedValue({
      ...ready(),
      bytes: new Uint8Array(size),
      identity: { ...identity, output_bytes: size },
    } as DraftExportPreviewResult);
    render(<DraftExportOutput {...props} job={{ ...job, output_bytes: size }} gateway={gateway} />);
    play();
    await screen.findByText(/超过 32 MiB 内嵌预览上限/);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
  it.each([
    [{ kind: "REMOTE_UNKNOWN" }, /结果未知/],
    [{ kind: "OUTPUT_UNAVAILABLE", code: "__proto__" }, /草稿文件验证失败/],
    [{ kind: "OUTPUT_UNAVAILABLE", code: "OUTPUT_BUSY" }, /已有草稿文件正在核验/],
    [{ kind: "NOT_FOUND", request_id: "gone" }, /任务记录不存在/],
    [{ kind: "OUTPUT_UNAVAILABLE", code: "HASH_MISMATCH" }, /文件校验值已变化/],
    [
      { kind: "DEFINITE_SERVER_ERROR", status: 409, code: "BLOCKED", request_id: "denied" },
      /请求被拒绝/,
    ],
    [{ kind: "SURPRISE" }, /结果未知/],
    [null, /结果未知/],
  ])("reports unavailable and unknown preview results honestly: %j", async (result, message) => {
    const gateway = setup();
    gateway.preview.mockResolvedValue(result as DraftExportPreviewResult);
    render(<DraftExportOutput {...props} gateway={gateway} />);
    play();
    await screen.findByText(message);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
  it("releases the blob when the media decoder fails", async () => {
    render(<DraftExportOutput {...props} gateway={setup()} />);
    play();
    fireEvent.error(await screen.findByLabelText("已验证 DRAFT 草稿视频"));
    await screen.findByText(/无法解码/);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:draft-1");
  });
  it("explains unavailable optional desktop capabilities", () => {
    render(<DraftExportOutput {...props} gateway={{}} />);
    expect(screen.getByRole("button", { name: "播放已验证草稿" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "打开所在文件夹" })).toBeDisabled();
    expect(screen.getByText(/当前桌面版本未提供草稿播放/)).toBeInTheDocument();
    expect(screen.getByText(/当前桌面版本未提供打开所在文件夹/)).toBeInTheDocument();
  });
  it("deduplicates reveal and reports success only for a matching verified identity", async () => {
    const gateway = setup();
    const pending = deferred<DraftExportRevealResult>();
    gateway.reveal.mockReturnValueOnce(pending.promise);
    render(<DraftExportOutput {...props} gateway={gateway} />);
    reveal();
    reveal();
    expect(gateway.reveal).toHaveBeenCalledTimes(1);
    expect(gateway.reveal).toHaveBeenCalledWith(job.project_id, job.episode_id, job.operation_id);
    await act(async () => pending.resolve({ kind: "REVEALED", identity }));
    expect(screen.getByText(/已请求系统打开已验证草稿所在文件夹/)).toBeInTheDocument();
    gateway.reveal.mockResolvedValueOnce({
      kind: "REVEALED",
      identity: { ...identity, output_sha256: "7".repeat(64) },
    });
    reveal();
    await screen.findByText(/返回的任务身份不符/);
  });
  it("ignores a stale reveal result after a job change", async () => {
    const gateway = setup();
    const pending = deferred<DraftExportRevealResult>();
    gateway.reveal.mockReturnValue(pending.promise);
    const view = render(<DraftExportOutput {...props} gateway={gateway} />);
    reveal();
    view.rerender(
      <DraftExportOutput
        {...props}
        job={{ ...job, operation_id: `dmp_${"8".repeat(32)}` }}
        gateway={gateway}
      />,
    );
    await act(async () => pending.resolve({ kind: "REVEALED", identity }));
    expect(screen.queryByText(/已请求系统打开/)).not.toBeInTheDocument();
  });
  it("reports reveal failures and rejected preview requests without inventing success", async () => {
    const gateway = setup();
    gateway.reveal.mockResolvedValue({ kind: "OUTPUT_UNAVAILABLE", code: "REVEAL_FAILED" });
    gateway.preview.mockRejectedValue(new Error("not available"));
    render(<DraftExportOutput {...props} gateway={gateway} />);
    reveal();
    await screen.findByText(/系统未能打开/);
    play();
    await screen.findByText(/结果未知/);
    gateway.reveal.mockRejectedValue(new Error("lost reply"));
    reveal();
    await waitFor(() => expect(screen.getAllByText(/结果未知/)).toHaveLength(2));
    expect(screen.queryByText(/已请求系统打开/)).not.toBeInTheDocument();
  });
});

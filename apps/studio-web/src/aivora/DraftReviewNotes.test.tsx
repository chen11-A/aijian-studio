import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DraftReviewNotes } from "./DraftReviewNotes";
import {
  approximateFrame,
  reviewIdentity,
  type DraftReviewData,
  type DraftReviewGateway,
  type DraftReviewResult,
} from "./adapters/draftReview";
import type { DraftExportJob } from "./adapters/draftExport";
const job: DraftExportJob = {
  project_id: `prj_${"1".repeat(32)}`,
  episode_id: `ep_${"2".repeat(32)}`,
  operation_id: `dmp_${"3".repeat(32)}`,
  assembly_version_id: `ver_${"4".repeat(32)}`,
  assembly_content_hash: `sha256:${"5".repeat(64)}`,
  output_sha256: "6".repeat(64),
  output_bytes: 100,
  total_frames: 50,
  progress_frames: 50,
  status: "SUCCEEDED",
  output_filename: "test-DRAFT.mp4",
  output_path: "/tmp/test-DRAFT.mp4",
  draft: true,
  rights_declaration: "OWNED_OR_SYNTHETIC",
  toolchain_profile_id: "test",
  created_at: "2026-10-08T00:00:00Z",
  updated_at: "2026-10-08T00:00:00Z",
  error_code: null,
  error_message: null,
};
const target = {
  project_id: job.project_id,
  episode_id: job.episode_id,
  operation_id: job.operation_id,
  assembly_version_id: job.assembly_version_id,
  assembly_content_hash: job.assembly_content_hash,
  output_sha256: "6".repeat(64),
  output_bytes: 100,
  assembly_version_number: 1,
  total_frames: 50,
  frame_rate_num: 25,
  frame_rate_den: 1,
};
const key = `aivora:draft-review:pending:${job.project_id}:${job.episode_id}:${job.operation_id}`;
function initial(): DraftReviewData {
  return {
    target,
    output_verified: true,
    current_assembly_version_id: target.assembly_version_id,
    current_assembly_content_hash: target.assembly_content_hash,
    version_status: "CURRENT",
    notes: [],
    manual_review_only: true,
  };
}
function found(data: DraftReviewData): DraftReviewResult {
  return { kind: "FOUND", receipt: { data, request_id: "00000000-0000-4000-8000-000000000001" } };
}
const note = {
  note_id: `drn_${"7".repeat(32)}`,
  frame_index: 12,
  text: "核对动作连续性",
  actor_id: "local-user",
  created_at: "2026-10-08T00:00:00Z",
  revision: 1 as const,
  resolution: null,
};
function setup(data = initial()) {
  let saved = data;
  const gateway = {
    listDraftReviewNotes: vi
      .fn<DraftReviewGateway["listDraftReviewNotes"]>()
      .mockImplementation(async () => found(saved)),
    createDraftReviewNote: vi
      .fn<DraftReviewGateway["createDraftReviewNote"]>()
      .mockImplementation(async (_p, _e, _o, input) => {
        saved = {
          ...saved,
          notes: [
            ...saved.notes,
            { ...note, note_id: input.note_id, text: input.text, frame_index: input.frame_index },
          ],
        };
        return found(saved);
      }),
    resolveDraftReviewNote: vi
      .fn<DraftReviewGateway["resolveDraftReviewNote"]>()
      .mockImplementation(async (_p, _e, _o, id, input) => {
        saved = {
          ...saved,
          notes: saved.notes.map((item) =>
            item.note_id === id
              ? {
                  ...item,
                  revision: 2,
                  resolution: {
                    resolution_id: input.resolution_id,
                    reason: input.reason,
                    actor_id: "local-user",
                    created_at: "2026-10-08T00:01:00Z",
                  },
                }
              : item,
          ),
        };
        return found(saved);
      }),
  };
  return gateway;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  return {
    promise: new Promise<T>((done) => {
      resolve = done;
    }),
    resolve: (value: T) => resolve(value),
  };
}
async function open() {
  fireEvent.click(screen.getByRole("button", { name: "查看 / 添加手工核对记录" }));
  await screen.findByLabelText("帧号（从 0 开始）");
}
const save = () => fireEvent.click(screen.getByRole("button", { name: "保存此帧手工评论" }));
const edit = (text = "核对画面") =>
  fireEvent.change(screen.getByLabelText("评论"), { target: { value: text } });
beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("exact-output manual review notes", () => {
  it("loads only when opened and saves exact project/episode/export/assembly/hash/frame identity", async () => {
    const gateway = setup();
    render(<DraftReviewNotes job={job} gateway={gateway} />);
    expect(gateway.listDraftReviewNotes).not.toHaveBeenCalled();
    await open();
    expect(gateway.listDraftReviewNotes).toHaveBeenCalledWith(
      job.project_id,
      job.episode_id,
      job.operation_id,
    );
    expect(screen.getByText(/处理评论不代表画面修正、版权通过或正式发布批准/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("帧号（从 0 开始）"), { target: { value: "49" } });
    edit();
    save();
    await screen.findByText(/手工记录已保存并读回/);
    expect(gateway.createDraftReviewNote).toHaveBeenCalledWith(
      job.project_id,
      job.episode_id,
      job.operation_id,
      {
        ...reviewIdentity(target),
        note_id: expect.stringMatching(/^drn_[a-f0-9]{32}$/),
        frame_index: 49,
        text: "核对画面",
      },
    );
    expect(screen.getByText("第 49 帧")).toBeInTheDocument();
    expect(localStorage.getItem(key)).toBeNull();
    expect(screen.getByLabelText("评论")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "收起手工核对记录" }));
    await open();
    expect(screen.getByText("第 49 帧")).toBeInTheDocument();
  });
  it.each(["", "-1", "50", "1.5"])("rejects invalid integer frame %s", async (frame) => {
    const gateway = setup();
    render(<DraftReviewNotes job={job} gateway={gateway} />);
    await open();
    edit();
    fireEvent.change(screen.getByLabelText("帧号（从 0 开始）"), { target: { value: frame } });
    expect(screen.getByRole("button", { name: "保存此帧手工评论" })).toBeDisabled();
    expect(gateway.createDraftReviewNote).not.toHaveBeenCalled();
  });
  it("labels approximate playback capture and clamps the final frame using original rational fps", async () => {
    const gateway = setup();
    render(<DraftReviewNotes job={job} gateway={gateway} playbackSeconds={1.19} />);
    await open();
    fireEvent.click(screen.getByRole("button", { name: "从播放位置估算帧号" }));
    expect(screen.getByLabelText("帧号（从 0 开始）")).toHaveValue(29);
    expect(screen.getByText(/播放器不保证逐帧精度/)).toBeInTheDocument();
    expect(approximateFrame(2, target)).toBe(49);
    expect(approximateFrame(1, { ...target, frame_rate_num: 30000, frame_rate_den: 1001 })).toBe(
      29,
    );
    expect(approximateFrame(NaN, target)).toBeNull();
    expect(approximateFrame(-1, target)).toBeNull();
  });
  it("retains original version and notes after new assembly edits", async () => {
    const gateway = setup({
      ...initial(),
      version_status: "OLDER_VERSION",
      current_assembly_version_id: `ver_${"8".repeat(32)}`,
      current_assembly_content_hash: `sha256:${"9".repeat(64)}`,
      notes: [note],
    });
    render(<DraftReviewNotes job={job} gateway={gateway} />);
    await open();
    expect(screen.getByText(/仅对应旧版文件和原帧号/)).toBeInTheDocument();
    expect(screen.getByText(`装配：${job.assembly_version_id}`)).toBeInTheDocument();
    expect(screen.getByText(note.text)).toBeInTheDocument();
  });
  it("keeps notes readable for changed outputs, blocks creation and resolves only original comment", async () => {
    const gateway = setup({ ...initial(), output_verified: false, notes: [note] });
    render(
      <DraftReviewNotes
        job={{
          ...job,
          status: "FAILED",
          output_sha256: null,
          output_bytes: null,
          output_path: null,
          error_code: "OUTPUT_CHANGED",
        }}
        gateway={gateway}
      />,
    );
    await open();
    expect(screen.getByText(/历史评论保留/)).toBeInTheDocument();
    expect(screen.getByLabelText("评论")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "处理此评论" }));
    fireEvent.change(screen.getByLabelText("第 12 帧处理说明"), { target: { value: "核对完成" } });
    fireEvent.click(screen.getByRole("button", { name: "保存评论处理说明" }));
    await screen.findByText("处理说明：核对完成");
    expect(gateway.resolveDraftReviewNote).toHaveBeenCalledWith(
      job.project_id,
      job.episode_id,
      job.operation_id,
      note.note_id,
      {
        ...reviewIdentity(target),
        resolution_id: expect.stringMatching(/^drr_[a-f0-9]{32}$/),
        expected_revision: 1,
        reason: "核对完成",
      },
    );
    expect(screen.getByText(note.text)).toBeInTheDocument();
  });
  it("suppresses repeated clicks, preserves unknown writes across remount and retries same ID", async () => {
    const gateway = setup();
    const pending = deferred<DraftReviewResult>();
    gateway.createDraftReviewNote.mockReturnValueOnce(pending.promise);
    const view = render(<DraftReviewNotes job={job} gateway={gateway} />);
    await open();
    edit();
    save();
    save();
    expect(gateway.createDraftReviewNote).toHaveBeenCalledTimes(1);
    const submitted = gateway.createDraftReviewNote.mock.calls[0]?.[3];
    await act(async () => pending.resolve({ kind: "REMOTE_UNKNOWN" }));
    expect(screen.getByRole("button", { name: "保存此帧手工评论" })).toBeDisabled();
    view.unmount();
    render(<DraftReviewNotes job={job} gateway={gateway} />);
    await open();
    expect(screen.getByText(/原提交尚未读回/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "核对并重试原提交" }));
    await screen.findByText(/手工记录已保存并读回/);
    expect(gateway.createDraftReviewNote.mock.calls[1]?.[3]).toEqual(submitted);
    expect(localStorage.getItem(key)).toBeNull();
  });
  it("reconciles persisted pending ID on readback without posting again", async () => {
    localStorage.setItem(
      key,
      JSON.stringify({
        kind: "create",
        command: {
          ...reviewIdentity(target),
          note_id: note.note_id,
          frame_index: note.frame_index,
          text: note.text,
        },
      }),
    );
    const gateway = setup({ ...initial(), notes: [note] });
    render(<DraftReviewNotes job={job} gateway={gateway} />);
    await open();
    expect(screen.getByText(/手工记录已保存并读回/)).toBeInTheDocument();
    expect(gateway.createDraftReviewNote).not.toHaveBeenCalled();
    expect(localStorage.getItem(key)).toBeNull();
  });
  it("blocks writes on malformed recovery storage and on storage write failure", async () => {
    localStorage.setItem(key, "not-json");
    const gateway = setup();
    const view = render(<DraftReviewNotes job={job} gateway={gateway} />);
    await open();
    expect(screen.getByText(/本机恢复记录不可用/)).toBeInTheDocument();
    expect(screen.getByLabelText("评论")).toBeDisabled();
    view.unmount();
    localStorage.clear();
    render(<DraftReviewNotes job={job} gateway={gateway} />);
    await open();
    edit();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    save();
    await screen.findByText(/无法保存本机恢复记录，未发送提交/);
    expect(gateway.createDraftReviewNote).not.toHaveBeenCalled();
  });
  it("ignores late reply after unmount and preserves pending recovery until readback", async () => {
    const gateway = setup();
    const pending = deferred<DraftReviewResult>();
    gateway.createDraftReviewNote.mockReturnValueOnce(pending.promise);
    const view = render(<DraftReviewNotes job={job} gateway={gateway} />);
    await open();
    edit();
    save();
    view.unmount();
    await act(async () => pending.resolve(found({ ...initial(), notes: [note] })));
    expect(screen.queryByText(/已保存并读回/)).not.toBeInTheDocument();
    expect(localStorage.getItem(key)).not.toBeNull();
  });
  it("rejects wrong output receipt instead of displaying notes or a success message", async () => {
    const gateway = setup({ ...initial(), target: { ...target, output_sha256: "a".repeat(64) } });
    render(<DraftReviewNotes job={job} gateway={gateway} />);
    fireEvent.click(screen.getByRole("button", { name: "查看 / 添加手工核对记录" }));
    await screen.findByText(/尚未可靠读回/);
    expect(screen.queryByLabelText("评论")).not.toBeInTheDocument();
  });
  it("offers no false browser persistence when capability is absent", () => {
    render(<DraftReviewNotes job={job} />);
    fireEvent.click(screen.getByRole("button", { name: "查看 / 添加手工核对记录" }));
    expect(screen.getByText(/尚未提供手工记录保存功能/)).toBeInTheDocument();
  });
  it("definite rejection preserves typed text and unlocks editing without claiming save", async () => {
    const gateway = setup();
    gateway.createDraftReviewNote.mockResolvedValueOnce({
      kind: "DEFINITE_SERVER_ERROR",
      status: 409,
      code: "DRAFT_REVIEW_OUTPUT_UNAVAILABLE",
      request_id: "00000000-0000-4000-8000-000000000001",
    });
    render(<DraftReviewNotes job={job} gateway={gateway} />);
    await open();
    edit();
    save();
    await screen.findByText(/请求被拒绝/);
    await waitFor(() => expect(screen.getByLabelText("评论")).toBeEnabled());
    expect(screen.getByLabelText("评论")).toHaveValue("核对画面");
    expect(localStorage.getItem(key)).toBeNull();
    expect(screen.queryByText(/已保存并读回/)).not.toBeInTheDocument();
  });
});

describe("bounded per-output unsaved editor recovery", () => {
  it("preserves unsent frame/text across collapse and remount without creating a saved comment", async () => {
    const gateway = setup();
    const view = render(<DraftReviewNotes job={job} gateway={gateway} />);
    await open();
    fireEvent.change(screen.getByLabelText("帧号（从 0 开始）"), { target: { value: "31" } });
    edit("尚未提交的剪辑意见");
    fireEvent.click(screen.getByRole("button", { name: "收起手工核对记录" }));
    await open();
    expect(screen.getByLabelText("评论")).toHaveValue("尚未提交的剪辑意见");
    view.unmount();
    render(<DraftReviewNotes job={job} gateway={gateway} />);
    await open();
    expect(screen.getByLabelText("帧号（从 0 开始）")).toHaveValue(31);
    expect(screen.getByLabelText("评论")).toHaveValue("尚未提交的剪辑意见");
    expect(screen.getByText(/尚未保存为手工记录/)).toBeInTheDocument();
    expect(gateway.createDraftReviewNote).not.toHaveBeenCalled();
    save();
    await screen.findByText(/手工记录已保存并读回/);
    expect(screen.getByLabelText("评论")).toHaveValue("");
  });
  it("restores resolution input and requires explicit discard; another output remains empty", async () => {
    const gateway = setup({ ...initial(), notes: [note] });
    const view = render(<DraftReviewNotes job={job} gateway={gateway} />);
    await open();
    fireEvent.click(screen.getByRole("button", { name: "处理此评论" }));
    fireEvent.change(screen.getByLabelText("第 12 帧处理说明"), {
      target: { value: "尚未提交的处理理由" },
    });
    view.unmount();
    const reopened = render(<DraftReviewNotes job={job} gateway={gateway} />);
    await open();
    expect(screen.getByLabelText("第 12 帧处理说明")).toHaveValue("尚未提交的处理理由");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "取消处理" }));
    expect(screen.getByLabelText("第 12 帧处理说明")).toHaveValue("尚未提交的处理理由");
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "取消处理" }));
    expect(screen.queryByLabelText("第 12 帧处理说明")).not.toBeInTheDocument();
    edit("旧文件输入");
    reopened.unmount();
    const nextJob = { ...job, operation_id: `dmp_${"8".repeat(32)}` };
    const nextGateway = setup({
      ...initial(),
      target: { ...target, operation_id: nextJob.operation_id },
    });
    render(<DraftReviewNotes job={nextJob} gateway={nextGateway} />);
    await open();
    expect(screen.getByLabelText("评论")).toHaveValue("");
  });
});

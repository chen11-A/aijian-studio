import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DraftReviewWorkspace } from "./DraftReviewWorkspace";
import { persistDraftReviewSelection } from "./adapters/workspaceSelection";
import { reviewWorkspaceGateway as gateway } from "./DraftReviewWorkspace.testFixtures";
import type { DraftExportResult } from "./adapters/draftExport";
import {
  source,
  sourceJob,
  savedNote,
  requestId,
  candidateData,
  revisionScope,
} from "./adapters/draftReviewRevision.testFixtures";
import { revisionRecoveryKey } from "./adapters/draftReviewRevisionRecovery";
import { revisionIdentity } from "./adapters/draftReviewRevision";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const scope = { projectId: source.project_id, episodeId: source.episode_id };
it("requires explicit selection and restores the same source and unsent input across all entrances", async () => {
  const exports = gateway();
  const props = { ...scope, exports, onAssembly: vi.fn(), onExport: vi.fn() };
  const first = render(<DraftReviewWorkspace {...props} view="review" />);
  await screen.findByRole("option", { name: /source-DRAFT/ });
  expect(exports.get).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("审片原版 DRAFT"), {
    target: { value: source.operation_id },
  });
  await screen.findByLabelText("评论");
  fireEvent.change(screen.getByLabelText("帧号（从 0 开始）"), { target: { value: "12" } });
  fireEvent.change(screen.getByLabelText("评论"), { target: { value: "尚未提交的原版评论" } });
  first.unmount();
  const second = render(<DraftReviewWorkspace {...props} view="changes" />);
  await screen.findByLabelText("人工修改指令");
  expect(screen.getByLabelText("评论")).toHaveValue("尚未提交的原版评论");
  expect(screen.getByLabelText("帧号（从 0 开始）")).toHaveValue(12);
  expect(
    screen.getByText(`候选 ${candidateData().plans[0]!.candidates[0]!.candidate.candidate_id}`),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "按已批准计划编辑本集装配" }));
  expect(props.onAssembly).toHaveBeenCalledOnce();
  expect(exports.createFromPicker).not.toHaveBeenCalled();
  expect(exports.revision!.approveDraftReviewRevisionPlan).not.toHaveBeenCalled();
  second.unmount();
  render(<DraftReviewWorkspace {...props} view="export" />);
  await screen.findByLabelText("评论");
  expect(screen.getByLabelText("审片原版 DRAFT")).toHaveValue(source.operation_id);
  expect(exports.review!.listDraftReviewNotes).toHaveBeenLastCalledWith(
    scope.projectId,
    scope.episodeId,
    source.operation_id,
  );
});
it("reads a selected historical operation outside the latest list and rejects a mismatched receipt", async () => {
  const exports = gateway();
  vi.mocked(exports.list).mockResolvedValue({
    kind: "LISTED" as const,
    receipt: { data: { items: [] }, request_id: requestId },
  });
  persistDraftReviewSelection(localStorage, scope.projectId, scope.episodeId, source.operation_id);
  const result = render(<DraftReviewWorkspace {...scope} exports={exports} view="review" />);
  await screen.findByLabelText("评论");
  expect(exports.get).toHaveBeenCalledWith(scope.projectId, scope.episodeId, source.operation_id);
  result.unmount();
  vi.mocked(exports.get).mockResolvedValue({
    kind: "FOUND" as const,
    receipt: { data: { ...sourceJob, episode_id: `ep_${"9".repeat(32)}` }, request_id: requestId },
  });
  render(<DraftReviewWorkspace {...scope} exports={exports} view="review" />);
  await screen.findByText(/原版回执未可靠读回/);
  expect(screen.queryByLabelText("评论")).not.toBeInTheDocument();
  expect(exports.review!.createDraftReviewNote).not.toHaveBeenCalled();
});
it("ignores a late A reply after A→B→A and keeps project/episode cursors isolated", async () => {
  const exports = gateway();
  const other = { projectId: `prj_${"8".repeat(32)}`, episodeId: `ep_${"9".repeat(32)}` };
  persistDraftReviewSelection(localStorage, scope.projectId, scope.episodeId, source.operation_id);
  persistDraftReviewSelection(
    localStorage,
    other.projectId,
    other.episodeId,
    `dmp_${"0".repeat(32)}`,
  );
  let complete!: (value: DraftExportResult) => void;
  vi.mocked(exports.get).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const result = render(<DraftReviewWorkspace {...scope} exports={exports} view="review" />);
  await screen.findByText(/正在读取原版/);
  result.rerender(<DraftReviewWorkspace {...other} exports={exports} view="review" />);
  await screen.findByText(/原版回执未可靠读回/);
  result.rerender(<DraftReviewWorkspace {...scope} exports={exports} view="review" />);
  await screen.findByLabelText("评论");
  await act(async () =>
    complete({
      kind: "FOUND" as const,
      receipt: {
        data: { ...sourceJob, output_filename: "obsolete-DRAFT.mp4" },
        request_id: requestId,
      },
    }),
  );
  expect(screen.queryByText("obsolete-DRAFT.mp4")).not.toBeInTheDocument();
  expect(screen.getByLabelText("审片原版 DRAFT")).toHaveValue(source.operation_id);
});

it("protects unsaved input on selection, refresh and native navigation and restores it after accepted leave", async () => {
  const exports = gateway();
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const guard: { current: (() => boolean) | null } = { current: null };
  const setNavigationGuard = (next: (() => boolean) | null) => {
    guard.current = next;
  };
  persistDraftReviewSelection(localStorage, scope.projectId, scope.episodeId, source.operation_id);
  render(
    <DraftReviewWorkspace
      {...scope}
      exports={exports}
      view="review"
      setNavigationGuard={setNavigationGuard}
    />,
  );
  await screen.findByLabelText("评论");
  fireEvent.change(screen.getByLabelText("评论"), { target: { value: "需要保留的输入" } });
  expect(guard.current?.()).toBe(false);
  fireEvent.change(screen.getByLabelText("审片原版 DRAFT"), { target: { value: "" } });
  expect(screen.getByLabelText("审片原版 DRAFT")).toHaveValue(source.operation_id);
  expect(screen.getByLabelText("评论")).toHaveValue("需要保留的输入");
  fireEvent.click(screen.getByRole("button", { name: "重新读取原版与导出列表（只读）" }));
  expect(exports.get).toHaveBeenCalledTimes(1);
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "重新读取原版与导出列表（只读）" }));
  await screen.findByLabelText("评论");
  expect(screen.getByLabelText("评论")).toHaveValue("需要保留的输入");
  expect(exports.createFromPicker).not.toHaveBeenCalled();
});

it("retains an UNKNOWN plan write across entrances and only reads on explicit reconciliation", async () => {
  const exports = gateway();
  const pending = {
    kind: "create",
    command: {
      ...revisionIdentity(source),
      plan_id: `drp_${"8".repeat(32)}`,
      note_ids: [savedNote.note_id],
      affected_segment_ids: [revisionScope().segments[0]!.segment_id],
      instruction: "未知提交的原内容",
    },
  };
  localStorage.setItem(revisionRecoveryKey(source), JSON.stringify(pending));
  persistDraftReviewSelection(localStorage, scope.projectId, scope.episodeId, source.operation_id);
  const first = render(<DraftReviewWorkspace {...scope} exports={exports} view="changes" />);
  await screen.findByText("未知提交的原内容");
  expect(await screen.findByRole("button", { name: "保存人工修改计划" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "重新读取修改计划（只读）" }));
  expect(exports.revision!.createDraftReviewRevisionPlan).not.toHaveBeenCalled();
  first.unmount();
  render(<DraftReviewWorkspace {...scope} exports={exports} view="changes" />);
  await screen.findByText("未知提交的原内容");
  expect(exports.revision!.createDraftReviewRevisionPlan).not.toHaveBeenCalled();
  expect(localStorage.getItem(revisionRecoveryKey(source))).toBe(JSON.stringify(pending));
});

it.each([
  { assembly_version_id: `ver_${"0".repeat(32)}` },
  { assembly_content_hash: `sha256:${"0".repeat(64)}` },
  { output_sha256: "0".repeat(64) },
  { output_bytes: 101 },
])(
  "blocks selected readback inconsistent with the listed immutable identity: %j",
  async (patch) => {
    const exports = gateway();
    vi.mocked(exports.get).mockResolvedValue({
      kind: "FOUND",
      receipt: { data: { ...sourceJob, ...patch }, request_id: requestId },
    });
    persistDraftReviewSelection(
      localStorage,
      scope.projectId,
      scope.episodeId,
      source.operation_id,
    );
    render(<DraftReviewWorkspace {...scope} exports={exports} view="review" />);
    await screen.findByText(/原版回执未可靠读回/);
    expect(screen.queryByLabelText("评论")).not.toBeInTheDocument();
    expect(exports.review!.listDraftReviewNotes).not.toHaveBeenCalled();
  },
);

it("retains historical notes and verified candidate comparison when the source file changes", async () => {
  const exports = gateway();
  vi.mocked(exports.get).mockResolvedValue({
    kind: "FOUND",
    receipt: {
      data: {
        ...sourceJob,
        status: "FAILED",
        error_code: "OUTPUT_CHANGED",
        output_path: null,
        output_bytes: null,
        output_sha256: null,
      },
      request_id: requestId,
    },
  });
  const notesResult = await exports.review!.listDraftReviewNotes(
    scope.projectId,
    scope.episodeId,
    source.operation_id,
  );
  if (notesResult.kind !== "FOUND") throw Error("fixture unavailable");
  vi.mocked(exports.review!.listDraftReviewNotes).mockResolvedValue({
    ...notesResult,
    receipt: {
      ...notesResult.receipt,
      data: {
        ...notesResult.receipt.data,
        output_verified: false,
        version_status: "OLDER_VERSION",
      },
    },
  });
  vi.mocked(exports.revision!.listDraftReviewRevisionPlans).mockResolvedValue({
    kind: "FOUND",
    receipt: {
      data: {
        ...candidateData(),
        output_verified: false,
      },
      request_id: requestId,
    },
  });
  persistDraftReviewSelection(localStorage, scope.projectId, scope.episodeId, source.operation_id);
  render(<DraftReviewWorkspace {...scope} exports={exports} view="changes" />);
  await screen.findByLabelText("人工修改指令");
  expect(screen.getByLabelText("评论")).toBeDisabled();
  expect(screen.getByRole("button", { name: "保存人工修改计划" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "播放原版草稿" })).toBeDisabled();
  expect(
    screen.getByText(`候选 ${candidateData().plans[0]!.candidates[0]!.candidate.candidate_id}`),
  ).toBeInTheDocument();
});

it("recovers separate unsent comments in two projects with two episodes each", async () => {
  const exports = gateway();
  const records = ["1", "2"].flatMap((p) =>
    ["3", "4"].map((e) => ({
      ...sourceJob,
      project_id: `prj_${p.repeat(32)}`,
      episode_id: `ep_${e.repeat(32)}`,
      operation_id: `dmp_${(p + e).repeat(16)}`,
    })),
  );
  vi.mocked(exports.list).mockImplementation(async (p, e) => ({
    kind: "LISTED",
    receipt: {
      data: { items: records.filter((item) => item.project_id === p && item.episode_id === e) },
      request_id: requestId,
    },
  }));
  vi.mocked(exports.get).mockImplementation(async (p, e, op) => {
    const item = records.find(
      (record) => record.project_id === p && record.episode_id === e && record.operation_id === op,
    );
    return item
      ? { kind: "FOUND", receipt: { data: item, request_id: requestId } }
      : { kind: "NOT_FOUND", request_id: requestId };
  });
  vi.mocked(exports.review!.listDraftReviewNotes).mockImplementation(async (p, e, op) => ({
    kind: "FOUND",
    receipt: {
      data: {
        target: { ...source, project_id: p, episode_id: e, operation_id: op },
        output_verified: true,
        version_status: "CURRENT",
        current_assembly_version_id: source.assembly_version_id,
        current_assembly_content_hash: source.assembly_content_hash,
        notes: [],
        manual_review_only: true,
      },
      request_id: requestId,
    },
  }));
  for (const record of records) {
    persistDraftReviewSelection(
      localStorage,
      record.project_id,
      record.episode_id,
      record.operation_id,
    );
    const result = render(
      <DraftReviewWorkspace
        projectId={record.project_id}
        episodeId={record.episode_id}
        exports={exports}
        view="review"
      />,
    );
    await screen.findByLabelText("评论");
    expect(screen.getByLabelText("评论")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("评论"), {
      target: { value: `输入-${record.operation_id}` },
    });
    result.unmount();
  }
  for (const record of [...records].reverse()) {
    const result = render(
      <DraftReviewWorkspace
        projectId={record.project_id}
        episodeId={record.episode_id}
        exports={exports}
        view="export"
      />,
    );
    await screen.findByLabelText("评论");
    expect(screen.getByLabelText("评论")).toHaveValue(`输入-${record.operation_id}`);
    expect(screen.getByLabelText("审片原版 DRAFT")).toHaveValue(record.operation_id);
    result.unmount();
  }
  expect(exports.review!.createDraftReviewNote).not.toHaveBeenCalled();
});

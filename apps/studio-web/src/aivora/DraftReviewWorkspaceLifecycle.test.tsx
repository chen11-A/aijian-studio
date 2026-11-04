import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DraftReviewWorkspace } from "./DraftReviewWorkspace";
import { reviewWorkspaceGateway } from "./DraftReviewWorkspace.testFixtures";
import { reviewRevisionLifecycle } from "./DraftReviewWorkspaceLifecycle.testFixtures";
import { persistDraftReviewSelection } from "./adapters/workspaceSelection";
import {
  candidate,
  candidateJob,
  plan,
  source,
  sourceJob,
  savedNote,
  requestId,
} from "./adapters/draftReviewRevision.testFixtures";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("saves a frame note, plan, explicit approval and later candidate recheck through the shared entrances", async () => {
  const lifecycle = reviewRevisionLifecycle();
  const exports = reviewWorkspaceGateway();
  exports.revision = lifecycle.gateway;
  exports.list = lifecycle.exports.list;
  exports.get = vi.fn(async (_p, _e, op) => ({
    kind: "FOUND" as const,
    receipt: { data: op === source.operation_id ? sourceJob : candidateJob, request_id: requestId },
  }));
  let notes = [savedNote];
  const original = await exports.review!.listDraftReviewNotes(
    source.project_id,
    source.episode_id,
    source.operation_id,
  );
  if (original.kind !== "FOUND") throw Error("unavailable test data");
  const read = () => ({
    ...original,
    receipt: { ...original.receipt, data: { ...original.receipt.data, notes } },
  });
  exports.review!.listDraftReviewNotes = vi.fn(async () => read());
  exports.review!.createDraftReviewNote = vi.fn(async (_p, _e, _o, command) => {
    notes = [
      ...notes,
      {
        ...savedNote,
        note_id: command.note_id,
        frame_index: command.frame_index,
        text: command.text,
      },
    ];
    return read();
  });
  const onAssembly = vi.fn(),
    onExport = vi.fn();
  const props = {
    projectId: source.project_id,
    episodeId: source.episode_id,
    exports,
    onAssembly,
    onExport,
  };
  persistDraftReviewSelection(
    localStorage,
    source.project_id,
    source.episode_id,
    source.operation_id,
  );
  const first = render(<DraftReviewWorkspace {...props} view="review" />);
  await screen.findByLabelText("评论");
  fireEvent.change(screen.getByLabelText("帧号（从 0 开始）"), { target: { value: "13" } });
  fireEvent.change(screen.getByLabelText("评论"), { target: { value: "精确整数帧的新批注" } });
  fireEvent.click(screen.getByRole("button", { name: "保存此帧手工评论" }));
  await screen.findByText("精确整数帧的新批注");
  expect(exports.review!.createDraftReviewNote).toHaveBeenCalledWith(
    source.project_id,
    source.episode_id,
    source.operation_id,
    expect.objectContaining({
      assembly_version_id: source.assembly_version_id,
      assembly_content_hash: source.assembly_content_hash,
      frame_index: 13,
    }),
  );
  first.unmount();
  const second = render(<DraftReviewWorkspace {...props} view="changes" />);
  await screen.findByLabelText("人工修改指令");
  fireEvent.click(screen.getByRole("checkbox", { name: /原版第 12 帧/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: /VISUAL.*seg_visual_1/ }));
  fireEvent.change(screen.getByLabelText("人工修改指令"), { target: { value: plan.instruction } });
  fireEvent.click(screen.getByRole("button", { name: "保存人工修改计划" }));
  const approve = await screen.findByRole("button", { name: "明确批准此人工修改计划" });
  expect(exports.revision!.approveDraftReviewRevisionPlan).not.toHaveBeenCalled();
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  fireEvent.click(approve);
  expect(exports.revision!.approveDraftReviewRevisionPlan).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  fireEvent.click(approve);
  await screen.findByRole("button", { name: "按已批准计划编辑本集装配" });
  expect(exports.createFromPicker).not.toHaveBeenCalled();
  expect(exports.cancel).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "按已批准计划编辑本集装配" }));
  expect(onAssembly).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "另行导出本集新装配草稿" }));
  expect(onExport).toHaveBeenCalledOnce();
  const entry = lifecycle.getSaved().plans[0]!;
  fireEvent.change(screen.getByLabelText(`计划 ${entry.plan.plan_id} 候选草稿`), {
    target: { value: candidateJob.operation_id },
  });
  fireEvent.change(screen.getByLabelText(`计划 ${entry.plan.plan_id} 人工修改摘要`), {
    target: { value: candidate.change_summary },
  });
  fireEvent.click(screen.getByRole("button", { name: "关联此精确候选草稿" }));
  await screen.findByRole("button", { name: "保存此候选人工复核记录" });
  const linked = lifecycle.getSaved().plans[0]!.candidates[0]!.candidate;
  fireEvent.change(screen.getByLabelText(`候选 ${linked.candidate_id} 人工复核结果`), {
    target: { value: "MANUALLY_CHECKED" },
  });
  fireEvent.change(screen.getByLabelText(`候选 ${linked.candidate_id} 人工复核说明`), {
    target: { value: "已独立核对候选，保留原版" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存此候选人工复核记录" }));
  await screen.findByText("人工复核记录：已人工核对");
  second.unmount();
  render(<DraftReviewWorkspace {...props} view="changes" />);
  await screen.findByText("人工复核记录：已人工核对");
  expect(lifecycle.getSaved().plans).toHaveLength(1);
  await waitFor(() =>
    expect(screen.getByLabelText("审片原版草稿")).toHaveValue(source.operation_id),
  );
  expect(exports.createFromPicker).not.toHaveBeenCalled();
  expect(notes.map((note) => note.text)).toContain("精确整数帧的新批注");
});

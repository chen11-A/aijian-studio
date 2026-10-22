import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MediaPages } from "./MediaPages";
import { reviewWorkspaceGateway } from "./DraftReviewWorkspace.testFixtures";
import { source } from "./adapters/draftReviewRevision.testFixtures";
import { persistDraftReviewSelection } from "./adapters/workspaceSelection";
import type { PageId } from "./data";
import type * as Model from "./model";
import {
  InvalidationHistoryController,
  type InvalidationHistoryState,
} from "../domain/invalidation-history-controller";

const state = vi.hoisted(() => ({
  page: "review" as PageId,
  exports: undefined as ReturnType<typeof reviewWorkspaceGateway> | undefined,
  projectId: "" as string | null,
  episodeId: "" as string | null,
  guard: null as (() => boolean) | null,
  go: vi.fn(),
  history: undefined as InvalidationHistoryState | undefined,
  controller: undefined as InvalidationHistoryController | undefined,
}));
vi.mock("./model", async (importOriginal) => ({
  ...(await importOriginal<typeof Model>()),
  useDemo: () => ({
    page: state.page,
    isFixture: false,
    shots: [],
    time: 0,
    selectedShot: 0,
    backendProjectId: state.projectId,
    selectedEpisodeId: state.episodeId,
    go: state.go,
    invalidationHistory: state.history,
    invalidationHistoryController: state.controller,
    setNavigationGuard: (guard: (() => boolean) | null) => {
      state.guard = guard;
    },
  }),
}));
vi.mock("../api/studio", () => ({
  createStudioTransport: () => ({ draftExports: state.exports }),
}));
beforeEach(() => {
  localStorage.clear();
  state.page = "review";
  state.projectId = source.project_id;
  state.episodeId = source.episode_id;
  state.exports = reviewWorkspaceGateway();
  state.go.mockClear();
  state.history = undefined;
  state.controller = undefined;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("renders real notes and plans on original review/changes/export routes and keeps the same episode for manual editing", async () => {
  persistDraftReviewSelection(
    localStorage,
    source.project_id,
    source.episode_id,
    source.operation_id,
  );
  const result = render(<MediaPages />);
  await screen.findByLabelText("评论");
  expect(screen.getByLabelText("审片原版 DRAFT")).toHaveValue(source.operation_id);
  state.page = "changes";
  result.rerender(<MediaPages />);
  await screen.findByLabelText("人工修改指令");
  fireEvent.click(screen.getByRole("button", { name: "按已批准计划编辑本集装配" }));
  expect(state.go).toHaveBeenCalledWith("assembly");
  expect(state.projectId).toBe(source.project_id);
  expect(state.episodeId).toBe(source.episode_id);
  expect(state.exports!.createFromPicker).not.toHaveBeenCalled();
  state.page = "export";
  result.rerender(<MediaPages />);
  await screen.findByLabelText("评论");
  expect(screen.getByLabelText("审片原版 DRAFT")).toHaveValue(source.operation_id);
  expect(screen.getAllByLabelText("评论")).toHaveLength(1);
  expect(state.exports!.createFromPicker).not.toHaveBeenCalled();
  expect(state.exports!.revision!.approveDraftReviewRevisionPlan).not.toHaveBeenCalled();
});

it.each(["review", "changes", "export"] as const)(
  "requires a real episode at the %s route",
  (page) => {
    state.page = page;
    state.episodeId = null;
    render(<MediaPages />);
    expect(screen.getByRole("button", { name: "打开雾城来信" })).toBeEnabled();
    expect(screen.queryByLabelText("审片原版 DRAFT")).not.toBeInTheDocument();
    expect(state.exports!.get).not.toHaveBeenCalled();
  },
);

it("shows the saved project approval impact source on native changes even without a selected episode", async () => {
  const list = vi.fn().mockResolvedValue({
    request_id: "12345678-abcd-1234-1234-123456789012",
    data: {
      items: [
        {
          project_id: source.project_id,
          operation_id: "ivo_" + "a".repeat(32),
          changed_artifact_id: "art_" + "b".repeat(32),
          old_accepted_version_id: "ver_" + "c".repeat(32),
          new_accepted_version_id: "ver_" + "d".repeat(32),
          gate_decision_id: "dec_" + "e".repeat(32),
          assessment_hash: "sha256:" + "f".repeat(64),
          created_at: "2026-10-11T04:00:00Z",
          reason_path_count: 4,
        },
      ],
      next_cursor: null,
    },
  });
  state.controller = new InvalidationHistoryController({ list, get: vi.fn() }, source.project_id);
  await state.controller.loadInitial();
  state.history = state.controller.getState();
  state.page = "changes";
  state.episodeId = null;
  render(<MediaPages />);
  expect(screen.getByRole("heading", { name: "作品批准替代与下游影响" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "内容版本发生变更 · 4 条影响路径" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "打开雾城来信" })).toBeEnabled();
  expect(list).toHaveBeenCalledWith(source.project_id, { limit: 20 });
  expect(state.exports!.createFromPicker).not.toHaveBeenCalled();
  expect(state.exports!.revision!.approveDraftReviewRevisionPlan).not.toHaveBeenCalled();
});

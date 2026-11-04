import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { StudioTransport } from "../api/studio";
import type * as StudioModule from "../api/studio";
import { createFakeTimelineRunOperationJournal } from "../fake-timeline-run-operation-journal";
import { DevelopmentMediaPanel } from "./DevelopmentMediaPanel";

let transport: Partial<StudioTransport>;
const projectId = `prj_${"1".repeat(32)}`;
const sourceId = `src_${"2".repeat(32)}`;
const versionId = `ver_${"3".repeat(32)}`;
const operationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const taskId = `task_${"4".repeat(32)}`;
function association() {
  return {
    schema_version: 1,
    project_id: projectId,
    operation_id: operationId,
    source_manifest_version_id: versionId,
    source_document_id: sourceId,
    workflow_run_id: `wfr_${"5".repeat(32)}`,
    node_run_id: `node_${"6".repeat(32)}`,
    attempt_id: `att_${"7".repeat(32)}`,
    task_id: taskId,
  };
}
function manifest() {
  return {
    data: {
      project_id: projectId,
      head: { accepted_version_id: versionId },
      accepted_version: {
        id: versionId,
        content: { documents: [{ source_document_id: sourceId, filename: "fixture.txt" }] },
      },
    },
  };
}
// This component consumes a model read view; the adapter and operation journal stay real.
function modelView() {
  return {
    backendProjectId: projectId as string | null,
    sourceManifest: manifest(),
    taskQueue: { state: { kind: "loading" }, reload: vi.fn().mockResolvedValue(undefined) },
    timelineWorkspaceController: { reload: vi.fn(), getState: vi.fn() },
    refreshRealSourceStage: vi.fn(),
  };
}
let view = modelView();
vi.mock("./model", () => ({ useDemo: () => view }));
vi.mock("../api/studio", async (original) => ({
  ...(await original<typeof StudioModule>()),
  createStudioTransport: () => transport,
}));
function setup() {
  const api = {
    getSource: vi.fn().mockResolvedValue({ data: { id: sourceId, project_id: projectId } }),
    getSourceManifest: vi.fn().mockResolvedValue(manifest()),
    listProjectTasks: vi.fn(),
    getProjectTimeline: vi.fn(),
    fakeTimelineRuns: {
      create: vi.fn().mockResolvedValue({ kind: "REMOTE_UNKNOWN" }),
      query: vi
        .fn()
        .mockResolvedValue({ kind: "NOT_FOUND", project_id: projectId, operation_id: operationId }),
    },
  };
  transport = api;
  return { api, ...render(<DevelopmentMediaPanel />) };
}
function selectSource() {
  fireEvent.change(screen.getByLabelText("选择本地 Fake 制作来源"), {
    target: { value: sourceId },
  });
}
function click(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}
function pending() {
  createFakeTimelineRunOperationJournal(localStorage, {
    operationId: () => operationId,
    now: () => "2026-10-10T00:00:00Z",
  }).begin(projectId, {
    source_manifest_version_id: versionId,
    source_document_id: sourceId,
  });
}
beforeEach(() => {
  localStorage.clear();
  view = modelView();
  vi.spyOn(crypto, "randomUUID").mockReturnValue(operationId);
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("development media explicit user actions", () => {
  test.each(["current", "stale-workspace", "old-output", "not-ready", "unavailable"])(
    "task readback distinguishes %s without claiming a provider result",
    async (state) => {
      localStorage.setItem(
        `aijian.fake-timeline-run.recovered.v1:${projectId}`,
        JSON.stringify(association()),
      );
      const h = setup();
      h.api.listProjectTasks.mockResolvedValue({
        data: {
          project_id: projectId,
          tasks: [
            {
              task: {
                task_id: taskId,
                kind: "local.timeline.assemble.fake.media.v1",
                status: state === "not-ready" ? "QUEUED" : "COMPLETED",
              },
              attempt: { status: "SUCCEEDED", execution_mode: "local" },
              node: { status: "SUCCEEDED", output_version_id: versionId },
            },
          ],
        },
      });
      h.api.getProjectTimeline.mockResolvedValue({
        data: {
          project_id: projectId,
          version_id: state === "old-output" ? "old" : versionId,
          timeline: { media_package: {} },
        },
      });
      view.timelineWorkspaceController.getState.mockReturnValue({
        kind: "ready",
        projectId,
        response: { data: { version_id: state === "stale-workspace" ? "old" : versionId } },
      });
      if (state === "unavailable") h.api.listProjectTasks.mockRejectedValue(new Error("offline"));
      click("查询任务与时间线");
      const notice = {
        current: /任务、素材与当前真实时间线版本一致/,
        "stale-workspace": /任务产物已读回，但制作时间线未同步/,
        "old-output": /任务成功记录与当前时间线版本不一致/,
        "not-ready": /素材尚未满足完成条件/,
        unavailable: /无法读取此任务或时间线/,
      }[state]!;
      expect(await screen.findByText(notice)).toBeInTheDocument();
      expect(h.api.fakeTimelineRuns.create).not.toHaveBeenCalled();
      expect(view.taskQueue.reload).toHaveBeenCalledTimes(1);
      expect(view.timelineWorkspaceController.reload).toHaveBeenCalledTimes(
        state === "current" || state === "stale-workspace" ? 1 : 0,
      );
    },
  );
  test.each(["success", "cleanup-failure", "storage-failure", "identity"])(
    "recovery %s only changes local state after matching readback",
    async (state) => {
      pending();
      const h = setup();
      const { schema_version: _schema, ...data } = association();
      void _schema;
      h.api.fakeTimelineRuns.query.mockResolvedValue({
        kind: "FOUND",
        receipt: {
          request_id: operationId,
          data: { ...data, operation_id: state === "identity" ? "wrong" : operationId },
        },
      });
      if (state === "cleanup-failure")
        vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
          throw new Error("locked");
        });
      if (state === "storage-failure")
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
          throw new Error("full");
        });
      click("查询原提交");
      const notice = {
        success: /已找回原提交关联任务/,
        "cleanup-failure": /原提交身份已核对，但本地锁清理未确认/,
        "storage-failure": /原操作恢复记录无法安全保存或读取/,
        identity: /原操作查询身份不一致或期间已变化/,
      }[state]!;
      expect(await screen.findByText(notice)).toBeInTheDocument();
      expect(h.api.fakeTimelineRuns.create).not.toHaveBeenCalled();
      expect(createFakeTimelineRunOperationJournal(localStorage).load(projectId) === null).toBe(
        state === "success",
      );
    },
  );
  test("requires a project and does not dispatch on mount", () => {
    view.backendProjectId = null;
    const h = setup();
    expect(screen.getByText("请先选择本地项目。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "提交本地 Fake 任务" })).toBeDisabled();
    expect(h.api.fakeTimelineRuns.create).not.toHaveBeenCalled();
  });
  test("source refresh is explicit when the manifest has no approved documents", () => {
    view.sourceManifest.data.accepted_version.content.documents = [];
    const h = setup();
    click("重新读取来源审核");
    expect(view.refreshRealSourceStage).toHaveBeenCalledTimes(1);
    expect(h.api.getSource).not.toHaveBeenCalled();
  });
  test("preflight reads the selected source and manifest but does not submit", async () => {
    const h = setup();
    selectSource();
    click("核对来源");
    expect(await screen.findByText(/来源与已批准清单匹配/)).toBeInTheDocument();
    expect(h.api.getSource).toHaveBeenCalledExactlyOnceWith(projectId, sourceId);
    expect(h.api.fakeTimelineRuns.create).not.toHaveBeenCalled();
  });
  test.each(["throw", "project", "source"])(
    "invalid source %s prevents submission",
    async (fault) => {
      const h = setup();
      selectSource();
      if (fault === "throw") h.api.getSource.mockRejectedValue(new Error("offline"));
      else
        h.api.getSource.mockResolvedValue({
          data: {
            id: fault === "source" ? "wrong" : sourceId,
            project_id: fault === "project" ? "wrong" : projectId,
          },
        });
      click("提交本地 Fake 任务");
      expect(await screen.findByText(/无法读取所选真实来源/)).toBeInTheDocument();
      expect(h.api.fakeTimelineRuns.create).not.toHaveBeenCalled();
    },
  );
  test.each(["missing", "throw"])("unavailable manifest %s prevents POST", async (fault) => {
    const h = setup();
    selectSource();
    if (fault === "throw") h.api.getSourceManifest.mockRejectedValue(new Error("offline"));
    else
      h.api.getSourceManifest.mockResolvedValue({
        ...manifest(),
        data: { ...manifest().data, head: { accepted_version_id: "" } },
      });
    click("提交本地 Fake 任务");
    expect(
      await screen.findByText(fault === "throw" ? /任务提交不可用/ : /来源预检未通过/),
    ).toBeInTheDocument();
    expect(h.api.fakeTimelineRuns.create).not.toHaveBeenCalled();
  });
  test("UNKNOWN persists identity and locks submit; recovery only queries", async () => {
    const h = setup();
    selectSource();
    click("提交本地 Fake 任务");
    expect(await screen.findByText(/^提交结果未知，操作 ID/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "提交本地 Fake 任务" })).toBeDisabled();
    click("查询原提交");
    expect(await screen.findByText(/按原操作未找到权威回执/)).toBeInTheDocument();
    expect(h.api.fakeTimelineRuns.create).toHaveBeenCalledTimes(1);
    expect(h.api.fakeTimelineRuns.query).toHaveBeenCalledTimes(1);
    expect(createFakeTimelineRunOperationJournal(localStorage).load(projectId)?.operation_id).toBe(
      operationId,
    );
  });
  test.each(["REMOTE_UNKNOWN", "throw", "DEFINITE_SERVER_ERROR"])(
    "reopened %s recovery preserves the lock",
    async (fault) => {
      pending();
      const h = setup();
      selectSource();
      if (fault === "throw") h.api.fakeTimelineRuns.query.mockRejectedValue(new Error("offline"));
      else
        h.api.fakeTimelineRuns.query.mockResolvedValue({
          kind: fault,
          project_id: projectId,
          operation_id: operationId,
          status: 409,
          code: "CONFLICT",
        });
      click("查询原提交");
      expect(
        await screen.findByText(
          fault === "DEFINITE_SERVER_ERROR" ? /原操作查询被拒绝/ : /原操作查询结果未知或不可用/,
        ),
      ).toBeInTheDocument();
      expect(h.api.fakeTimelineRuns.create).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "提交本地 Fake 任务" })).toBeDisabled();
    },
  );
  test("corrupt journal remains untouched and blocks submit", () => {
    const key = `aijian.fake-timeline-run.pending.v1:${projectId}`;
    localStorage.setItem(key, "{");
    const h = setup();
    selectSource();
    expect(screen.getByText(/本地操作或恢复记录损坏/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "提交本地 Fake 任务" })).toBeDisabled();
    expect(localStorage.getItem(key)).toBe("{");
    expect(h.api.fakeTimelineRuns.create).not.toHaveBeenCalled();
  });
  test("late source read after navigation cannot dispatch or update the new project", async () => {
    const h = setup();
    let finish!: () => void;
    h.api.getSource.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ data: { id: sourceId, project_id: projectId } });
        }),
    );
    selectSource();
    click("提交本地 Fake 任务");
    view.backendProjectId = `prj_${"9".repeat(32)}`;
    h.rerender(<DevelopmentMediaPanel />);
    await act(async () => {
      finish();
    });
    expect(h.api.getSourceManifest).not.toHaveBeenCalled();
    expect(h.api.fakeTimelineRuns.create).not.toHaveBeenCalled();
    expect(screen.queryByText(/提交结果未知，操作 ID/)).not.toBeInTheDocument();
  });
});

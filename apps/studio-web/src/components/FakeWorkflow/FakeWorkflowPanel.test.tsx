import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type {
  FakeTimelineRunCapability,
  ProjectData,
  SourceDocumentResponse,
  SourceManifestResponse,
} from "../../api/studio";
import { createFakeTimelineRunOperationJournal } from "../../fake-timeline-run-operation-journal";
import { FakeWorkflowPanel } from "./FakeWorkflowPanel";

const project = {
  id: `prj_${"1".repeat(32)}`,
  name: "雾城来信",
} as ProjectData;
const sourceId = `src_${"2".repeat(32)}`;
const versionId = `ver_${"4".repeat(32)}`;
const operationId = "7e0df32e-299a-4bb7-b77e-b85f20c41d61";
const requestId = "e6225937-1243-427b-bc98-56eda28e9dd3";
const source = {
  data: {
    id: sourceId,
    project_id: project.id,
    filename: "synthetic-fixture.txt",
    media_type: "text/plain",
    encoding: "utf-8",
    byte_size: 24,
    raw_sha256: "5".repeat(64),
    imported_at: "2026-08-11T09:00:00Z",
    chapter_count: 1,
    block_count: 1,
    blocks: [
      {
        id: `srcb_${"3".repeat(32)}`,
        ordinal: 0,
        kind: "paragraph",
        chapter_index: 1,
        text: "雾城来信的第一段原文",
        normalized_start_byte: 0,
        normalized_end_byte: 24,
        content_sha256: "6".repeat(64),
      },
    ],
  },
  request_id: requestId,
} satisfies SourceDocumentResponse;
const manifestVersion = {
  id: versionId,
  artifact_id: `art_${"7".repeat(32)}`,
  version_number: 1,
  schema_version: "1.0.0" as const,
  content: {
    scope_type: "full_work" as const,
    documents: [
      {
        source_document_id: sourceId,
        import_order: 1,
        filename: "synthetic-fixture.txt",
        media_type: "text/plain" as const,
        encoding: "utf-8" as const,
        byte_size: 24,
        raw_sha256: "5".repeat(64),
        normalized_sha256: "8".repeat(64),
        chapter_count: 1,
        blocks: [
          {
            source_block_id: `srcb_${"3".repeat(32)}`,
            ordinal: 0,
            kind: "paragraph" as const,
            chapter_index: 1,
            start_byte: 0,
            end_byte: 24,
            content_sha256: "6".repeat(64),
          },
        ],
      },
    ],
    exclusions: [],
  },
  content_hash: `sha256:${"9".repeat(64)}`,
  parent_version_id: null,
  change_summary: "冻结小说来源",
  created_at: "2026-08-11T09:01:00Z",
};
const manifest = {
  data: {
    project_id: project.id,
    head: {
      artifact_id: manifestVersion.artifact_id,
      latest_version_id: versionId,
      review_version_id: versionId,
      review_submission_id: `sub_${"a".repeat(32)}`,
      accepted_version_id: versionId,
      revision: 3,
      review_evidence_revision: 1,
      updated_at: "2026-08-11T09:02:00Z",
    },
    latest_version: manifestVersion,
    review_version: manifestVersion,
    accepted_version: manifestVersion,
  },
  request_id: requestId,
} satisfies SourceManifestResponse;
const frozenInput = {
  source_manifest_version_id: versionId,
  source_document_id: sourceId,
};
const receipt = {
  data: {
    project_id: project.id,
    source_manifest_version_id: versionId,
    source_document_id: sourceId,
    workflow_run_id: `wfr_${"4".repeat(32)}`,
    node_run_id: `node_${"5".repeat(32)}`,
    attempt_id: `att_${"6".repeat(32)}`,
    task_id: `task_${"7".repeat(32)}`,
    attempt_status: "READY" as const,
    task_status: "READY" as const,
    capability_losses: [
      "FAKE_IMAGE_NO_SEMANTIC_GENERATION",
      "STATIC_FRAME_NO_MOTION_GENERATION",
      "PLACEHOLDER_TONE_NO_SPEECH_OR_VOICE_IDENTITY",
    ] as [
      "FAKE_IMAGE_NO_SEMANTIC_GENERATION",
      "STATIC_FRAME_NO_MOTION_GENERATION",
      "PLACEHOLDER_TONE_NO_SPEECH_OR_VOICE_IDENTITY",
    ],
  },
  request_id: requestId,
};

function journal() {
  return createFakeTimelineRunOperationJournal(localStorage, {
    operationId: () => operationId,
    now: () => "2026-08-11T10:00:00.000Z",
  });
}

function renderPanel(
  overrides: Partial<{
    getManifest: (projectId: string) => Promise<SourceManifestResponse | null>;
    capability: FakeTimelineRunCapability;
    journal: ReturnType<typeof journal>;
    onOpenQueue: () => void;
  }> = {},
) {
  const getManifest = overrides.getManifest ?? vi.fn().mockResolvedValue(manifest);
  const capability = overrides.capability ?? { create: vi.fn() };
  const onOpenQueue = overrides.onOpenQueue ?? vi.fn();
  const view = render(
    <FakeWorkflowPanel
      project={project}
      source={source}
      getSourceManifest={getManifest}
      capability={capability}
      journal={overrides.journal ?? journal()}
      onOpenQueue={onOpenQueue}
    />,
  );
  return { getManifest, capability, onOpenQueue, view };
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
});

describe("fake workflow panel", () => {
  test("does not expose creation without capability or at a 480px viewport", async () => {
    const getManifest = vi.fn().mockResolvedValue(manifest);
    const create = vi.fn();
    const startFakeTimelineWorkflow = vi.fn();
    const ordinary = render(
      <FakeWorkflowPanel
        project={project}
        source={source}
        getSourceManifest={getManifest}
        onOpenQueue={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(getManifest).not.toHaveBeenCalled();
    expect(startFakeTimelineWorkflow).not.toHaveBeenCalled();
    ordinary.unmount();

    Object.defineProperty(window, "innerWidth", { configurable: true, value: 480 });
    render(
      <FakeWorkflowPanel
        project={project}
        source={source}
        getSourceManifest={getManifest}
        capability={{ create }}
        onOpenQueue={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(getManifest).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  });

  test("does not access blocked local storage without a visible creation capability", () => {
    const getManifest = vi.fn().mockResolvedValue(manifest);
    const storage = vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("storage blocked", "SecurityError");
    });

    expect(() =>
      render(
        <FakeWorkflowPanel
          project={project}
          source={source}
          getSourceManifest={getManifest}
          onOpenQueue={vi.fn()}
        />,
      ),
    ).not.toThrow();
    expect(getManifest).not.toHaveBeenCalled();
    storage.mockRestore();

    Object.defineProperty(window, "innerWidth", { configurable: true, value: 480 });
    const mobileStorage = vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("storage blocked", "SecurityError");
    });
    expect(() =>
      render(
        <FakeWorkflowPanel
          project={project}
          source={source}
          getSourceManifest={getManifest}
          capability={{ create: vi.fn() }}
          onOpenQueue={vi.fn()}
        />,
      ),
    ).not.toThrow();
    expect(getManifest).not.toHaveBeenCalled();
    mobileStorage.mockRestore();

    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
    const desktopStorage = vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("storage blocked", "SecurityError");
    });
    render(
      <FakeWorkflowPanel
        project={project}
        source={source}
        getSourceManifest={getManifest}
        capability={{ create: vi.fn() }}
        onOpenQueue={vi.fn()}
      />,
    );
    expect(
      screen.getByText("本地操作记录存储不可用，已停止创建任务。请启用本地存储后重试。"),
    ).toBeInTheDocument();
    expect(getManifest).not.toHaveBeenCalled();
    desktopStorage.mockRestore();
  });

  test("persists the operation before IPC and keeps the same identity after unknown", async () => {
    const persistent = journal();
    const create = vi.fn(async () => {
      expect(persistent.load(project.id)).toMatchObject({
        operation_id: operationId,
        input: frozenInput,
      });
      return { kind: "REMOTE_UNKNOWN" } as const;
    });
    renderPanel({ capability: { create }, journal: persistent });

    fireEvent.click(await screen.findByRole("button", { name: "生成 Fake 分镜时间线" }));
    expect(await screen.findByText("提交结果未知")).toBeInTheDocument();
    expect(screen.getByText(/不会自动换一个操作重新提交/)).toBeInTheDocument();
    expect(create).toHaveBeenCalledWith(project.id, {
      operation_id: operationId,
      input: frozenInput,
    });
    expect(persistent.load(project.id)).toMatchObject({
      operation_id: operationId,
      input: frozenInput,
    });
  });

  test("keeps the same operation after a rejected Promise and after remount when the accepted source changes", async () => {
    const persistent = journal();
    const firstCreate = vi.fn().mockRejectedValue(new Error("ipc destroyed"));
    const first = render(
      <FakeWorkflowPanel
        project={project}
        source={source}
        getSourceManifest={vi.fn().mockResolvedValue(manifest)}
        capability={{ create: firstCreate }}
        journal={persistent}
        onOpenQueue={vi.fn()}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "生成 Fake 分镜时间线" }));
    await screen.findByText("提交结果未知");
    first.unmount();

    const changedManifest: SourceManifestResponse = {
      ...manifest,
      data: {
        ...manifest.data,
        head: {
          ...manifest.data.head,
          accepted_version_id: `ver_${"9".repeat(32)}`,
          latest_version_id: `ver_${"9".repeat(32)}`,
        },
        accepted_version: {
          ...manifestVersion,
          id: `ver_${"9".repeat(32)}`,
        },
        latest_version: {
          ...manifestVersion,
          id: `ver_${"9".repeat(32)}`,
        },
      },
    };
    const reloadedManifest = vi.fn().mockResolvedValue(changedManifest);
    const retryCreate = vi.fn().mockResolvedValue({
      kind: "DEFINITE_SERVER_ERROR",
      status: 409,
      code: "FAKE_TIMELINE_RUN_CONFLICT",
      request_id: requestId,
    });
    render(
      <FakeWorkflowPanel
        project={project}
        source={source}
        getSourceManifest={reloadedManifest}
        capability={{ create: retryCreate } as FakeTimelineRunCapability}
        journal={persistent}
        onOpenQueue={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "恢复同一操作" }));
    await waitFor(() => expect(retryCreate).toHaveBeenCalled());
    expect(retryCreate.mock.calls[0]?.[1]).toEqual({
      operation_id: operationId,
      input: frozenInput,
    });
    expect(reloadedManifest).not.toHaveBeenCalled();
    expect(await screen.findByText(/服务器已明确拒绝/)).toBeInTheDocument();
    expect(screen.getByText(/FAKE_TIMELINE_RUN_CONFLICT/)).toBeInTheDocument();
    expect(persistent.load(project.id)).toBeNull();
  });

  test("distinguishes fresh enqueue, recovered replay, and cleanup-pending truth", async () => {
    const create = vi.fn().mockResolvedValue({
      kind: "SUCCEEDED",
      replayed: false,
      receipt,
    });
    const fresh = renderPanel({ capability: { create } });
    fireEvent.click(await screen.findByRole("button", { name: "生成 Fake 分镜时间线" }));
    expect(await screen.findByText("Fake 时间线已进入任务队列")).toBeInTheDocument();
    expect(screen.getByText(/后台生成必须完成之后才能进入剪辑/)).toBeInTheDocument();
    expect(screen.queryByText("PREVIEW READY")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "进入剪辑台" })).not.toBeInTheDocument();
    expect(screen.getByText(/FAKE_IMAGE_NO_SEMANTIC_GENERATION/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看任务记录" }));
    expect(fresh.onOpenQueue).toHaveBeenCalledOnce();
    fresh.view.unmount();

    const replayJournal = journal();
    const replayCreate = vi.fn().mockResolvedValue({
      kind: "SUCCEEDED",
      replayed: true,
      receipt: {
        ...receipt,
        data: { ...receipt.data, attempt_status: "SUCCEEDED", task_status: "COMPLETED" },
      },
    });
    const replayView = render(
      <FakeWorkflowPanel
        project={project}
        source={source}
        getSourceManifest={vi.fn().mockResolvedValue(manifest)}
        capability={{ create: replayCreate }}
        journal={replayJournal}
        onOpenQueue={vi.fn()}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "生成 Fake 分镜时间线" }));
    expect(await screen.findByText("已恢复原运行")).toBeInTheDocument();
    expect(screen.getByText(/COMPLETED/)).toBeInTheDocument();
    replayView.unmount();

    const cleanupJournal = {
      load: () => null,
      begin: () => ({
        schema_version: 1 as const,
        state: "PENDING_SUBMIT" as const,
        project_id: project.id,
        operation_id: operationId,
        input: frozenInput,
        created_at: "2026-08-11T10:00:00.000Z",
      }),
      complete: () => {
        throw new Error("cleanup failed");
      },
    };
    render(
      <FakeWorkflowPanel
        project={project}
        source={source}
        getSourceManifest={vi.fn().mockResolvedValue(manifest)}
        capability={{
          create: vi.fn().mockResolvedValue({
            kind: "SUCCEEDED",
            replayed: false,
            receipt,
          }),
        }}
        journal={cleanupJournal}
        onOpenQueue={vi.fn()}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "生成 Fake 分镜时间线" }));
    expect(await screen.findByText("Fake 时间线已进入任务队列")).toBeInTheDocument();
    expect(screen.getByText(/本地待恢复记录尚未确认清理/)).toBeInTheDocument();
  });

  test("does not show project A completion after switching to project B", async () => {
    const otherProject = { ...project, id: `prj_${"a".repeat(32)}`, name: "夜航" };
    let resolveCreate!: (value: { kind: "REMOTE_UNKNOWN" }) => void;
    const create = vi.fn(
      () =>
        new Promise<{ kind: "REMOTE_UNKNOWN" }>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    const view = render(
      <FakeWorkflowPanel
        key={project.id}
        project={project}
        source={source}
        getSourceManifest={vi.fn().mockResolvedValue(manifest)}
        capability={{ create }}
        journal={journal()}
        onOpenQueue={vi.fn()}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "生成 Fake 分镜时间线" }));
    await screen.findByText("正在提交已持久化的操作…");

    const unavailableManifest: SourceManifestResponse = {
      ...manifest,
      data: {
        ...manifest.data,
        project_id: otherProject.id,
        head: { ...manifest.data.head, accepted_version_id: null },
        accepted_version: null,
      },
    };
    view.rerender(
      <FakeWorkflowPanel
        key={otherProject.id}
        project={otherProject}
        source={{ ...source, data: { ...source.data, project_id: otherProject.id } }}
        getSourceManifest={vi.fn().mockResolvedValue(unavailableManifest)}
        capability={{ create }}
        journal={journal()}
        onOpenQueue={vi.fn()}
      />,
    );
    await screen.findByText(/需要先由具名人员批准来源清单/);
    resolveCreate({ kind: "REMOTE_UNKNOWN" });

    await waitFor(() => {
      expect(screen.queryByText("提交结果未知")).not.toBeInTheDocument();
    });
    expect(screen.getByText(/需要先由具名人员批准来源清单/)).toBeInTheDocument();
  });

  test("serializes same-tick create and recovery clicks", async () => {
    let resolveCreate!: (value: { kind: "REMOTE_UNKNOWN" }) => void;
    const create = vi.fn(
      () =>
        new Promise<{ kind: "REMOTE_UNKNOWN" }>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    renderPanel({ capability: { create } });
    const button = await screen.findByRole("button", { name: "生成 Fake 分镜时间线" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(create).toHaveBeenCalledOnce();
    resolveCreate({ kind: "REMOTE_UNKNOWN" });
    await screen.findByText("提交结果未知");
    const recover = screen.getByRole("button", { name: "恢复同一操作" });
    fireEvent.click(recover);
    fireEvent.click(recover);
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
  });

  test("fails closed when no accepted manifest or the source is not a member", async () => {
    const unavailableManifest: SourceManifestResponse = {
      ...manifest,
      data: {
        ...manifest.data,
        head: { ...manifest.data.head, accepted_version_id: null },
        accepted_version: null,
      },
    };
    renderPanel({ getManifest: vi.fn().mockResolvedValue(unavailableManifest) });
    expect(await screen.findByText(/需要先由具名人员批准来源清单/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "生成 Fake 分镜时间线" })).not.toBeInTheDocument();

    const detached = {
      ...manifest,
      data: {
        ...manifest.data,
        accepted_version: {
          ...manifestVersion,
          content: { ...manifestVersion.content, documents: [] },
        },
      },
    };
    render(
      <FakeWorkflowPanel
        project={project}
        source={source}
        getSourceManifest={vi.fn().mockResolvedValue(detached)}
        capability={{ create: vi.fn() }}
        journal={journal()}
        onOpenQueue={vi.fn()}
      />,
    );
    expect(await screen.findByText(/已批准来源清单不包含当前原文/)).toBeInTheDocument();
  });

  test("reports manifest transport failure separately from journal corruption", async () => {
    renderPanel({ getManifest: vi.fn().mockRejectedValue(new Error("sidecar unavailable")) });
    expect(
      await screen.findByText("无法读取已批准来源，请检查本地服务后重试。"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/本地操作记录无法安全读取/)).not.toBeInTheDocument();

    localStorage.setItem(`aijian.fake-timeline-run.pending.v1:${project.id}`, "{not-json");
    render(
      <FakeWorkflowPanel
        project={project}
        source={source}
        getSourceManifest={vi.fn().mockResolvedValue(manifest)}
        capability={{ create: vi.fn() }}
        onOpenQueue={vi.fn()}
      />,
    );
    expect(await screen.findByText(/本地操作记录无法安全读取/)).toBeInTheDocument();
  });
});

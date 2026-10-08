import "@testing-library/jest-dom/vitest";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StoryPages } from "./StoryPages";
import { EditorDialog } from "./Common";
import { DemoProvider, useDemo, createAivoraSampleFixture } from "./model";

afterEach(() => {
  cleanup();
  delete window.aijian;
});

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
function Harness() {
  const d = useDemo();
  return (
    <>
      <StoryPages />
      <EditorDialog />
      <button onClick={() => d.go("story")}>故事页</button>
      <button onClick={() => void d.readRealStoryWorkspace()}>读取真实故事工作区</button>
      <button onClick={() => void d.selectRealProject(1)}>打开第一项目</button>
      <button onClick={() => void d.selectRealProject(2)}>打开第二项目</button>
      <button
        onClick={() =>
          void d.importRealSource(new File(["新的来源"], "new-source.txt", { type: "text/plain" }))
        }
      >
        导入真实来源
      </button>
      <button onClick={() => void d.importPastedSource("原文".repeat(10_000))}>
        导入长粘贴来源
      </button>
      <button
        onClick={() =>
          void d.saveProductionBrief({
            operation_id: "123e4567-e89b-42d3-a456-426614174000",
            input: {
              parent_version_id: null,
              expected_revision: null,
              change_summary: "draft",
              content: {
                schema_version: "1.0.0",
                creative_entry: { kind: "original_idea", origin_statement: "idea", references: [] },
                creative: { premise: "p", intent: "i", constraints: [] },
                delivery: {
                  width_px: 1080,
                  height_px: 1920,
                  language: "zh-CN",
                  display_aspect_ratio: { num: 9, den: 16 },
                  frame_rate: { num: 24, den: 1 },
                },
                duration_intent: {
                  episode_mode: "unspecified",
                  work_seconds: 60,
                  episode_seconds: null,
                },
                budget_intent: { state: "unknown", amount_micros: null, currency: null },
                rights_declaration: { state: "unknown", statement: null },
              },
            },
          } as never)
        }
      >
        保存 C3 草稿
      </button>
      <button onClick={() => void d.reviewRealSource()}>提交真实来源审核</button>
      <output aria-label="状态">
        {JSON.stringify({
          source: d.value("source"),
          approved: d.value("sourceApproved"),
          submitted: d.value("sourceReviewSubmitted"),
          stage: d.sourceStage.kind,
          story: d.storyWorkspaceState,
          pendingBrief: !!d.pendingProductionBrief,
        })}
      </output>
      {d.toast && <p role="status">{d.toast}</p>}
    </>
  );
}
function openSource() {
  window.history.replaceState({}, "", "#source");
  render(
    <DemoProvider fixture={createAivoraSampleFixture()}>
      <Harness />
    </DemoProvider>,
  );
}

const projectId = `prj_${"1".repeat(32)}`;
const latestId = `ver_${"2".repeat(32)}`;
function manifest({
  accepted = latestId,
  review = null,
}: { accepted?: string | null; review?: string | null } = {}) {
  const version = (id: string, versionNumber: number) => ({
    artifact_id: `art_${"3".repeat(32)}`,
    id,
    parent_version_id: null,
    version_number: versionNumber,
    schema_version: "1.0.0",
    content_hash: `sha256:${"4".repeat(64)}`,
    change_summary: "来源版本",
    created_at: "2026-09-14T00:00:00Z",
    content: { scope_type: "full_work", documents: [] },
  });
  return {
    request_id: "manifest",
    data: {
      project_id: projectId,
      head: {
        artifact_id: `art_${"3".repeat(32)}`,
        latest_version_id: latestId,
        review_version_id: review,
        review_submission_id: review ? `sub_${"5".repeat(32)}` : null,
        accepted_version_id: accepted,
        revision: 1,
        review_evidence_revision: 0,
        updated_at: "2026-09-14T00:00:00Z",
      },
      latest_version: version(latestId, 4),
      review_version: review ? version(review, 4) : null,
      accepted_version: accepted ? version(accepted, accepted === latestId ? 4 : 3) : null,
    },
  };
}
function openRemoteSource(stage: ReturnType<typeof manifest> | null) {
  window.history.replaceState({}, "", "#source");
  window.aijian = {
    health: vi.fn().mockResolvedValue({
      request_id: "health",
      data: { status: "ok", service: "aijian-api", version: "test" },
    }),
    listProjects: vi.fn().mockResolvedValue({
      request_id: "projects",
      data: [
        {
          id: projectId,
          name: "来源项目",
          status: "active",
          revision: 1,
          updated_at: "2026-09-14T00:00:00Z",
        },
      ],
    }),
    listSources: vi.fn().mockResolvedValue({ request_id: "sources", data: [] }),
    getSourceManifest: vi.fn().mockResolvedValue(stage),
  } as unknown as Window["aijian"];
  render(
    <DemoProvider>
      <Harness />
    </DemoProvider>,
  );
}

function pending<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function sourceResponse() {
  return {
    request_id: "source",
    data: {
      id: `src_${"7".repeat(32)}`,
      project_id: projectId,
      filename: "new-source.txt",
      media_type: "text/plain",
      sha256: `sha256:${"8".repeat(64)}`,
      bytes: 12,
      blocks: [{ id: `blk_${"9".repeat(32)}`, ordinal: 1, text: "新的来源" }],
      created_at: "2026-09-14T00:00:00Z",
      updated_at: "2026-09-14T00:00:00Z",
    },
  };
}
function acceptedAdaptationManifest() {
  const accepted = manifest();
  accepted.data.accepted_version!.content.documents = [
    {
      source_document_id: `src_${"7".repeat(32)}`,
      blocks: [
        { source_block_id: `srcb_${"a".repeat(32)}`, ordinal: 1 },
        { source_block_id: `srcb_${"b".repeat(32)}`, ordinal: 2 },
      ],
    },
  ] as never;
  return accepted;
}
function productionBriefReceipt(content: unknown) {
  return {
    request_id: "brief",
    data: {
      head: { revision: 1 },
      version: { id: `ver_${"c".repeat(32)}`, version_number: 1, content },
    },
  };
}
function remoteBridge(
  getSourceManifest: () => Promise<ReturnType<typeof manifest> | null>,
  projects = [
    {
      id: projectId,
      name: "来源项目",
      status: "active",
      revision: 1,
      updated_at: "2026-09-14T00:00:00Z",
    },
  ],
) {
  return {
    health: vi.fn().mockResolvedValue({
      request_id: "health",
      data: { status: "ok", service: "aijian-api", version: "test" },
    }),
    listProjects: vi.fn().mockResolvedValue({ request_id: "projects", data: projects }),
    listSources: vi.fn().mockResolvedValue({ request_id: "sources", data: [] }),
    getSourceManifest: vi.fn(getSourceManifest),
  } as unknown as Window["aijian"];
}
function openWithBridge(bridge: Window["aijian"]) {
  window.history.replaceState({}, "", "#source");
  window.aijian = bridge;
  render(
    <DemoProvider>
      <Harness />
    </DemoProvider>,
  );
}
describe("selected story source workflow", () => {
  it("keeps pasted external text out of the source workspace until an import succeeds", () => {
    openSource();
    const before = JSON.parse(screen.getByLabelText("状态").textContent!);
    fireEvent.click(screen.getByRole("button", { name: "粘贴故事" }));
    fireEvent.change(screen.getByRole("textbox", { name: "外部原文正文" }), {
      target: { value: "新的来源正文" },
    });
    expect(JSON.parse(screen.getByLabelText("状态").textContent!)).toMatchObject({
      source: before.source,
      approved: before.approved,
    });
  });
  it("blocks a source adaptation until the current source is approved and listed", () => {
    openSource();
    fireEvent.click(screen.getByRole("button", { name: "基于已批准来源改编" }));
    expect(screen.getByText("请先选择当前已批准来源及其清单区块。")).toBeInTheDocument();
  });

  it("saves an accepted-manifest adaptation through the UI and renders its exact source identity", async () => {
    const createProductionBriefVersion = vi.fn(async (_projectId, command) => ({
      kind: "SUCCEEDED" as const,
      receipt: productionBriefReceipt(command.input.content) as never,
    }));
    const bridge = remoteBridge(async () => acceptedAdaptationManifest()) as Window["aijian"] & {
      getSource: ReturnType<typeof vi.fn>;
      createProductionBriefVersion: typeof createProductionBriefVersion;
    };
    bridge.listSources = vi.fn().mockResolvedValue({
      request_id: "sources",
      data: [{ id: `src_${"7".repeat(32)}` }],
    });
    bridge.getSource = vi.fn().mockResolvedValue(sourceResponse());
    bridge.createProductionBriefVersion = createProductionBriefVersion as never;
    openWithBridge(bridge);

    expect(await screen.findByText(/来源状态：已批准/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "基于已批准来源改编" }));
    fireEvent.change(screen.getByLabelText("改编说明"), { target: { value: "改编说明" } });
    fireEvent.change(screen.getByLabelText(/焦点区块序号/), { target: { value: "1,2" } });
    fireEvent.change(screen.getByLabelText("核心设定"), { target: { value: "核心设定" } });
    fireEvent.change(screen.getByLabelText("创作意图"), { target: { value: "创作意图" } });
    fireEvent.change(screen.getByLabelText("目标受众（可选）"), { target: { value: "青年观众" } });
    fireEvent.change(screen.getByLabelText("类型（可选）"), { target: { value: "科幻" } });
    fireEvent.change(screen.getByLabelText("风格（可选）"), { target: { value: "霓虹" } });
    fireEvent.change(screen.getByLabelText(/创作约束/), { target: { value: "不使用旁白" } });
    fireEvent.change(screen.getByLabelText("整部时长（秒，可选）"), { target: { value: "180" } });
    fireEvent.change(screen.getByLabelText("单集时长模式"), { target: { value: "按单集" } });
    fireEvent.change(screen.getByLabelText("单集时长（秒）"), { target: { value: "45" } });
    fireEvent.change(screen.getByLabelText("预算状态"), { target: { value: "已声明" } });
    fireEvent.change(screen.getByLabelText(/预算金额/), { target: { value: "12.345678" } });
    fireEvent.change(screen.getByLabelText(/预算币种/), { target: { value: "CNY" } });
    fireEvent.change(screen.getByLabelText("权利状态"), { target: { value: "用户声明" } });
    fireEvent.change(screen.getByLabelText("权利声明"), { target: { value: "已获授权" } });
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));

    await waitFor(() => expect(createProductionBriefVersion).toHaveBeenCalledOnce());
    expect(createProductionBriefVersion.mock.calls[0]![0]).toBe(projectId);
    expect(createProductionBriefVersion.mock.calls[0]![1].input.content).toMatchObject({
      creative_entry: {
        kind: "source_adaptation",
        source_document_id: `src_${"7".repeat(32)}`,
        source_manifest_version_id: latestId,
        source_block_ids: [`srcb_${"a".repeat(32)}`, `srcb_${"b".repeat(32)}`],
      },
      budget_intent: { state: "declared", amount_micros: 12345678, currency: "CNY" },
      rights_declaration: { state: "user_declared", statement: "已获授权" },
      creative: {
        premise: "核心设定",
        intent: "创作意图",
        audience: "青年观众",
        genre: "科幻",
        style: "霓虹",
        constraints: ["不使用旁白"],
      },
      duration_intent: { episode_mode: "per_episode", work_seconds: 180, episode_seconds: 45 },
    });
    expect(await screen.findByText(`来源清单版本：${latestId}`)).toBeInTheDocument();
    expect(screen.getByText(`来源文档：src_${"7".repeat(32)}`)).toBeInTheDocument();
    expect(
      screen.getByText(`焦点区块：srcb_${"a".repeat(32)}、srcb_${"b".repeat(32)}`),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/受众：青年观众；类型：科幻；风格：霓虹；约束：不使用旁白/),
    ).toBeInTheDocument();
    expect(screen.getByText("整部：180 秒；按单集：45 秒")).toBeInTheDocument();
  });

  it("blocks an opened adaptation form after the accepted source becomes unavailable", async () => {
    const createProductionBriefVersion = vi.fn();
    const bridge = remoteBridge(
      vi
        .fn()
        .mockResolvedValueOnce(acceptedAdaptationManifest())
        .mockResolvedValueOnce(manifest({ accepted: null, review: latestId })),
    ) as Window["aijian"] & {
      getSource: ReturnType<typeof vi.fn>;
      createProductionBriefVersion: typeof createProductionBriefVersion;
    };
    bridge.listSources = vi.fn().mockResolvedValue({
      request_id: "sources",
      data: [{ id: `src_${"7".repeat(32)}` }],
    });
    bridge.getSource = vi.fn().mockResolvedValue(sourceResponse());
    bridge.createProductionBriefVersion = createProductionBriefVersion;
    openWithBridge(bridge);

    expect(await screen.findByText(/来源状态：已批准/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "基于已批准来源改编" }));
    fireEvent.change(screen.getByLabelText("改编说明"), { target: { value: "改编说明" } });
    fireEvent.change(screen.getByLabelText(/焦点区块序号/), { target: { value: "1,2" } });
    fireEvent.change(screen.getByLabelText("核心设定"), { target: { value: "核心设定" } });
    fireEvent.change(screen.getByLabelText("创作意图"), { target: { value: "创作意图" } });
    fireEvent.click(screen.getByRole("button", { name: "刷新来源状态" }));
    expect(await screen.findByText(/来源状态：审核中/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));

    expect(createProductionBriefVersion).not.toHaveBeenCalled();
    expect(
      await screen.findByText("来源或审核清单已变化；请重新选择改编焦点。"),
    ).toBeInTheDocument();
  });

  it("does not submit either open C3 form into a project selected after it opened", async () => {
    const createProductionBriefVersion = vi.fn();
    const projects = [
      {
        id: projectId,
        name: "来源项目",
        status: "active",
        revision: 1,
        updated_at: "2026-09-14T00:00:00Z",
      },
      {
        id: `prj_${"d".repeat(32)}`,
        name: "第二项目",
        status: "active",
        revision: 1,
        updated_at: "2026-09-14T00:00:00Z",
      },
    ];
    const bridge = remoteBridge(
      async () => acceptedAdaptationManifest(),
      projects,
    ) as Window["aijian"] & {
      getSource: ReturnType<typeof vi.fn>;
      createProductionBriefVersion: typeof createProductionBriefVersion;
    };
    bridge.listSources = vi.fn().mockResolvedValue({
      request_id: "sources",
      data: [{ id: `src_${"7".repeat(32)}` }],
    });
    bridge.getSource = vi.fn().mockResolvedValue(sourceResponse());
    bridge.createProductionBriefVersion = createProductionBriefVersion;
    openWithBridge(bridge);

    expect(await screen.findByText(/来源状态：已批准/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "粘贴故事" }));
    fireEvent.click(screen.getByRole("button", { name: "原创灵感" }));
    fireEvent.change(screen.getByLabelText("原创来源说明"), { target: { value: "原创来源" } });
    fireEvent.change(screen.getByLabelText("核心设定"), { target: { value: "核心设定" } });
    fireEvent.change(screen.getByLabelText("创作意图"), { target: { value: "创作意图" } });
    fireEvent.click(screen.getByRole("button", { name: "打开第二项目" }));
    await waitFor(() =>
      expect((screen.getByLabelText("项目名称") as HTMLInputElement).value).toBe("第二项目"),
    );
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    expect(createProductionBriefVersion).not.toHaveBeenCalled();
    expect(await screen.findByText("项目已变化；请重新打开原创灵感草稿。")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "关闭对话框" }));
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    fireEvent.click(screen.getByRole("button", { name: "打开第一项目" }));
    await waitFor(() =>
      expect((screen.getByLabelText("项目名称") as HTMLInputElement).value).toBe("来源项目"),
    );
    expect(await screen.findByText(/来源状态：已批准/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "基于已批准来源改编" }));
    fireEvent.change(screen.getByLabelText("改编说明"), { target: { value: "改编说明" } });
    fireEvent.change(screen.getByLabelText(/焦点区块序号/), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("核心设定"), { target: { value: "核心设定" } });
    fireEvent.change(screen.getByLabelText("创作意图"), { target: { value: "创作意图" } });
    fireEvent.click(screen.getByRole("button", { name: "打开第二项目" }));
    await waitFor(() =>
      expect((screen.getByLabelText("项目名称") as HTMLInputElement).value).toBe("第二项目"),
    );
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    expect(createProductionBriefVersion).not.toHaveBeenCalled();
    expect(
      await screen.findByText("来源或审核清单已变化；请重新选择改编焦点。"),
    ).toBeInTheDocument();
  });

  it("rejects an unsafe original delivery value before attempting to save", async () => {
    openSource();
    fireEvent.click(screen.getByRole("button", { name: "粘贴故事" }));
    fireEvent.click(screen.getByRole("button", { name: "原创灵感" }));
    fireEvent.change(screen.getByLabelText("原创来源说明"), { target: { value: "原创" } });
    fireEvent.change(screen.getByLabelText("核心设定"), { target: { value: "设定" } });
    fireEvent.change(screen.getByLabelText("创作意图"), { target: { value: "意图" } });
    fireEvent.change(screen.getByLabelText("交付宽度"), { target: { value: "1.5" } });
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    expect(
      await screen.findByText("请填写有效的交付信息；已声明预算还需要金额和币种。"),
    ).toBeInTheDocument();
  });
  it("saves every non-default original brief field and renders a Chinese readback", async () => {
    const createProductionBriefVersion = vi.fn(async (_projectId, command) => ({
      kind: "SUCCEEDED" as const,
      receipt: productionBriefReceipt(command.input.content) as never,
    }));
    const bridge = remoteBridge(async () => manifest()) as Window["aijian"] & {
      createProductionBriefVersion: typeof createProductionBriefVersion;
    };
    bridge.createProductionBriefVersion = createProductionBriefVersion as never;
    openWithBridge(bridge);

    expect(await screen.findByText(/来源状态：已批准/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "粘贴故事" }));
    fireEvent.click(screen.getByRole("button", { name: "原创灵感" }));
    fireEvent.change(screen.getByLabelText("原创来源说明"), { target: { value: "原创来源" } });
    fireEvent.change(screen.getByLabelText("核心设定"), { target: { value: "核心设定" } });
    fireEvent.change(screen.getByLabelText("创作意图"), { target: { value: "创作意图" } });
    fireEvent.change(screen.getByLabelText("目标受众（可选）"), { target: { value: "青年观众" } });
    fireEvent.change(screen.getByLabelText("类型（可选）"), { target: { value: "科幻" } });
    fireEvent.change(screen.getByLabelText("风格（可选）"), { target: { value: "霓虹黑色电影" } });
    fireEvent.change(screen.getByLabelText(/创作约束/), {
      target: { value: "不使用旁白\n保留悬念" },
    });
    fireEvent.change(screen.getByLabelText("参考类型（可选）"), { target: { value: "研究" } });
    fireEvent.change(screen.getByLabelText("参考说明（可选）"), {
      target: { value: "城市夜景研究" },
    });
    fireEvent.change(screen.getByLabelText("整部时长（秒，可选）"), { target: { value: "180" } });
    fireEvent.change(screen.getByLabelText("单集时长模式"), { target: { value: "按单集" } });
    fireEvent.change(screen.getByLabelText("单集时长（秒）"), { target: { value: "45" } });
    fireEvent.change(screen.getByLabelText("预算状态"), { target: { value: "已声明" } });
    fireEvent.change(screen.getByLabelText("预算金额"), { target: { value: "7.5" } });
    fireEvent.change(screen.getByLabelText("预算币种"), { target: { value: "USD" } });
    fireEvent.change(screen.getByLabelText("权利状态"), { target: { value: "用户声明" } });
    fireEvent.change(screen.getByLabelText("权利声明"), { target: { value: "原创权利已声明" } });
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));

    await waitFor(() => expect(createProductionBriefVersion).toHaveBeenCalledOnce());
    expect(createProductionBriefVersion.mock.calls[0]![1].input.content).toMatchObject({
      creative_entry: {
        kind: "original_idea",
        references: [{ reference_kind: "research", description: "城市夜景研究" }],
      },
      creative: {
        audience: "青年观众",
        genre: "科幻",
        style: "霓虹黑色电影",
        constraints: ["不使用旁白", "保留悬念"],
      },
      duration_intent: { episode_mode: "per_episode", work_seconds: 180, episode_seconds: 45 },
      budget_intent: { state: "declared", amount_micros: 7500000, currency: "USD" },
      rights_declaration: { state: "user_declared", statement: "原创权利已声明" },
    });
    expect(
      await screen.findByText(
        /受众：青年观众；类型：科幻；风格：霓虹黑色电影；约束：不使用旁白、保留悬念/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("研究：城市夜景研究")).toBeInTheDocument();
    expect(screen.getByText("整部：180 秒；按单集：45 秒")).toBeInTheDocument();
  });
  it("resets declared budget and rights to contract nulls in both C3 forms", async () => {
    const createProductionBriefVersion = vi.fn(async (_projectId, command) => ({
      kind: "SUCCEEDED" as const,
      receipt: productionBriefReceipt(command.input.content) as never,
    }));
    const bridge = remoteBridge(async () => acceptedAdaptationManifest()) as Window["aijian"] & {
      getSource: ReturnType<typeof vi.fn>;
      createProductionBriefVersion: typeof createProductionBriefVersion;
    };
    bridge.listSources = vi.fn().mockResolvedValue({
      request_id: "sources",
      data: [{ id: `src_${"7".repeat(32)}` }],
    });
    bridge.getSource = vi.fn().mockResolvedValue(sourceResponse());
    bridge.createProductionBriefVersion = createProductionBriefVersion as never;
    openWithBridge(bridge);
    expect(await screen.findByText(/来源状态：已批准/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "粘贴故事" }));
    fireEvent.click(screen.getByRole("button", { name: "原创灵感" }));
    fireEvent.change(screen.getByLabelText("原创来源说明"), { target: { value: "原创来源" } });
    fireEvent.change(screen.getByLabelText("核心设定"), { target: { value: "核心设定" } });
    fireEvent.change(screen.getByLabelText("创作意图"), { target: { value: "创作意图" } });
    fireEvent.change(screen.getByLabelText("预算状态"), { target: { value: "已声明" } });
    fireEvent.change(screen.getByLabelText("预算金额"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("预算币种"), { target: { value: "USD" } });
    fireEvent.change(screen.getByLabelText("权利状态"), { target: { value: "用户声明" } });
    fireEvent.change(screen.getByLabelText("权利声明"), { target: { value: "声明" } });
    fireEvent.change(screen.getByLabelText("预算状态"), { target: { value: "未知" } });
    fireEvent.change(screen.getByLabelText("权利状态"), { target: { value: "尚未确认" } });
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(createProductionBriefVersion).toHaveBeenCalledOnce());
    expect(createProductionBriefVersion.mock.calls[0]![1].input.content).toMatchObject({
      budget_intent: { state: "unknown", amount_micros: null, currency: null },
      rights_declaration: { state: "unknown", statement: null },
    });

    fireEvent.click(screen.getByRole("button", { name: "基于已批准来源改编" }));
    fireEvent.change(screen.getByLabelText("改编说明"), { target: { value: "改编说明" } });
    fireEvent.change(screen.getByLabelText(/焦点区块序号/), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("核心设定"), { target: { value: "核心设定" } });
    fireEvent.change(screen.getByLabelText("创作意图"), { target: { value: "创作意图" } });
    fireEvent.change(screen.getByLabelText("预算状态"), { target: { value: "已声明" } });
    fireEvent.change(screen.getByLabelText(/预算金额/), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText(/预算币种/), { target: { value: "USD" } });
    fireEvent.change(screen.getByLabelText("权利状态"), { target: { value: "用户声明" } });
    fireEvent.change(screen.getByLabelText("权利声明"), { target: { value: "声明" } });
    fireEvent.change(screen.getByLabelText("预算状态"), { target: { value: "尚未确认" } });
    fireEvent.change(screen.getByLabelText("权利状态"), { target: { value: "尚未确认" } });
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(createProductionBriefVersion).toHaveBeenCalledTimes(2));
    expect(createProductionBriefVersion.mock.calls[1]![1].input.content).toMatchObject({
      budget_intent: { state: "unknown", amount_micros: null, currency: null },
      rights_declaration: { state: "unknown", statement: null },
    });
  });
  it("does not pretend an import succeeded without a connected project", async () => {
    openSource();
    fireEvent.change(screen.getByLabelText("替换原文文件"), {
      target: { files: [new File(["x"], "story.txt", { type: "text/plain" })] },
    });
    expect(await screen.findByText(/当前项目尚未连接本地工作区，无法导入来源/)).toBeInTheDocument();
  });
  it("does not offer source review when no real project source is selected", () => {
    openSource();
    expect(screen.getByRole("button", { name: "开始理解故事" })).toBeDisabled();
    expect(JSON.parse(screen.getByLabelText("状态").textContent!)).toMatchObject({
      source: "",
      approved: "",
    });
  });
  it("does not permit story confirmation before an accepted source version exists", () => {
    openSource();
    fireEvent.click(screen.getByRole("button", { name: "故事页" }));
    for (const checkbox of screen.getAllByRole("checkbox"))
      if (!(checkbox as HTMLInputElement).checked) fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: "确认故事理解" }));
    expect(
      within(screen.getByRole("dialog")).getByRole("button", { name: "确认并进入角色" }),
    ).toBeDisabled();
  });
  it("shows the current accepted manifest state without submitting a review", async () => {
    openRemoteSource(manifest());
    expect(await screen.findByText(/来源状态：已批准/)).toBeInTheDocument();
    expect(screen.getByText(/最新来源 V4 已批准/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "审阅故事证据" })).toBeInTheDocument();
  });
  it("keeps an old accepted baseline visibly distinct from the newer draft", async () => {
    const oldAccepted = `ver_${"6".repeat(32)}`;
    openRemoteSource(manifest({ accepted: oldAccepted }));
    expect(await screen.findByText(/来源状态：新版待审核/)).toBeInTheDocument();
    expect(screen.getByText(/旧批准基线 V3 仍可用于故事阅读/)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "审阅故事证据" })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "审核来源版本" })).toBeInTheDocument();
  });

  it.each([
    ["empty manifest", async () => null, "未导入"],
    ["review manifest", async () => manifest({ accepted: null, review: latestId }), "审核中"],
    [
      "inconsistent manifest",
      async () => {
        const broken = manifest();
        broken.data.project_id = `prj_${"9".repeat(32)}`;
        return broken;
      },
      "身份不一致",
    ],
  ])("clears approval for a real %s", async (_name, getManifest, status) => {
    openWithBridge(remoteBridge(getManifest));
    expect(await screen.findByText(new RegExp(`来源状态：${status}`))).toBeInTheDocument();
    expect(JSON.parse(screen.getByLabelText("状态").textContent!)).toMatchObject({
      approved: "false",
    });
  });

  it("keeps approval false while a real manifest is loading", async () => {
    const request = pending<ReturnType<typeof manifest>>();
    openWithBridge(remoteBridge(() => request.promise));
    expect(await screen.findByText(/来源状态：读取中/)).toBeInTheDocument();
    expect(JSON.parse(screen.getByLabelText("状态").textContent!)).toMatchObject({
      approved: "false",
      stage: "loading",
    });
    request.resolve(manifest({ accepted: null, review: latestId }));
    expect(await screen.findByText(/来源状态：审核中/)).toBeInTheDocument();
  });

  it("does not let an earlier same-project refresh overwrite a later refresh", async () => {
    const stale = pending<ReturnType<typeof manifest>>();
    let call = 0;
    openWithBridge(
      remoteBridge(async () => {
        call += 1;
        if (call === 1) return manifest();
        if (call === 2) return stale.promise;
        return manifest({ accepted: null, review: latestId });
      }),
    );
    expect(await screen.findByText(/来源状态：已批准/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "刷新来源状态" }));
    fireEvent.click(screen.getByRole("button", { name: "刷新来源状态" }));
    expect(await screen.findByText(/来源状态：审核中/)).toBeInTheDocument();
    stale.resolve(manifest());
    await waitFor(() => expect(screen.getByText(/来源状态：审核中/)).toBeInTheDocument());
    expect(JSON.parse(screen.getByLabelText("状态").textContent!)).toMatchObject({
      approved: "false",
      stage: "review",
    });
  });

  it("does not let a stale story read override a later refresh for the same project", async () => {
    const storyManifest = pending<ReturnType<typeof manifest>>();
    let call = 0;
    openWithBridge(
      remoteBridge(async () => {
        call += 1;
        if (call === 1) return manifest();
        if (call === 2) return storyManifest.promise;
        return manifest({ accepted: null, review: latestId });
      }),
    );
    expect(await screen.findByText(/来源状态：已批准/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "读取真实故事工作区" }));
    fireEvent.click(screen.getByRole("button", { name: "刷新来源状态" }));
    expect(await screen.findByText(/来源状态：审核中/)).toBeInTheDocument();
    storyManifest.resolve(manifest());
    await waitFor(() => expect(screen.getByText(/来源状态：审核中/)).toBeInTheDocument());
    expect(JSON.parse(screen.getByLabelText("状态").textContent!)).toMatchObject({
      approved: "false",
      stage: "review",
    });
  });
  it("keeps a failed real manifest unapproved", async () => {
    openWithBridge(
      remoteBridge(async () => {
        throw new Error("bridge");
      }),
    );
    expect(await screen.findByText(/来源状态：读取失败/)).toBeInTheDocument();
    expect(JSON.parse(screen.getByLabelText("状态").textContent!)).toMatchObject({
      approved: "false",
      stage: "error",
    });
  });

  it("uses the approved-stage action for navigation only", async () => {
    const submit = vi.fn();
    const bridge = remoteBridge(async () => manifest()) as Window["aijian"] & {
      sourceManifestReview?: { submit: typeof submit };
    };
    bridge.sourceManifestReview = { submit };
    openWithBridge(bridge);
    expect(await screen.findByText(/来源状态：已批准/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "审阅故事证据" }));
    expect(screen.getByRole("heading", { name: "故事理解" })).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
  });
  it("lets a reviewed source return to the source page and confirm its displayed baseline", async () => {
    const review = manifest({ accepted: null, review: latestId });
    const accepted = manifest({ accepted: latestId, review: latestId });
    const getSourceManifest = vi
      .fn()
      .mockResolvedValueOnce(review)
      .mockResolvedValueOnce(review)
      .mockResolvedValueOnce(accepted);
    const confirmSourceManifestBaseline = vi.fn().mockResolvedValue({
      kind: "SUCCEEDED",
      phase: "decision",
      identity: {
        project_id: projectId,
        version_id: latestId,
        content_hash: `sha256:${"4".repeat(64)}`,
        expected_revision: 1,
      },
      completed_actions: ["decision"],
      receipts: [],
    });
    const bridge = remoteBridge(getSourceManifest)!;
    Object.assign(bridge, {
      submitSourceManifest: vi.fn(),
      confirmSourceManifestBaseline,
      copySourceManifestDraft: vi.fn(),
    });
    openWithBridge(bridge);
    expect(await screen.findByText(/来源状态：审核中/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认来源审核基线" }));
    expect(screen.getByRole("heading", { name: "确认来源审核基线" })).toBeInTheDocument();
    expect(screen.getByText(new RegExp(projectId))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(latestId))).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("确认理由（1 至 1000 个字符）"), {
      target: { value: `  ${"😀".repeat(1000)}  ` },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "确认来源审核基线" })[1]!);
    await waitFor(() =>
      expect(confirmSourceManifestBaseline).toHaveBeenCalledWith({
        project_id: projectId,
        version_id: latestId,
        content_hash: `sha256:${"4".repeat(64)}`,
        expected_revision: 1,
        rationale: "😀".repeat(1000),
      }),
    );
    expect(await screen.findByText(/来源状态：已批准/)).toBeInTheDocument();
  });
  it("keeps the confirmation drawer and astral rationale when it exceeds 1000 code points", async () => {
    const review = manifest({ accepted: null, review: latestId });
    const confirmSourceManifestBaseline = vi.fn();
    const bridge = remoteBridge(vi.fn().mockResolvedValue(review))!;
    Object.assign(bridge, {
      confirmSourceManifestBaseline,
      submitSourceManifest: vi.fn(),
      copySourceManifestDraft: vi.fn(),
    });
    openWithBridge(bridge);
    expect(await screen.findByText(/来源状态：审核中/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认来源审核基线" }));
    const rationale = "😀".repeat(1001);
    fireEvent.change(screen.getByLabelText("确认理由（1 至 1000 个字符）"), {
      target: { value: rationale },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "确认来源审核基线" })[1]!);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("确认理由（1 至 1000 个字符）")).toHaveValue(rationale);
    expect(screen.getByText("确认理由需要是 1 至 1000 个字符。")).toBeInTheDocument();
    expect(confirmSourceManifestBaseline).not.toHaveBeenCalled();
  });
  it("cancels an open source-baseline drawer without dispatching", async () => {
    const review = manifest({ accepted: null, review: latestId });
    const confirmSourceManifestBaseline = vi.fn();
    const bridge = remoteBridge(vi.fn().mockResolvedValue(review))!;
    Object.assign(bridge, {
      confirmSourceManifestBaseline,
      submitSourceManifest: vi.fn(),
      copySourceManifestDraft: vi.fn(),
    });
    openWithBridge(bridge);
    expect(await screen.findByText(/来源状态：审核中/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认来源审核基线" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "关闭" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(confirmSourceManifestBaseline).not.toHaveBeenCalled();
  });
  it("does not dispatch an open baseline drawer after switching projects", async () => {
    const projectB = `prj_${"b".repeat(32)}`;
    const review = manifest({ accepted: null, review: latestId });
    const bReview = manifest({ accepted: null, review: latestId });
    bReview.data.project_id = projectB;
    const confirmSourceManifestBaseline = vi.fn();
    const bridge = remoteBridge(vi.fn().mockResolvedValueOnce(review).mockResolvedValue(bReview), [
      {
        id: projectId,
        name: "项目 A",
        status: "active",
        revision: 1,
        updated_at: "2026-09-14T00:00:00Z",
      },
      {
        id: projectB,
        name: "项目 B",
        status: "active",
        revision: 1,
        updated_at: "2026-09-14T00:00:00Z",
      },
    ])!;
    Object.assign(bridge, {
      confirmSourceManifestBaseline,
      submitSourceManifest: vi.fn(),
      copySourceManifestDraft: vi.fn(),
    });
    openWithBridge(bridge);
    expect(await screen.findByText(/来源状态：审核中/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认来源审核基线" }));
    fireEvent.change(screen.getByLabelText("确认理由（1 至 1000 个字符）"), {
      target: { value: "已核对" },
    });
    fireEvent.click(screen.getByRole("button", { name: "打开第二项目" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("alert")).toHaveTextContent("来源审核目标已变化");
    expect(screen.getByLabelText("确认理由（1 至 1000 个字符）")).toHaveValue("已核对");
    expect(within(dialog).getByRole("button", { name: "确认来源审核基线" })).toBeDisabled();
    expect(confirmSourceManifestBaseline).not.toHaveBeenCalled();
  });
  it("keeps project B source state when project A's earlier manifest returns late", async () => {
    const projectB = `prj_${"8".repeat(32)}`;
    const oldProject = pending<ReturnType<typeof manifest>>();
    const bManifest = manifest({ accepted: null, review: latestId });
    bManifest.data.project_id = projectB;
    const bridge = remoteBridge(
      vi
        .fn()
        .mockImplementationOnce(() => oldProject.promise)
        .mockImplementationOnce(async () => bManifest),
      [
        {
          id: projectId,
          name: "项目 A",
          status: "active",
          revision: 1,
          updated_at: "2026-09-14T00:00:00Z",
        },
        {
          id: projectB,
          name: "项目 B",
          status: "active",
          revision: 1,
          updated_at: "2026-09-14T00:00:00Z",
        },
      ],
    );
    openWithBridge(bridge);
    expect(await screen.findByText(/来源状态：读取中/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "打开第二项目" }));
    expect(await screen.findByText(/来源状态：审核中/)).toBeInTheDocument();
    oldProject.resolve(manifest());
    await waitFor(() => expect(screen.getByText(/来源状态：审核中/)).toBeInTheDocument());
    expect(JSON.parse(screen.getByLabelText("状态").textContent!)).toMatchObject({
      approved: "false",
      stage: "review",
    });
  });

  it("does not let an old manifest begun before a successful import overwrite its newer state", async () => {
    const stale = pending<ReturnType<typeof manifest>>();
    let calls = 0;
    const bridge = remoteBridge(async () => {
      calls += 1;
      if (calls === 1) return manifest();
      if (calls === 2) return stale.promise;
      return manifest({ accepted: null, review: latestId });
    }) as Window["aijian"] & { importTextSource: ReturnType<typeof vi.fn> };
    bridge.importTextSource = vi.fn().mockResolvedValue(sourceResponse());
    openWithBridge(bridge);
    expect(await screen.findByText(/来源状态：已批准/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "刷新来源状态" }));
    fireEvent.click(screen.getByRole("button", { name: "导入真实来源" }));
    expect(await screen.findByText(/来源状态：审核中/)).toBeInTheDocument();
    stale.resolve(manifest());
    await waitFor(() => expect(screen.getByText(/来源状态：审核中/)).toBeInTheDocument());
    expect(JSON.parse(screen.getByLabelText("状态").textContent!)).toMatchObject({
      approved: "false",
      stage: "review",
      source: "新的来源",
    });
  });

  it("imports a 20,000-character pasted source through the model without truncation", async () => {
    const bridge = remoteBridge(async () => manifest()) as Window["aijian"] & {
      importTextSource: ReturnType<typeof vi.fn>;
    };
    bridge.importTextSource = vi.fn().mockResolvedValue(sourceResponse());
    openWithBridge(bridge);
    expect(await screen.findByText(/来源状态：已批准/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "导入长粘贴来源" }));
    await waitFor(() => expect(bridge.importTextSource).toHaveBeenCalledTimes(1));
    const encoded = bridge.importTextSource.mock.calls[0]![1].content_base64 as string;
    expect(
      new TextDecoder().decode(Uint8Array.from(atob(encoded), (char) => char.codePointAt(0)!)),
    ).toBe("原文".repeat(10_000));
  });

  it("retains the original recovery operation when the create bridge is unavailable", async () => {
    openWithBridge(remoteBridge(async () => manifest()));
    expect(await screen.findByText(/来源状态：已批准/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存 C3 草稿" }));
    expect(await screen.findByRole("button", { name: "恢复原草稿操作" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "恢复原草稿操作" }));
    await waitFor(() =>
      expect(JSON.parse(screen.getByLabelText("状态").textContent!)).toMatchObject({
        pendingBrief: true,
      }),
    );
  });

  it("does not let an old manifest begun before a successful review overwrite its newer state", async () => {
    const stale = pending<ReturnType<typeof manifest>>();
    let calls = 0;
    const bridge = remoteBridge(async () => {
      calls += 1;
      if (calls === 1) return manifest({ accepted: null });
      if (calls === 2) return stale.promise;
      if (calls === 3) return manifest({ accepted: null });
      return manifest({ accepted: null, review: latestId });
    })!;
    bridge.submitSourceManifest = vi.fn().mockResolvedValue({
      kind: "SUCCEEDED",
      phase: "submit",
      identity: {},
      completed_actions: [],
      receipts: [],
    });
    bridge.confirmSourceManifestBaseline = vi.fn();
    bridge.copySourceManifestDraft = vi.fn();
    openWithBridge(bridge);
    expect(await screen.findByText(/来源状态：待审核/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "刷新来源状态" }));
    fireEvent.click(screen.getByRole("button", { name: "提交真实来源审核" }));
    expect(await screen.findByText(/来源状态：审核中/)).toBeInTheDocument();
    stale.resolve(manifest({ accepted: null }));
    await waitFor(() => expect(screen.getByText(/来源状态：审核中/)).toBeInTheDocument());
    expect(JSON.parse(screen.getByLabelText("状态").textContent!)).toMatchObject({
      approved: "false",
      submitted: "true",
      stage: "review",
    });
  });
});

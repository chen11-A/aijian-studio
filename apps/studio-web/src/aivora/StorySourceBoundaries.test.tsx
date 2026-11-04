import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type {
  ProductionBriefCreateCommand,
  SourceManifestResponse,
  StudioTransport,
} from "../api/studio";
import type { ProductionSourceStage } from "./adapters/productionSourceStage";
import type { Editor } from "./model";
import { StoryPages } from "./StoryPages";

const projectId = `prj_${"1".repeat(32)}`;
const sourceId = `src_${"2".repeat(32)}`;
const versionId = `ver_${"3".repeat(32)}`;
const blockId = `srcb_${"4".repeat(32)}`;
const hash = `sha256:${"5".repeat(64)}`;
const operation = "11111111-1111-4111-8111-111111111111";
const date = "2026-10-10T00:00:00Z";
function manifest(): SourceManifestResponse {
  const version: SourceManifestResponse["data"]["latest_version"] = {
    id: versionId,
    artifact_id: `art_${"6".repeat(32)}`,
    version_number: 1,
    schema_version: "1.0.0",
    content_hash: hash,
    parent_version_id: null,
    change_summary: "Synthetic source",
    created_at: date,
    content: {
      scope_type: "full_work",
      documents: [
        {
          source_document_id: sourceId,
          filename: "synthetic.txt",
          raw_sha256: hash,
          normalized_sha256: hash,
          byte_size: 12,
          media_type: "text/plain",
          encoding: "utf-8",
          import_order: 0,
          chapter_count: 1,
          blocks: [
            {
              source_block_id: blockId,
              kind: "paragraph",
              ordinal: 0,
              chapter_index: 0,
              content_sha256: hash,
              start_byte: 0,
              end_byte: 12,
            },
          ],
        },
      ],
    },
  };
  return {
    request_id: operation,
    data: {
      project_id: projectId,
      latest_version: version,
      accepted_version: structuredClone(version),
      review_version: null,
      head: {
        artifact_id: version.artifact_id,
        latest_version_id: versionId,
        accepted_version_id: versionId,
        review_version_id: null,
        review_submission_id: null,
        revision: 1,
        review_evidence_revision: 0,
        updated_at: date,
      },
    },
  };
}
let values: Record<string, string>;
type Card = {
  backendId: string;
  name: string;
  revision: number;
  status: string;
  updated: string;
  episode: string;
};
function modelView() {
  return {
    page: "source",
    isFixture: false,
    scenario: "normal",
    backendProjectId: projectId,
    sourceStage: { kind: "approved", versionNumber: 1 } as ProductionSourceStage,
    sourceManifest: manifest(),
    sourceDocument: { data: { id: sourceId } },
    sourceImportState: { kind: "idle" },
    productionBriefState: "empty",
    productionBrief: null,
    pendingProductionBrief: null as unknown,
    projects: [
      {
        backendId: projectId,
        name: "Before",
        revision: 1,
        status: "进行中",
        updated: date,
        episode: "",
      },
    ] as Card[],
    value: (key: string, fallback = "") => values[key] ?? fallback,
    put: vi.fn((key: string, value: string) => {
      values[key] = value;
    }),
    go: vi.fn(),
    notify: vi.fn(),
    setEditor: vi.fn<(editor: Editor) => void>(),
    setProjects: vi.fn<(update: (old: Card[]) => Card[]) => void>(),
    setNavigationGuard: vi.fn<(guard: (() => boolean) | null) => void>(),
    saveProductionBrief: vi
      .fn<
        (
          command: ProductionBriefCreateCommand,
        ) => Promise<{ kind: "SUCCEEDED" | "REMOTE_UNKNOWN" | "REJECTED" }>
      >()
      .mockResolvedValue({ kind: "SUCCEEDED" }),
    recoverProductionBrief: vi.fn().mockResolvedValue({ kind: "REMOTE_UNKNOWN" }),
    refreshProductionBrief: vi.fn(),
    refreshRealSourceStage: vi.fn(),
    readRealStoryWorkspace: vi.fn(),
    importRealSource: vi.fn(),
    importPastedSource: vi.fn().mockResolvedValue({ kind: "SUCCEEDED" }),
    reviewRealSource: vi.fn().mockResolvedValue(true),
    confirmRealSourceBaseline: vi.fn().mockResolvedValue(true),
  };
}
let view = modelView();
let transport: Partial<StudioTransport>;
// Model command outcomes are the boundary; form validation, source identity
// selection, project adapter and journal remain real. No AI request is made.
vi.mock("./model", () => ({ useDemo: () => view }));
vi.mock("../api/studio", () => ({ createStudioTransport: () => transport }));
vi.mock("./SourceExtractionPanel", () => ({ SourceExtractionPanel: () => null }));

function input(): Record<string, string> {
  return {
    origin: "Original idea",
    adaptation: "Human adaptation",
    blocks: "0",
    premise: "Premise",
    intent: "Intent",
    width: "1080",
    height: "1920",
    language: "zh-CN",
    frameRateNum: "24",
    frameRateDen: "1",
    episodeMode: "未指定",
    budgetState: "未知",
    rightsState: "尚未确认",
    constraints: "",
    referenceKind: "",
    referenceDescription: "",
  };
}
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
function editor() {
  const result = view.setEditor.mock.calls.at(-1)?.[0];
  if (!result?.save) throw new Error("missing editor");
  return result;
}
async function submit(data: Record<string, string>) {
  await act(async () => {
    await editor().save?.(data);
  });
}
beforeEach(() => {
  values = { source: "Source text" };
  view = modelView();
  localStorage.clear();
  vi.spyOn(crypto, "randomUUID").mockReturnValue(operation);
  transport = {
    getProject: vi.fn().mockResolvedValue({
      request_id: "get",
      data: {
        id: projectId,
        name: "Before",
        revision: 1,
        aspect_ratio: "9:16",
        source_language: "zh-CN",
        target_duration_seconds: 90,
        status: "active",
        created_at: date,
        updated_at: date,
      },
    }),
    updateProject: vi.fn().mockResolvedValue({ kind: "REMOTE_UNKNOWN" }),
  };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("source brief composition and authority", () => {
  test("unsaved source intent warns before unload and only explicit confirmation discards it", () => {
    values.input = "Unsaved idea";
    const { unmount } = render(<StoryPages />);
    const guard = view.setNavigationGuard.mock.calls.at(-1)?.[0];
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    expect(guard?.()).toBe(false);
    expect(values.input).toBe("Unsaved idea");
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    confirm.mockReturnValue(true);
    act(() => {
      expect(guard?.()).toBe(true);
    });
    expect(values.input).toBe("");
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    expect(view.saveProductionBrief).not.toHaveBeenCalled();
    unmount();
    expect(view.setNavigationGuard).toHaveBeenLastCalledWith(null);
  });
  test("source page read and script actions are explicit commands", () => {
    render(<StoryPages />);
    click("重新读取创作简报");
    expect(view.refreshProductionBrief).toHaveBeenCalledTimes(1);
    click("编写分集剧本");
    expect(view.go).toHaveBeenCalledWith("script");
    expect(view.saveProductionBrief).not.toHaveBeenCalled();
  });
  test("real story page links do not synthesize story or save a brief", () => {
    view.page = "story";
    render(<StoryPages />);
    expect(view.readRealStoryWorkspace).toHaveBeenCalledTimes(1);
    click("来源与原创灵感");
    click("编写分集剧本");
    expect(view.go.mock.calls).toEqual([["source"], ["script"]]);
    expect(view.saveProductionBrief).not.toHaveBeenCalled();
  });
  test.each(["原创灵感", "基于已批准来源改编"])(
    "%s reduces ratios and encodes explicit budget without auto-confirming",
    async (action) => {
      render(<StoryPages />);
      click(action);
      await submit({
        ...input(),
        frameRateNum: "48",
        frameRateDen: "2",
        episodeMode: "按单集",
        episodeSeconds: "60",
        seconds: "180",
        budgetState: "已声明",
        budgetAmount: "12.000001",
        budgetCurrency: " CNY ",
        rightsState: "用户声明",
        rights: " Human declaration ",
        constraints: "Constraint one\nConstraint two",
        audience: " Adults ",
        genre: "Drama",
        style: "Realistic",
        ...(action === "原创灵感"
          ? { referenceKind: "研究", referenceDescription: " Reference note " }
          : {}),
      });
      const command = view.saveProductionBrief.mock.calls[0]?.[0];
      expect(command).toMatchObject({
        operation_id: operation,
        input: {
          parent_version_id: null,
          expected_revision: null,
          content: {
            delivery: {
              display_aspect_ratio: { num: 9, den: 16 },
              frame_rate: { num: 24, den: 1 },
            },
            budget_intent: { state: "declared", amount_micros: 12000001, currency: "CNY" },
            rights_declaration: { state: "user_declared", statement: "Human declaration" },
            duration_intent: {
              episode_mode: "per_episode",
              work_seconds: 180,
              episode_seconds: 60,
            },
            creative: { audience: "Adults", constraints: ["Constraint one", "Constraint two"] },
          },
        },
      });
      expect(command?.input.content.creative_entry).toMatchObject(
        action === "原创灵感"
          ? {
              kind: "original_idea",
              references: [{ reference_kind: "research", description: "Reference note" }],
            }
          : {
              kind: "source_adaptation",
              source_document_id: sourceId,
              source_manifest_version_id: versionId,
              source_block_ids: [blockId],
            },
      );
      expect(view.confirmRealSourceBaseline).not.toHaveBeenCalled();
      expect(view.reviewRealSource).not.toHaveBeenCalled();
      expect(view.go).not.toHaveBeenCalled();
    },
  );

  test.each(["原创灵感", "基于已批准来源改编"])(
    "%s preserves unspecified duration, budget and rights",
    async (action) => {
      render(<StoryPages />);
      click(action);
      await submit(input());
      expect(view.saveProductionBrief.mock.calls[0]?.[0].input.content).toMatchObject({
        creative: { audience: null, genre: null, style: null, constraints: [] },
        duration_intent: { episode_mode: "unspecified", work_seconds: null, episode_seconds: null },
        budget_intent: { state: "unknown", amount_micros: null, currency: null },
        rights_declaration: { state: "unknown", statement: null },
      });
    },
  );

  const invalid: [string, Record<string, string>][] = [
    ["width", { width: "0" }],
    ["height", { height: "1.5" }],
    ["frame numerator", { frameRateNum: "0" }],
    ["frame denominator", { frameRateDen: "2147483648" }],
    ["language", { language: " " }],
    ["duration", { seconds: "0" }],
    ["missing episode duration", { episodeMode: "按单集" }],
    ["unexpected episode duration", { episodeSeconds: "60" }],
    ["premise", { premise: " " }],
    ["intent", { intent: " " }],
    [
      "budget precision",
      { budgetState: "已声明", budgetAmount: "1.0000001", budgetCurrency: "CNY" },
    ],
    ["budget currency", { budgetState: "已声明", budgetAmount: "1", budgetCurrency: "cny" }],
    ["rights declaration", { rightsState: "用户声明", rights: " " }],
    ["duplicate constraint", { constraints: "same\nsame" }],
    [
      "too many constraints",
      { constraints: Array.from({ length: 33 }, (_, i) => `line${i}`).join("\n") },
    ],
    ["long constraint", { constraints: "x".repeat(241) }],
    ["long audience", { audience: "x".repeat(241) }],
  ];
  describe.each(["原创灵感", "基于已批准来源改编"])("%s validation", (action) => {
    test.each(invalid)("blocks invalid %s", async (_name, fields) => {
      render(<StoryPages />);
      click(action);
      await submit({ ...input(), ...fields });
      expect(view.saveProductionBrief).not.toHaveBeenCalled();
      expect(view.notify).toHaveBeenCalledWith(
        action === "原创灵感"
          ? "请填写有效的交付信息；已声明预算还需要金额和币种。"
          : "请只选择当前已批准清单中的 1 至 100 个不重复区块，并填写有效交付信息。",
      );
    });
  });

  test.each(["", " ", "x".repeat(4001)])(
    "invalid original origin blocks command (%#)",
    async (origin) => {
      render(<StoryPages />);
      click("原创灵感");
      await submit({ ...input(), origin });
      expect(view.saveProductionBrief).not.toHaveBeenCalled();
    },
  );
  test.each(["0,0", "999", "0,999"])(
    "adaptation rejects invalid block selection %s",
    async (blocks) => {
      render(<StoryPages />);
      click("基于已批准来源改编");
      await submit({ ...input(), blocks });
      expect(view.saveProductionBrief).not.toHaveBeenCalled();
    },
  );

  test.each(["REMOTE_UNKNOWN", "REJECTED"] as const)(
    "brief %s retains draft with no auto retry",
    async (kind) => {
      view.saveProductionBrief.mockResolvedValue({ kind });
      render(<StoryPages />);
      click("原创灵感");
      await submit(input());
      expect(view.notify).toHaveBeenCalledWith(
        kind === "REMOTE_UNKNOWN"
          ? "草稿保存结果待确认；请关闭窗口并恢复原操作。"
          : "草稿未保存，请核对输入后重试。",
      );
      expect(view.saveProductionBrief).toHaveBeenCalledTimes(1);
      expect(view.put).not.toHaveBeenCalledWith("input", "");
    },
  );

  test.each(["project", "source", "stage"] as const)(
    "open adaptation invalidates after %s drift",
    async (field) => {
      const mounted = render(<StoryPages />);
      click("基于已批准来源改编");
      if (field === "project") view.backendProjectId = `prj_${"a".repeat(32)}`;
      if (field === "source") view.sourceDocument = { data: { id: `src_${"a".repeat(32)}` } };
      if (field === "stage") view.sourceStage = { kind: "draft", acceptedVersionNumber: 1 };
      mounted.rerender(<StoryPages />);
      await submit(input());
      expect(view.notify).toHaveBeenCalledWith("来源或审核清单已变化；请重新选择改编焦点。");
      expect(view.saveProductionBrief).not.toHaveBeenCalled();
    },
  );

  test.each(["loading", "error", "pending"])(
    "unverified brief %s blocks the original editor",
    (state) => {
      if (state === "pending") view.pendingProductionBrief = { operation_id: operation };
      else view.productionBriefState = state;
      render(<StoryPages />);
      click("原创灵感");
      expect(editor().validate?.()).toBeTruthy();
      expect(view.saveProductionBrief).not.toHaveBeenCalled();
    },
  );

  test("paste import clears only the submitted text and never invokes brief save", async () => {
    render(<StoryPages />);
    click("粘贴故事");
    fireEvent.change(screen.getByLabelText("外部原文正文"), { target: { value: "Pasted source" } });
    click("作为外部原文导入");
    await waitFor(() => expect(screen.getByLabelText("外部原文正文")).toHaveValue(""));
    expect(view.importPastedSource).toHaveBeenCalledWith("Pasted source");
    expect(view.saveProductionBrief).not.toHaveBeenCalled();
  });
});

describe("source page project rename", () => {
  test("matching PATCH and authoritative readback update the card and title", async () => {
    const before = (await transport.getProject!(projectId)).data;
    const saved = { ...before, name: "Renamed", revision: 2, status: "archived" as const };
    transport.getProject = vi.fn().mockResolvedValue({ data: saved, request_id: "get" });
    transport.updateProject = vi
      .fn()
      .mockResolvedValue({ kind: "SUCCEEDED", receipt: { data: saved, request_id: "patch" } });
    render(<StoryPages />);
    fireEvent.change(screen.getByLabelText("项目名称"), { target: { value: " Renamed " } });
    click("保存项目名称");
    expect(await screen.findByText("项目名称已保存并从本地工作区读回。")).toBeVisible();
    expect(transport.updateProject).toHaveBeenCalledExactlyOnceWith(projectId, {
      expectedRevision: 1,
      name: "Renamed",
    });
    expect(view.put).toHaveBeenCalledWith("title", "Renamed");
    expect(view.setProjects.mock.calls.at(-1)?.[0](view.projects)).toMatchObject([
      { name: "Renamed", revision: 2, status: "已归档", episode: "REV 2" },
    ]);
    expect(screen.getByLabelText("项目名称")).toHaveValue("Renamed");
  });
  test.each([401, 403, 404, 409, 412, 422, 428])(
    "definitive rejection %s requires a fresh read while keeping the draft",
    async (status) => {
      transport.updateProject = vi.fn().mockResolvedValue({
        kind: "DEFINITE_SERVER_ERROR",
        status,
        code: "CONFLICT",
        request_id: "reject",
      });
      render(<StoryPages />);
      fireEvent.change(screen.getByLabelText("项目名称"), { target: { value: "Draft" } });
      click("保存项目名称");
      expect(await screen.findByText(/项目更新被拒绝/)).toBeVisible();
      expect(screen.getByRole("button", { name: "保存项目名称" })).toBeDisabled();
      click("重新读取");
      expect(await screen.findByText(/未保存草稿仍保留/)).toBeVisible();
      expect(screen.getByLabelText("项目名称")).toHaveValue("Draft");
      expect(screen.getByRole("button", { name: "保存项目名称" })).toBeEnabled();
      expect(transport.updateProject).toHaveBeenCalledTimes(1);
    },
  );
  test("clean refresh follows the current name, while stale revision cannot replace a newer card", async () => {
    const before = (await transport.getProject!(projectId)).data;
    transport.getProject = vi.fn().mockResolvedValue({
      data: { ...before, name: "Read name", revision: 2 },
      request_id: "get",
    });
    render(<StoryPages />);
    click("重新读取");
    expect(await screen.findByText("已从本地工作区重新读取项目名称。")).toBeVisible();
    expect(screen.getByLabelText("项目名称")).toHaveValue("Read name");
    expect(view.put).toHaveBeenCalledWith("title", "Read name");
    const newer = { ...view.projects[0]!, name: "Newer", revision: 9 };
    expect(view.setProjects.mock.calls.at(-1)?.[0]([newer])).toEqual([newer]);
  });
  test.each(["rejected", "wrong-project", "invalid-revision"])(
    "invalid readback %s keeps the draft and reports uncertainty",
    async (failure) => {
      const before = (await transport.getProject!(projectId)).data;
      transport.getProject =
        failure === "rejected"
          ? vi.fn().mockRejectedValue(new Error("offline"))
          : vi.fn().mockResolvedValue({
              data: {
                ...before,
                ...(failure === "wrong-project" ? { id: "another" } : { revision: 0 }),
              },
              request_id: "get",
            });
      render(<StoryPages />);
      fireEvent.change(screen.getByLabelText("项目名称"), { target: { value: "Draft" } });
      click("重新读取");
      expect(await screen.findByText("项目当前状态无法核实，仍阻止提交。")).toBeVisible();
      expect(screen.getByLabelText("项目名称")).toHaveValue("Draft");
      expect(view.setProjects).not.toHaveBeenCalled();
      expect(transport.updateProject).not.toHaveBeenCalled();
    },
  );
  test("unmount suppresses late GET updates", async () => {
    const before = await transport.getProject!(projectId);
    let finish!: (value: typeof before) => void;
    transport.getProject = vi.fn(
      () =>
        new Promise<typeof before>((resolve) => {
          finish = resolve;
        }),
    );
    const mounted = render(<StoryPages />);
    click("重新读取");
    mounted.unmount();
    await act(async () => {
      finish(before);
    });
    expect(view.setProjects).not.toHaveBeenCalled();
    expect(view.put).not.toHaveBeenCalledWith("title", expect.anything());
  });
  test("UNKNOWN rename stays locked through read-only reconciliation", async () => {
    render(<StoryPages />);
    fireEvent.change(screen.getByLabelText("项目名称"), { target: { value: "Draft" } });
    click("保存项目名称");
    expect(await screen.findByText(/更新结果未知；原操作已锁定/)).toBeVisible();
    expect(screen.getByRole("button", { name: "保存项目名称" })).toBeDisabled();
    click("重新读取");
    expect(await screen.findByText(/已只读核对当前项目；原更新仍锁定/)).toBeVisible();
    click("核对并结束未知记录");
    expect(await screen.findByText(/未知记录已结束；已读当前项目/)).toBeVisible();
    expect(transport.updateProject).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("项目名称")).toHaveValue("Draft");
    const updater = view.setProjects.mock.calls.at(-1)?.[0];
    expect(updater?.(view.projects)).toMatchObject([{ name: "Before", revision: 1 }]);
  });

  test.each([" ", "x".repeat(81), "bad\u0001name"])("invalid name is not sent (%#)", (name) => {
    render(<StoryPages />);
    fireEvent.change(screen.getByLabelText("项目名称"), { target: { value: name } });
    click("保存项目名称");
    expect(screen.getByText(/项目名称需为 1 至 80 个字符/)).toBeVisible();
    expect(transport.updateProject).not.toHaveBeenCalled();
  });
  test("cancel keeps applied name; trim-only changes do not issue a write", () => {
    render(<StoryPages />);
    fireEvent.change(screen.getByLabelText("项目名称"), { target: { value: "Dirty" } });
    click("取消");
    expect(screen.getByLabelText("项目名称")).toHaveValue("Before");
    fireEvent.change(screen.getByLabelText("项目名称"), { target: { value: " Before " } });
    click("保存项目名称");
    expect(screen.getByLabelText("项目名称")).toHaveValue("Before");
    expect(transport.updateProject).not.toHaveBeenCalled();
  });
});

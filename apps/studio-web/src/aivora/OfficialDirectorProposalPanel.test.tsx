import { webcrypto } from "node:crypto";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  OfficialDirectorBridge,
  OfficialDirectorOperation,
} from "@aijian/contracts/official-director";
import {
  directorGateway,
  directorOperation,
  directorStorage,
} from "../test/officialDirectorFixture";
import { OfficialDirectorProposalPanel } from "./OfficialDirectorProposalPanel";
import { OfficialDirectorInputProof } from "./OfficialDirectorInputProof";
import { OfficialDirectorPlainText } from "./OfficialDirectorPlainText";
import {
  useOfficialDirectorProposals,
  defaultDirectorIntent,
  type OfficialDirectorPanelProps,
} from "./useOfficialDirectorProposals";

function props(operations: OfficialDirectorOperation[] = []) {
  const fixture = directorGateway(operations);
  const input: OfficialDirectorPanelProps = {
    projectId: fixture.inputs.project_id,
    episodeId: fixture.inputs.episode_id,
    bridge: fixture.bridge,
    preparationGateway: fixture.preparationGateway,
    scriptDirty: false,
    storyboardDirty: false,
    pendingOperations: false,
    onAdopted: vi.fn(),
    onWorkStateChange: vi.fn(),
    storage: directorStorage(),
  };
  return { ...fixture, input };
}
async function ready() {
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "只读核对记录与输入" })).toBeEnabled(),
  );
}
async function models() {
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "读取官方可用模型" }));
  await waitFor(() =>
    expect(screen.getByLabelText("官方模型")).toHaveValue("fixture-official-model"),
  );
  fireEvent.change(screen.getByLabelText("官方模型"), { target: { value: "" } });
  fireEvent.change(screen.getByLabelText("官方模型"), {
    target: { value: "fixture-official-model" },
  });
}
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  window.aijianChatGPT = {
    models: vi.fn(async () => ({
      kind: "OK",
      models: [{ slug: "fixture-official-model", displayName: "Fixture official model" }],
    })),
  } as unknown as NonNullable<Window["aijianChatGPT"]>;
});
afterEach(() => {
  delete window.aijianChatGPT;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("compact native-only AI director review", () => {
  it("shows exact read-only current and historical input proofs and never interprets raw bytes as markup", async () => {
    const fixture = props();
    render(<OfficialDirectorInputProof input={fixture.inputs} />);
    const proof = screen.getByText("当前已确认剧本与制作意图凭据").closest("details");
    if (!proof) throw new Error("Missing proof details");
    proof.open = true;
    fireEvent(proof, new Event("toggle"));
    await screen.findByText("只读剧本原始内容");
    expect(
      screen.getByText(`剧本确认：${fixture.inputs.authority.script.confirmation_id}`),
    ).toBeInTheDocument();
    expect(proof.querySelector("pre")?.textContent).toBe(
      JSON.stringify(fixture.inputs.script_stored_content, null, 2),
    );
    const view = render(
      <OfficialDirectorPlainText
        title="原始响应预览"
        text={"<img src=x onerror=alert(1)>" + "x".repeat(25000)}
      />,
    );
    const detail = screen.getByText("原始响应预览").closest("details");
    if (!detail) throw new Error("Missing details");
    detail.open = true;
    fireEvent(detail, new Event("toggle"));
    await screen.findByText(/这里只预览前 20000 个字符/);
    expect(document.querySelector("img[src=x]")).toBeNull();
    expect(detail.querySelector("pre")?.textContent?.length).toBe(20000);
    view.unmount();
  });
  it("reads existing records without inference, then generates eleven typed shots only after explicit action", async () => {
    const fixture = props();
    render(<OfficialDirectorProposalPanel {...fixture.input} />);
    await ready();
    expect(fixture.bridge.generate).not.toHaveBeenCalled();
    expect(window.aijianChatGPT?.models).not.toHaveBeenCalled();
    await models();
    fireEvent.click(screen.getByText("生成选项与当前输入"));
    fireEvent.change(screen.getByLabelText("目标镜头数（留空由模型规划）"), {
      target: { value: "11" },
    });
    fireEvent.change(screen.getByLabelText("节奏"), { target: { value: "FAST" } });
    fireEvent.change(screen.getByLabelText("导演意图"), {
      target: { value: "保留沉默，用动作推动情节。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "审阅输入并生成一次" }));
    fireEvent.click(screen.getByRole("button", { name: "审阅输入并生成一次" }));
    await screen.findByText("11 个 · 24/1 fps");
    expect(fixture.bridge.generate).toHaveBeenCalledTimes(1);
    const input = vi.mocked(fixture.bridge.generate).mock.calls[0]?.[0];
    expect(input).toMatchObject({
      projectId: fixture.input.projectId,
      episodeId: fixture.input.episodeId,
      authority: fixture.inputs.authority,
      storyboardBase: fixture.inputs.storyboard_base,
      intent: "保留沉默，用动作推动情节。",
      options: { target_shot_count: 11, pacing: "FAST" },
    });
    expect(Object.keys(input ?? {}).sort()).toEqual([
      "authority",
      "episodeId",
      "intent",
      "model",
      "operationId",
      "options",
      "projectId",
      "storyboardBase",
    ]);
    expect(fixture.bridge.adopt).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("供应商响应、版本与操作身份"));
    expect(screen.getByText("供应商响应：resp_verified_fixture")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /模型镜头 11/ }));
    expect(
      within(screen.getByLabelText("所选 AI 镜头详情")).getByRole("heading", {
        name: "镜头 11 · 模型镜头 11",
      }),
    ).toBeInTheDocument();
  });
  it("requires explicit adoption, sends the reviewed identity once and reloads a new editable storyboard", async () => {
    const operation = directorOperation();
    const fixture = props([operation]);
    render(<OfficialDirectorProposalPanel {...fixture.input} />);
    await ready();
    const button = screen.getByRole("button", { name: "明确采纳为新分镜版本" });
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    fireEvent.click(button);
    expect(fixture.bridge.adopt).not.toHaveBeenCalled();
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(fixture.input.onAdopted).toHaveBeenCalledTimes(1));
    await screen.findByText("已采纳为新的可编辑分镜版本，旧版本和原剧本引用保留。");
    expect(fixture.bridge.adopt).toHaveBeenCalledTimes(1);
    expect(fixture.bridge.adopt).toHaveBeenCalledWith(
      fixture.input.projectId,
      fixture.input.episodeId,
      operation.request.operation_id,
      {
        proposal_version_id: operation.proposal?.version_id,
        proposal_content_hash: operation.proposal?.content_hash,
        confirm: true,
      },
    );
    expect(screen.getByText(/已创建可编辑分镜：/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "明确采纳为新分镜版本" })).not.toBeInTheDocument();
    expect(operation.proposal?.content.authority.script.version_id).toBe(
      fixture.inputs.authority.script.version_id,
    );
  });
  it("records a literal human rejection reason and preserves the original AI proposal", async () => {
    const fixture = props([directorOperation()]);
    render(<OfficialDirectorProposalPanel {...fixture.input} />);
    await ready();
    expect(screen.getByRole("button", { name: "记录驳回理由" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("人工驳回理由"), {
      target: { value: "<img src=x onerror=alert(1)> 表演节奏过急。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "记录驳回理由" }));
    await screen.findByText(/人工驳回理由：<img src=x/);
    expect(document.querySelector("img[src=x]")).toBeNull();
    expect(fixture.bridge.reject).toHaveBeenCalledTimes(1);
    expect(fixture.bridge.adopt).not.toHaveBeenCalled();
    expect(screen.getByLabelText("AI 导演镜头计划只读预览")).toBeInTheDocument();
  });
  it.each(["scriptDirty", "storyboardDirty", "pendingOperations"] as const)(
    "blocks generation/adoption/rejection with %s while allowing read-only evidence",
    async (guard) => {
      const fixture = props([directorOperation()]);
      render(<OfficialDirectorProposalPanel {...fixture.input} {...{ [guard]: true }} />);
      await models();
      expect(screen.getByRole("button", { name: "审阅输入并生成一次" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "明确采纳为新分镜版本" })).toBeDisabled();
      expect(screen.getByLabelText("人工驳回理由")).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: "只读核对记录与输入" }));
      await waitFor(() => expect(fixture.bridge.list).toHaveBeenCalledTimes(2));
      expect(fixture.bridge.generate).not.toHaveBeenCalled();
    },
  );
  it("retains invalid output diagnostics and blocks capability-losing adoption", async () => {
    const invalid = directorOperation();
    invalid.status = "INVALID";
    invalid.proposal = null;
    invalid.validation_issues = [{ code: "COVERAGE_INVALID", message: "对白覆盖缺失" }];
    const blocked = directorOperation("323e4567-e89b-42d3-a456-426614174000");
    if (blocked.proposal)
      blocked.proposal.capability_losses = [
        {
          code: "FRACTIONAL_RATE",
          severity: "BLOCKING",
          shot_id: null,
          message: "当前分镜不支持分数帧率",
        },
      ];
    const fixture = props([invalid, blocked]);
    render(<OfficialDirectorProposalPanel {...fixture.input} />);
    await ready();
    expect(screen.getByText("COVERAGE_INVALID：对白覆盖缺失")).toBeInTheDocument();
    expect(screen.queryByLabelText("AI 导演镜头计划只读预览")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("本集操作记录（最近记录）"), {
      target: { value: blocked.request.operation_id },
    });
    expect(screen.getByText(/阻断 · FRACTIONAL_RATE/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "明确采纳为新分镜版本" })).toBeDisabled();
  });
  it("shows missing native gateway and unavailable storage as disabled states", async () => {
    const fixture = props();
    const view = render(<OfficialDirectorProposalPanel {...fixture.input} bridge={null} />);
    await screen.findByText(/当前桌面版本未连接 AI 导演接口/);
    expect(screen.getByRole("button", { name: "审阅输入并生成一次" })).toBeDisabled();
    view.rerender(<OfficialDirectorProposalPanel {...fixture.input} storage={null} />);
    await screen.findByText("本地恢复存储不可用，已暂停提交。");
    expect(screen.getByRole("button", { name: "审阅输入并生成一次" })).toBeDisabled();
  });
  it("reports unavailable model bridge and blocked browser storage without starting inference", async () => {
    const fixture = props();
    const view = render(<OfficialDirectorProposalPanel {...fixture.input} />);
    await ready();
    delete window.aijianChatGPT;
    fireEvent.click(screen.getByRole("button", { name: "读取官方可用模型" }));
    await screen.findByText(/官方模型接口不可用/);
    view.unmount();
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("storage denied");
    });
    render(<OfficialDirectorProposalPanel {...fixture.input} storage={undefined} />);
    await screen.findByText("本地恢复存储不可用，已暂停提交。");
    expect(fixture.bridge.generate).not.toHaveBeenCalled();
  });
  it("reports operation identity failures before transmission without creating a replay journal", async () => {
    const fixture = props();
    render(<OfficialDirectorProposalPanel {...fixture.input} />);
    await models();
    vi.stubGlobal("crypto", {
      subtle: webcrypto.subtle,
      randomUUID: () => {
        throw new Error("uuid unavailable");
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "审阅输入并生成一次" }));
    await screen.findByText("本次操作未能完整核对。请只读查看记录；不会自动重发。");
    expect(fixture.bridge.generate).not.toHaveBeenCalled();
    expect(screen.queryByText("原操作尚待核对，不会自动重发。")).not.toBeInTheDocument();
  });
  it("focuses the newly generated result after previously selecting an older proposal", async () => {
    const newer = directorOperation();
    const older = directorOperation("323e4567-e89b-42d3-a456-426614174000", 11);
    const fixture = props([newer, older]);
    render(<OfficialDirectorProposalPanel {...fixture.input} />);
    await models();
    fireEvent.change(screen.getByLabelText("本集操作记录（最近记录）"), {
      target: { value: older.request.operation_id },
    });
    expect(screen.getByText("11 个 · 24/1 fps")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "审阅输入并生成一次" }));
    await screen.findByText("7 个 · 24/1 fps");
    const id = vi.mocked(fixture.bridge.generate).mock.calls[0]?.[0].operationId;
    expect(screen.getByLabelText("本集操作记录（最近记录）")).toHaveValue(id);
  });
  it("keeps an unknown generate journal after reopening and only reads the original operation", async () => {
    const fixture = props();
    vi.mocked(fixture.bridge.generate).mockResolvedValue({
      kind: "REMOTE_UNKNOWN",
      code: "UNCONFIRMED",
      operationId: "123e4567-e89b-42d3-a456-426614174000",
    });
    let view = render(<OfficialDirectorProposalPanel {...fixture.input} />);
    await models();
    fireEvent.click(screen.getByRole("button", { name: "审阅输入并生成一次" }));
    await screen.findByText("原操作尚待核对，不会自动重发。");
    const originalId = vi.mocked(fixture.bridge.generate).mock.calls[0]?.[0].operationId;
    view.unmount();
    view = render(<OfficialDirectorProposalPanel {...fixture.input} />);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "核对原操作（只读）" }));
    await waitFor(() =>
      expect(fixture.bridge.get).toHaveBeenCalledWith(
        fixture.input.projectId,
        fixture.input.episodeId,
        originalId,
      ),
    );
    expect(fixture.bridge.generate).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "审阅输入并生成一次" })).toBeDisabled();
    expect(
      fixture.input.storage?.getItem(
        `aivora.official-director.pending.v1.${fixture.input.projectId}.${fixture.input.episodeId}`,
      ),
    ).not.toBeNull();
    view.unmount();
  });
  it("recovers an uncertain adoption without re-sending or discarding later manual edits", async () => {
    const operation = directorOperation();
    const fixture = props([operation]);
    const adopt = fixture.bridge.adopt;
    vi.mocked(adopt).mockImplementationOnce(async (...args) => {
      const local = directorGateway([operation]);
      const result = await local.bridge.adopt(...args);
      if (result.kind === "OK") fixture.store.set(operation.request.operation_id, result.operation);
      return { kind: "UNKNOWN" };
    });
    const view = render(<OfficialDirectorProposalPanel {...fixture.input} />);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "明确采纳为新分镜版本" }));
    await screen.findByText("原操作尚待核对，不会自动重发。");
    expect(adopt).toHaveBeenCalledTimes(1);
    view.rerender(<OfficialDirectorProposalPanel {...fixture.input} storyboardDirty />);
    fireEvent.click(screen.getByRole("button", { name: "核对原操作（只读）" }));
    await screen.findByText(/已创建可编辑分镜：/);
    expect(fixture.input.onAdopted).not.toHaveBeenCalled();
    expect(adopt).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "核对原操作（只读）" })).not.toBeInTheDocument();
  });
  it("preserves an uncertain rejection reason, then clears only after its exact read receipt", async () => {
    const operation = directorOperation();
    const fixture = props([operation]);
    const reject = fixture.bridge.reject;
    vi.mocked(reject).mockImplementationOnce(async (...args) => {
      const local = directorGateway([operation]);
      const result = await local.bridge.reject(...args);
      if (result.kind === "OK") fixture.store.set(operation.request.operation_id, result.operation);
      return { kind: "UNKNOWN" };
    });
    render(<OfficialDirectorProposalPanel {...fixture.input} />);
    await ready();
    fireEvent.change(screen.getByLabelText("人工驳回理由"), { target: { value: "原始理由" } });
    fireEvent.click(screen.getByRole("button", { name: "记录驳回理由" }));
    await screen.findByText("原操作尚待核对，不会自动重发。");
    expect(screen.getByLabelText("人工驳回理由")).toHaveValue("原始理由");
    fireEvent.click(screen.getByRole("button", { name: "核对原操作（只读）" }));
    await screen.findByText(/人工驳回理由：原始理由/);
    expect(fixture.input.onWorkStateChange).toHaveBeenLastCalledWith({
      dirty: false,
      pending: false,
      busy: false,
      storyboardPending: false,
    });
    expect(reject).toHaveBeenCalledTimes(1);
  });
  it("preserves a malformed journal seen on focus and reports truncated recent history explicitly", async () => {
    const fixture = props([directorOperation()]);
    vi.mocked(fixture.bridge.list).mockResolvedValue({
      kind: "OK",
      operations: [...fixture.store.values()],
      hasMore: true,
    });
    render(<OfficialDirectorProposalPanel {...fixture.input} />);
    await ready();
    expect(screen.getByText(/这里只显示最近的部分记录/)).toBeInTheDocument();
    fixture.input.storage?.setItem(
      `aivora.official-director.pending.v1.${fixture.input.projectId}.${fixture.input.episodeId}`,
      "broken",
    );
    fireEvent(window, new Event("focus"));
    await screen.findByText("恢复记录不可读取，已暂停所有提交。");
    expect(screen.getByRole("button", { name: "明确采纳为新分镜版本" })).toBeDisabled();
  });
  it("disables stale cached preparation after the host saves a newer manual storyboard", async () => {
    const fixture = props([directorOperation()]);
    const view = render(
      <OfficialDirectorProposalPanel
        {...fixture.input}
        currentStoryboardBase={fixture.inputs.storyboard_base}
      />,
    );
    await ready();
    expect(screen.getByRole("button", { name: "明确采纳为新分镜版本" })).toBeEnabled();
    const newer = {
      version_id: `ver_${"3".repeat(32)}`,
      content_hash: `sha256:${"4".repeat(64)}`,
      head_revision: 2,
    };
    view.rerender(
      <OfficialDirectorProposalPanel {...fixture.input} currentStoryboardBase={newer} />,
    );
    expect(screen.getByText(/本集已保存的分镜版本已变化/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "明确采纳为新分镜版本" })).toBeDisabled();
    fixture.inputs.storyboard_base = newer;
    fireEvent.click(screen.getByRole("button", { name: "只读核对记录与输入" }));
    await screen.findByText(/当前剧本、制作意图或分镜基准已变化/);
    expect(screen.queryByText(/本集已保存的分镜版本已变化/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "明确采纳为新分镜版本" })).toBeDisabled();
    expect(fixture.bridge.adopt).not.toHaveBeenCalled();
  });
  it("retains existing evidence after failed record reads, pauses mutations and handles unavailable models", async () => {
    const fixture = props([directorOperation()]);
    render(<OfficialDirectorProposalPanel {...fixture.input} />);
    await ready();
    vi.mocked(fixture.bridge.list).mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: "只读核对记录与输入" }));
    await screen.findByText("操作记录读取失败，未重复生成。请只读核对。");
    expect(screen.getByLabelText("AI 导演镜头计划只读预览")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "明确采纳为新分镜版本" })).toBeDisabled();
    const auth = window.aijianChatGPT;
    if (!auth) throw new Error("Missing test model bridge");
    vi.mocked(auth.models).mockResolvedValueOnce({
      kind: "ERROR",
      code: "PLAN_USAGE_NOT_AUTHORIZED",
    });
    fireEvent.click(screen.getByRole("button", { name: "读取官方可用模型" }));
    await screen.findByText(/PLAN_USAGE_NOT_AUTHORIZED/);
    vi.mocked(auth.models).mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: "读取官方可用模型" }));
    await screen.findByText("官方模型读取失败，请核对连接管理。");
    vi.mocked(auth.models).mockResolvedValueOnce({ kind: "OK", models: [] });
    fireEvent.click(screen.getByRole("button", { name: "读取官方可用模型" }));
    await screen.findByText("当前账号没有可用模型。");
  });
  it("reopens a durable REMOTE_UNKNOWN with an empty renderer journal and reconciles only by reading", async () => {
    const operation = directorOperation();
    operation.status = "REMOTE_UNKNOWN";
    operation.proposal = null;
    operation.completion = null;
    operation.attempt_status = "REMOTE_UNKNOWN";
    const fixture = props([operation]);
    render(<OfficialDirectorProposalPanel {...fixture.input} />);
    await models();
    expect(screen.getByText(/本集有远端结果未知的操作/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "审阅输入并生成一次" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "核对原操作（只读）" })).not.toBeInTheDocument();
    fixture.store.set(operation.request.operation_id, directorOperation());
    fireEvent.click(screen.getByRole("button", { name: "只读核对记录与输入" }));
    await screen.findByText("7 个 · 24/1 fps");
    expect(fixture.bridge.generate).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "审阅输入并生成一次" })).toBeEnabled();
  });
  it("never applies a late previous-episode generation to the new episode state", async () => {
    const fixture = props();
    let resolve:
      ((value: Awaited<ReturnType<OfficialDirectorBridge["generate"]>>) => void) | undefined;
    vi.mocked(fixture.bridge.generate).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const { result, rerender } = renderHook(
      (input: OfficialDirectorPanelProps) => useOfficialDirectorProposals(input),
      { initialProps: fixture.input },
    );
    await waitFor(() => expect(result.current.readState).toBe("ready"));
    await act(() => result.current.loadModels());
    act(() => {
      result.current.setCount(11);
    });
    let task: Promise<void> | undefined;
    act(() => {
      task = result.current.generate();
    });
    const priorInput = vi.mocked(fixture.bridge.generate).mock.calls[0]?.[0];
    expect(priorInput).toBeDefined();
    rerender({ ...fixture.input, episodeId: `ep_${"f".repeat(32)}` });
    await waitFor(() => expect(result.current.busy).toBe(false));
    act(() => {
      result.current.setIntent("新集导演意图");
      result.current.setReason("新集驳回理由");
    });
    await act(async () => {
      if (!resolve || !priorInput) throw new Error("No pending generation");
      const old = directorOperation(priorInput.operationId, 11);
      old.request.options = priorInput.options;
      fixture.store.set(old.request.operation_id, old);
      resolve({ kind: "OK", operation: old });
      await task;
    });
    expect(result.current.intent).toBe("新集导演意图");
    expect(result.current.reason).toBe("新集驳回理由");
    expect(result.current.operations).toEqual([]);
    expect(fixture.input.onAdopted).not.toHaveBeenCalled();
    expect(defaultDirectorIntent).not.toBe(result.current.intent);
  });
  it("never clears a new episode rejection reason after a late prior-episode rejection", async () => {
    const operation = directorOperation();
    const fixture = props([operation]);
    let resolve:
      ((value: Awaited<ReturnType<OfficialDirectorBridge["reject"]>>) => void) | undefined;
    vi.mocked(fixture.bridge.reject).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const { result, rerender } = renderHook(
      (input: OfficialDirectorPanelProps) => useOfficialDirectorProposals(input),
      { initialProps: fixture.input },
    );
    await waitFor(() => expect(result.current.readState).toBe("ready"));
    act(() => result.current.setReason("旧集理由"));
    let task: Promise<void> | undefined;
    act(() => {
      task = result.current.reject(operation);
    });
    expect(fixture.bridge.reject).toHaveBeenCalledTimes(1);
    rerender({ ...fixture.input, episodeId: `ep_${"f".repeat(32)}` });
    await waitFor(() => expect(result.current.busy).toBe(false));
    act(() => result.current.setReason("新集理由"));
    await act(async () => {
      if (!resolve) throw new Error("No pending rejection");
      const rejected = {
        ...operation,
        rejection: {
          actor_id: "local-user",
          rejected_at: "2026-10-08T13:00:00Z",
          reason: "旧集理由",
        },
      };
      fixture.store.set(operation.request.operation_id, rejected);
      resolve({ kind: "OK", operation: rejected });
      await task;
    });
    expect(result.current.reason).toBe("新集理由");
    expect(result.current.operations).toEqual([]);
    expect(fixture.input.onAdopted).not.toHaveBeenCalled();
  });
  it("never reloads the storyboard after a late adoption response reaches an unmounted panel", async () => {
    const operation = directorOperation();
    const fixture = props([operation]);
    let resolve:
      ((value: Awaited<ReturnType<OfficialDirectorBridge["adopt"]>>) => void) | undefined;
    vi.mocked(fixture.bridge.adopt).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const { result, unmount } = renderHook(
      (input: OfficialDirectorPanelProps) => useOfficialDirectorProposals(input),
      { initialProps: fixture.input },
    );
    await waitFor(() => expect(result.current.readState).toBe("ready"));
    let task: Promise<void> | undefined;
    act(() => {
      task = result.current.adopt(operation);
    });
    unmount();
    await act(async () => {
      if (!resolve || !operation.proposal) throw new Error("No pending adoption");
      const adopted = {
        ...operation,
        adoption: {
          proposal_version_id: operation.proposal.version_id,
          proposal_content_hash: operation.proposal.content_hash,
          storyboard_version_id: `ver_${"3".repeat(32)}`,
          storyboard_content_hash: `sha256:${"4".repeat(64)}`,
          actor_id: "local-user",
          adopted_at: "2026-10-08T13:00:00Z",
        },
      };
      fixture.store.set(operation.request.operation_id, adopted);
      resolve({ kind: "OK", operation: adopted });
      await task;
    });
    expect(fixture.input.onAdopted).not.toHaveBeenCalled();
  });
});

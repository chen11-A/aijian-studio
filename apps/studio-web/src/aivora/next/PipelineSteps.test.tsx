import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  PipelineSteps,
  type PipelineCheckpoint,
  type PipelineStepView,
  type PipelineTargetView,
} from "./PipelineSteps";

const step = (
  id: string,
  status: PipelineStepView["status"],
  done = 0,
  total = 1,
  targets?: PipelineTargetView[],
): PipelineStepView => ({ id, label: `internal-${id}`, status, done, total, targets });

const checkpoint = (over: Partial<PipelineCheckpoint> = {}): PipelineCheckpoint => ({
  shotCount: 28,
  seconds: 149,
  estimatedRequests: 30,
  coverage: [{ sceneId: "s1", ok: true, missingLines: [], missingTail: null }],
  risks: [],
  ...over,
});

const openList = () => fireEvent.click(screen.getByRole("button", { name: /要处理的 \d+ 件事/ }));

describe("PipelineSteps", () => {
  it("draws nothing without steps or a checkpoint", () => {
    const { container } = render(<PipelineSteps steps={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names every step plainly, including the human-accepted review and assembly", () => {
    render(
      <PipelineSteps
        steps={[
          step("writer", "done"),
          step("portraits", "running", 12, 28),
          step("prompter", "queued"),
          step("review", "accepted"),
          step("assembly", "blocked"),
        ]}
      />,
    );
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("编剧✓");
    expect(items[1]).toHaveTextContent("定妆照正在做12/28");
    expect(items[2]).toHaveTextContent("画面说明");
    expect(items[3]).toHaveTextContent("审片✓ 人工确认");
    expect(items[4]).toHaveTextContent("合成成片卡住了");
    expect(document.body.textContent).not.toMatch(/internal-|提示词|[A-Z]{3,}_/);
  });

  it("retries only the chosen target, and an uncertain one only after it is confirmed", () => {
    const retry = vi.fn();
    render(
      <PipelineSteps
        steps={[
          step("portraits", "failed", 2, 3, [
            { id: "a@正面", status: "done" },
            { id: "a@侧面", status: "failed", code: "PORTRAIT_FAILED", retryable: true },
            {
              id: "b@正面",
              status: "uncertain",
              code: "REQUEST_OUTCOME_UNKNOWN",
              retryable: true,
              requiresOutcomeConfirmation: true,
            },
            { id: "c@正面", status: "failed", code: "PORTRAIT_FAILED", retryable: false },
          ]),
        ]}
        targetName={(_, id) => ({ "a@侧面": "林晚 · 侧面", "b@正面": "沈砚 · 正面" })[id] ?? ""}
        onRetryTarget={retry}
      />,
    );
    openList();
    expect(screen.getByText(/林晚 · 侧面：没做完。定妆照没出成/)).toBeInTheDocument();
    const buttons = screen.getAllByRole("button", { name: "重试这一项" });
    expect(buttons).toHaveLength(2);
    expect(screen.getByText(/第 4 项：没做完/)).toBeInTheDocument();
    fireEvent.click(buttons[0]!);
    expect(retry).toHaveBeenLastCalledWith("portraits", "a@侧面", false);
    expect(buttons[1]).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /我核对过，上次没有做成/ }));
    fireEvent.click(buttons[1]!);
    expect(retry).toHaveBeenLastCalledWith("portraits", "b@正面", true);
    expect(retry).toHaveBeenCalledTimes(2);
  });

  it("asks for a written human review, separate from continuing", () => {
    const accept = vi.fn();
    const go = vi.fn();
    render(
      <PipelineSteps
        steps={[step("review", "needs-input", 0, 1, [{ id: "all", status: "needs-input" }])]}
        checkpoint={checkpoint()}
        canAcceptReview
        canContinue={false}
        onAcceptReview={accept}
        onContinue={go}
      />,
    );
    expect(screen.getByRole("button", { name: "继续生成" })).toBeDisabled();
    expect(screen.getByText("先看一遍画面，写下审片结论，才能继续。")).toBeInTheDocument();
    openList();
    expect(screen.getByText(/审片还不会自己看画面/)).toBeInTheDocument();
    const record = screen.getByRole("button", { name: "记下审片结论" });
    expect(record).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  28 张都看过了  " } });
    fireEvent.click(record);
    expect(accept).toHaveBeenCalledWith("28 张都看过了");
    expect(go).not.toHaveBeenCalled();
  });

  it("will not continue past a missing end or a blocking risk, and says why", () => {
    const { rerender } = render(
      <PipelineSteps
        steps={[]}
        checkpoint={checkpoint({
          coverage: [{ sceneId: "s1", ok: false, missingLines: [], missingTail: "门外刹车声。" }],
        })}
        canContinue={false}
        sceneName={() => "第 1 场「雨夜旧书店」"}
        onContinue={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "继续生成" })).toBeDisabled();
    expect(screen.getByText("先补上没拍到的结尾和台词，才能继续。")).toBeInTheDocument();
    openList();
    expect(
      screen.getByText("第 1 场「雨夜旧书店」结尾还没拍到：「门外刹车声。」"),
    ).toBeInTheDocument();
    rerender(
      <PipelineSteps
        steps={[]}
        checkpoint={checkpoint({
          risks: [{ code: "ACTION_UNASSIGNED", text: "2 个动作还没对上镜头。", severity: "block" }],
        })}
        canContinue={false}
        onContinue={() => {}}
      />,
    );
    expect(screen.getByText("先处理标红的问题，才能继续。")).toBeInTheDocument();
  });

  it("calls the request count an estimate and continues only when allowed", () => {
    const go = vi.fn();
    render(<PipelineSteps steps={[]} checkpoint={checkpoint()} canContinue onContinue={go} />);
    expect(
      screen.getByText(/28 个镜头 · 约 149 秒 · 约需 30 次生成 · 用会员额度/),
    ).toBeInTheDocument();
    expect(document.querySelectorAll(".nx-primary")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "继续生成" }));
    expect(go).toHaveBeenCalledTimes(1);
  });

  it("offers 取消 while something is being made, and says when it was cancelled", () => {
    const cancel = vi.fn();
    const { rerender } = render(
      <PipelineSteps steps={[step("director", "running")]} busy onCancel={cancel} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(cancel).toHaveBeenCalled();
    rerender(<PipelineSteps steps={[step("director", "queued")]} overall="cancelled" />);
    expect(screen.getByText("已取消，做好的都留着。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "取消" })).toBeNull();
  });
});

it("offers an exact retry for a failed whole-film assembly target", () => {
  const retry = vi.fn();
  render(
    <PipelineSteps
      steps={[
        {
          id: "assembly",
          status: "failed",
          done: 0,
          total: 1,
          targets: [{ id: "all", status: "failed", attempt: 1, retryable: true }],
        },
      ]}
      onRetryTarget={retry}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /要处理的/ }));
  fireEvent.click(screen.getByRole("button", { name: "重试这一项" }));
  expect(retry).toHaveBeenCalledExactlyOnceWith("assembly", "all", false);
});

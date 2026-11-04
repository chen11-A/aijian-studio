import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PipelineSteps, type PipelineStepView } from "./PipelineSteps";

const step = (
  id: string,
  status: PipelineStepView["status"],
  done = 0,
  total = 1,
): PipelineStepView => ({ id, label: `internal-${id}`, status, done, total });

describe("PipelineSteps", () => {
  it("draws nothing without steps or a checkpoint", () => {
    const { container } = render(<PipelineSteps steps={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names the steps plainly, ticks the done ones and counts the running one", () => {
    render(
      <PipelineSteps
        steps={[
          step("writer", "done"),
          step("portraits", "running", 12, 28),
          step("prompter", "queued"),
        ]}
      />,
    );
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("编剧✓");
    expect(items[1]).toHaveTextContent("定妆照12/28");
    expect(items[2]).toHaveTextContent("画面说明");
    expect(document.body.textContent).not.toMatch(/internal-|提示词/);
  });

  it("offers 从这一步重来 on a failed step only when it can restart", () => {
    const retry = vi.fn();
    const { rerender } = render(<PipelineSteps steps={[step("director", "failed", 2, 3)]} />);
    expect(screen.getByText("没做完 2/3")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "从这一步重来" })).toBeNull();
    rerender(<PipelineSteps steps={[step("director", "failed", 2, 3)]} onRetryFrom={retry} />);
    fireEvent.click(screen.getByRole("button", { name: "从这一步重来" }));
    expect(retry).toHaveBeenCalledWith("director");
  });

  it("says what the checkpoint will make, with one primary button", () => {
    const go = vi.fn();
    render(
      <PipelineSteps
        steps={[]}
        checkpoint={{ shots: 28, seconds: 149, videos: 28 }}
        onContinue={go}
      />,
    );
    expect(
      screen.getByText(/28 个镜头 · 约 149 秒 · 将生成 28 段视频 · 用会员额度/),
    ).toBeInTheDocument();
    expect(document.querySelectorAll(".nx-primary")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "继续生成" }));
    expect(go).toHaveBeenCalled();
  });
});

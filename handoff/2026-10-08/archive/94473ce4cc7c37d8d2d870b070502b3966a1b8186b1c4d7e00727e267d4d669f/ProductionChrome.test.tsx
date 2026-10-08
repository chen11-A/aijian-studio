import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import type { ProjectData } from "../../api/studio";
import {
  PendingWorkspace,
  ProductionStageBar,
  ProjectInspector,
  type ProductionSourceStage,
} from "./ProductionChrome";

const project = {
  id: `prj_${"a".repeat(32)}`,
  name: "雾城来信",
  aspect_ratio: "9:16",
  target_duration_seconds: 90,
  source_language: "zh-CN",
  status: "active",
  revision: 3,
  created_at: "2026-08-10T09:00:00Z",
  updated_at: "2026-08-10T09:00:00Z",
} satisfies ProjectData;

test.each([
  [{ kind: "empty" }, "未导入", "导入小说原文", "source"],
  [{ kind: "loading" }, "读取中", "正在读取来源状态", null],
  [{ kind: "error" }, "读取失败", "恢复来源审核", "source-review"],
  [{ kind: "inconsistent" }, "身份不一致", "核对来源审核", "source-review"],
  [{ kind: "draft", acceptedVersionNumber: null }, "待审核", "审核来源版本", "source-review"],
  [{ kind: "review", acceptedVersionNumber: null }, "审核中", "审核来源版本", "source-review"],
  [{ kind: "approved", versionNumber: 1 }, "已批准", "审阅故事证据", "story"],
] satisfies Array<[ProductionSourceStage, string, string, string | null]>)(
  "derives honest source navigation from %j",
  (source, status, label, target) => {
    const onNext = vi.fn();
    render(<ProductionStageBar source={source} onNext={onNext} />);
    const next = screen.getByRole("button", { name: `下一步：${label}` });
    const g1 = screen.getByRole("button", { name: `G1 来源：${status}` });
    fireEvent.click(next);
    if (target === null) {
      expect(next).toBeDisabled();
      expect(g1).toBeDisabled();
      expect(onNext).not.toHaveBeenCalled();
    } else {
      expect(onNext).toHaveBeenLastCalledWith(target);
      fireEvent.click(g1);
      expect(onNext).toHaveBeenLastCalledWith("source-review");
    }
    fireEvent.click(screen.getByRole("button", { name: /G0 立项/ }));
    expect(onNext).toHaveBeenLastCalledWith("project");
    expect(screen.getByText("G2–G8 状态未接入 · 导航不代表批准")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /G[2-8]/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/审批人未指派/)).not.toBeInTheDocument();
  },
);

test.each(["draft", "review"] as const)(
  "keeps the old approved baseline explicit beside a new %s",
  (kind) => {
    render(<ProductionStageBar source={{ kind, acceptedVersionNumber: 1 }} onNext={vi.fn()} />);
    expect(screen.getByText(/旧批准基线 V1 仍可用于故事阅读/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: kind === "draft" ? "G1 来源：新版待审核" : "G1 来源：新版审核中",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下一步：审核来源版本" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "G1 来源：已批准" })).not.toBeInTheDocument();
  },
);

test("R2 five-stage navigation does not submit or approve a source gate", () => {
  const onNext = vi.fn();
  const onStage = vi.fn();
  render(
    <ProductionStageBar
      source={{ kind: "review", acceptedVersionNumber: 1 }}
      onNext={onNext}
      activeStage="story"
      onStage={onStage}
    />,
  );
  const stages = screen.getByRole("navigation", { name: "创作五阶段" });
  expect(stages.querySelectorAll("button")).toHaveLength(5);
  fireEvent.click(screen.getByRole("button", { name: "2角色与世界" }));
  expect(onStage).toHaveBeenCalledExactlyOnceWith("world");
  expect(onNext).not.toHaveBeenCalled();
  expect(screen.getByText(/旧批准基线 V1 仍可用于故事阅读/)).toBeInTheDocument();
});

test("R2 inspector folding keeps its proposal controls mounted and available", () => {
  const proposal = (
    <label>
      提案理由
      <input defaultValue="未提交的内容" />
    </label>
  );
  const view = render(
    <ProjectInspector project={project} collapsed={false} onToggle={vi.fn()} proposal={proposal} />,
  );
  const input = screen.getByRole("textbox", { name: "提案理由" });
  fireEvent.change(input, { target: { value: "保留修改" } });
  view.rerender(
    <ProjectInspector project={project} collapsed onToggle={vi.fn()} proposal={proposal} />,
  );
  expect(screen.getByRole("textbox", { name: "提案理由" })).toBe(input);
  expect(input).toHaveValue("保留修改");
});

test("keeps G0 overview navigation separate from empty-source import navigation", () => {
  const onNext = vi.fn();
  render(<ProductionStageBar source={{ kind: "empty" }} onNext={onNext} />);

  fireEvent.click(screen.getByRole("button", { name: "下一步：导入小说原文" }));
  expect(onNext).toHaveBeenLastCalledWith("source");

  fireEvent.click(screen.getByRole("button", { name: /G0 立项/ }));
  expect(onNext).toHaveBeenLastCalledWith("project");
});

test("keeps the inspector collapsible without inventing proposal data", () => {
  const toggle = vi.fn();
  const view = render(<ProjectInspector project={project} collapsed={false} onToggle={toggle} />);

  expect(screen.getByText("REV 3")).toBeInTheDocument();
  expect(screen.getByText("暂无待审提案")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "收起属性检查器" }));
  expect(toggle).toHaveBeenCalledOnce();

  view.rerender(<ProjectInspector project={project} collapsed onToggle={toggle} />);
  fireEvent.click(screen.getByRole("button", { name: "展开属性检查器" }));
  expect(toggle).toHaveBeenCalledTimes(2);
});

test("labels planned production areas as unavailable", () => {
  render(<PendingWorkspace name="导演" />);
  expect(screen.getByRole("heading", { name: "导演工作区尚未实现" })).toBeInTheDocument();
  expect(screen.getByText(/不会用静态示例冒充/)).toBeInTheDocument();
});

test("keeps the inspector as the single production inspector slot", () => {
  render(<ProjectInspector project={project} collapsed={false} onToggle={() => {}} />);
  expect(screen.getByLabelText("Aivora AI 与提案")).toHaveClass("studio-inspector");
});

import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import type { ProjectData } from "../../api/studio";
import { PendingWorkspace, ProductionStageBar, ProjectInspector } from "./ProductionChrome";

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

test("offers one honest next action as production evidence advances", () => {
  const onNext = vi.fn();
  const view = render(<ProductionStageBar sourceReady={false} onNext={onNext} />);

  fireEvent.click(screen.getByRole("button", { name: "下一步：导入小说原文" }));
  fireEvent.click(screen.getByRole("button", { name: /G0 立项/ }));
  expect(onNext).toHaveBeenNthCalledWith(1, "project");
  expect(onNext).toHaveBeenNthCalledWith(2, "project");

  view.rerender(<ProductionStageBar sourceReady onNext={onNext} />);
  fireEvent.click(screen.getByRole("button", { name: "下一步：审阅故事证据" }));
  expect(onNext).toHaveBeenLastCalledWith("story");
  expect(screen.getByRole("button", { name: /G2 故事：状态未接入/ })).toBeDisabled();
});

test("keeps the inspector collapsible without inventing proposal data", () => {
  const toggle = vi.fn();
  const view = render(<ProjectInspector project={project} collapsed={false} onToggle={toggle} />);

  expect(screen.getByText("REV 3")).toBeInTheDocument();
  expect(screen.getByText("暂无提案")).toBeInTheDocument();
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

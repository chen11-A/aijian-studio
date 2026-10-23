import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { UtilityPages } from "./UtilityPages";

const model = vi.hoisted(() => ({
  page: "costs" as const,
  isFixture: false,
  professional: false,
  backendProjectId: `prj_${"1".repeat(32)}`,
  go: vi.fn(),
  taskQueue: {
    state: {
      kind: "ready" as const,
      response: {
        request_id: "00000000-0000-4000-8000-000000000001",
        data: {
          project_id: `prj_${"1".repeat(32)}`,
          summary: { total: 0, attention: 0, active: 0, completed: 0 },
          tasks: [],
        },
      },
    },
    filter: "all" as const,
    visibleTasks: [],
    setFilter: vi.fn(),
    reload: vi.fn(),
  },
}));
vi.mock("./model", () => ({ useDemo: () => model }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("opens the connected Costs page in both modes with only read and navigation actions", () => {
  const result = render(<UtilityPages />);
  expect(screen.getByLabelText("当前作品任务与费用记录")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "查看固定演示账单" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "预算设置待接入" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "重新读取项目任务账本（只读）" }));
  expect(model.taskQueue.reload).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button", { name: "选择作品" }));
  expect(model.go).toHaveBeenCalledWith("project");
  fireEvent.click(screen.getByRole("button", { name: "前往 AI 服务" }));
  expect(model.go).toHaveBeenCalledWith("services");
  model.professional = true;
  result.rerender(<UtilityPages />);
  expect(screen.getAllByText("未知")).toHaveLength(3);
  expect(screen.getByRole("button", { name: "预算设置待接入" })).toBeDisabled();
});

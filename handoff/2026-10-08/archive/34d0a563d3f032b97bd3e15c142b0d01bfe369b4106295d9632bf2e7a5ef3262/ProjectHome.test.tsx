import { expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ProjectHome } from "./ProjectHome";
import type { ProjectData } from "../../api/studio";
const project = {
  id: "p",
  name: "雾城",
  aspect_ratio: "9:16",
  target_duration_seconds: 90,
  revision: 1,
  status: "active",
  source_language: "zh-CN",
  created_at: "",
  updated_at: "",
} satisfies ProjectData;
test("uses the selected project and routes each real overview entry", () => {
  const navigate = vi.fn();
  const openTasks = vi.fn();
  render(
    <ProjectHome
      project={project}
      source={{ kind: "empty" }}
      onNavigate={navigate}
      onOpenTasks={openTasks}
    />,
  );
  expect(screen.getByRole("heading", { name: "雾城" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "导入小说原文" }));
  expect(navigate).toHaveBeenCalledWith("source");
  fireEvent.click(screen.getByRole("button", { name: "任务与影响报告" }));
  expect(openTasks).toHaveBeenCalledOnce();
});

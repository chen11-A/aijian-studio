import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import type { CreateProjectInput, ProjectData } from "../../api/studio";
import { ProjectEntry, type ProjectEntryCreateOutcome } from "./ProjectEntry";

const first: ProjectData = {
  id: `prj_${"1".repeat(32)}`,
  name: "雾城来信",
  aspect_ratio: "9:16",
  target_duration_seconds: 90,
  source_language: "zh-CN",
  status: "active",
  revision: 3,
  created_at: "2026-09-01T08:00:00Z",
  updated_at: "2026-09-02T08:00:00Z",
};

const second: ProjectData = {
  ...first,
  id: `prj_${"2".repeat(32)}`,
  name: "海港来信",
  revision: 4,
  updated_at: "2026-09-03T08:00:00Z",
};

function entry(
  options: Partial<{
    projects: readonly ProjectData[];
    selectedProjectId: string | null;
    onSelectProject: (projectId: string) => void;
    onCreateProject: (input: CreateProjectInput) => Promise<ProjectEntryCreateOutcome>;
    onDismiss: () => void;
  }> = {},
) {
  const onSelectProject = options.onSelectProject ?? vi.fn<(projectId: string) => void>();
  const onCreateProject =
    options.onCreateProject ??
    vi.fn<(input: CreateProjectInput) => Promise<ProjectEntryCreateOutcome>>();
  const onDismiss = options.onDismiss ?? vi.fn<() => void>();
  render(
    <ProjectEntry
      projects={options.projects ?? []}
      selectedProjectId={options.selectedProjectId ?? null}
      onSelectProject={onSelectProject}
      onCreateProject={onCreateProject}
      onDismiss={onDismiss}
    />,
  );
  return { onSelectProject, onCreateProject, onDismiss };
}

function fillDraft(name = "未署名的海") {
  fireEvent.change(screen.getByRole("textbox", { name: "作品名称" }), { target: { value: name } });
}

test("shows project fields and requires a draft decision before switching", () => {
  const { onSelectProject } = entry({ projects: [first, second], selectedProjectId: first.id });

  const recent = screen.getByRole("region", { name: "近期作品列表" });
  expect(within(recent).getByRole("button", { name: /雾城来信/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(within(recent).getByText(/9:16 · 90 秒 · REV 4/)).toBeInTheDocument();
  fireEvent.click(within(recent).getByRole("button", { name: /海港来信/ }));
  expect(onSelectProject).toHaveBeenCalledExactlyOnceWith(second.id);
  expect(screen.queryByText(/服务已确认创建/)).not.toBeInTheDocument();
  fillDraft();
  fireEvent.change(screen.getByRole("spinbutton", { name: "作品默认目标时长" }), {
    target: { value: "121" },
  });
  const firstButton = within(recent).getByRole("button", { name: /雾城来信/ });
  fireEvent.click(firstButton);
  expect(screen.getByText("放弃未提交的草稿并切换作品？")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "放弃并切换" })).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
  expect(firstButton).toHaveFocus();
  expect(onSelectProject).toHaveBeenCalledTimes(1);
});

test("creates with the existing Project contract and only exposes a confirmed result", async () => {
  const onCreateProject = vi
    .fn<(input: CreateProjectInput) => Promise<ProjectEntryCreateOutcome>>()
    .mockResolvedValue({
      kind: "SUCCEEDED",
      project: first,
    });
  const { onSelectProject } = entry({ onCreateProject });
  const name = screen.getByRole("textbox", { name: "作品名称" });
  expect(name).toHaveFocus();
  fillDraft();
  fireEvent.change(screen.getByRole("spinbutton", { name: "作品默认目标时长" }), {
    target: { value: "120" },
  });
  fireEvent.click(screen.getByRole("button", { name: "创建作品" }));

  await waitFor(() =>
    expect(onCreateProject).toHaveBeenCalledExactlyOnceWith({
      name: "未署名的海",
      aspect_ratio: "9:16",
      target_duration_seconds: 120,
      source_language: "zh-CN",
    } satisfies CreateProjectInput),
  );
  expect(await screen.findByText("已创建“雾城来信”。")).toBeInTheDocument();
  expect(onSelectProject).not.toHaveBeenCalled();
  fillDraft("下一份草稿");
  fireEvent.click(screen.getByRole("button", { name: "打开新作品" }));
  expect(screen.getByText("放弃未提交的草稿并切换作品？")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
  expect(onSelectProject).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "打开新作品" }));
  fireEvent.click(screen.getByRole("button", { name: "放弃并切换" }));
  expect(onSelectProject).toHaveBeenCalledExactlyOnceWith(first.id);
});

test("keeps unknown results and transport exceptions blocked until a new request is explicitly confirmed", async () => {
  const onCreateProject = vi
    .fn<(input: CreateProjectInput) => Promise<ProjectEntryCreateOutcome>>()
    .mockRejectedValue(new Error("connection dropped"));
  entry({ onCreateProject });
  fillDraft();
  fireEvent.click(screen.getByRole("button", { name: "创建作品" }));

  expect(await screen.findByText(/创建结果待核对/)).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "作品名称" })).toHaveValue("未署名的海");
  expect(onCreateProject).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "继续编辑草稿" }));
  expect(screen.getByRole("button", { name: "创建新请求" })).toBeDisabled();
  expect(onCreateProject).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "创建新的请求" }));
  expect(screen.getByRole("button", { name: "仍然创建新请求" })).toHaveFocus();
  fireEvent.submit(screen.getByRole("textbox", { name: "作品名称" }).closest("form")!);
  expect(onCreateProject).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "仍然创建新请求" }));
  expect(screen.getByRole("button", { name: "创建新请求" })).toBeEnabled();
  expect(onCreateProject).toHaveBeenCalledTimes(1);
});

test("prevents duplicate submission and does not switch projects when a late create succeeds", async () => {
  let resolveCreate: (outcome: ProjectEntryCreateOutcome) => void = () => {};
  const onCreateProject = vi.fn<(input: CreateProjectInput) => Promise<ProjectEntryCreateOutcome>>(
    () =>
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
  );
  const { onSelectProject } = entry({
    projects: [first],
    selectedProjectId: first.id,
    onCreateProject,
  });
  fillDraft("延迟创建");
  const create = screen.getByRole("button", { name: "创建作品" });
  fireEvent.click(create);
  fireEvent.click(create);
  expect(onCreateProject).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: /雾城来信/ }));
  expect(onSelectProject).not.toHaveBeenCalled();
  await act(async () => resolveCreate({ kind: "SUCCEEDED", project: second }));
  expect(await screen.findByText("已创建“海港来信”。")).toBeInTheDocument();
  expect(onSelectProject).not.toHaveBeenCalled();
});

test("requires an explicit discard and restores focus for keyboard users", () => {
  const { onCreateProject, onDismiss } = entry();
  fillDraft();
  fireEvent.keyDown(window, { key: "Escape" });
  const discard = screen.getByRole("button", { name: "放弃草稿" });
  expect(discard).toHaveFocus();
  fireEvent.submit(screen.getByRole("textbox", { name: "作品名称" }).closest("form")!);
  expect(onCreateProject).not.toHaveBeenCalled();
  expect(screen.getByRole("textbox", { name: "作品名称" })).toHaveValue("未署名的海");
  fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
  expect(screen.getByRole("textbox", { name: "作品名称" })).toHaveValue("未署名的海");
  fireEvent.keyDown(window, { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "放弃草稿" }));
  expect(onDismiss).toHaveBeenCalledOnce();
  expect(screen.getByRole("textbox", { name: "作品名称" })).toHaveValue("");
});

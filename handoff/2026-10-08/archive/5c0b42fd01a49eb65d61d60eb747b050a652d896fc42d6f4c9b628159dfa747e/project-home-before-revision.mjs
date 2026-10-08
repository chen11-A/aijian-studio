import React from "react";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HomePages } from "@qa-project/HomePages.tsx";
import { EditorDialog } from "@qa-project/Common.tsx";
import { DemoProvider, useDemo } from "@qa-project/model.tsx";

const aid = "prj_" + "a".repeat(32);
const bid = "prj_" + "b".repeat(32);
const requestId = "88ed7974-adc3-4e35-a5c8-38b9674fc45c";
function project(id, name, changes = {}) {
  return { id, name, aspect_ratio: "9:16", target_duration_seconds: 60,
    source_language: "zh-CN", status: "active", revision: 1,
    created_at: "2026-09-14T00:00:00Z", updated_at: "2026-09-14T00:00:00Z",
    ...changes };
}
function response(data) { return { request_id: requestId, data }; }
function makeBridge(initial) {
  let rows = [...initial];
  const bridge = {
    health: vi.fn(async () => response({ status: "ok", service: "aijian-api", version: "test" })),
    listProjects: vi.fn(async () => response(rows)),
    listSources: vi.fn(async () => response([])),
    getProject: vi.fn(async (id) => response(rows.find((row) => row.id === id))),
    updateProject: vi.fn(async (id, command) => {
      const old = rows.find((row) => row.id === id);
      const updated = { ...old, ...("name" in command ? { name: command.name } : {}),
        ...("status" in command ? { status: command.status } : {}),
        revision: old.revision + 1, updated_at: "2026-09-15T00:00:00Z" };
      rows = rows.map((row) => row.id === id ? updated : row);
      return { kind: "SUCCEEDED", receipt: response(updated) };
    }),
  };
  return bridge;
}
function Harness() {
  const d = useDemo();
  return React.createElement(React.Fragment, null,
    React.createElement(HomePages),
    React.createElement(EditorDialog),
    React.createElement("output", { "aria-label": "project-state" },
      JSON.stringify({ projects: d.projects, selected: d.backendProjectId, title: d.value("title"), page: d.page })),
    React.createElement("output", { "aria-label": "toast" }, d.toast));
}
function mount(bridge) {
  window.aijian = bridge;
  window.history.replaceState({}, "", "#projects");
  render(React.createElement(DemoProvider, null, React.createElement(Harness)));
}
function state() { return JSON.parse(screen.getByLabelText("project-state").textContent || "{}"); }
function manage(name) { fireEvent.click(screen.getByRole("button", { name })); }
function action(value) { fireEvent.change(screen.getByLabelText("操作"), { target: { value } }); }
function save() { fireEvent.click(screen.getByRole("button", { name: "保存真实项目修改" })); }
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal("crypto", { randomUUID: () => requestId });
});
afterEach(() => {
  cleanup();
  delete window.aijian;
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

test("rename persists across reopen; archive and restore update only after authoritative read", async () => {
  const bridge = makeBridge([project(aid, "旧名")]);
  mount(bridge);
  await screen.findByRole("button", { name: "旧名" });
  manage("旧名");
  fireEvent.change(screen.getByLabelText("项目名称"), { target: { value: "新名" } });
  save();
  await waitFor(() => expect(state().projects[0]).toMatchObject({ name: "新名", revision: 2 }));
  expect(bridge.updateProject).toHaveBeenCalledWith(aid, { expectedRevision: 1, name: "新名" });
  expect(bridge.getProject).toHaveBeenCalledWith(aid);
  cleanup();
  mount(bridge);
  await screen.findByRole("button", { name: "新名" });
  expect(state().projects[0]).toMatchObject({ name: "新名", revision: 2 });
  manage("新名");
  action("归档");
  save();
  await waitFor(() => expect(state().projects[0]).toMatchObject({ status: "已归档", revision: 3 }));
  manage("新名");
  action("恢复项目");
  save();
  await waitFor(() => expect(state().projects[0]).toMatchObject({ status: "进行中", revision: 4 }));
  expect(bridge.updateProject).toHaveBeenCalledTimes(3);
});

test("favorite and delete remain visibly unavailable and never fake a local mutation", async () => {
  const bridge = makeBridge([project(aid, "真实项目")]);
  mount(bridge);
  await screen.findByRole("button", { name: "真实项目" });
  manage("真实项目");
  action("收藏 / 取消收藏（待接入）");
  save();
  expect(bridge.updateProject).not.toHaveBeenCalled();
  expect(state().projects[0]).toMatchObject({ favorite: false, name: "真实项目" });
  expect(screen.getByLabelText("toast").textContent).toMatch(/未修改项目或界面状态/);
  action("删除（待影响核对）");
  save();
  expect(bridge.updateProject).not.toHaveBeenCalled();
  expect(state().projects).toHaveLength(1);
  expect(screen.getByLabelText("toast").textContent).toMatch(/未删除项目或任何产物/);
});

test("412 reads authority and reports rejection without claiming saved", async () => {
  const bridge = makeBridge([project(aid, "旧名")]);
  const current = project(aid, "别人已改", { revision: 2, updated_at: "2026-09-15T00:00:00Z" });
  bridge.updateProject = vi.fn(async () => ({ kind: "DEFINITE_SERVER_ERROR", status: 412,
    code: "PROJECT_PRECONDITION_FAILED", request_id: requestId }));
  bridge.getProject = vi.fn(async () => response(current));
  mount(bridge);
  await screen.findByRole("button", { name: "旧名" });
  manage("旧名");
  fireEvent.change(screen.getByLabelText("项目名称"), { target: { value: "我的新名" } });
  save();
  await waitFor(() => expect(bridge.getProject).toHaveBeenCalledWith(aid));
  await waitFor(() => expect(screen.getByLabelText("toast").textContent).toMatch(/明确拒绝.*412/));
  expect(screen.getByLabelText("toast").textContent).not.toMatch(/已由更新回执与权威 GET 双重核对/);
  expect(state().projects[0].name).toBe("别人已改");
});

test("old project response cannot replace the newly selected project's title", async () => {
  const bridge = makeBridge([project(aid, "项目A"), project(bid, "项目B")]);
  const updatedA = project(aid, "项目A新", { revision: 2, updated_at: "2026-09-15T00:00:00Z" });
  let resolveUpdate;
  bridge.updateProject = vi.fn(() => new Promise((resolve) => { resolveUpdate = resolve; }));
  bridge.getProject = vi.fn(async () => response(updatedA));
  mount(bridge);
  await screen.findByRole("button", { name: "项目A" });
  manage("项目A");
  fireEvent.change(screen.getByLabelText("项目名称"), { target: { value: "项目A新" } });
  save();
  await waitFor(() => expect(bridge.updateProject).toHaveBeenCalledOnce());
  const rows = document.querySelectorAll(".v2-project-row");
  const bOpen = [...rows].find((row) => row.textContent.includes("项目B"))
    ?.querySelectorAll("button")[1];
  expect(bOpen).toBeDefined();
  fireEvent.click(bOpen);
  await waitFor(() => expect(state().selected).toBe(bid));
  resolveUpdate({ kind: "SUCCEEDED", receipt: response(updatedA) });
  await waitFor(() => expect(bridge.getProject).toHaveBeenCalledWith(aid));
  expect(state().title).toBe("项目B");
  expect(state().selected).toBe(bid);
  expect(state().projects.find((row) => row.backendId === aid).name).toBe("项目A新");
});

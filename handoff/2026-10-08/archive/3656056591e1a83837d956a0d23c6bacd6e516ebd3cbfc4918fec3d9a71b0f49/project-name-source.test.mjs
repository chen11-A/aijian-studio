import React from "react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StoryPages } from "@qa-source/StoryPages.tsx";
import { DemoProvider, createAivoraSampleFixture, useDemo } from "@qa-source/model.tsx";

const aid = `prj_${"a".repeat(32)}`;
const bid = `prj_${"b".repeat(32)}`;
const operationId = "88ed7974-adc3-4e35-a5c8-38b9674fc45c";
const response = (data) => ({ request_id: operationId, data });
function project(id, name, revision = 1) {
  return { id, name, aspect_ratio: "9:16", target_duration_seconds: 60,
    source_language: "zh-CN", status: "active", revision,
    created_at: "2026-09-14T00:00:00Z", updated_at: "2026-09-14T00:00:00Z" };
}
function bridgeFor(initial) {
  let rows = [...initial];
  const bridge = {
    rows: () => rows,
    health: vi.fn(async () => response({ status: "ok", service: "aijian-api", version: "test" })),
    listProjects: vi.fn(async () => response(rows)),
    listSources: vi.fn(async () => response([])),
    getSourceManifest: vi.fn(async () => null),
    getProject: vi.fn(async (id) => response(rows.find((row) => row.id === id))),
    updateProject: vi.fn(async (id, command) => {
      const old = rows.find((row) => row.id === id);
      if (!old || old.revision !== command.expectedRevision) return {
        kind: "DEFINITE_SERVER_ERROR", status: 412,
        code: "PROJECT_PRECONDITION_FAILED", request_id: operationId,
      };
      const changed = { ...old, name: command.name, revision: old.revision + 1,
        updated_at: "2026-09-15T00:00:00Z" };
      rows = rows.map((row) => row.id === id ? changed : row);
      return { kind: "SUCCEEDED", receipt: response(changed) };
    }),
  };
  return bridge;
}
function Harness() {
  const d = useDemo();
  return React.createElement(React.Fragment, null,
    React.createElement(StoryPages),
    React.createElement("button", { onClick: () => void d.selectRealProject(2) }, "打开第二项目"),
    React.createElement("output", { "aria-label": "selection" },
      JSON.stringify({ id: d.backendProjectId, title: d.value("title"),
        projects: d.projects.map((row) => ({ id: row.backendId, name: row.name,
          revision: row.revision })) })));
}
function mount(bridge, fixture) {
  window.aijian = bridge;
  window.history.replaceState({}, "", "#source");
  render(React.createElement(DemoProvider,
    fixture ? { fixture } : null, React.createElement(Harness)));
}
const selection = () => JSON.parse(screen.getByLabelText("selection").textContent || "{}");
const name = () => screen.getByRole("textbox", { name: "项目名称" });
const save = () => fireEvent.click(screen.getByRole("button", { name: "保存项目名称" }));

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal("crypto", { randomUUID: () => operationId });
});
afterEach(() => {
  cleanup();
  delete window.aijian;
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

test("formal source rename uses one PATCH and authoritative GET; remount reads the same identity", async () => {
  const bridge = bridgeFor([project(aid, "旧名")]);
  mount(bridge);
  await waitFor(() => expect(name()).toHaveValue("旧名"));
  fireEvent.change(name(), { target: { value: "新名" } });
  save();
  await waitFor(() => expect(selection()).toMatchObject({ id: aid, title: "新名" }));
  expect(bridge.updateProject).toHaveBeenCalledTimes(1);
  expect(bridge.updateProject).toHaveBeenCalledWith(aid,
    { expectedRevision: 1, name: "新名" });
  expect(bridge.getProject).toHaveBeenCalledWith(aid);
  expect(selection().projects[0]).toEqual({ id: aid, name: "新名", revision: 2 });
  cleanup();
  mount(bridge);
  await waitFor(() => expect(name()).toHaveValue("新名"));
  expect(selection().projects[0]).toEqual({ id: aid, name: "新名", revision: 2 });
  expect(bridge.updateProject).toHaveBeenCalledTimes(1);
});

test("409 leaves the draft and requires an explicit read before another PATCH", async () => {
  const bridge = bridgeFor([project(aid, "旧名")]);
  bridge.updateProject = vi.fn(async () => ({ kind: "DEFINITE_SERVER_ERROR", status: 409,
    code: "PROJECT_CONFLICT", request_id: operationId }));
  mount(bridge);
  await waitFor(() => expect(name()).toHaveValue("旧名"));
  fireEvent.change(name(), { target: { value: "我的草稿" } });
  save();
  await screen.findByText(/更新被拒绝（409/);
  expect(name()).toHaveValue("我的草稿");
  expect(screen.getByRole("button", { name: "保存项目名称" })).toBeDisabled();
  expect(bridge.updateProject).toHaveBeenCalledTimes(1);
  expect(bridge.getProject).toHaveBeenCalledWith(aid);
});

test("UNKNOWN remains locked after remount and readback never repeats PATCH", async () => {
  const bridge = bridgeFor([project(aid, "旧名")]);
  bridge.updateProject = vi.fn(async () => ({ kind: "REMOTE_UNKNOWN" }));
  mount(bridge);
  await waitFor(() => expect(name()).toHaveValue("旧名"));
  fireEvent.change(name(), { target: { value: "未确认名" } });
  save();
  await screen.findByText(/更新结果未知；原操作已锁定/);
  expect(bridge.updateProject).toHaveBeenCalledTimes(1);
  cleanup();
  mount(bridge);
  await waitFor(() => expect(name()).toHaveValue("旧名"));
  expect(screen.getByRole("button", { name: "保存项目名称" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
  await screen.findByText(/原更新仍锁定/);
  expect(bridge.updateProject).toHaveBeenCalledTimes(1);
});

test("a late reply for project A cannot overwrite selected project B", async () => {
  const bridge = bridgeFor([project(aid, "项目A"), project(bid, "项目B")]);
  let complete;
  bridge.updateProject = vi.fn(() => new Promise((resolve) => { complete = resolve; }));
  mount(bridge);
  await waitFor(() => expect(name()).toHaveValue("项目A"));
  fireEvent.change(name(), { target: { value: "项目A新" } });
  save();
  await waitFor(() => expect(bridge.updateProject).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "打开第二项目" }));
  await waitFor(() => expect(selection().id).toBe(bid));
  complete({ kind: "SUCCEEDED", receipt: response(project(aid, "项目A新", 2)) });
  await waitFor(() => expect(name()).toHaveValue("项目B"));
  expect(selection().title).toBe("项目B");
  expect(bridge.updateProject).toHaveBeenCalledTimes(1);
});

test("fixture keeps its sample editor and never calls the project API", () => {
  const bridge = bridgeFor([project(aid, "真实项目")]);
  mount(bridge, createAivoraSampleFixture());
  expect(screen.getByRole("textbox", { name: "项目名称（样例）" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "保存项目名称" })).toBeNull();
  expect(bridge.updateProject).not.toHaveBeenCalled();
});

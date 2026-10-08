import React from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DemoApp } from "@qa-project/DemoApp.tsx";

const requestId = "7ea6cf34-2f98-4ba7-a147-aa41cd897633";
function bridgeWithoutProjects() {
  const response = (data) => ({ request_id: requestId, data });
  return {
    health: vi.fn(async () => response({ status: "ok", service: "aijian-api", version: "test" })),
    listProjects: vi.fn(async () => response([])),
    listProviderConnections: vi.fn(async () => response([])),
  };
}
function mountAtProjectCenter(page = "projects") {
  const bridge = bridgeWithoutProjects();
  window.aijian = bridge;
  window.history.replaceState({}, "", `#${page}`);
  render(React.createElement(DemoApp));
  return bridge;
}

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  delete window.aijian;
  window.localStorage.clear();
});

test("without a project, AI service navigation reaches its real provider form", async () => {
  const bridge = mountAtProjectCenter();
  await waitFor(() => expect(bridge.listProjects).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "AI 服务" }));
  expect(await screen.findByRole("heading", { name: "AI 服务", exact: true })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "添加模型供应商", level: 2 })).toBeTruthy();
  expect(screen.queryByText(/创建或选择项目后，才会读取此页面的内容/)).toBeNull();
});

test("without a project, Usage navigation reaches the global ledger page", async () => {
  const bridge = mountAtProjectCenter();
  await waitFor(() => expect(bridge.listProjects).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "用量" }));
  expect(await screen.findByRole("heading", { name: "用量", exact: true })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "用量与费用明细" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "预算设置" })).toBeTruthy();
  expect(screen.queryByText(/创建或选择项目后，才会读取此页面的内容/)).toBeNull();
});

test("without a project, Settings navigation reaches user settings", async () => {
  const bridge = mountAtProjectCenter();
  await waitFor(() => expect(bridge.listProjects).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "设置" }));
  expect(await screen.findByRole("heading", { name: "用户设置", exact: true })).toBeTruthy();
  expect(screen.getByRole("button", { name: "保存用户设置" })).toBeTruthy();
  expect(screen.queryByText(/创建或选择项目后，才会读取此页面的内容/)).toBeNull();
});

test.each([
  ["AIVORA 启动页", "把故事，变成看得见的世界。", "进入 UI 演示"],
  ["创作首页", "创作首页", "新建项目"],
])("without a project, %s remains available", async (navigation, heading, action) => {
  const bridge = mountAtProjectCenter();
  await waitFor(() => expect(bridge.listProjects).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: navigation }));
  expect(await screen.findByRole("heading", { name: heading, exact: true })).toBeTruthy();
  expect(screen.getAllByRole("button", { name: action }).length).toBeGreaterThan(0);
  expect(screen.queryByText(/创建或选择项目后，才会读取此页面的内容/)).toBeNull();
});

test.each([
  ["source", "故事输入与来源"],
  ["story", "故事理解"],
  ["projectSettings", "项目设置"],
])("without a project, %s remains gated", async (page, heading) => {
  const bridge = mountAtProjectCenter(page);
  await waitFor(() => expect(bridge.listProjects).toHaveBeenCalledOnce());
  expect(await screen.findByRole("heading", { name: heading, exact: true })).toBeTruthy();
  expect(screen.getByText(/创建或选择项目后，才会读取此页面的内容/)).toBeTruthy();
});

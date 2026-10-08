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
function mountAtProjectCenter() {
  const bridge = bridgeWithoutProjects();
  window.aijian = bridge;
  window.history.replaceState({}, "", "#projects");
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

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DemoApp } from "@qa-h87/DemoApp.tsx";
import { createAivoraSampleFixture } from "@qa-h87/model.tsx";

function bridge(overrides = {}) {
  return {
    health: vi.fn(async () => ({ request_id: "health", data: {
      status: "ok", service: "aijian-api", version: "test",
    } })),
    listProjects: vi.fn(async () => ({ request_id: "projects", data: [] })),
    listSources: vi.fn(async () => ({ request_id: "sources", data: [] })),
    listProviderConnections: vi.fn(async () => ({ request_id: "providers", data: [] })),
    ...overrides,
  };
}
function configuredConnection() {
  return { id: `pcn_${"a".repeat(32)}`, provider_kind: "OPENAI",
    display_name: "配置中的文本服务", base_url: "https://api.openai.com/v1",
    enabled: true, revision: 1, credential_status: "CONFIGURED",
    models: [{ model_id: "text-model", capabilities: ["TEXT"] }],
    created_at: "2026-09-14T00:00:00Z", updated_at: "2026-09-14T00:00:00Z" };
}
function renderProduction(remote = bridge()) {
  window.aijian = remote;
  window.history.replaceState({}, "", "#project");
  render(React.createElement(DemoApp));
  return remote;
}
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(() => {
  cleanup();
  delete window.aijian;
  window.localStorage.clear();
  window.history.replaceState({}, "", "#project");
});

test("production shell has no demo page/state/reset controls or invented storage quota", async () => {
  const remote = renderProduction();
  await waitFor(() => expect(remote.listProjects).toHaveBeenCalledTimes(1));
  expect(document.querySelector('select[aria-label="演示页面"]')).toBeNull();
  expect(document.querySelector('select[aria-label="页面状态"]')).toBeNull();
  expect(screen.queryByRole("button", { name: "重置演示", hidden: true })).toBeNull();
  expect(document.querySelector('progress[aria-label="演示存储空间"]')).toBeNull();
  expect(screen.queryByText("128 GB / 1 TB", { exact: true })).toBeNull();
});

test("explicit fixture retains demo controls and reset action", () => {
  window.history.replaceState({}, "", "#project");
  render(React.createElement(DemoApp, { fixture: createAivoraSampleFixture() }));
  expect(document.querySelector('select[aria-label="演示页面"]')).not.toBeNull();
  expect(document.querySelector('select[aria-label="页面状态"]')).not.toBeNull();
  const reset = screen.getByRole("button", { name: "重置演示", hidden: true });
  expect(reset.disabled).toBe(false);
  fireEvent.click(reset);
  expect(document.querySelector(".demo-root").getAttribute("data-page")).toBe("project");
});

test("configured provider is reported as configuration, without a live-connection claim", async () => {
  const remote = bridge({ listProviderConnections: vi.fn(async () => ({
    request_id: "providers", data: [configuredConnection()],
  })) });
  renderProduction(remote);
  await waitFor(() => expect(remote.listProviderConnections).toHaveBeenCalled());
  const indicator = document.querySelector(".service-indicator");
  expect(indicator).not.toBeNull();
  expect(indicator.textContent).toMatch(/已配置|配置可用/);
  expect(indicator.textContent).not.toMatch(/实时连接|已连接供应商/);
  fireEvent.click(indicator);
  expect(document.querySelector(".demo-root").getAttribute("data-page")).toBe("services");
});

test("unknown provider-read state is shown as unknown with a route to inspect it", async () => {
  const remote = bridge({ listProviderConnections: vi.fn(async () => { throw Error("local read failed"); }) });
  renderProduction(remote);
  await waitFor(() => expect(remote.listProviderConnections).toHaveBeenCalled());
  const indicator = document.querySelector(".service-indicator");
  await waitFor(() => expect(indicator.textContent).toMatch(/未知|读取失败|无法确认/));
  expect(indicator.textContent).not.toContain("未连接真实服务");
  fireEvent.click(indicator);
  expect(document.querySelector(".demo-root").getAttribute("data-page")).toBe("services");
});

test("production empty notification does not promise demo task progress", async () => {
  renderProduction();
  fireEvent.click(screen.getByRole("button", { name: "通知" }));
  const dialog = screen.getByRole("dialog");
  expect(dialog.textContent).toMatch(/暂无新通知/);
  expect(dialog.textContent).not.toMatch(/演示中的任务进度/);
});

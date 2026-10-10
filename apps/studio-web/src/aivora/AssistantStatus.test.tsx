import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ProviderConnectionListResponse } from "../api/studio";
import type { ProviderSettingsState } from "../domain/use-provider-settings";
import { AssistantContext, AssistantServiceStatus, assistantServiceLabel } from "./AssistantStatus";

type Connection = ProviderConnectionListResponse["data"][number];
function connection(id: string, changes: Partial<Connection> = {}): Connection {
  return {
    id,
    provider_kind: "SUB2API",
    origin_mode: "LOCAL_LOOPBACK_HTTP",
    display_name: id,
    base_url: "http://127.0.0.1:8000/v1",
    enabled: true,
    models: [{ model_id: "synthetic", capabilities: ["TEXT"] }],
    credential_status: "CONFIGURED",
    revision: 1,
    created_at: "2026-10-10T00:00:00Z",
    updated_at: "2026-10-10T00:00:00Z",
    ...changes,
  };
}
function model() {
  return {
    providerSettings: { state: { kind: "loading" } as ProviderSettingsState, load: vi.fn() },
    go: vi.fn(),
    page: "source",
    backendProjectId: "project" as string | null,
    projects: [{ backendId: "project", name: "Project" }],
    selectedEpisodeId: "episode",
    episodes: [{ id: "episode", project_id: "project", title: "Episode" }],
    sourceDocument: { data: { project_id: "project", filename: "Source.txt" } },
    sourceManifest: {
      data: {
        project_id: "project",
        latest_version: { id: "latest" },
        accepted_version: null as { id: string } | null,
      },
    },
    sourceStage: { kind: "draft", acceptedVersionNumber: 1 },
  };
}
let view = model();
vi.mock("./model", () => ({ useDemo: () => view }));
beforeEach(() => {
  view = model();
});
afterEach(cleanup);
describe("assistant status distinguishes configuration from authorization", () => {
  test.each(["loading", "error"] as const)("%s has an explicit label and read control", (kind) => {
    view.providerSettings.state = { kind };
    render(<AssistantServiceStatus />);
    expect(assistantServiceLabel({ kind })).toBe(
      kind === "loading" ? "正在读取 API 连接" : "API 连接读取失败",
    );
    const reload = screen.getByRole("button", { name: "重新读取服务配置" });
    if (kind === "loading") expect(reload).toBeDisabled();
    else expect(reload).toBeEnabled();
    fireEvent.click(reload);
    expect(view.providerSettings.load).toHaveBeenCalledTimes(kind === "loading" ? 0 : 1);
    fireEvent.click(screen.getByRole("button", { name: "打开 AI 服务设置" }));
    expect(view.go).toHaveBeenCalledExactlyOnceWith("services");
  });
  test("only enabled configured text-capable supported connections count as candidates", () => {
    const response = {
      request_id: "local",
      data: [
        connection("eligible"),
        connection("disabled", { enabled: false }),
        connection("missing", { credential_status: "MISSING" }),
        connection("unavailable", { credential_status: "UNAVAILABLE" }),
        connection("no-text", { models: [] }),
        connection("other", { provider_kind: "OPENAI" }),
      ],
    };
    view.providerSettings.state = { kind: "ready", response };
    render(<AssistantServiceStatus />);
    expect(screen.getByText(/已登记的来源提取文本候选：1 个/)).toBeInTheDocument();
    expect(screen.getByText(/配置记录不证明供应商可连接/)).toBeInTheDocument();
    expect(screen.getByText("凭据库不可用", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("无已配置凭据", { exact: false })).toBeInTheDocument();
    expect(assistantServiceLabel(view.providerSettings.state)).toBe("已配置 6 个 · 能力未验证");
    expect(view.providerSettings.load).not.toHaveBeenCalled();
  });
  test("empty configuration is not a ready provider", () => {
    view.providerSettings.state = { kind: "ready", response: { request_id: "empty", data: [] } };
    render(<AssistantServiceStatus />);
    expect(assistantServiceLabel(view.providerSettings.state)).toBe("没有 API 连接");
    expect(assistantServiceLabel(view.providerSettings.state, "AUTHORIZED_UNVERIFIED")).toBe(
      "ChatGPT 已连接 · 推理待验证；没有 API 连接",
    );
    expect(screen.queryByText("查看连接与文本配置")).not.toBeInTheDocument();
  });
  test("context shows matching scope and never treats old acceptance as approval of latest", () => {
    render(<AssistantContext />);
    expect(screen.getByText("Project")).toBeVisible();
    expect(screen.getByText("Episode")).toBeVisible();
    expect(screen.getByText("Source.txt")).toBeVisible();
    expect(screen.getByText("尚未接受")).toBeVisible();
    expect(screen.getByText(/新版尚未批准；旧批准基线 V1/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "返回当前作品" }));
    expect(view.go).toHaveBeenCalledExactlyOnceWith("project");
  });
  test("context hides documents and episodes from a different project", () => {
    view.backendProjectId = null;
    render(<AssistantContext />);
    expect(screen.getByText("尚未选择真实作品")).toBeVisible();
    expect(screen.getByText("尚未选择真实剧集")).toBeVisible();
    expect(screen.getByText("尚未读取来源")).toBeVisible();
    expect(screen.queryByText("latest")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "返回当前作品" })).toBeDisabled();
  });
});

import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect } from "react";
import type { ChatGPTBridge, ChatGPTStatus } from "@aijian/contracts/chatgpt-auth";
import { DESKTOP_REQUIRED } from "./chatgpt-auth/transport";
import { DemoProvider, useDemo } from "./model";
import { UtilityPages } from "./UtilityPages";
import { MODEL_PREFERENCE_KEY } from "./chatgpt-auth/modelPreference";

const connected: ChatGPTStatus = {
  ...DESKTOP_REQUIRED,
  runtime: "DESKTOP",
  state: "CONNECTED",
  secureStorage: "AVAILABLE",
  useScope: "LOCAL_PERSONAL",
  activeProfileId: "11111111-1111-4111-8111-111111111111",
  profiles: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      label: "Fixture account",
      email: null,
      connected: true,
      planUsage: true,
    },
  ],
};

function Harness() {
  const demo = useDemo();
  useEffect(() => {
    demo.go("services");
  }, [demo]);
  return <UtilityPages />;
}

function open() {
  const request_id = "req_" + "1".repeat(32);
  const list = vi.fn().mockResolvedValue({ data: [], request_id });
  window.aijian = {
    health: vi.fn().mockResolvedValue({ status: "ok" }),
    listProjects: list,
    listSources: list,
    listProviderConnections: vi.fn().mockResolvedValue({ data: [], request_id }),
  } as unknown as NonNullable<Window["aijian"]>;
  const bridge: ChatGPTBridge = {
    status: vi.fn().mockResolvedValue(connected),
    signIn: vi.fn(),
    signOut: vi.fn().mockResolvedValue({
      kind: "OK",
      status: {
        ...DESKTOP_REQUIRED,
        runtime: "DESKTOP",
        secureStorage: "AVAILABLE",
      },
    }),
    selectProfile: vi.fn(),
    cancel: vi.fn(),
    models: vi.fn(),
  };
  window.aijianChatGPT = bridge;
  render(
    <DemoProvider>
      <Harness />
    </DemoProvider>,
  );
  return bridge;
}

afterEach(() => {
  cleanup();
  delete window.aijian;
  delete window.aijianChatGPT;
  localStorage.clear();
});

describe("service capability overview", () => {
  it("selects a verified official text default on the service page without generation", async () => {
    const bridge = open();
    expect(await screen.findByText("还没有 API 连接")).toBeInTheDocument();
    expect(screen.queryByText("尚未配置 AI 服务")).not.toBeInTheDocument();
    vi.mocked(bridge.models).mockResolvedValue({
      kind: "OK",
      profileId: connected.activeProfileId!,
      models: [
        { slug: "text-one", displayName: "Text One" },
        { slug: "text-two", displayName: "Text Two" },
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: "ChatGPT 官方账号" }));
    fireEvent.click(await screen.findByRole("button", { name: "读取此账号的可用模型" }));
    const picker = await screen.findByRole("combobox", { name: "默认官方文本模型" });
    expect(picker).toHaveValue("");
    fireEvent.change(picker, { target: { value: "text-two" } });
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(MODEL_PREFERENCE_KEY) ?? "null")).toMatchObject({
        version: 1,
        defaultModel: { profileId: connected.activeProfileId, modelSlug: "text-two" },
      }),
    );
    expect(bridge.models).toHaveBeenCalledOnce();
    expect(bridge.signIn).not.toHaveBeenCalled();
  });
  it("checks local account readiness without inference, catalog calls or a fabricated Grok login", async () => {
    const bridge = open();
    const panel = await screen.findByRole("region", { name: "账号与能力检查" });
    await within(panel).findByText("套餐已授权 · 推理待验证");
    expect(within(panel).getByText(/剩余额度：未知/)).toBeInTheDocument();
    expect(within(panel).getByText(/Grok 订阅登录尚未接入/)).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "检查自动出片准备" }));
    expect(within(panel).getByRole("status")).toHaveTextContent("自动出片尚未就绪");
    expect(bridge.models).not.toHaveBeenCalled();
    expect(bridge.signIn).not.toHaveBeenCalled();
    expect(bridge.status).toHaveBeenCalledOnce();
  });

  it("shares current account state with sign-out instead of retaining a stale authorized summary", async () => {
    const bridge = open();
    const panel = await screen.findByRole("region", { name: "账号与能力检查" });
    await within(panel).findByText("套餐已授权 · 推理待验证");
    fireEvent.click(screen.getByRole("button", { name: "ChatGPT 官方账号" }));
    fireEvent.click(await screen.findByRole("button", { name: "退出当前账号" }));
    await waitFor(() =>
      expect(within(panel).queryByText("套餐已授权 · 推理待验证")).not.toBeInTheDocument(),
    );
    expect(within(panel).getByText("尚未连接 ChatGPT 账号")).toBeInTheDocument();
    expect(bridge.signOut).toHaveBeenCalledOnce();
    expect(bridge.status).toHaveBeenCalledOnce();
  });

  it("turns a failed refresh into unknown instead of trusting the previous authorized account", async () => {
    const bridge = open();
    const panel = await screen.findByRole("region", { name: "账号与能力检查" });
    await within(panel).findByText("套餐已授权 · 推理待验证");
    vi.mocked(bridge.status).mockRejectedValueOnce(new Error("fixture read failed"));
    fireEvent.click(within(panel).getByRole("button", { name: "重新读取连接状态" }));
    await within(panel).findByText("账号状态读取失败 · 尚未确认");
    expect(within(panel).queryByText("套餐已授权 · 推理待验证")).not.toBeInTheDocument();
    expect(within(panel).getByText("文本能力尚未确认")).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "重新读取连接状态" }));
    await within(panel).findByText("套餐已授权 · 推理待验证");
    expect(bridge.models).not.toHaveBeenCalled();
    expect(bridge.signIn).not.toHaveBeenCalled();
  });
});

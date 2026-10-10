import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ServiceCapabilities } from "./ServiceCapabilities";
import { DESKTOP_REQUIRED } from "./chatgpt-auth/transport";
import type { useChatGPTConnection } from "./chatgpt-auth/useChatGPTConnection";
import type { ProviderSettingsState } from "../domain/use-provider-settings";

function props(
  providers: ProviderSettingsState = {
    kind: "ready",
    response: { data: [], request_id: "fixture" },
  },
) {
  return {
    chatGPT: {
      status: DESKTOP_REQUIRED,
      loading: false,
      busy: false,
      statusReadFailed: false,
      models: [],
      modelsProfileId: null,
      notice: "",
      load: vi.fn().mockResolvedValue(undefined),
      readModels: vi.fn(),
      help: vi.fn(),
      signIn: vi.fn(),
      select: vi.fn(),
      signOut: vi.fn(),
      cancel: vi.fn(),
    } satisfies ReturnType<typeof useChatGPTConnection>,
    providers,
    onReloadProviders: vi.fn().mockResolvedValue(undefined),
    onOpenProjects: vi.fn(),
  };
}

describe("capability preparation view", () => {
  it("preserves unavailable credentials and distinguishes xAI API from subscription login", () => {
    const base = {
      base_url: "https://api.x.ai/v1",
      enabled: true,
      revision: 1,
      created_at: "fixture",
      updated_at: "fixture",
      models: [{ model_id: "fixture-video", capabilities: ["VIDEO" as const] }],
    };
    render(
      <ServiceCapabilities
        {...props({
          kind: "ready",
          response: {
            request_id: "fixture",
            data: [
              {
                ...base,
                id: "one",
                display_name: "Grok API fixture",
                provider_kind: "XAI",
                credential_status: "CONFIGURED",
              },
              {
                ...base,
                id: "two",
                display_name: "Other fixture",
                provider_kind: "OPENAI_COMPATIBLE",
                credential_status: "UNAVAILABLE",
              },
            ],
          },
        })}
      />,
    );
    expect(screen.getByText(/已登记候选：Grok API fixture/)).toBeInTheDocument();
    expect(screen.getByText(/这是 xAI API 配置，不是 SuperGrok/)).toBeInTheDocument();
    expect(screen.getByText(/Other fixture：系统凭据暂不可用/)).toBeInTheDocument();
    expect(screen.getAllByText("自动生成尚未接入")).toHaveLength(3);
  });
  it.each(["loading", "error"] as const)(
    "keeps %s separate from no configured accounts",
    (kind) => {
      render(<ServiceCapabilities {...props({ kind })} />);
      expect(
        screen.getByText(kind === "loading" ? /API 连接目录读取中/ : /API 连接目录读取失败/),
      ).toBeInTheDocument();
      if (kind === "loading")
        expect(screen.getByRole("button", { name: "检查自动出片准备" })).toBeDisabled();
    },
  );
  it("only refreshes local display state and offers project navigation", async () => {
    const input = props();
    render(<ServiceCapabilities {...input} />);
    fireEvent.click(screen.getByRole("button", { name: "检查自动出片准备" }));
    expect(screen.getByRole("status")).toHaveTextContent("自动出片尚未就绪");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "重新读取连接状态" }));
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(input.chatGPT.load).toHaveBeenCalledOnce();
    expect(input.onReloadProviders).toHaveBeenCalledOnce();
    expect(input.chatGPT.readModels).not.toHaveBeenCalled();
    expect(input.chatGPT.signIn).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "进入项目准备剧本或导入素材" }));
    expect(input.onOpenProjects).toHaveBeenCalledOnce();
  });
  it.each(["loading", "busy"] as const)("does not refresh or inspect during %s", (field) => {
    const input = props();
    render(<ServiceCapabilities {...input} chatGPT={{ ...input.chatGPT, [field]: true }} />);
    expect(screen.getByRole("button", { name: "重新读取连接状态" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "检查自动出片准备" })).toBeDisabled();
  });
});

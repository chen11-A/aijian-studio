import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { ProviderSettingsWorkspace } from "./ProviderSettingsWorkspace";

const requestId = "e6225937-1243-427b-bc98-56eda28e9dd3";

describe("provider settings workspace", () => {
  test("explains the membership boundary and saves a write-only provider key", async () => {
    const listConnections = vi
      .fn()
      .mockResolvedValueOnce({ data: [], request_id: requestId })
      .mockResolvedValueOnce({
        data: [
          {
            id: `pcn_${"1".repeat(32)}`,
            provider_kind: "XAI",
            display_name: "xAI",
            base_url: "https://api.x.ai/v1",
            enabled: true,
            models: [{ model_id: "grok-production", capabilities: ["TEXT"] }],
            credential_status: "CONFIGURED",
            revision: 1,
            created_at: "2026-08-04T02:00:00Z",
            updated_at: "2026-08-04T02:00:00Z",
          },
        ],
        request_id: requestId,
      });
    const createConnection = vi.fn().mockResolvedValue({});
    render(
      <ProviderSettingsWorkspace
        listConnections={listConnections}
        createConnection={createConnection}
        deleteConnection={vi.fn()}
      />,
    );
    expect(await screen.findByText("还没有模型连接")).toBeInTheDocument();
    expect(screen.getByText("会员与 API 是两套账户体系")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "新增连接 ↓" })).toHaveAttribute(
      "href",
      "#new-provider-connection",
    );

    fireEvent.click(screen.getByRole("button", { name: /xAI/ }));
    fireEvent.change(screen.getByLabelText(/API Key/), { target: { value: " xai-test-secret " } });
    fireEvent.change(screen.getByLabelText("剧本 / 提示词"), {
      target: { value: "grok-production" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存连接" }));

    await waitFor(() => expect(createConnection).toHaveBeenCalledTimes(1));
    expect(createConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        provider_kind: "XAI",
        base_url: "https://api.x.ai/v1",
        api_key: " xai-test-secret ",
        models: [{ model_id: "grok-production", capabilities: ["TEXT"] }],
      }),
    );
    expect(await screen.findByText("密钥已配置")).toBeInTheDocument();
    expect(screen.getByLabelText(/API Key/)).toHaveValue("");
  });

  test("shows a recoverable read failure", async () => {
    const listConnections = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ data: [], request_id: requestId });
    render(
      <ProviderSettingsWorkspace
        listConnections={listConnections}
        createConnection={vi.fn()}
        deleteConnection={vi.fn()}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("配置读取失败");
    fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
    expect(await screen.findByText("还没有模型连接")).toBeInTheDocument();
  });

  test("requires at least one model capability before saving", async () => {
    const createConnection = vi.fn();
    render(
      <ProviderSettingsWorkspace
        listConnections={vi.fn().mockResolvedValue({ data: [], request_id: requestId })}
        createConnection={createConnection}
        deleteConnection={vi.fn()}
      />,
    );
    await screen.findByText("还没有模型连接");
    fireEvent.change(screen.getByLabelText(/API Key/), { target: { value: "test-secret-key" } });
    fireEvent.click(screen.getByRole("button", { name: "保存连接" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("至少填写一个");
    expect(createConnection).not.toHaveBeenCalled();
  });

  test("reloads retained metadata after an uncertain credential failure", async () => {
    const retained = {
      id: `pcn_${"3".repeat(32)}`,
      provider_kind: "OPENAI" as const,
      display_name: "OpenAI 主连接",
      base_url: "https://api.openai.com/v1",
      enabled: true,
      models: [{ model_id: "gpt-production", capabilities: ["TEXT" as const] }],
      credential_status: "CONFIGURED" as const,
      revision: 1,
      created_at: "2026-08-04T02:00:00Z",
      updated_at: "2026-08-04T02:00:00Z",
    };
    const listConnections = vi
      .fn()
      .mockResolvedValueOnce({ data: [], request_id: requestId })
      .mockResolvedValueOnce({ data: [retained], request_id: requestId });
    render(
      <ProviderSettingsWorkspace
        listConnections={listConnections}
        createConnection={vi.fn().mockRejectedValue(new Error("CREDENTIAL_CLEANUP_REQUIRED"))}
        deleteConnection={vi.fn()}
      />,
    );
    await screen.findByText("还没有模型连接");
    fireEvent.change(screen.getByLabelText(/API Key/), { target: { value: "test-secret-key" } });
    fireEvent.change(screen.getByLabelText("剧本 / 提示词"), {
      target: { value: "gpt-production" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存连接" }));

    expect(await screen.findByText("OpenAI 主连接")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("系统凭据可能需要清理");
  });

  test("does not suggest deleting a valid connection after an ordinary conflict", async () => {
    const listConnections = vi
      .fn()
      .mockResolvedValueOnce({ data: [], request_id: requestId })
      .mockResolvedValueOnce({ data: [], request_id: requestId });
    render(
      <ProviderSettingsWorkspace
        listConnections={listConnections}
        createConnection={vi.fn().mockRejectedValue(new Error("PROVIDER_CONNECTION_CONFLICT"))}
        deleteConnection={vi.fn()}
      />,
    );
    await screen.findByText("还没有模型连接");
    fireEvent.change(screen.getByLabelText(/API Key/), { target: { value: "test-secret-key" } });
    fireEvent.change(screen.getByLabelText("剧本 / 提示词"), {
      target: { value: "gpt-production" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存连接" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("连接未保存");
    expect(screen.getByRole("alert")).not.toHaveTextContent("移除");
  });

  test("clears provider-specific secrets and model ids when switching provider", async () => {
    render(
      <ProviderSettingsWorkspace
        listConnections={vi.fn().mockResolvedValue({ data: [], request_id: requestId })}
        createConnection={vi.fn()}
        deleteConnection={vi.fn()}
      />,
    );
    await screen.findByText("还没有模型连接");
    fireEvent.change(screen.getByLabelText(/API Key/), { target: { value: "openai-secret" } });
    fireEvent.change(screen.getByLabelText("剧本 / 提示词"), {
      target: { value: "openai-model" },
    });

    fireEvent.click(screen.getByRole("button", { name: /xAI/ }));

    expect(screen.getByLabelText(/API Key/)).toHaveValue("");
    expect(screen.getByLabelText("剧本 / 提示词")).toHaveValue("");
  });

  test("requires an explicit second action before removing credentials", async () => {
    const connection = {
      id: `pcn_${"2".repeat(32)}`,
      provider_kind: "OLLAMA" as const,
      display_name: "本机 Ollama",
      base_url: "http://127.0.0.1:11434/v1",
      enabled: true,
      models: [],
      credential_status: "MISSING" as const,
      revision: 1,
      created_at: "2026-08-04T02:00:00Z",
      updated_at: "2026-08-04T02:00:00Z",
    };
    const listConnections = vi
      .fn()
      .mockResolvedValueOnce({ data: [connection], request_id: requestId })
      .mockResolvedValueOnce({ data: [], request_id: requestId });
    const deleteConnection = vi.fn().mockResolvedValue(undefined);
    render(
      <ProviderSettingsWorkspace
        listConnections={listConnections}
        createConnection={vi.fn()}
        deleteConnection={deleteConnection}
      />,
    );
    await screen.findByText("尚未登记模型 ID");

    fireEvent.click(screen.getByRole("button", { name: "移除连接" }));
    expect(screen.getByRole("alert")).toHaveTextContent("同时移除系统凭据");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByText("同时移除系统凭据？")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "移除连接" }));
    fireEvent.click(screen.getByRole("button", { name: "确认移除" }));

    await waitFor(() => expect(deleteConnection).toHaveBeenCalledWith(connection.id));
    expect(await screen.findByText("还没有模型连接")).toBeInTheDocument();
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProviderConnectionForm } from "./ProviderConnectionForm";

function fill(label: string | RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("provider connection form rendered boundary", () => {
  it.each([
    ["公网 HTTPS", "https://text.example.com", "PUBLIC_HTTPS"],
    ["本机 loopback", "http://127.0.0.1:8080", "LOCAL_LOOPBACK_HTTP"],
  ])("submits explicit %s text-only configuration", async (modeLabel, url, mode) => {
    const onSubmit = vi.fn(async () => {});
    render(<ProviderConnectionForm busy={false} error={null} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: /^Sub2API/ }));
    fireEvent.click(screen.getByRole("button", { name: modeLabel }));
    expect(screen.getByRole("button", { name: modeLabel })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByLabelText("角色 / 场景图片")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("镜头视频")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("配音")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Base URL")).toHaveAttribute(
      "placeholder",
      mode === "PUBLIC_HTTPS" ? "https://gateway.example.com" : "http://127.0.0.1:8080",
    );
    fill("连接名称", "  Synthetic  ");
    fill("Base URL", url);
    fill(/业务 API Key/, "synthetic-test-key");
    fill("剧本 / 提示词", "text-model");
    fireEvent.click(screen.getByRole("button", { name: "保存连接" }));
    await waitFor(() => expect(screen.getByLabelText(/业务 API Key/)).toHaveValue(""));
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
      provider_kind: "SUB2API",
      display_name: "Synthetic",
      base_url: url,
      origin_mode: mode,
      enabled: true,
      api_key: "synthetic-test-key",
      models: [{ model_id: "text-model", capabilities: ["TEXT"] }],
    });
  });

  it("switching deployment mode clears the secret and requires re-entry", () => {
    const onSubmit = vi.fn(async () => {});
    render(<ProviderConnectionForm busy={false} error={null} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: /^Sub2API/ }));
    fill("Base URL", "https://text.example.com");
    fill(/业务 API Key/, "synthetic-test-key");
    fireEvent.click(screen.getByRole("button", { name: "本机 loopback" }));
    expect(screen.getByLabelText("Base URL")).toHaveValue("");
    expect(screen.getByLabelText(/业务 API Key/)).toHaveValue("");
    expect(screen.getByText(/上游 AI 离线/)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("renders local validation and server errors without submitting invalid models", () => {
    const onSubmit = vi.fn(async () => {});
    render(
      <ProviderConnectionForm
        busy={false}
        error="Synthetic server rejection"
        onSubmit={onSubmit}
      />,
    );
    fill(/API Key/, "synthetic-test-key");
    fireEvent.click(screen.getByRole("button", { name: "保存连接" }));
    expect(screen.getByText(/至少填写一个用于/)).toHaveAttribute("role", "alert");
    expect(screen.getByText("Synthetic server rejection")).toHaveAttribute("role", "alert");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("permits an Ollama draft without a key and compiles all declared capabilities", async () => {
    const onSubmit = vi.fn(async () => {});
    render(<ProviderConnectionForm busy={false} error={null} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: /^Ollama/ }));
    expect(screen.getByLabelText(/API Key/)).not.toBeRequired();
    fill("剧本 / 提示词", "local-model");
    fill("角色 / 场景图片", "local-model");
    fill("镜头视频", "video-model");
    fill("配音", "voice-model");
    fireEvent.click(screen.getByRole("button", { name: "保存连接" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit).toHaveBeenCalledWith({
      provider_kind: "OLLAMA",
      display_name: "Ollama 本地",
      base_url: "http://127.0.0.1:11434/v1",
      enabled: true,
      models: [
        { model_id: "local-model", capabilities: ["TEXT", "IMAGE"] },
        { model_id: "video-model", capabilities: ["VIDEO"] },
        { model_id: "voice-model", capabilities: ["SPEECH"] },
      ],
    });
  });

  it("disables every mutable control while a save is in progress", () => {
    const onSubmit = vi.fn(async () => {});
    const { rerender, container } = render(
      <ProviderConnectionForm busy={false} error={null} onSubmit={onSubmit} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Sub2API/ }));
    rerender(<ProviderConnectionForm busy error={null} onSubmit={onSubmit} />);
    for (const control of container.querySelectorAll("input, button"))
      expect(control).toBeDisabled();
    expect(screen.getByRole("button", { name: "正在安全保存…" })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProviderConnectionForm } from "./ProviderConnectionForm";

function fill(label: string | RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("provider connection form rendered boundary", () => {
  it("does not offer a retired text gateway and can save an xAI connection", async () => {
    const onSubmit = vi.fn(async () => {});
    render(<ProviderConnectionForm busy={false} error={null} onSubmit={onSubmit} />);
    expect(screen.queryByRole("button", { name: /Sub2API/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^xAI/ }));
    fill("连接名称", "Grok API");
    fill(/API Key/, "xai-sandbox-demo-key");
    fill("剧本 / 提示词", "grok-4.7");
    fireEvent.click(screen.getByRole("button", { name: "保存连接" }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          provider_kind: "XAI",
          display_name: "Grok API",
          base_url: "https://api.x.ai/v1",
          models: [{ model_id: "grok-4.7", capabilities: ["TEXT"] }],
        }),
      ),
    );
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
    fireEvent.click(screen.getByRole("button", { name: /^xAI/ }));
    rerender(<ProviderConnectionForm busy error={null} onSubmit={onSubmit} />);
    for (const control of container.querySelectorAll("input, button"))
      expect(control).toBeDisabled();
    expect(screen.getByRole("button", { name: "正在安全保存…" })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

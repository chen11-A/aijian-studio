import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { useProviderConnectionForm } from "./use-provider-connection-form";

describe("useProviderConnectionForm", () => {
  test("requires a model before it submits a provider connection", () => {
    const onSubmit = vi.fn();
    const { result } = renderHook(() => useProviderConnectionForm(onSubmit));

    act(() => result.current.submit());

    expect(result.current.modelError).toContain("至少填写一个");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("resets provider-specific input and clears a submitted secret after success", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useProviderConnectionForm(onSubmit));

    act(() => result.current.setApiKey("openai-secret"));
    act(() => result.current.setModel("TEXT", "gpt-production"));
    act(() => result.current.chooseProvider("XAI"));
    expect(result.current.apiKey).toBe("");
    expect(result.current.models.TEXT).toBe("");

    act(() => result.current.setApiKey("xai-secret"));
    act(() => result.current.setModel("TEXT", "grok-production"));
    act(() => result.current.submit());

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        provider_kind: "XAI",
        display_name: "xAI",
        base_url: "https://api.x.ai/v1",
        enabled: true,
        api_key: "xai-secret",
        models: [{ model_id: "grok-production", capabilities: ["TEXT"] }],
      }),
    );
    await waitFor(() => expect(result.current.apiKey).toBe(""));
  });
});

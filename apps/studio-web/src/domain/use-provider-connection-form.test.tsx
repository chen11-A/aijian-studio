import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useProviderConnectionForm } from "./use-provider-connection-form";

function setup() {
  const submit = vi.fn(async () => {});
  const hook = renderHook(() => useProviderConnectionForm(submit));
  act(() => hook.result.current.chooseProvider("SUB2API"));
  act(() => {
    hook.result.current.setBaseUrl("https://text.example.com");
    hook.result.current.setApiKey("synthetic-test-key");
    hook.result.current.setModel("TEXT", "text-model");
  });
  return { ...hook, submit };
}

describe("Sub2API connection form", () => {
  it.each([
    ["not a URL", "公网 HTTPS"],
    ["http://text.example.com", "HTTPS origin"],
    ["https://text.example.com/v1", "HTTPS origin"],
    ["https://user:pass@text.example.com", "HTTPS origin"],
    ["https://text.example.com?query=1", "HTTPS origin"],
    ["https://text.example.com#fragment", "HTTPS origin"],
    ["https://text.example.com\\path", "HTTPS origin"],
    ["https://%65xample.com", "HTTPS origin"],
  ])("rejects invalid public origin %s before submit", (url, message) => {
    const { result, submit } = setup();
    act(() => result.current.setBaseUrl(url));
    act(() => result.current.submit());
    expect(result.current.modelError).toContain(message);
    expect(submit).not.toHaveBeenCalled();
  });

  it.each([
    "http://localhost:8080",
    "http://127.0.0.1:0",
    "http://127.0.0.1:65536",
    "http://[::1]:80/",
  ])("rejects noncanonical local origin %s", (url) => {
    const { result, submit } = setup();
    act(() => result.current.chooseSub2apiMode("LOCAL_LOOPBACK_HTTP"));
    act(() => result.current.setBaseUrl(url));
    act(() => result.current.submit());
    expect(result.current.modelError).toContain("本机地址只接受");
    expect(submit).not.toHaveBeenCalled();
  });

  it("clears secrets and origin when switching mode without losing explicit text model", () => {
    const { result } = setup();
    act(() => result.current.chooseSub2apiMode("LOCAL_LOOPBACK_HTTP"));
    expect(result.current.apiKey).toBe("");
    expect(result.current.baseUrl).toBe("");
    expect(result.current.models.TEXT).toBe("text-model");
    act(() => result.current.setModel("IMAGE", "forbidden"));
    expect(result.current.models.IMAGE).toBe("");
  });

  it("rejects short keys and empty text models without a write", () => {
    const { result, submit } = setup();
    act(() => result.current.setApiKey("short"));
    act(() => result.current.submit());
    expect(result.current.modelError).toContain("至少 8 字符");
    act(() => {
      result.current.setApiKey("synthetic-test-key");
      result.current.setModel("TEXT", " ");
    });
    act(() => result.current.submit());
    expect(result.current.modelError).toContain("只接受显式 TEXT 模型");
    expect(submit).not.toHaveBeenCalled();
  });

  it.each(["PUBLIC_HTTPS", "LOCAL_LOOPBACK_HTTP"] as const)(
    "submits %s explicitly and clears the key only after success",
    async (mode) => {
      const { result, submit } = setup();
      act(() => result.current.chooseSub2apiMode(mode));
      const url = mode === "PUBLIC_HTTPS" ? "https://text.example.com" : "http://[::1]:8080";
      act(() => {
        result.current.setBaseUrl(url);
        result.current.setApiKey("synthetic-test-key");
        result.current.setDisplayName("  Synthetic  ");
      });
      act(() => result.current.submit());
      await waitFor(() => expect(result.current.apiKey).toBe(""));
      expect(submit).toHaveBeenCalledExactlyOnceWith({
        provider_kind: "SUB2API",
        display_name: "Synthetic",
        base_url: url,
        enabled: true,
        origin_mode: mode,
        models: [{ model_id: "text-model", capabilities: ["TEXT"] }],
        api_key: "synthetic-test-key",
      });
    },
  );

  it("retains a rejected draft key and resets it when choosing another provider", async () => {
    const { result, submit } = setup();
    submit.mockRejectedValueOnce(new Error("synthetic rejection"));
    await act(async () => result.current.submit());
    expect(result.current.apiKey).toBe("synthetic-test-key");
    act(() => result.current.chooseProvider("OLLAMA"));
    expect(result.current.apiKey).toBe("");
    expect(result.current.models.TEXT).toBe("");
    expect(result.current.sub2apiMode).toBe("PUBLIC_HTTPS");
    expect(result.current.modelError).toBeNull();
  });
});

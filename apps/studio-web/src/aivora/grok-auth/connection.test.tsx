import "@testing-library/jest-dom/vitest";
import type { GrokLoginBridge, GrokLoginStatus } from "@aijian/contracts/grok-auth";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GrokConnectionProvider } from "./GrokConnectionContext";
import { GrokConnectionCard } from "./GrokConnectionCard";
import { grokLoginFailureMessage, validGrokStatus } from "./transport";
import { useGrokConnection } from "./useGrokConnection";

const signedOut: GrokLoginStatus = {
  provider: "GROK_LOGIN",
  runtime: "DESKTOP",
  state: "NOT_CONNECTED",
  secureStorage: "AVAILABLE",
  accountLabel: null,
  lastError: null,
};
const connected: GrokLoginStatus = {
  ...signedOut,
  state: "CONNECTED",
  accountLabel: "person@example.test",
};
const denied: GrokLoginStatus = {
  ...connected,
  state: "ENTITLEMENT_DENIED",
  lastError: "ENTITLEMENT_DENIED",
};

function bridge(overrides: Partial<GrokLoginBridge> = {}): GrokLoginBridge {
  return {
    status: vi.fn(async () => signedOut),
    signIn: vi.fn(async () => ({ kind: "OK" as const, status: connected })),
    cancel: vi.fn(async () => ({ kind: "CANCELLED" as const, status: signedOut })),
    signOut: vi.fn(async () => ({ kind: "OK" as const, status: signedOut })),
    models: vi.fn(async () => ({
      kind: "OK" as const,
      models: [{ id: "grok-4", label: "Grok 4" }],
    })),
    completeText: vi.fn(async () => ({
      kind: "ERROR" as const,
      code: "ENTITLEMENT_DENIED",
      billingAccountKind: "grok_login" as const,
    })),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  delete window.aijianGrok;
});

describe("Grok login copy and connection", () => {
  it("explains every login failure in Chinese and points at the token-free log", () => {
    for (const code of [
      "REAUTH_REQUIRED",
      "NOT_CONNECTED",
      "DESKTOP_REQUIRED",
      "SECURE_STORAGE_UNAVAILABLE",
      "AUTH_DENIED",
      "CALLBACK_REJECTED",
      "DEVICE_CODE_LINK_MISSING",
      "BROWSER_OPEN_FAILED",
      "AUTH_ATTEMPT_EXPIRED",
    ]) {
      const message = grokLoginFailureMessage(code);
      expect(message.length).toBeGreaterThan(8);
      expect(message).toContain("grok-login.log");
      expect(message).not.toMatch(/access_token|refresh_token|Bearer /);
    }
    expect(grokLoginFailureMessage("ENTITLEMENT_DENIED")).toContain("403");
    expect(grokLoginFailureMessage("ENTITLEMENT_DENIED")).not.toContain("grok-login.log");
    expect(grokLoginFailureMessage("TEXT_FAILED")).toContain("改用 API Key");
    expect(grokLoginFailureMessage("SOMETHING_NEW")).toContain("SOMETHING_NEW");
    expect(validGrokStatus(connected)).toBe(true);
    expect(validGrokStatus({ ...connected, accessToken: "nope" })).toBe(false);
  });

  it("signs in, lists models, reports inference 403, and signs out", async () => {
    const client = bridge();
    const { result } = renderHook(() => useGrokConnection(client, "prj_1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.signIn();
    });
    expect(result.current.status.state).toBe("CONNECTED");
    expect(result.current.models.map((model) => model.label)).toEqual(["Grok 4"]);
    await act(async () => {
      await result.current.checkInference("grok-4");
    });
    expect(result.current.notice).toContain("403");
    expect(client.completeText).toHaveBeenCalledWith(
      expect.objectContaining({ model: "grok-4", projectId: "prj_1" }),
    );
    await act(async () => {
      await result.current.signOut();
    });
    expect(result.current.status.state).toBe("NOT_CONNECTED");
    expect(result.current.models).toEqual([]);
  });

  it("shows a login error, a cancelled login, and an unconfirmed result", async () => {
    const failing = bridge({
      signIn: vi
        .fn()
        .mockResolvedValueOnce({ kind: "ERROR", code: "AUTH_DENIED", status: signedOut })
        .mockResolvedValueOnce({ kind: "CANCELLED", status: signedOut })
        .mockRejectedValueOnce(new Error("offline")),
    });
    const { result } = renderHook(() => useGrokConnection(failing));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.signIn();
    });
    expect(result.current.notice).toContain("没有同意");
    await act(async () => {
      await result.current.signIn();
    });
    expect(result.current.notice).toContain("已取消");
    await act(async () => {
      await result.current.signIn();
    });
    expect(result.current.notice).toContain("尚未确认");
  });

  it("keeps a restored session that cannot infer and surfaces model-directory failure", async () => {
    const client = bridge({
      status: vi.fn(async () => denied),
      models: vi.fn(async () => ({ kind: "ERROR" as const, code: "MODELS_FAILED" })),
      completeText: vi.fn(async () => ({
        kind: "OK" as const,
        text: "ok",
        billingAccountKind: "grok_login" as const,
        model: "grok-4",
      })),
    });
    const { result } = renderHook(() => useGrokConnection(client));
    await waitFor(() => expect(result.current.notice).toContain("403"));
    expect(result.current.models).toEqual([]);
    await act(async () => {
      await result.current.checkInference("grok-4");
    });
    expect(result.current.notice).toContain("测试完成，可以用");
  });

  it("renders the signed-in model list and the one login button", async () => {
    window.aijianGrok = bridge({ status: async () => connected });
    render(
      <GrokConnectionProvider>
        <GrokConnectionCard />
      </GrokConnectionProvider>,
    );
    expect(await screen.findByRole("status", { name: "已登录" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "用 Grok 账号登录" })).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "可用模型" })).not.toBeInTheDocument();
    expect(screen.getByText(/已登录 · person@example.test/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "改用 API Key（高级备用）" }));
  });

  it("covers directory failure, invalid results, and a missing desktop bridge", async () => {
    const client = bridge({
      status: vi.fn(async () => connected),
      models: vi.fn(async () => ({ kind: "ERROR" as const, code: "MODELS_FAILED" })),
      signIn: vi.fn(async () => ({
        kind: "OK" as const,
        status: { ...connected, state: "REAUTH_REQUIRED" as const, lastError: "REAUTH_REQUIRED" },
      })),
      signOut: vi.fn(async () => {
        throw new Error("offline");
      }),
      completeText: vi.fn(async () => {
        throw new Error("offline");
      }),
    });
    const { result } = renderHook(() => useGrokConnection(client));
    await waitFor(() => expect(result.current.notice).toContain("模型目录没有读成"));
    await act(async () => {
      await result.current.signIn();
    });
    expect(result.current.notice).toContain("登录已失效");
    await act(async () => {
      await result.current.signOut();
    });
    expect(result.current.notice).toContain("退出结果尚未确认");
    await act(async () => {
      await result.current.checkInference("grok-4");
    });
    expect(result.current.notice).toContain("没有确认这次测试");

    const invalid = bridge({
      signIn: vi.fn(async () => ({
        kind: "OK" as const,
        status: { provider: "GROK_LOGIN" } as never,
      })),
    });
    const invalidHook = renderHook(() => useGrokConnection(invalid));
    await waitFor(() => expect(invalidHook.result.current.loading).toBe(false));
    await act(async () => {
      await invalidHook.result.current.signIn();
    });
    expect(invalidHook.result.current.notice).toContain("尚未确认");

    const missing = renderHook(() => useGrokConnection(undefined));
    await waitFor(() => expect(missing.result.current.loading).toBe(false));
    await act(async () => {
      await missing.result.current.signIn();
      await missing.result.current.signOut();
      await missing.result.current.checkInference("grok-4");
    });
    expect(missing.result.current.status.runtime).toBe("DESKTOP_REQUIRED");
  });
});

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChatGPTBridge, ChatGPTStatus } from "./transport";
import { DESKTOP_REQUIRED, validStatus, chatGPTErrorMessage } from "./transport";
import { ChatGPTConnectionCard } from "./ChatGPTConnectionCard";
const disconnected: ChatGPTStatus = {
  ...DESKTOP_REQUIRED,
  runtime: "DESKTOP",
  secureStorage: "AVAILABLE",
};
const profile = {
  id: "11111111-1111-4111-8111-111111111111",
  label: "ChatGPT 1",
  email: "fixture@example.test",
  connected: true,
  planUsage: true,
};
const connected: ChatGPTStatus = {
  ...disconnected,
  state: "CONNECTED",
  useScope: "LOCAL_PERSONAL",
  activeProfileId: profile.id,
  profiles: [profile],
};
function bridge(value = disconnected): ChatGPTBridge {
  return {
    status: vi.fn<ChatGPTBridge["status"]>(async () => value),
    signIn: vi.fn<ChatGPTBridge["signIn"]>(async () => ({ kind: "OK", status: connected })),
    cancel: vi.fn<ChatGPTBridge["cancel"]>(async () => ({
      kind: "CANCELLED",
      status: disconnected,
    })),
    selectProfile: vi.fn<ChatGPTBridge["selectProfile"]>(async () => ({
      kind: "OK",
      status: connected,
    })),
    signOut: vi.fn<ChatGPTBridge["signOut"]>(async () => ({ kind: "OK", status: disconnected })),
    models: vi.fn<ChatGPTBridge["models"]>(async () => ({
      kind: "OK",
      models: [{ slug: "fixture-text", displayName: "Fixture text" }],
    })),
    openHelp: vi.fn(async () => undefined),
  };
}
describe("official connection card", () => {
  it.each([
    "OPENAI_REQUEST_FAILED",
    "MODEL_CATALOG_INVALID",
    "RESPONSE_INVALID",
    "RESPONSE_TOO_LARGE",
    "OPERATION_IN_PROGRESS",
  ])("explains %s without the generic verification warning", (code) => {
    expect(chatGPTErrorMessage(code)).toContain(code);
    expect(chatGPTErrorMessage(code)).not.toContain("操作未通过验证");
  });
  it("keeps web preview honestly desktop-required and allows skipping to API", async () => {
    const skip = vi.fn();
    render(<ChatGPTConnectionCard onUseApi={skip} />);
    await screen.findByText(/请在 AIVORA 桌面应用中授权/);
    expect(screen.getByRole("button", { name: "Continue with ChatGPT" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "跳过，使用 API" }));
    expect(skip).toHaveBeenCalledOnce();
  });
  it("requires explicit scope and persistence consent before any sign-in call", async () => {
    const transport = bridge();
    const done = vi.fn();
    render(<ChatGPTConnectionCard transport={transport} onConnected={done} />);
    const start = await screen.findByRole("button", { name: "Continue with ChatGPT" });
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);
    const authorize = screen.getByRole("button", { name: "在系统浏览器中授权" });
    expect(authorize).toBeDisabled();
    expect(screen.getByText(/这里说明你如何使用 AIVORA/)).toHaveTextContent(
      "ChatGPT 套餐和账号权限会在官方授权页另行确认",
    );
    expect(screen.getByText(/如果官方网页打不开/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("软件使用方式（接入资格）"), {
      target: { value: "LOCAL_PERSONAL" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    expect(transport.signIn).not.toHaveBeenCalled();
    fireEvent.click(authorize);
    await waitFor(() => expect(done).toHaveBeenCalledOnce());
    expect(transport.signIn).toHaveBeenCalledExactlyOnceWith("LOCAL_PERSONAL", undefined);
    expect(screen.getByText(/尚未验证真实推理/)).toBeInTheDocument();
    expect(transport.models).not.toHaveBeenCalled();
  });
  it("dismisses preparation without starting OAuth", async () => {
    const transport = bridge();
    render(<ChatGPTConnectionCard transport={transport} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Continue with ChatGPT" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue with ChatGPT" }));
    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(transport.signIn).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("软件使用方式（接入资格）")).not.toBeInTheDocument();
  });
  it("does not call connected completion for identity-only consent", async () => {
    const transport = bridge();
    transport.signIn = vi.fn<ChatGPTBridge["signIn"]>(async () => ({
      kind: "OK",
      status: {
        ...connected,
        state: "IDENTITY_ONLY",
        profiles: [{ ...profile, planUsage: false }],
      },
    }));
    const done = vi.fn();
    render(<ChatGPTConnectionCard transport={transport} onConnected={done} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Continue with ChatGPT" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue with ChatGPT" }));
    fireEvent.change(screen.getByLabelText("软件使用方式（接入资格）"), {
      target: { value: "LOCAL_PERSONAL" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "在系统浏览器中授权" }));
    await screen.findByText("账号已连接 · 未授权套餐");
    expect(done).not.toHaveBeenCalled();
  });
  it("cancels a pending login when leaving the card", async () => {
    const transport = bridge();
    let finish: (value: Awaited<ReturnType<ChatGPTBridge["signIn"]>>) => void = () => undefined;
    transport.signIn = vi.fn<ChatGPTBridge["signIn"]>(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(<ChatGPTConnectionCard transport={transport} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Continue with ChatGPT" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue with ChatGPT" }));
    fireEvent.change(screen.getByLabelText("软件使用方式（接入资格）"), {
      target: { value: "LOCAL_PERSONAL" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "在系统浏览器中授权" }));
    view.unmount();
    expect(transport.cancel).toHaveBeenCalledOnce();
    await act(async () => finish({ kind: "CANCELLED", status: disconnected }));
  });
  it("shows only a requested current-account model list, with no inference claim", async () => {
    const transport = bridge(connected);
    render(<ChatGPTConnectionCard transport={transport} />);
    fireEvent.click(await screen.findByRole("button", { name: "读取此账号的可用模型" }));
    await screen.findByText("Fixture text");
    expect(transport.models).toHaveBeenCalledOnce();
    expect(screen.getByText(/尚未执行模型推理/)).toBeInTheDocument();
  });
  it("rejects statuses with secret fields or impossible connected states", () => {
    expect(validStatus({ ...connected, accessToken: "fixture" })).toBe(false);
    expect(validStatus({ ...connected, profiles: [] })).toBe(false);
    expect(validStatus({ ...connected, profiles: [{ ...profile, connected: false }] })).toBe(false);
    expect(validStatus({ ...connected, profiles: [profile, profile] })).toBe(false);
    expect(validStatus(connected)).toBe(true);
  });
});

it("keeps secure-store failure explicit and opens only documented help", async () => {
  const transport = bridge({ ...disconnected, secureStorage: "UNAVAILABLE" });
  render(<ChatGPTConnectionCard transport={transport} />);
  await screen.findByText("系统安全凭据库不可用，官方登录暂不可开始。");
  expect(screen.getByRole("button", { name: "Continue with ChatGPT" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "官方接入说明" }));
  fireEvent.click(screen.getByRole("button", { name: "商业接入资格" }));
  expect(transport.openHelp).toHaveBeenCalledWith("documentation");
  expect(transport.openHelp).toHaveBeenCalledWith("eligibility");
});
it("shows failed reads, allows retry, and opens browser-only documentation safely", async () => {
  const transport = bridge();
  transport.status = vi
    .fn<ChatGPTBridge["status"]>()
    .mockRejectedValueOnce(new Error("fixture unavailable"))
    .mockResolvedValue(disconnected);
  render(<ChatGPTConnectionCard transport={transport} />);
  await screen.findByText("无法读取官方账号状态，尚未确认连接。请重试。");
  fireEvent.click(screen.getByRole("button", { name: "重新读取状态" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Continue with ChatGPT" })).toBeEnabled(),
  );
});
it("supports profile selection, account addition, pending registration and sign out", async () => {
  const pending = {
    ...profile,
    id: "22222222-2222-4222-8222-222222222222",
    connected: false,
    planUsage: false,
    email: null,
    label: "ChatGPT 2",
  };
  const other = { ...profile, id: "33333333-3333-4333-8333-333333333333", label: "ChatGPT 3" };
  const transport = bridge({ ...connected, profiles: [profile, pending, other] });
  render(<ChatGPTConnectionCard transport={transport} />);
  fireEvent.click(await screen.findByRole("button", { name: "完成此账号登录" }));
  fireEvent.click(screen.getByRole("button", { name: "返回" }));
  fireEvent.click(screen.getByRole("button", { name: "添加账号" }));
  fireEvent.click(screen.getByRole("button", { name: "返回" }));
  const choices = screen.getAllByRole("button", { name: "使用此账号" });
  const enabled = choices.find((button) => !button.hasAttribute("disabled"));
  if (!enabled) throw new Error("missing choice");
  fireEvent.click(enabled);
  await waitFor(() => expect(transport.selectProfile).toHaveBeenCalledWith(other.id));
  fireEvent.click(screen.getByRole("button", { name: "管理 ChatGPT 用量" }));
  expect(transport.openHelp).toHaveBeenCalledWith("usage");
  fireEvent.click(screen.getByRole("button", { name: "退出当前账号" }));
  await waitFor(() => expect(transport.signOut).toHaveBeenCalledOnce());
});
it("reports model request rejection, network failure and an empty account directory", async () => {
  const transport = bridge(connected);
  transport.models = vi
    .fn<ChatGPTBridge["models"]>()
    .mockResolvedValueOnce({ kind: "ERROR", code: "USAGE_LIMIT" })
    .mockRejectedValueOnce(new Error("fixture network"))
    .mockResolvedValueOnce({ kind: "OK", models: [] });
  render(<ChatGPTConnectionCard transport={transport} />);
  const button = await screen.findByRole("button", { name: "读取此账号的可用模型" });
  fireEvent.click(button);
  await screen.findByText(/已达到当前账号的用量限制/);
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await screen.findByText(/模型目录尚未确认/);
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await screen.findByText("当前账号未返回可选模型。");
});
it("reports uncertain sign-in and stops pending sign-in on explicit cancellation", async () => {
  const transport = bridge();
  transport.signIn = vi.fn<ChatGPTBridge["signIn"]>().mockRejectedValueOnce(new Error("fixture"));
  const view = render(<ChatGPTConnectionCard transport={transport} />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Continue with ChatGPT" })).toBeEnabled(),
  );
  async function start() {
    fireEvent.click(screen.getByRole("button", { name: "Continue with ChatGPT" }));
    fireEvent.change(screen.getByLabelText("软件使用方式（接入资格）"), {
      target: { value: "LOCAL_PERSONAL" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "在系统浏览器中授权" }));
  }
  await start();
  await screen.findByText("结果尚未确认。请重新读取账号状态，避免重复授权。");
  let finish: (value: Awaited<ReturnType<ChatGPTBridge["signIn"]>>) => void = () => undefined;
  transport.signIn = vi.fn<ChatGPTBridge["signIn"]>(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await start();
  fireEvent.click(screen.getByRole("button", { name: "取消登录" }));
  expect(transport.cancel).toHaveBeenCalledOnce();
  await act(async () => finish({ kind: "CANCELLED", status: disconnected }));
  view.unmount();
});
it("reports native action errors and uncertain remote revocation distinctly", async () => {
  const transport = bridge(connected);
  transport.signOut = vi
    .fn<ChatGPTBridge["signOut"]>()
    .mockResolvedValueOnce({
      kind: "ERROR",
      code: "SECURE_STORAGE_WRITE_FAILED",
      status: connected,
    })
    .mockResolvedValueOnce({
      kind: "OK",
      status: { ...disconnected, lastError: "REMOTE_REVOCATION_UNCONFIRMED" },
    });
  render(<ChatGPTConnectionCard transport={transport} />);
  fireEvent.click(await screen.findByRole("button", { name: "退出当前账号" }));
  await screen.findByText(/凭据保存未能确认/);
  await waitFor(() => expect(screen.getByRole("button", { name: "退出当前账号" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "退出当前账号" }));
  await screen.findByText(/远端撤销未确认/);
});

import "@testing-library/jest-dom/vitest";
import type { GrokLoginStatus } from "@aijian/contracts/grok-auth";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { HomePages } from "./HomePages";
import { DemoProvider } from "./model";

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

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  delete window.aijianGrok;
});

describe("first-launch Grok login", () => {
  it("uses one button to sign in and then shows the account and models", async () => {
    const signIn = vi.fn(async () => ({ kind: "OK" as const, status: connected }));
    window.aijianGrok = {
      status: vi.fn(async () => signedOut),
      signIn,
      cancel: vi.fn(async () => ({ kind: "CANCELLED" as const, status: signedOut })),
      signOut: vi.fn(async () => ({ kind: "OK" as const, status: signedOut })),
      models: vi.fn(async () => ({
        kind: "OK" as const,
        models: [{ id: "grok-4", label: "Grok 4" }],
      })),
      completeText: vi.fn(),
    };
    render(
      <DemoProvider>
        <HomePages />
      </DemoProvider>,
    );
    const button = await screen.findByRole("button", { name: "用 Grok 账号登录" });
    fireEvent.click(button);
    expect(await screen.findByText(/已登录 · person@example.test/)).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "可用模型" })).toHaveTextContent("Grok 4");
    expect(signIn).toHaveBeenCalledTimes(1);
  });

  it("shows the Chinese failure and the log path when sign-in does not finish", async () => {
    window.aijianGrok = {
      status: vi.fn(async () => signedOut),
      signIn: vi.fn(async () => ({
        kind: "ERROR" as const,
        code: "CALLBACK_REJECTED",
        status: signedOut,
      })),
      cancel: vi.fn(async () => ({ kind: "CANCELLED" as const, status: signedOut })),
      signOut: vi.fn(async () => ({ kind: "OK" as const, status: signedOut })),
      models: vi.fn(async () => ({ kind: "OK" as const, models: [] })),
      completeText: vi.fn(),
    };
    render(
      <DemoProvider>
        <HomePages />
      </DemoProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "用 Grok 账号登录" }));
    expect(await screen.findByText(/授权页没有接受本机回调/)).toBeInTheDocument();
    expect(screen.getByText(/grok-login\.log/)).toBeInTheDocument();
  });

  it("restores a saved login without asking again", async () => {
    window.aijianGrok = {
      status: vi.fn(async () => connected),
      signIn: vi.fn(),
      cancel: vi.fn(),
      signOut: vi.fn(),
      models: vi.fn(async () => ({
        kind: "OK" as const,
        models: [{ id: "grok-4", label: "Grok 4" }],
      })),
      completeText: vi.fn(),
    };
    render(
      <DemoProvider>
        <HomePages />
      </DemoProvider>,
    );
    expect(await screen.findByText(/关闭再打开不用重新登录/)).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "可用模型" })).toHaveTextContent("Grok 4");
    expect(screen.queryByRole("button", { name: "用 Grok 账号登录" })).not.toBeInTheDocument();
  });

  it("tells the user when the desktop bridge is missing or the login is cancelled", async () => {
    render(
      <DemoProvider>
        <HomePages />
      </DemoProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "用 Grok 账号登录" }));
    expect(await screen.findByText(/需要桌面应用/)).toBeInTheDocument();

    window.aijianGrok = {
      status: vi.fn(async () => signedOut),
      signIn: vi.fn(async () => ({ kind: "CANCELLED" as const, status: signedOut })),
      cancel: vi.fn(),
      signOut: vi.fn(),
      models: vi.fn(),
      completeText: vi.fn(),
    };
    cleanup();
    render(
      <DemoProvider>
        <HomePages />
      </DemoProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "用 Grok 账号登录" }));
    expect(await screen.findByText("已取消 Grok 登录。")).toBeInTheDocument();
  });

  it("keeps an entitlement denial visible after restart", async () => {
    const denied = {
      ...connected,
      state: "ENTITLEMENT_DENIED" as const,
      lastError: "ENTITLEMENT_DENIED",
    };
    window.aijianGrok = {
      status: vi.fn(async () => denied),
      signIn: vi.fn(async () => ({ kind: "OK" as const, status: denied })),
      cancel: vi.fn(),
      signOut: vi.fn(),
      models: vi.fn(async () => ({ kind: "OK" as const, models: [] })),
      completeText: vi.fn(),
    };
    render(
      <DemoProvider>
        <HomePages />
      </DemoProvider>,
    );
    expect(await screen.findByText(/403/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "用 Grok 账号登录" })).not.toBeInTheDocument();
  });

  it("logs in from the first-run dialog and opens AI services", async () => {
    window.aijianGrok = {
      status: vi.fn(async () => signedOut),
      signIn: vi.fn(async () => ({ kind: "OK" as const, status: connected })),
      cancel: vi.fn(),
      signOut: vi.fn(),
      models: vi.fn(async () => ({
        kind: "OK" as const,
        models: [{ id: "grok-4", label: "Grok 4" }],
      })),
      completeText: vi.fn(),
    };
    render(
      <DemoProvider>
        <HomePages />
      </DemoProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "进入创作工作台" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "用 Grok 账号登录" }));
    await screen.findByRole("heading", { name: "项目创作首页" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

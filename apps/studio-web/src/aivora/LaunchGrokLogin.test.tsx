import "@testing-library/jest-dom/vitest";
import type { GrokLoginStatus } from "@aijian/contracts/grok-auth";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
});

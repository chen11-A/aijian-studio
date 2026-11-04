import "@testing-library/jest-dom/vitest";
import type { GrokLoginBridge, GrokLoginStatus } from "@aijian/contracts/grok-auth";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DemoProvider } from "./model";
import { UserChip } from "./UserChip";

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

function bridge(status: GrokLoginStatus): GrokLoginBridge {
  return {
    status: vi.fn(async () => status),
    signIn: vi.fn(async () => ({ kind: "OK" as const, status })),
    cancel: vi.fn(async () => ({ kind: "CANCELLED" as const, status: signedOut })),
    signOut: vi.fn(async () => ({ kind: "OK" as const, status: signedOut })),
    models: vi.fn(async () => ({ kind: "OK" as const, models: [] })),
    completeText: vi.fn(async () => ({
      kind: "ERROR" as const,
      code: "NOT_CONNECTED",
      billingAccountKind: "grok_login" as const,
    })),
  };
}

afterEach(() => {
  cleanup();
  delete window.aijianGrok;
});

describe("header user chip", () => {
  it("uses a monogram for a local user and never an image", async () => {
    window.aijianGrok = bridge(signedOut);
    render(
      <DemoProvider>
        <UserChip />
      </DemoProvider>,
    );
    expect(await screen.findByText("本")).toBeInTheDocument();
    const summary = screen.getByText("本地用户", { selector: ".user-chip-name" });
    expect(summary).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
    fireEvent.click(summary);
    fireEvent.click(screen.getByRole("button", { name: "用户中心" }));
    fireEvent.click(summary);
    fireEvent.click(screen.getByRole("button", { name: "项目设置" }));
    fireEvent.click(summary);
    fireEvent.click(screen.getByRole("button", { name: "回到欢迎页" }));
  });

  it("shows the Grok account label after the desktop session is read", async () => {
    window.aijianGrok = bridge(connected);
    render(
      <DemoProvider>
        <UserChip />
      </DemoProvider>,
    );
    await waitFor(() =>
      expect(screen.getAllByText("person@example.test").length).toBeGreaterThan(0),
    );
    expect(screen.getByText("P")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
    fireEvent.click(screen.getByText("person", { selector: ".user-chip-name" }));
    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));
    await waitFor(() => expect(window.aijianGrok?.signOut).toHaveBeenCalled());
  });

  it("keeps the local name when the desktop status cannot be read", async () => {
    window.aijianGrok = bridge(signedOut);
    window.aijianGrok.status = vi.fn(async () => {
      throw new Error("offline");
    });
    render(
      <DemoProvider>
        <UserChip />
      </DemoProvider>,
    );
    expect(await screen.findByText("本")).toBeInTheDocument();
    await waitFor(() => expect(window.aijianGrok?.status).toHaveBeenCalled());
    fireEvent.click(screen.getByText("本地用户", { selector: ".user-chip-name" }));
    expect(screen.getByRole("button", { name: "退出登录" })).toBeDisabled();
  });
});

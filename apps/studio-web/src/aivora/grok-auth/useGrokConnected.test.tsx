import "@testing-library/jest-dom/vitest";
import type { GrokLoginBridge, GrokLoginStatus } from "@aijian/contracts/grok-auth";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useGrokConnected } from "./useGrokConnected";

const connected: GrokLoginStatus = {
  provider: "GROK_LOGIN",
  runtime: "DESKTOP",
  state: "CONNECTED",
  secureStorage: "AVAILABLE",
  accountLabel: "person@example.test",
  lastError: null,
};

function Probe() {
  return <span>{useGrokConnected() ? "已连接" : "未连接"}</span>;
}

afterEach(() => {
  cleanup();
  delete window.aijianGrok;
});

describe("useGrokConnected", () => {
  it("follows a desktop Grok session and clears it when the status read fails", async () => {
    const status = vi
      .fn()
      .mockResolvedValueOnce(connected)
      .mockResolvedValueOnce({ ...connected, state: "ENTITLEMENT_DENIED" })
      .mockRejectedValueOnce(new Error("offline"));
    window.aijianGrok = { status } as unknown as GrokLoginBridge;
    render(<Probe />);
    expect(await screen.findByText("已连接")).toBeInTheDocument();
    window.dispatchEvent(new Event("aivora-grok-changed"));
    await waitFor(() => expect(status).toHaveBeenCalledTimes(2));
    expect(screen.getByText("已连接")).toBeInTheDocument();
    window.dispatchEvent(new Event("aivora-grok-changed"));
    expect(await screen.findByText("未连接")).toBeInTheDocument();
  });
});

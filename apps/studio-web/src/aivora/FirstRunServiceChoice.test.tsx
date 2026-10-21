import "@testing-library/jest-dom/vitest";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  FirstRunServiceChoice,
  hasServiceEntryChoice,
  rememberServiceEntryChoice,
} from "./FirstRunServiceChoice";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
});
beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe("optional first-use service choice", () => {
  it("does not require ChatGPT and routes directly to API or offline work", () => {
    const select = vi.fn();
    render(<FirstRunServiceChoice onSelect={select} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "连接 Grok（API Key）" }));
    expect(select).toHaveBeenLastCalledWith("api");
    fireEvent.click(screen.getByRole("button", { name: "暂时离线创作" }));
    expect(select).toHaveBeenLastCalledWith("offline");
    fireEvent.click(screen.getByRole("button", { name: "使用 ChatGPT 官方账号" }));
    expect(select).toHaveBeenLastCalledWith("chatgpt");
  });
  it("close and Escape dismiss without choosing or persisting anything", () => {
    const select = vi.fn(),
      close = vi.fn();
    render(<FirstRunServiceChoice onSelect={select} onClose={close} />);
    fireEvent.click(screen.getByRole("button", { name: "关闭连接方式选择" }));
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(close).toHaveBeenCalledTimes(2);
    expect(select).not.toHaveBeenCalled();
    expect(hasServiceEntryChoice()).toBe(false);
  });
  it("stores only the chosen entry preference and rejects unknown marker values", () => {
    expect(hasServiceEntryChoice()).toBe(false);
    expect(rememberServiceEntryChoice("api")).toBe(true);
    expect(hasServiceEntryChoice()).toBe(true);
    expect(window.localStorage.getItem("aivora.service-onboarding.v1")).toBe("api");
    window.localStorage.setItem("aivora.service-onboarding.v1", "connected");
    expect(hasServiceEntryChoice()).toBe(false);
  });
});

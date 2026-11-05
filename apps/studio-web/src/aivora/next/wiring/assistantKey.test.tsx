import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { isAssistantKey, useAssistantKey } from "./assistantKey";

function Probe({ toggle, enabled }: { toggle: () => void; enabled?: boolean }) {
  useAssistantKey(toggle, enabled);
  return null;
}

describe("useAssistantKey", () => {
  it("reads Ctrl+J and ⌘J, not Shift or Alt", () => {
    const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);
    expect(isAssistantKey(key({ key: "j", ctrlKey: true }))).toBe(true);
    expect(isAssistantKey(key({ key: "J", metaKey: true }))).toBe(true);
    expect(isAssistantKey(key({ key: "j" }))).toBe(false);
    expect(isAssistantKey(key({ key: "j", ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isAssistantKey(key({ key: "k", ctrlKey: true }))).toBe(false);
  });

  it("calls the latest toggle, and stops when the part of the page is gone", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender, unmount } = render(<Probe toggle={first} />);
    rerender(<Probe toggle={second} />);
    fireEvent.keyDown(window, { key: "j", ctrlKey: true });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    rerender(<Probe toggle={second} enabled={false} />);
    fireEvent.keyDown(window, { key: "j", ctrlKey: true });
    expect(second).toHaveBeenCalledTimes(1);
    rerender(<Probe toggle={second} />);
    unmount();
    fireEvent.keyDown(window, { key: "j", ctrlKey: true });
    expect(second).toHaveBeenCalledTimes(1);
  });
});

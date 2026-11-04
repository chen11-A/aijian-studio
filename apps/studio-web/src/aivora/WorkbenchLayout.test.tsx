import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DemoApp } from "./DemoApp";
import { createAivoraSampleFixture } from "./model";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("mounted professional dock view controls", () => {
  it("retains tab, object input and AI draft through collapse, restore and mode changes", () => {
    window.history.replaceState({}, "", "#storyboard");
    render(<DemoApp fixture={createAivoraSampleFixture()} />);
    fireEvent.click(screen.getByRole("button", { name: "专业模式" }));
    fireEvent.click(screen.getByRole("button", { name: "镜头 2 走进雨幕" }));
    const shotType = screen.getByLabelText("镜头类型");
    fireEvent.change(shotType, { target: { value: "特写 (ECU)" } });
    const input = screen.getByLabelText("AI 输入");
    fireEvent.change(input, { target: { value: "尚未发送的想法\n保留上下文" } });
    fireEvent.click(screen.getByRole("tab", { name: "Aivora AI" }));
    const dock = document.getElementById("creative-right-dock")!;
    const root = document.querySelector(".demo-root")!;
    const storage = Object.fromEntries(
      Object.keys(localStorage).map((key) => [key, localStorage.getItem(key)]),
    );
    fireEvent.click(screen.getByRole("button", { name: "收起专业右栏" }));
    expect(dock).toHaveAttribute("hidden");
    expect(root).toHaveAttribute("data-right-tab", "ai");
    expect(input.isConnected).toBe(true);
    expect(shotType.isConnected).toBe(true);
    expect(screen.queryByRole("complementary", { name: "创作辅助面板" })).toBeNull();
    const restore = screen.getByRole("button", { name: "恢复专业右栏" });
    expect(restore).toHaveAttribute("aria-expanded", "false");
    expect(restore).toHaveAttribute("aria-controls", "creative-right-dock");
    fireEvent.click(restore);
    expect(dock).not.toHaveAttribute("hidden");
    expect(screen.getByLabelText("AI 输入")).toBe(input);
    expect(input).toHaveValue("尚未发送的想法\n保留上下文");
    expect(shotType).toHaveValue("特写 (ECU)");
    expect(root).toHaveAttribute("data-right-tab", "ai");
    fireEvent.click(screen.getByRole("button", { name: "收起专业右栏" }));
    fireEvent.click(screen.getByRole("button", { name: "普通模式" }));
    expect(dock).not.toHaveAttribute("hidden");
    fireEvent.click(screen.getByRole("button", { name: "专业模式" }));
    expect(dock).toHaveAttribute("hidden");
    fireEvent.click(screen.getByRole("button", { name: "恢复专业右栏" }));
    expect(input).toHaveValue("尚未发送的想法\n保留上下文");
    expect(shotType).toHaveValue("特写 (ECU)");
    expect(root).toHaveAttribute("data-right-tab", "ai");
    expect(
      Object.fromEntries(Object.keys(localStorage).map((key) => [key, localStorage.getItem(key)])),
    ).toEqual(storage);
  });

  it("keeps collapse preferences per page and restores each selected tab", () => {
    window.history.replaceState({}, "", "#storyboard");
    render(<DemoApp fixture={createAivoraSampleFixture()} />);
    fireEvent.click(screen.getByRole("button", { name: "专业模式" }));
    fireEvent.click(screen.getByRole("tab", { name: "Aivora AI" }));
    fireEvent.click(screen.getByRole("button", { name: "收起专业右栏" }));
    fireEvent.change(screen.getByLabelText("演示页面"), { target: { value: "assembly" } });
    expect(screen.getByRole("button", { name: "收起专业右栏" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(document.querySelector(".demo-root")).toHaveAttribute("data-right-tab", "inspector");
    fireEvent.change(screen.getByLabelText("演示页面"), { target: { value: "storyboard" } });
    expect(screen.getByRole("button", { name: "恢复专业右栏" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(document.querySelector(".demo-root")).toHaveAttribute("data-right-tab", "ai");
  });
});

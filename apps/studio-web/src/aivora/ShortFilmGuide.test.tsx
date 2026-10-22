import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { DemoApp } from "./DemoApp";
import { createAivoraSampleFixture } from "./model";

afterEach(() => cleanup());

describe("simple story-to-film navigation", () => {
  it("shows the four steps and a provider choice, and keeps the full nav behind professional mode", () => {
    window.history.replaceState({}, "", "#project");
    render(<DemoApp />);
    const stages = screen.getByRole("navigation", { name: "创作阶段" });
    expect(within(stages).getByRole("button", { name: "故事" })).toBeInTheDocument();
    expect(within(stages).queryByRole("button", { name: "分镜" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "分镜" })).not.toBeInTheDocument();
    fireEvent.click(within(stages).getByRole("button", { name: "画面" }));
    const provider = screen.getByRole("combobox", { name: "用什么生成" });
    expect(within(provider).getAllByRole("option").length).toBeGreaterThan(1);
    expect(within(provider).getByRole("option", { name: /本地占位/ })).toBeInTheDocument();
    expect(screen.getAllByText(/不花钱/).length).toBeGreaterThan(0);
    fireEvent.click(
      within(screen.getByLabelText("短片向导")).getByRole("button", { name: "专业模式" }),
    );
    expect(screen.getByRole("button", { name: "分镜" })).toBeInTheDocument();
  });

  it("keeps the full navigation in the fixture without professional mode", () => {
    window.history.replaceState({}, "", "#project");
    render(<DemoApp fixture={createAivoraSampleFixture()} />);
    expect(screen.getByRole("button", { name: "分镜" })).toBeInTheDocument();
    expect(screen.queryByLabelText("短片向导")).not.toBeInTheDocument();
  });
});

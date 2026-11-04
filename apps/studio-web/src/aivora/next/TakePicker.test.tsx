import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TakePicker, type TakeOption, type TakePickerProps } from "./TakePicker";

const A: TakeOption = {
  id: "take-a",
  label: "A 版",
  verdict: "必须重做",
  notes: [{ tone: "bad", text: "铁棍穿过了肩膀" }],
};
const B: TakeOption = {
  id: "take-b",
  label: "B 版",
  verdict: "可用",
  notes: [{ tone: "ok", text: "砸空干净" }],
};
const C: TakeOption = {
  id: "take-c",
  label: "C 版",
  verdict: "建议重做",
  notes: [{ tone: "warn", text: "开头 0.4 秒黑屏" }],
};

function renderPicker(props: Partial<TakePickerProps> = {}) {
  const onSelect = vi.fn();
  const view = render(
    <TakePicker
      shotLabel="第 2 场第 17 个镜头"
      shotCode="scene-2-shot-17"
      description="铁棍砸在木箱上。"
      takes={[A, B, C]}
      aiChoiceId="take-b"
      onSelect={onSelect}
      {...props}
    />,
  );
  return { ...view, onSelect };
}

describe("TakePicker", () => {
  it("puts up to three versions side by side and marks the AI's pick", () => {
    const { container } = renderPicker();
    const tiles = screen.getAllByRole("listitem", { name: /版$/ });
    expect(tiles).toHaveLength(3);
    expect(container.querySelector(".nx-takes-grid")).toHaveClass("nx-count-3");
    const picked = screen.getByRole("listitem", { name: "B 版" });
    expect(within(picked).getByText("AI 选的，可换")).toBeInTheDocument();
    expect(within(picked).getByText("正在用这一版")).toBeInTheDocument();
    expect(screen.getAllByText("AI 选的，可换")).toHaveLength(1);
    expect(screen.getByText("scene-2-shot-17")).toHaveClass("nx-code");
    expect(screen.getByText(/按 1、2、3 也能选。/)).toBeInTheDocument();
    expect(container.querySelectorAll(".nx-key")).toHaveLength(3);
  });

  it("calls back with the version the user picks", () => {
    const { onSelect } = renderPicker();
    fireEvent.click(screen.getByRole("button", { name: "用A 版" }));
    expect(onSelect).toHaveBeenCalledWith("take-a");
    expect(screen.queryByRole("button", { name: "用B 版" })).toBeNull();
  });

  it("moves 正在用 when the caller says another version is in use", () => {
    renderPicker({ selectedId: "take-c" });
    const c = screen.getByRole("listitem", { name: "C 版" });
    expect(within(c).getByText("正在用这一版")).toBeInTheDocument();
    const b = screen.getByRole("listitem", { name: "B 版" });
    expect(within(b).getByText("AI 选的，可换")).toBeInTheDocument();
    expect(within(b).getByRole("button", { name: "用B 版" })).toBeEnabled();
  });

  it("lays out one or two versions", () => {
    const { container, rerender, onSelect } = renderPicker({ takes: [B] });
    expect(container.querySelector(".nx-takes-grid")).toHaveClass("nx-count-1");
    expect(screen.queryByText(/也能选/)).toBeNull();
    expect(container.querySelector(".nx-key")).toBeNull();
    rerender(<TakePicker shotLabel="镜头" takes={[A, B]} aiChoiceId={null} onSelect={onSelect} />);
    expect(container.querySelector(".nx-takes-grid")).toHaveClass("nx-count-2");
    expect(screen.getByText(/按 1、2 也能选。/)).toBeInTheDocument();
    expect(screen.queryByText("AI 选的，可换")).toBeNull();
    expect(screen.queryByText("正在用这一版")).toBeNull();
  });

  it("shows only the first three when given more", () => {
    renderPicker({ takes: [A, B, C, { id: "take-d", label: "D 版" }] });
    expect(screen.queryByRole("listitem", { name: "D 版" })).toBeNull();
    expect(screen.getByText(/这里只放前 3 个版本。/)).toBeInTheDocument();
  });

  it("cannot pick a version that is still being made or failed", () => {
    renderPicker({
      takes: [
        A,
        B,
        { id: "take-c", label: "C 版", status: "generating", statusText: "正在生成 · 已等 48 秒" },
      ],
    });
    expect(screen.getByRole("button", { name: "用C 版" })).toBeDisabled();
    expect(screen.getByText("正在生成 · 已等 48 秒")).toBeInTheDocument();
    renderPicker({ takes: [{ id: "f", label: "F 版", status: "failed" }] });
    expect(screen.getByText("没有做成")).toBeInTheDocument();
    renderPicker({ takes: [{ id: "g", label: "G 版", status: "generating" }] });
    expect(screen.getByText("正在生成")).toBeInTheDocument();
  });

  it("picks with the keys 1, 2 and 3", () => {
    const { onSelect } = renderPicker({
      takes: [A, B, { id: "take-c", label: "C 版", status: "generating" }],
    });
    const region = screen.getByRole("region", { name: "第 2 场第 17 个镜头" });
    fireEvent.keyDown(region, { key: "1" });
    expect(onSelect).toHaveBeenCalledWith("take-a");
    fireEvent.keyDown(region, { key: "2" });
    fireEvent.keyDown(region, { key: "3" });
    fireEvent.keyDown(region, { key: "x" });
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("shows a still and a landscape frame when given them", () => {
    const { container } = renderPicker({
      takes: [{ ...B, imageUrl: "blob:still-b" }],
      aspect: "16:9",
    });
    expect(screen.getByRole("img", { name: "B 版的画面" })).toHaveAttribute("src", "blob:still-b");
    expect(container.querySelector(".nx-frame")).toHaveClass("nx-wide");
  });
});

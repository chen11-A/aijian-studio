import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CoverEditor, TITLE_MAX_LENGTH, type CoverEditorProps } from "./CoverEditor";

function renderCover(props: Partial<CoverEditorProps> = {}) {
  const onTitleChange = vi.fn();
  const view = render(
    <CoverEditor title="雨夜旧书店" subtitle="第 1 集" onTitleChange={onTitleChange} {...props} />,
  );
  return { ...view, onTitleChange };
}

describe("CoverEditor", () => {
  it("turns the 「AI 生成」 mark on by default", () => {
    renderCover();
    expect(screen.getByRole("switch", { name: "「AI 生成」标识" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(within(screen.getByTestId("cover-tall")).getByText("AI 生成")).toBeInTheDocument();
    expect(within(screen.getByTestId("cover-wide")).getByText("AI 生成")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("turns the mark off on its own and warns about it", () => {
    const onAiMarkChange = vi.fn();
    renderCover({ onAiMarkChange });
    const mark = screen.getByRole("switch", { name: "「AI 生成」标识" });
    fireEvent.click(mark);
    expect(onAiMarkChange).toHaveBeenCalledWith(false);
    expect(mark).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByText("AI 生成")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("部分平台要求标注 AI 生成");
    fireEvent.click(mark);
    expect(onAiMarkChange).toHaveBeenLastCalledWith(true);
    expect(screen.getAllByText("AI 生成")).toHaveLength(2);
  });

  it("follows the caller when the mark is controlled", () => {
    const onAiMarkChange = vi.fn();
    renderCover({ aiMark: false, onAiMarkChange });
    const mark = screen.getByRole("switch", { name: "「AI 生成」标识" });
    fireEvent.click(mark);
    expect(onAiMarkChange).toHaveBeenCalledWith(true);
    expect(mark).toHaveAttribute("aria-checked", "false");
  });

  it("can start with the mark off", () => {
    renderCover({ defaultAiMark: false });
    expect(screen.getByRole("switch", { name: "「AI 生成」标识" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    fireEvent.click(screen.getByRole("switch", { name: "「AI 生成」标识" }));
    expect(screen.getAllByText("AI 生成")).toHaveLength(2);
  });

  it("edits the title and shows it on both covers", () => {
    const { onTitleChange } = renderCover();
    const input = screen.getByRole("textbox", { name: "片名" });
    expect(input).toHaveAttribute("maxLength", String(TITLE_MAX_LENGTH));
    fireEvent.change(input, { target: { value: "灯还亮着" } });
    expect(onTitleChange).toHaveBeenCalledWith("灯还亮着");
    expect(within(screen.getByTestId("cover-tall")).getByText("雨夜旧书店")).toBeInTheDocument();
    expect(within(screen.getByTestId("cover-wide")).getByText("第 1 集")).toBeInTheDocument();
  });

  it("edits the subtitle only when the caller handles it", () => {
    const onSubtitleChange = vi.fn();
    const { rerender, onTitleChange } = renderCover();
    expect(screen.queryByRole("textbox", { name: "副标题" })).toBeNull();
    rerender(
      <CoverEditor
        title="雨夜旧书店"
        onTitleChange={onTitleChange}
        onSubtitleChange={onSubtitleChange}
      />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "副标题" }), {
      target: { value: "第 2 集" },
    });
    expect(onSubtitleChange).toHaveBeenCalledWith("第 2 集");
  });

  it("saves, but not without a title", () => {
    const onSave = vi.fn();
    const { rerender, onTitleChange } = renderCover({ onSave });
    fireEvent.click(screen.getByRole("button", { name: "用这个封面" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    rerender(<CoverEditor title="  " onTitleChange={onTitleChange} onSave={onSave} />);
    expect(screen.getByRole("button", { name: "用这个封面" })).toBeDisabled();
    expect(screen.getByText("先写片名。")).toBeInTheDocument();
    expect(screen.getAllByText("片名").length).toBeGreaterThan(1);
  });

  it("puts a still behind the title when given one", () => {
    const { container } = renderCover({ backgroundUrl: "blob:cover" });
    expect(container.querySelectorAll("img[src='blob:cover']")).toHaveLength(2);
  });
});

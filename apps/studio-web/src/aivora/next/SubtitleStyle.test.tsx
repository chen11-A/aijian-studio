import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SUBTITLE_STYLES, SubtitleStyle, wrapLine, type SubtitleStyleProps } from "./SubtitleStyle";

const LINE = "你来晚了。这家店，下个月就没了。";

function renderStyle(props: Partial<SubtitleStyleProps> = {}) {
  const onChange = vi.fn();
  const view = render(
    <SubtitleStyle
      value="clear"
      sampleLine={LINE}
      sampleSource="第 1 场第 16 个镜头"
      onChange={onChange}
      {...props}
    />,
  );
  return { ...view, onChange };
}

describe("SubtitleStyle", () => {
  it("offers four styles and previews the line both ways", () => {
    renderStyle();
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(4);
    expect(SUBTITLE_STYLES.map((style) => style.name)).toEqual([
      "清楚白字",
      "底条字幕",
      "电影字幕",
      "醒目黄字",
    ]);
    expect(screen.getByRole("radio", { name: /清楚白字/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("wide-line")).toHaveTextContent(LINE);
    expect(screen.getByTestId("wide-line")).toHaveClass("nx-look-clear");
    const tall = screen.getByTestId("tall-line");
    expect(
      within(tall)
        .getAllByText(/./)
        .map((line) => line.textContent),
    ).toEqual(["你来晚了。这家店，", "下个月就没了。"]);
    expect(screen.getByText("平台的按钮和标题会挡住这里")).toBeInTheDocument();
    expect(screen.getByText("第 1 场第 16 个镜头")).toBeInTheDocument();
  });

  it("changes the style by click and arrow keys", () => {
    const { onChange } = renderStyle({ value: "film" });
    expect(screen.getByTestId("wide-line")).toHaveClass("nx-look-film");
    fireEvent.click(screen.getByRole("radio", { name: /醒目黄字/ }));
    expect(onChange).toHaveBeenLastCalledWith("bold");
    const current = screen.getByRole("radio", { name: /电影字幕/ });
    fireEvent.keyDown(current, { key: "ArrowUp" });
    expect(onChange).toHaveBeenLastCalledWith("band");
    expect(screen.getByRole("radio", { name: /底条字幕/ })).toHaveFocus();
    fireEvent.keyDown(current, { key: "Enter" });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("applies the chosen style when asked", () => {
    const onApply = vi.fn();
    renderStyle({ value: "bold", onApply });
    fireEvent.click(screen.getByRole("button", { name: "用这个样式" }));
    expect(onApply).toHaveBeenCalledWith("bold");
  });

  it("waits for a choice before it can apply", () => {
    const onApply = vi.fn();
    renderStyle({ value: "", onApply });
    for (const radio of screen.getAllByRole("radio")) {
      expect(radio).toHaveAttribute("aria-checked", "false");
    }
    expect(screen.getByRole("radio", { name: /清楚白字/ })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: /底条字幕/ })).toHaveAttribute("tabindex", "-1");
    expect(screen.getByText("先在左边选一套样式。")).toBeInTheDocument();
    const apply = screen.getByRole("button", { name: "用这个样式" });
    expect(apply).toBeDisabled();
    fireEvent.click(apply);
    expect(onApply).not.toHaveBeenCalled();
  });

  it("draws an unknown style with the plain look and hides apply without a handler", () => {
    renderStyle({
      value: "mine",
      styles: [{ id: "mine", name: "我的样式", description: "自己调的" }],
    });
    expect(screen.getByTestId("wide-line")).toHaveClass("nx-look-clear");
    expect(screen.getByText("1 套")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "用这个样式" })).toBeNull();
  });
});

describe("wrapLine", () => {
  it("keeps short lines whole", () => {
    expect(wrapLine("你是谁？", 12)).toEqual(["你是谁？"]);
  });

  it("breaks after punctuation and splits long runs", () => {
    expect(wrapLine(LINE, 12)).toEqual(["你来晚了。这家店，", "下个月就没了。"]);
    expect(wrapLine("一二三四五六七八九十", 4)).toEqual(["一二三四", "五六七八", "九十"]);
    expect(wrapLine("好", 0)).toEqual(["好"]);
    expect(wrapLine("", 12)).toEqual([]);
  });
});

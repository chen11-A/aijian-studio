import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MouseSelect, Select } from "./Select";

afterEach(() => cleanup());

describe("mouse select", () => {
  it("keeps the clicked option instead of leaving the value unchanged", () => {
    const onChange = vi.fn();
    render(
      <MouseSelect aria-label="文本模型" value="" onChange={onChange}>
        <option value="">未选择</option>
        <option value="grok-4.3">Grok 4.3</option>
        <option value="grok-4.5">Grok 4.5</option>
      </MouseSelect>,
    );
    fireEvent.click(screen.getByRole("combobox", { name: "文本模型" }));
    const option = screen.getByRole("option", { name: "Grok 4.3" });
    fireEvent.pointerDown(option);
    fireEvent.mouseDown(option);
    fireEvent.click(option);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0].target.value).toBe("grok-4.3");
    expect(screen.queryByRole("option", { name: "Grok 4.3" })).not.toBeInTheDocument();
  });

  it("closes on escape and an outside press, and skips a disabled option", () => {
    const onChange = vi.fn();
    render(
      <div>
        <button type="button">外面</button>
        <MouseSelect aria-label="文本模型" defaultValue="grok-4.3" onChange={onChange}>
          <option value="grok-4.3">Grok 4.3</option>
          <option value="grok-4.5" disabled>
            Grok 4.5
          </option>
          <option value="grok-4.6">Grok 4.6</option>
        </MouseSelect>
      </div>,
    );
    const combo = screen.getByRole("combobox", { name: "文本模型" });
    fireEvent.click(combo);
    fireEvent.keyDown(combo, { key: "ArrowDown" });
    fireEvent.keyDown(combo, { key: " " });
    expect(onChange.mock.calls.at(-1)?.[0].target.value).toBe("grok-4.6");
    fireEvent.click(combo);
    fireEvent.keyDown(combo, { key: "Escape" });
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    fireEvent.click(combo);
    fireEvent.pointerDown(screen.getByRole("button", { name: "外面" }));
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    const stray = new Event("pointerdown", { bubbles: true });
    Object.defineProperty(stray, "target", { configurable: true, value: "不是节点" });
    document.dispatchEvent(stray);
    fireEvent.click(combo);
    fireEvent.click(screen.getByRole("option", { name: "Grok 4.5" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(combo, { key: "ArrowUp" });
    fireEvent.keyDown(combo, { key: "Enter" });
    expect(onChange.mock.calls.at(-1)?.[0].target.value).toBe("grok-4.3");
  });

  it("ignores a disabled control and keeps a lifted menu inside a dialog", () => {
    const onChange = vi.fn();
    const original = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.classList.contains("mouse-select-face")) {
        return {
          top: 700,
          bottom: 740,
          left: 5000,
          right: 5120,
          width: 120,
          height: 40,
          x: 5000,
          y: 700,
          toJSON() {
            return {};
          },
        } as DOMRect;
      }
      return original.call(this);
    };
    render(
      <dialog open>
        <MouseSelect aria-label="剧集选择" disabled value="one" onChange={onChange}>
          <option value="one">第一集</option>
        </MouseSelect>
        <MouseSelect aria-label="分集" defaultValue="one" className="episode-select" name="episode">
          <option value="one">第一集</option>
          <option value="two">第二集</option>
        </MouseSelect>
      </dialog>,
    );
    const blocked = screen.getByRole("combobox", { name: "剧集选择" });
    fireEvent.click(blocked);
    fireEvent.keyDown(blocked, { key: "ArrowDown" });
    fireEvent.keyDown(blocked, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
    const combo = screen.getByRole("combobox", { name: "分集" });
    fireEvent.click(combo);
    const menu = document.querySelector("dialog .mouse-select-menu");
    expect(menu).toHaveClass("is-lifted");
    expect(menu?.parentElement?.tagName).toBe("DIALOG");
    fireEvent.scroll(window);
    window.dispatchEvent(new Event("resize"));
    fireEvent.click(screen.getByRole("option", { name: "第二集" }));
    expect(combo).toHaveTextContent("第二集");
    HTMLElement.prototype.getBoundingClientRect = original;
  });

  it("selects with the keyboard after the list is open", () => {
    const onChange = vi.fn();
    render(
      <label>
        配音
        <MouseSelect aria-label="配音" value="eve" onChange={onChange}>
          <option value="eve">eve</option>
          <option value="ara">ara</option>
        </MouseSelect>
      </label>,
    );
    const combo = screen.getByRole("combobox", { name: "配音" });
    fireEvent.keyDown(combo, { key: "ArrowUp" });
    fireEvent.keyDown(combo, { key: "ArrowDown" });
    fireEvent.keyDown(combo, { key: "Enter" });
    expect(onChange.mock.calls.at(-1)?.[0].target.value).toBe("ara");
  });

  it("reads nested labels, an unknown value, and the hidden field", () => {
    const onChange = vi.fn();
    render(
      <MouseSelect id="mixed" aria-labelledby="mixed-label" required onChange={onChange}>
        <>
          {false}
          跳过
          <option>{12}</option>
          <option value="joined">{["雾", "城"]}</option>
          <option value="inner">
            <span>内层</span>
          </option>
          <option value="odd">{Symbol("x") as unknown as string}</option>
          <option value="blank"></option>
        </>
      </MouseSelect>,
    );
    expect(screen.getByRole("combobox")).toHaveTextContent("12");
    const hidden = document.querySelector("select.sr-only");
    expect(hidden).toBeRequired();
    fireEvent.change(hidden as HTMLSelectElement, { target: { value: "blank" } });
    expect(onChange.mock.calls.at(-1)?.[0].target.value).toBe("blank");
    render(
      <MouseSelect aria-label="空列表" value="missing">
        <option value="only" disabled>
          只有停用项
        </option>
      </MouseSelect>,
    );
    const empty = screen.getByRole("combobox", { name: "空列表" });
    expect(empty).toHaveTextContent("只有停用项");
    fireEvent.click(empty);
    fireEvent.keyDown(empty, { key: "ArrowDown" });
    fireEvent.keyDown(empty, { key: "Enter" });
    fireEvent.keyDown(empty, { key: "ArrowUp" });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("keeps the native select while tests run", () => {
    const onChange = vi.fn();
    render(
      <Select aria-label="原生" defaultValue="a" onChange={onChange}>
        <option value="a">A</option>
        <option value="b">B</option>
      </Select>,
    );
    fireEvent.change(screen.getByRole("combobox", { name: "原生" }), { target: { value: "b" } });
    expect(onChange.mock.calls.at(-1)?.[0].target.value).toBe("b");
  });
});

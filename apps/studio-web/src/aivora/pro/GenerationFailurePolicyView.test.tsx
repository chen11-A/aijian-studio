import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GenerationFailurePolicyView } from "./GenerationFailurePolicyView";

describe("generation failure policy review", () => {
  it("has no default and submits explicit zero while rejecting fractional or unbounded input", () => {
    const save = vi.fn();
    render(
      <GenerationFailurePolicyView
        state={{ kind: "ready", limit: null }}
        busy={false}
        onSave={save}
        onRefresh={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const input = screen.getByRole("textbox", { name: "新的上限（整数 0–1000）" });
    expect(input).toHaveValue("");
    const submit = screen.getByRole("button", { name: "保存上限" });
    for (const value of ["", "-1", "1.5", "1e2", "1001", "Infinity"]) {
      fireEvent.change(input, { target: { value } });
      fireEvent.click(submit);
      expect(save).not.toHaveBeenCalled();
      expect(screen.getByRole("alert")).toHaveTextContent("请输入 0 到 1000 的整数。");
    }
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.click(submit);
    expect(save).toHaveBeenCalledExactlyOnceWith(0);
  });

  it("preserves a user draft after a conflict read and requires another explicit submission", () => {
    const save = vi.fn(),
      refresh = vi.fn(),
      close = vi.fn();
    const props = { busy: false, onSave: save, onRefresh: refresh, onClose: close };
    const view = render(
      <GenerationFailurePolicyView {...props} state={{ kind: "ready", limit: 4 }} />,
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "7" } });
    view.rerender(
      <GenerationFailurePolicyView
        {...props}
        state={{ kind: "ready", limit: 5, message: "设置已变化，请核对后再次提交。" }}
      />,
    );
    expect(screen.getByRole("textbox")).toHaveValue("7");
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "保存上限" }));
    expect(save).toHaveBeenCalledExactlyOnceWith(7);
    view.rerender(
      <GenerationFailurePolicyView {...props} busy state={{ kind: "ready", limit: 5 }} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "正在保存…" }));
    expect(save).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(close).toHaveBeenCalledOnce();
  });

  it("cannot save without a confirmed policy read", () => {
    const save = vi.fn();
    const props = { busy: false, onSave: save, onRefresh: vi.fn(), onClose: vi.fn() };
    const view = render(
      <GenerationFailurePolicyView
        {...props}
        state={{ kind: "error", message: "保存结果尚未确认，请重新核对。" }}
      />,
    );
    expect(screen.queryByRole("button", { name: "保存上限" })).not.toBeInTheDocument();
    view.rerender(<GenerationFailurePolicyView {...props} state={{ kind: "unsupported" }} />);
    expect(screen.getByRole("button", { name: "重新核对" })).toBeDisabled();
    expect(save).not.toHaveBeenCalled();
  });
});

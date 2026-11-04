import { Component, useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkbenchRenderBoundary } from "./WorkbenchRenderBoundary";

const journalKey = "aivora.test.render-recovery-journal";

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.removeItem(journalKey);
});

function EditingChild() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>编辑次数：{count}</button>;
}

function ThrowDuringRender({ error }: { error: Error }): never {
  throw error;
}

class ThrowDuringMount extends Component<{ error: Error }> {
  componentDidMount() {
    throw this.props.error;
  }

  render() {
    return <div>即将挂载</div>;
  }
}

function expectOnlyCaughtError(expectedError: Error) {
  return vi.fn((error: unknown) => {
    // Keep unrelated root failures visible rather than suppressing console errors.
    if (error !== expectedError) throw error;
  });
}

describe("workbench render recovery boundary", () => {
  it("renders ordinary children unchanged and preserves their interactions", () => {
    const reload = vi.fn();
    const { container } = render(
      <WorkbenchRenderBoundary onReload={reload}>
        <EditingChild />
      </WorkbenchRenderBoundary>,
    );

    expect(container.childElementCount).toBe(1);
    expect(container.firstElementChild?.tagName).toBe("BUTTON");
    fireEvent.click(screen.getByRole("button", { name: "编辑次数：0" }));
    expect(screen.getByRole("button", { name: "编辑次数：1" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
  });

  it("shows a bounded fallback without exposing the exception or changing recovery journals", () => {
    const journal = JSON.stringify({ pending: "synthetic-save", confirmed: false });
    window.localStorage.setItem(journalKey, journal);
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");
    const clear = vi.spyOn(Storage.prototype, "clear");
    const fetch = vi.spyOn(globalThis, "fetch");
    const reload = vi.fn();
    const error = new Error("synthetic-private-source / synthetic-provider-secret");
    const onCaughtError = expectOnlyCaughtError(error);

    const { container } = render(
      <WorkbenchRenderBoundary onReload={reload}>
        <ThrowDuringRender error={error} />
      </WorkbenchRenderBoundary>,
      { onCaughtError },
    );

    expect(onCaughtError).toHaveBeenCalledOnce();
    expect(screen.getByRole("alert")).toHaveTextContent("工作台显示遇到问题");
    expect(screen.getByText("界面标识：AIVORA-UI-001")).toBeInTheDocument();
    expect(screen.getByText(/如果刚刚进行了保存或确认，结果尚未核实/)).toBeInTheDocument();
    expect(screen.getByText(/重新加载可能丢失尚未保存的修改/)).toBeInTheDocument();
    expect(container).not.toHaveTextContent(error.message);
    expect(container).not.toHaveTextContent("synthetic-provider-secret");
    expect(reload).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(journalKey)).toBe(journal);
  });

  it("catches a descendant lifecycle exception", () => {
    const error = new Error("synthetic mount exception");
    const onCaughtError = expectOnlyCaughtError(error);
    const reload = vi.fn();
    render(
      <WorkbenchRenderBoundary onReload={reload}>
        <ThrowDuringMount error={error} />
      </WorkbenchRenderBoundary>,
      { onCaughtError },
    );

    expect(onCaughtError).toHaveBeenCalledOnce();
    expect(screen.getByRole("alert")).toHaveTextContent("工作台显示遇到问题");
    expect(screen.queryByText("即将挂载")).not.toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
  });

  it("catches a later render failure and remains bounded until a user requests reload", () => {
    const error = new Error("synthetic update exception");
    const onCaughtError = expectOnlyCaughtError(error);
    const reload = vi.fn();
    const { rerender } = render(
      <WorkbenchRenderBoundary onReload={reload}>
        <div>当前工作台</div>
      </WorkbenchRenderBoundary>,
      { onCaughtError },
    );

    rerender(
      <WorkbenchRenderBoundary onReload={reload}>
        <ThrowDuringRender error={error} />
      </WorkbenchRenderBoundary>,
    );
    expect(onCaughtError).toHaveBeenCalledOnce();
    expect(screen.queryByText("当前工作台")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();

    rerender(
      <WorkbenchRenderBoundary onReload={reload}>
        <div>不要自动重新挂载</div>
      </WorkbenchRenderBoundary>,
    );
    expect(screen.queryByText("不要自动重新挂载")).not.toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "重新加载工作台" }));
    expect(reload).toHaveBeenCalledExactlyOnceWith();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});

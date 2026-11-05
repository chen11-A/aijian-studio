import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HomeStart, type HomeStartProps } from "./HomeStart";

const setup = (over: Partial<HomeStartProps> = {}) => {
  const props: HomeStartProps = {
    connected: true,
    recent: [],
    onOneClick: vi.fn(),
    onImport: vi.fn(),
    onBlank: vi.fn(),
    onOpen: vi.fn(),
    onSignIn: vi.fn(),
    ...over,
  };
  render(<HomeStart {...props} />);
  return props;
};

describe("HomeStart", () => {
  it("starts one-click with the written idea and the chosen aspect", () => {
    const props = setup();
    const start = screen.getByRole("button", { name: "开始一键成片" });
    expect(start).toBeDisabled();
    fireEvent.change(screen.getByLabelText("一句话的想法"), {
      target: { value: "  雨夜，旧书店来了讨债的人。 " },
    });
    fireEvent.click(screen.getByRole("radio", { name: "竖屏 9:16" }));
    fireEvent.click(start);
    expect(props.onOneClick).toHaveBeenCalledWith("雨夜，旧书店来了讨债的人。", "9:16");
  });

  it("signs in first when there is no membership yet, and still allows a blank work", () => {
    const props = setup({ connected: false });
    const signIn = screen.getByRole("button", { name: "用 Grok 会员登录" });
    expect(signIn).toBeEnabled();
    fireEvent.click(signIn);
    expect(props.onSignIn).toHaveBeenCalled();
    expect(props.onOneClick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "新建作品" }));
    expect(props.onBlank).toHaveBeenCalledWith("16:9", undefined);
    fireEvent.click(screen.getByRole("button", { name: "导入小说…" }));
    expect(props.onImport).toHaveBeenCalledWith("16:9");
  });

  it("starts a blank work from a chosen story template", () => {
    const props = setup({ templates: ["雨夜巷战打斗", "旧书店"] });
    fireEvent.change(screen.getByLabelText("从模板开始"), { target: { value: "旧书店" } });
    fireEvent.click(screen.getByRole("button", { name: "新建作品" }));
    expect(props.onBlank).toHaveBeenCalledWith("16:9", "旧书店");
  });

  it("has a single primary button", () => {
    setup();
    expect(document.querySelectorAll(".nx-primary")).toHaveLength(1);
  });

  it("lists saved works and opens one", () => {
    const props = setup({
      recent: [
        { id: "a", title: "晚照书店", savedAt: "2026-11-04T12:03:00Z" },
        { id: "b", title: "", savedAt: "" },
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: /晚照书店/ }));
    expect(props.onOpen).toHaveBeenCalledWith("a");
    expect(screen.getByRole("button", { name: "还没起名" })).toBeInTheDocument();
  });

  it("shows the example only when there is one, and says what it holds", () => {
    setup();
    expect(screen.queryByRole("button", { name: "打开示例" })).toBeNull();
    const onSample = vi.fn();
    setup({ onSample });
    fireEvent.click(screen.getByRole("button", { name: "打开示例" }));
    expect(onSample).toHaveBeenCalled();
    expect(screen.getByText(/只有剧本和分镜，没有画面/)).toBeInTheDocument();
  });
});

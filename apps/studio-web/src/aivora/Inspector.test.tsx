import "@testing-library/jest-dom/vitest";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { DemoApp } from "./DemoApp";
import { createAivoraSampleFixture } from "./model";

afterEach(cleanup);
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});

describe("demo object inspector", () => {
  it("keeps shot edits isolated and AI context aligned through mode changes", () => {
    window.history.replaceState({}, "", "#storyboard");
    render(<DemoApp fixture={createAivoraSampleFixture()} />);
    fireEvent.click(screen.getByRole("button", { name: "专业模式" }));
    fireEvent.click(screen.getByRole("button", { name: "镜头 2 走进雨幕" }));
    fireEvent.change(screen.getByLabelText("镜头类型"), { target: { value: "特写 (ECU)" } });
    fireEvent.click(screen.getByRole("button", { name: "镜头 3 似曾相识" }));
    expect(screen.getByLabelText("镜头类型")).toHaveValue("近景 (CU)");
    fireEvent.click(screen.getByRole("button", { name: "镜头 2 走进雨幕" }));
    expect(screen.getByLabelText("镜头类型")).toHaveValue("特写 (ECU)");
    const ai = within(screen.getByRole("complementary", { name: "Aivora AI 助手" }));
    fireEvent.click(ai.getByRole("button", { name: "上下文" }));
    expect(ai.getByText("Shot 002 · 走进雨幕", { exact: true })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "普通模式" }));
    expect(screen.queryByRole("complementary", { name: "专业属性" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "专业模式" }));
    expect(screen.getByLabelText("镜头类型")).toHaveValue("特写 (ECU)");
  });

  it("rescales action timing without moving the active shot when its duration changes", () => {
    window.history.replaceState({}, "", "#storyboard");
    render(<DemoApp fixture={createAivoraSampleFixture()} />);
    fireEvent.click(screen.getByRole("button", { name: "专业模式" }));
    fireEvent.click(screen.getByRole("button", { name: "镜头 2 走进雨幕" }));
    fireEvent.change(screen.getByLabelText("属性镜头时长"), { target: { value: "8" } });
    expect(screen.getByRole("heading", { name: "Shot 002 · 走进雨幕" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /建立视线与人物位置/ })).toHaveTextContent(
      /0\.0\s*–\s*2\.0\s*s/,
    );
    expect(screen.getByRole("button", { name: /动作收束，保留短暂停顿/ })).toHaveTextContent(
      /5\.0\s*–\s*8\.0\s*s/,
    );
  });

  it("keeps character and reference-version changes bound to the selected shot", () => {
    window.history.replaceState({}, "", "#storyboard");
    render(<DemoApp fixture={createAivoraSampleFixture()} />);
    fireEvent.click(screen.getByRole("button", { name: "专业模式" }));
    fireEvent.click(screen.getByRole("button", { name: "镜头 2 走进雨幕" }));
    const inspector = within(screen.getByRole("complementary", { name: "专业属性" }));
    fireEvent.click(inspector.getByRole("button", { name: "参考" }));
    fireEvent.change(inspector.getByRole("combobox", { name: "关联角色" }), {
      target: { value: "2" },
    });
    fireEvent.change(inspector.getByRole("combobox", { name: "角色参考版本" }), {
      target: { value: "v1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "镜头 3 似曾相识" }));
    expect(inspector.getByRole("combobox", { name: "关联角色" })).toHaveValue("1");
    expect(inspector.getByRole("combobox", { name: "角色参考版本" })).toHaveValue("v4");
    fireEvent.click(screen.getByRole("button", { name: "镜头 2 走进雨幕" }));
    expect(inspector.getByRole("combobox", { name: "关联角色" })).toHaveValue("2");
    expect(inspector.getByRole("combobox", { name: "角色参考版本" })).toHaveValue("v1");
  });

  it.each(["姓名", "身份与职业"])(
    "invalidates a confirmed identity when %s is edited in the inspector",
    (label) => {
      window.history.replaceState({}, "", "#character");
      render(<DemoApp fixture={createAivoraSampleFixture()} />);
      fireEvent.click(screen.getByRole("button", { name: "确认角色造型" }));
      fireEvent.click(
        within(screen.getByRole("dialog")).getByRole("button", { name: "确认本集全部造型并继续" }),
      );
      fireEvent.click(screen.getByRole("button", { name: "角色详情" }));
      const details = within(screen.getByRole("dialog"));
      fireEvent.change(details.getByRole("combobox", { name: "当前角色" }), {
        target: { value: "1" },
      });
      fireEvent.click(details.getByRole("button", { name: "返回三视图" }));
      expect(screen.getByRole("button", { name: "角色已确认" })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "专业模式" }));
      const inspector = within(screen.getByRole("complementary", { name: "专业属性" }));
      fireEvent.click(inspector.getByRole("button", { name: "技术详情" }));
      fireEvent.change(inspector.getByRole("textbox", { name: label }), {
        target: { value: `${label}修改后的值` },
      });
      expect(screen.queryByRole("button", { name: "角色已确认" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "三视图样例" })).toBeInTheDocument();
    },
  );
});

import "@testing-library/jest-dom/vitest";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { SettingsPage } from "./SettingsPage";
import { EditorDialog } from "./Common";
import { createAivoraSampleFixture, DemoProvider, useDemo } from "./model";

afterEach(cleanup);

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});

function SettingsHarness() {
  const demo = useDemo();
  return (
    <>
      <SettingsPage />
      <EditorDialog />
      <button onClick={() => demo.setScenario("error")}>模拟演示保存错误</button>
      <button onClick={() => demo.setScenario("loading")}>模拟加载设置</button>
      <output aria-label="用户设置状态">{demo.value("userName", "陈")}</output>
      <output aria-label="用户设置通知">{demo.toast}</output>
      <output aria-label="用户设置页面">{demo.page}</output>
    </>
  );
}

describe("user settings draft", () => {
  it("keeps edits local until save and restores the applied value on cancel", () => {
    window.history.replaceState({}, "", "#settings");
    render(
      <DemoProvider>
        <SettingsHarness />
      </DemoProvider>,
    );

    const nickname = screen.getByRole("textbox", { name: "昵称" });
    expect(nickname).toHaveValue("陈");
    fireEvent.change(nickname, { target: { value: "临时昵称" } });
    expect(screen.getByText("有未保存的设置草稿")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(nickname).toHaveValue("陈");
    expect(screen.getByLabelText("用户设置状态")).toHaveTextContent("陈");

    fireEvent.change(nickname, { target: { value: "已保存昵称" } });
    fireEvent.click(screen.getByRole("button", { name: "保存用户设置" }));
    expect(screen.getByLabelText("用户设置状态")).toHaveTextContent("已保存昵称");
    expect(screen.getByText("已应用 · 仅本次演示")).toBeInTheDocument();
  });

  it("requires an explicit local confirmation before applying project format changes", () => {
    window.history.replaceState({}, "", "#projectSettings");
    render(
      <DemoProvider fixture={createAivoraSampleFixture()}>
        <SettingsPage />
        <EditorDialog />
      </DemoProvider>,
    );

    fireEvent.change(screen.getByRole("combobox", { name: "示例画幅" }), {
      target: { value: "9:16" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存项目设置" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("确认修改项目画幅或时基");
    fireEvent.click(screen.getByRole("button", { name: "保存演示设置" }));
    expect(screen.getByText("已应用 · 仅本次演示")).toBeInTheDocument();
  });
  it("keeps a user draft intact when the local save simulation reports an error", () => {
    window.history.replaceState({}, "", "#settings");
    render(
      <DemoProvider>
        <SettingsHarness />
      </DemoProvider>,
    );
    const nickname = screen.getByRole("textbox", { name: "昵称" });
    fireEvent.change(nickname, { target: { value: "待重试昵称" } });
    fireEvent.click(screen.getByRole("button", { name: "模拟演示保存错误" }));
    fireEvent.click(screen.getByRole("button", { name: "保存用户设置" }));
    expect(nickname).toHaveValue("待重试昵称");
    expect(screen.getByLabelText("用户设置状态")).toHaveTextContent("陈");
    expect(screen.getByLabelText("用户设置通知")).toHaveTextContent("演示保存错误，已保留当前草稿");
    fireEvent.click(screen.getByRole("button", { name: "重试演示" }));
    expect(nickname).toHaveValue("待重试昵称");
  });

  it("opens the privacy-only local cache action without claiming a persistent setting", () => {
    window.history.replaceState({}, "", "#settings");
    render(
      <DemoProvider>
        <SettingsHarness />
      </DemoProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "隐私" }));
    expect(screen.getByText(/无真实凭据、在线模型和项目持久化/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清理演示缓存" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("仅清理 AI 会话、附件引用与输入草稿");
    fireEvent.click(screen.getByRole("button", { name: "清理演示会话" }));
    expect(screen.getByLabelText("用户设置通知")).toHaveTextContent("演示会话已清理");
  });

  it("switches between visual and creation-default drafts without enabling the unavailable directory action", () => {
    window.history.replaceState({}, "", "#settings");
    render(
      <DemoProvider>
        <SettingsHarness />
      </DemoProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "外观" }));
    expect(screen.getByText("当前视觉母版使用深色工作台。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "创作默认值" }));
    const signature = screen.getByRole("textbox", { name: "创作签名" });
    fireEvent.change(signature, { target: { value: "仅本地草稿" } });
    expect(screen.getByRole("button", { name: "选择系统目录 · 未接入" })).toBeDisabled();
    expect(screen.getByText("有未保存的设置草稿")).toBeInTheDocument();
  });

  it("keeps a blank project title from entering the confirmation flow", () => {
    window.history.replaceState({}, "", "#projectSettings");
    render(
      <DemoProvider fixture={createAivoraSampleFixture()}>
        <SettingsHarness />
      </DemoProvider>,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "项目名称" }), {
      target: { value: "  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存项目设置" }));
    expect(screen.getByLabelText("用户设置通知")).toHaveTextContent("作品名称不能为空白");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps project episode and description in a local draft dialog before applying settings", async () => {
    window.history.replaceState({}, "", "#projectSettings");
    render(
      <DemoProvider fixture={createAivoraSampleFixture()}>
        <SettingsHarness />
      </DemoProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "剧集与项目说明" }));
    fireEvent.change(screen.getByLabelText("当前剧集"), { target: { value: "第 2 集 · 回声" } });
    fireEvent.change(screen.getByLabelText("项目说明"), { target: { value: "只更新演示草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("有未保存的设置草稿")).toBeInTheDocument();
  });

  it("asks to preserve a dirty local draft before returning to the project", () => {
    window.history.replaceState({}, "", "#settings");
    render(
      <DemoProvider fixture={createAivoraSampleFixture()}>
        <SettingsHarness />
      </DemoProvider>,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "昵称" }), {
      target: { value: "待返回草稿" },
    });
    fireEvent.click(screen.getByRole("button", { name: "返回项目" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("离开未保存的设置？");
    fireEvent.click(screen.getByRole("button", { name: "保留草稿并返回" }));
    expect(screen.getByLabelText("用户设置页面")).toHaveTextContent("project");
  });

  it("recovers the controlled settings loading state without applying a draft", () => {
    window.history.replaceState({}, "", "#settings");
    render(
      <DemoProvider>
        <SettingsHarness />
      </DemoProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "模拟加载设置" }));
    expect(document.querySelector(".v2-settings-state")).toHaveAttribute("aria-busy", "true");
    fireEvent.click(screen.getByRole("button", { name: "查看样例" }));
    expect(document.querySelector(".v2-settings-state")).toBeNull();
    expect(screen.getByRole("textbox", { name: "昵称" })).toHaveValue("陈");
  });

  it("rejects an unsupported avatar file before opening a local reader", () => {
    window.history.replaceState({}, "", "#settings");
    render(
      <DemoProvider>
        <SettingsHarness />
      </DemoProvider>,
    );
    const unsupported = new File(["not an image"], "portrait.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText("选择头像图片"), { target: { files: [unsupported] } });
    expect(screen.getByLabelText("用户设置通知")).toHaveTextContent(
      "请选择 2MB 内的 PNG、JPEG 或 WebP 图片",
    );
  });
});

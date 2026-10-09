import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DemoProvider } from "./model";
import { SettingsPage } from "./SettingsPage";
import { MediaPages } from "./MediaPages";
import { WorldPage } from "./WorldPage";
import type { AppPreferencesResponse } from "./adapters/appPreferences";

afterEach(() => {
  cleanup();
  delete window.aijian;
  localStorage.clear();
});

function preferences(revision: number, name: string): AppPreferencesResponse {
  return {
    request_id: "preferences",
    data: {
      saved: revision > 0,
      revision,
      user_name: name,
      display_bio: "",
      ui_language: "zh-CN",
      ui_theme: "dark-cinematic",
      created_at: revision > 0 ? "2026-09-14T00:00:00Z" : null,
      updated_at: revision > 0 ? "2026-09-14T00:00:00Z" : null,
    },
  };
}

describe("production routes without demo fixtures", () => {
  it("keeps preferences disabled when the native capability is unavailable", () => {
    window.history.replaceState({}, "", "#settings");
    render(
      <DemoProvider>
        <SettingsPage />
      </DemoProvider>,
    );
    expect(screen.getByText("当前桌面版本缺少用户偏好接口，无法读取或保存。")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "昵称" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存用户设置" })).toBeDisabled();
    expect(screen.queryByText("已应用 · 仅本次演示")).not.toBeInTheDocument();
  });

  it.each(["SAVED", "REMOTE_UNKNOWN"] as const)(
    "uses the native preference contract and handles %s without a demo save",
    async (kind) => {
      const initial = preferences(0, "");
      const saved = preferences(1, "本机用户");
      const getAppPreferences = vi.fn().mockResolvedValue({ kind: "FOUND", receipt: initial });
      const saveAppPreferences = vi.fn(async () => {
        if (kind === "SAVED") {
          getAppPreferences.mockResolvedValue({ kind: "FOUND", receipt: saved });
          return { kind, receipt: saved };
        }
        return { kind };
      });
      window.aijian = {
        health: vi.fn().mockResolvedValue({
          request_id: "health",
          data: { status: "ok", service: "aijian-api", version: "test" },
        }),
        listProjects: vi.fn().mockResolvedValue({ request_id: "projects", data: [] }),
        listProviderConnections: vi.fn().mockResolvedValue({ request_id: "connections", data: [] }),
        getAppPreferences,
        saveAppPreferences,
      } as unknown as Window["aijian"];
      window.history.replaceState({}, "", "#settings");
      render(
        <DemoProvider>
          <SettingsPage />
        </DemoProvider>,
      );
      const name = screen.getByRole("textbox", { name: "昵称" });
      await waitFor(() => expect(name).toBeEnabled());
      fireEvent.change(name, { target: { value: "本机用户" } });
      fireEvent.click(screen.getByRole("button", { name: "保存用户设置" }));
      await waitFor(() => expect(saveAppPreferences).toHaveBeenCalledOnce());
      expect(saveAppPreferences).toHaveBeenCalledWith({
        expected_revision: 0,
        user_name: "本机用户",
        display_bio: "",
        ui_language: "zh-CN",
        ui_theme: "dark-cinematic",
      });
      if (kind === "SAVED") {
        expect(await screen.findByText("设置已保存并从本地工作区读回。")).toBeInTheDocument();
        // The model and the settings page both read initially; saving adds one readback.
        expect(getAppPreferences).toHaveBeenCalledTimes(3);
      } else {
        expect(await screen.findByText("上次保存结果未知，不会自动重复提交。")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "保存用户设置" }));
        expect(saveAppPreferences).toHaveBeenCalledOnce();
        expect(getAppPreferences).toHaveBeenCalledTimes(2);
      }
      expect(name).toHaveValue("本机用户");
      expect(screen.getByRole("button", { name: "保存用户设置" })).toBeDisabled();
    },
  );

  it("does not expose a fixture timeline without a selected real episode", () => {
    window.history.replaceState({}, "", "#assembly");
    render(
      <DemoProvider>
        <MediaPages />
      </DemoProvider>,
    );
    expect(
      screen.getByText("请先在项目页选择真实项目和剧集，再读取该集的媒体装配。"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("slider", { name: "预演位置" })).not.toBeInTheDocument();
  });

  it.each([
    ["review", "草稿审片与手工核对"],
    ["changes", "版本化修改方案待接入"],
  ])("keeps %s separate from legacy fixture execution", (page, heading) => {
    window.history.replaceState({}, "", `#${page}`);
    render(
      <DemoProvider>
        <MediaPages />
      </DemoProvider>,
    );
    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "确认并执行" })).not.toBeInTheDocument();
    expect(screen.queryByRole("slider", { name: "审片时间轴" })).not.toBeInTheDocument();
  });

  it("does not expose demo world confirmation on the production route", () => {
    window.history.replaceState({}, "", "#world");
    render(
      <DemoProvider>
        <WorldPage />
      </DemoProvider>,
    );
    expect(screen.getByRole("heading", { name: "世界观" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "确认世界观" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "详细设定" })).not.toBeInTheDocument();
  });
});

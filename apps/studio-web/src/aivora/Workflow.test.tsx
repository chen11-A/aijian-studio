import "@testing-library/jest-dom/vitest";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DemoApp } from "./DemoApp";
import { createAivoraSampleFixture } from "./model";
afterEach(() => {
  cleanup();
  delete window.aijian;
});
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
function open(page: string) {
  window.history.replaceState({}, "", `#${page}`);
  render(<DemoApp fixture={createAivoraSampleFixture()} />);
}
const realProjectId = `prj_${"1".repeat(32)}`;
const realTimeline = {
  request_id: "timeline",
  data: {
    project_id: realProjectId,
    version_id: `ver_${"2".repeat(32)}`,
    content_hash: `sha256:${"3".repeat(64)}`,
    created_at: "2026-09-14T00:00:00Z",
    total_duration_frames: 84,
    timeline: {
      schema_version: 1,
      timeline_id: "episode-main",
      revision: 1,
      sequence_timebase: { frame_rate: { num: 24, den: 1 }, timecode_mode: "NON_DROP_FRAME" },
      width: 1080,
      height: 1920,
      assets: [
        {
          schema_version: 1,
          asset_id: "asset-a",
          source_asset_sha256: `sha256:${"4".repeat(64)}`,
          source_frame_count: 120,
          proxy: null,
        },
      ],
      clips: [
        {
          schema_version: 1,
          clip_id: "clip-a",
          asset_id: "asset-a",
          source_in_frame: 0,
          duration_frames: 84,
        },
      ],
    },
  },
};
function connectRealTimeline() {
  window.aijian = {
    health: vi.fn().mockResolvedValue({ status: "ok" }),
    listProjects: vi.fn().mockResolvedValue({
      request_id: "projects",
      data: [
        {
          id: realProjectId,
          name: "真实项目",
          status: "active",
          revision: 1,
          updated_at: "2026-09-14T00:00:00Z",
        },
      ],
    }),
    listSources: vi.fn().mockResolvedValue({ request_id: "sources", data: [] }),
    listProviderConnections: vi.fn().mockResolvedValue({ request_id: "providers", data: [] }),
    getProjectTimeline: vi.fn().mockResolvedValue(realTimeline),
  } as unknown as Window["aijian"];
}
describe("demo workflow state", () => {
  it("requires an explicit group review and keeps outfits isolated between characters", async () => {
    open("character");
    const groupConfirm = screen.getByRole("button", { name: "确认角色造型" });
    expect(groupConfirm).toBeEnabled();
    fireEvent.click(groupConfirm);
    let dialog = within(screen.getByRole("dialog"));
    for (const name of ["雨夜调查", "日常职业装", "医院工作服", "居家服"])
      expect(dialog.getByText(new RegExp(name))).toBeInTheDocument();
    expect(dialog.getByText(/正面、侧面、背面已齐备/)).toBeInTheDocument();
    fireEvent.click(dialog.getByRole("button", { name: "关闭" }));
    expect(screen.getByRole("heading", { name: "苏晚" })).toBeInTheDocument();
    fireEvent.click(groupConfirm);
    dialog = within(screen.getByRole("dialog"));
    fireEvent.click(dialog.getByRole("button", { name: "确认本集全部造型并继续" }));
    expect(screen.getByRole("heading", { name: "程野" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认角色造型" })).toBeEnabled();
    expect(screen.getByText("缺少侧面参考")).toBeInTheDocument();
    expect(screen.getByText("缺少背面参考")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认角色造型" }));
    dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByRole("button", { name: "确认本集全部造型并继续" })).toBeDisabled();
    fireEvent.click(dialog.getByRole("button", { name: "关闭" }));

    fireEvent.click(screen.getByRole("button", { name: "角色详情" }));
    dialog = within(screen.getByRole("dialog"));
    fireEvent.click(dialog.getByRole("button", { name: "造型" }));
    fireEvent.click(dialog.getByRole("button", { name: "新增造型" }));
    fireEvent.change(screen.getByLabelText("造型名称"), { target: { value: "程野的新外套" } });
    fireEvent.click(screen.getByRole("button", { name: "保存演示修改" }));
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "新增本集造型" })).not.toBeInTheDocument(),
    );
    expect(screen.getByText("程野的新外套")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认角色造型" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "角色详情" }));
    dialog = within(screen.getByRole("dialog"));
    fireEvent.change(dialog.getByRole("combobox", { name: "当前角色" }), {
      target: { value: "1" },
    });
    fireEvent.click(dialog.getByRole("button", { name: "造型" }));
    expect(dialog.queryByText("程野的新外套")).not.toBeInTheDocument();
    expect(dialog.getAllByText("已确认", { exact: true })).toHaveLength(4);
    expect(dialog.getByRole("button", { name: "撤回造型确认" })).toBeInTheDocument();

    fireEvent.click(dialog.getByRole("button", { name: "编辑当前造型" }));
    fireEvent.change(screen.getByLabelText("造型名称"), {
      target: { value: "苏晚修改后的雨夜造型" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存演示修改" }));
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "编辑本集造型" })).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: "角色已确认" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "角色详情" }));
    dialog = within(screen.getByRole("dialog"));
    expect(dialog.getAllByText("已确认", { exact: true })).toHaveLength(3);
    expect(dialog.getByRole("button", { name: "确认当前造型" })).toBeInTheDocument();
  });
  it("isolates scene environments and invalidates only the scene edited after group confirmation", async () => {
    open("scenes");
    fireEvent.change(screen.getByRole("combobox", { name: "环境状态" }), {
      target: { value: "雾天" },
    });
    fireEvent.change(screen.getByLabelText("当前地点"), { target: { value: "2" } });
    expect(screen.getByRole("combobox", { name: "环境状态" })).toHaveValue("白天");
    fireEvent.change(screen.getByLabelText("当前地点"), { target: { value: "1" } });
    expect(screen.getByRole("combobox", { name: "环境状态" })).toHaveValue("雾天");
    fireEvent.click(screen.getByRole("button", { name: "确认场景并进入分镜" }));
    let dialog = within(screen.getByRole("dialog"));
    for (const name of ["雨夜街道", "记忆修复中心", "滨海城区"])
      expect(dialog.getByText(new RegExp(name))).toBeInTheDocument();
    expect(dialog.getByText(/雾天/)).toBeInTheDocument();
    fireEvent.click(dialog.getByRole("button", { name: "确认全部场景并进入分镜" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(window.location.hash).toBe("#storyboard");
    fireEvent.click(within(screen.getByLabelText("主导航")).getByRole("button", { name: "场景" }));
    fireEvent.click(screen.getByRole("button", { name: "空间设定" }));
    dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByRole("combobox", { name: "当前场景确认" })).toHaveValue("已确认");
    fireEvent.click(dialog.getByRole("button", { name: "关闭" }));
    fireEvent.change(screen.getByRole("combobox", { name: "环境状态" }), {
      target: { value: "夜 · 晴" },
    });
    fireEvent.click(screen.getByRole("button", { name: "空间设定" }));
    dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByRole("combobox", { name: "当前场景确认" })).toHaveValue("待确认");
    fireEvent.click(dialog.getByRole("button", { name: "关闭" }));
    fireEvent.change(screen.getByRole("combobox", { name: "当前地点" }), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "空间设定" }));
    expect(
      within(screen.getByRole("dialog")).getByRole("combobox", { name: "当前场景确认" }),
    ).toHaveValue("已确认");
  });
  it("preserves separate AI drafts across pages and dock tabs", () => {
    open("storyboard");
    fireEvent.change(screen.getByLabelText("AI 输入"), { target: { value: "镜头草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "专业模式" }));
    fireEvent.click(screen.getByRole("tab", { name: "Aivora AI" }));
    expect(screen.getByLabelText("AI 输入")).toHaveValue("镜头草稿");
    fireEvent.click(
      within(screen.getByLabelText("主导航")).getByRole("button", { name: "世界观" }),
    );
    expect(screen.getByLabelText("AI 输入")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("AI 输入"), { target: { value: "世界观草稿" } });
    fireEvent.click(within(screen.getByLabelText("主导航")).getByRole("button", { name: "分镜" }));
    expect(screen.getByLabelText("AI 输入")).toHaveValue("镜头草稿");
    expect(screen.getByRole("tab", { name: "Aivora AI" })).toHaveAttribute("aria-selected", "true");
  });
  it("does not invent assembly tracks without a real timeline and never invents execution", () => {
    open("assembly");
    expect(screen.queryByText("A3 环境")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "专业模式" }));
    for (const name of ["V1 画面", "A1 对白", "A2 音乐", "A3 环境", "S1 字幕"])
      expect(screen.queryByText(name)).not.toBeInTheDocument();
    expect(screen.getByText("尚未连接本地项目，无法读取真实时间线。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "进入审片" }));
    fireEvent.click(screen.getByRole("button", { name: "审核完成 · 查看修改方案" }));
    expect(screen.getByRole("button", { name: "确认并执行" })).toBeDisabled();
  });
  it("shows five professional tracks only after a real timeline is loaded, without inventing them from fixture shots", async () => {
    connectRealTimeline();
    open("assembly");
    await screen.findByText("修订版 1");
    expect(screen.queryByText("V1 画面")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "专业模式" }));
    await waitFor(() => expect(screen.getByText("V1 画面")).toBeInTheDocument());
    for (const name of ["A1 对白", "A2 音乐", "A3 环境", "S1 字幕"])
      expect(screen.getByText(name)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "V1 画面镜头 1 clip-a" })).toBeInTheDocument();
    expect(screen.getByText("A3 环境轨尚未接入真实素材")).toBeInTheDocument();
  });
});

import type { AijianDesktopBridge } from "../api/studio";
import type { MediaToolchainSelectResult } from "./mediaToolchainContract";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MediaToolchainSettings } from "./MediaToolchainSettings";
import { useMediaToolchain } from "./useMediaToolchain";
import type { MediaToolchainGateway, MediaToolchainStatus } from "./mediaToolchainContract";

const available: MediaToolchainStatus = {
  schema_version: 1,
  state: "AVAILABLE",
  source: "EXTERNAL",
  directory: "C:\\Media Tools\\bin",
  profile_id: "windows-x86_64-gyan-full-8.1.2-dev",
  version: "8.1.2",
  diagnostic: "Verified locally",
  can_probe: true,
  can_preview: true,
  can_draft_export: true,
  formal_release_approved: false,
};
const absent: MediaToolchainStatus = {
  ...available,
  state: "NOT_CONFIGURED",
  source: "NONE",
  directory: null,
  profile_id: null,
  version: null,
  diagnostic: "No external configuration",
  can_probe: false,
  can_preview: false,
  can_draft_export: false,
};
function gateway(initial = absent) {
  let saved = initial;
  return {
    getMediaToolchainStatus: vi.fn<MediaToolchainGateway["getMediaToolchainStatus"]>(async () => ({
      kind: "STATUS",
      status: saved,
    })),
    selectMediaToolchain: vi.fn<MediaToolchainGateway["selectMediaToolchain"]>(async () => {
      saved = available;
      return { kind: "STATUS", status: saved };
    }),
    clearMediaToolchain: vi.fn<MediaToolchainGateway["clearMediaToolchain"]>(async () => {
      saved = absent;
      return { kind: "STATUS", status: saved };
    }),
  };
}
function Consumer({ gateway }: { gateway: MediaToolchainGateway }) {
  const tools = useMediaToolchain(gateway);
  return (
    <>
      <button disabled={!tools.canProbe}>探测测试</button>
      <button disabled={!tools.canPreview}>连续预览测试</button>
      <button disabled={!tools.canDraftExport}>草稿导出测试</button>
    </>
  );
}
const select = () => screen.getByRole("button", { name: "选择媒体工具文件夹" });
const refresh = () => screen.getByRole("button", { name: "重新读取媒体工具状态" });
const clear = () => screen.getByRole("button", { name: "移除外部工具配置" });

afterEach(() => {
  cleanup();
  delete window.aijian;
  vi.restoreAllMocks();
});

describe("explicit local media tools settings", () => {
  it.each([
    ["DEVELOPMENT_OVERRIDE", "开发环境指定工具"],
    ["DEVELOPMENT_LOCAL", "开发环境本地工具"],
    ["BUNDLED", "随包工具"],
  ] as const)("labels %s from verified runtime status precisely", async (source, label) => {
    const native = gateway({
      ...available,
      source,
      profile_id: "admitted-existing-tools",
      version: "7.1.1",
    });
    render(<MediaToolchainSettings gateway={native} />);
    await screen.findByText(`来源：${label}`);
    expect(screen.getByText(`${label}已核验 · 仅供 DRAFT`)).toBeInTheDocument();
    expect(clear()).toBeDisabled();
    expect(native.selectMediaToolchain).not.toHaveBeenCalled();
  });

  it("requires an explicit native folder choice and updates all capability consumers on removal", async () => {
    const native = gateway();
    render(
      <>
        <MediaToolchainSettings gateway={native} />
        <Consumer gateway={native} />
      </>,
    );
    await waitFor(() => expect(select()).toBeEnabled());
    expect(native.selectMediaToolchain).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "草稿导出测试" })).toBeDisabled();
    fireEvent.click(select());
    await screen.findByText("已验证外部媒体工具 · 仅供本地 DRAFT");
    expect(native.selectMediaToolchain).toHaveBeenCalledExactlyOnceWith();
    expect(screen.getByText(/不代表正式发布批准/)).toBeInTheDocument();
    for (const name of ["探测测试", "连续预览测试", "草稿导出测试"])
      expect(screen.getByRole("button", { name })).toBeEnabled();
    fireEvent.click(clear());
    await screen.findByText(/尚未配置媒体工具/);
    expect(native.clearMediaToolchain).toHaveBeenCalledExactlyOnceWith();
    for (const name of ["探测测试", "连续预览测试", "草稿导出测试"])
      expect(screen.getByRole("button", { name })).toBeDisabled();
  });
  it("locks unknown outcomes until a verified read and never automatically repeats the action", async () => {
    const native = gateway();
    render(<MediaToolchainSettings gateway={native} />);
    await waitFor(() => expect(select()).toBeEnabled());
    native.selectMediaToolchain.mockResolvedValue({ kind: "REMOTE_UNKNOWN" });
    native.getMediaToolchainStatus.mockResolvedValue({ kind: "REMOTE_UNKNOWN" });
    fireEvent.click(select());
    await screen.findByText(/媒体工具状态未核实；/);
    expect(select()).toBeDisabled();
    expect(clear()).toBeDisabled();
    expect(refresh()).toBeEnabled();
    native.getMediaToolchainStatus.mockResolvedValue({ kind: "STATUS", status: available });
    fireEvent.click(refresh());
    await waitFor(() => expect(select()).toBeEnabled());
    expect(native.selectMediaToolchain).toHaveBeenCalledTimes(1);
  });
  it("keeps cancelled selection separate from success and rechecks existing configuration", async () => {
    const native = gateway(available);
    native.selectMediaToolchain.mockResolvedValue({ kind: "PICKER_CANCELLED" });
    render(<MediaToolchainSettings gateway={native} />);
    await waitFor(() => expect(select()).toBeEnabled());
    fireEvent.click(select());
    await screen.findByText("已取消选择，现有配置已重新读取。");
    expect(native.selectMediaToolchain).toHaveBeenCalledTimes(1);
    expect(native.getMediaToolchainStatus).toHaveBeenCalledTimes(2);
    expect(clear()).toBeEnabled();
  });
  it("does not infer capability from methods, rejects unsupported platforms, and keeps refresh available", async () => {
    const native = gateway({ ...absent, state: "UNSUPPORTED", diagnostic: "Windows only" });
    render(
      <>
        <MediaToolchainSettings gateway={native} />
        <Consumer gateway={native} />
      </>,
    );
    await screen.findByText(/此环境不支持选择外部媒体工具/);
    expect(select()).toBeDisabled();
    expect(clear()).toBeDisabled();
    expect(refresh()).toBeEnabled();
    expect(screen.getByRole("button", { name: "草稿导出测试" })).toBeDisabled();
  });
  it("shows desktop-required state without fallback downloads or browser writes", async () => {
    render(<MediaToolchainSettings />);
    await screen.findByText(/当前环境无法读取本机媒体工具能力/);
    expect(select()).toBeDisabled();
    expect(clear()).toBeDisabled();
    expect(refresh()).toBeDisabled();
  });
  it("refreshes on re-entry and focus so a changed tool cannot retain an old available status", async () => {
    const native = gateway(available);
    const view = render(<MediaToolchainSettings gateway={native} />);
    await screen.findByText("已验证外部媒体工具 · 仅供本地 DRAFT");
    native.getMediaToolchainStatus.mockResolvedValue({
      kind: "STATUS",
      status: { ...absent, state: "INVALID", diagnostic: "File changed" },
    });
    fireEvent.focus(window);
    await screen.findByText("File changed");
    view.unmount();
    native.getMediaToolchainStatus.mockResolvedValue({ kind: "STATUS", status: absent });
    render(<MediaToolchainSettings gateway={native} />);
    await screen.findByText(/尚未配置媒体工具/);
    expect(native.getMediaToolchainStatus).toHaveBeenCalledTimes(3);
  });
});

describe("settings card native selection lifecycle", () => {
  it("cancels its active native selection on view departure and never adopts a late picker response", async () => {
    let finish!: (value: MediaToolchainSelectResult) => void;
    const native = {
      ...gateway(),
      cancelMediaToolchainSelection: vi.fn().mockResolvedValue({ kind: "CANCELLED" }),
    };
    native.selectMediaToolchain.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    window.aijian = native as unknown as AijianDesktopBridge;
    const view = render(<MediaToolchainSettings />);
    await waitFor(() => expect(select()).toBeEnabled());
    fireEvent.click(select());
    await waitFor(() => expect(native.selectMediaToolchain).toHaveBeenCalledTimes(1));
    view.unmount();
    await waitFor(() =>
      expect(native.cancelMediaToolchainSelection).toHaveBeenCalledExactlyOnceWith(),
    );
    render(<MediaToolchainSettings />);
    expect(select()).toBeDisabled();
    await act(async () => {
      finish({ kind: "STATUS", status: available });
    });
    await screen.findByText(/尚未配置媒体工具/);
    expect(screen.queryByText("已验证外部媒体工具 · 仅供本地 DRAFT")).not.toBeInTheDocument();
    expect(native.selectMediaToolchain).toHaveBeenCalledTimes(1);
  });
});

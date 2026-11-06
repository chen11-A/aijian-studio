import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ExportProgress,
  type ExportPhase,
  type ExportProgressMeasure,
  type ExportProgressProps,
} from "./ExportProgress";

const base: ExportProgressProps = {
  operationKey: "internal-operation-do-not-render",
  phase: "rendering",
  cancelState: "available",
};
function show(props: Partial<ExportProgressProps> = {}) {
  const onRequestCancel = vi.fn();
  const view = render(<ExportProgress {...base} onRequestCancel={onRequestCancel} {...props} />);
  return { ...view, onRequestCancel };
}

describe("ExportProgress", () => {
  it("shows actual completed work for the current phase without an overall percentage or ETA", () => {
    show({ progress: { kind: "units", completed: 2, total: 3, unit: "画幅" } });
    const meter = screen.getByRole("progressbar", { name: "本阶段进度" });
    expect(meter).toHaveAttribute("value", "2");
    expect(meter).toHaveAttribute("max", "3");
    expect(screen.getByText("本阶段已完成 2 / 3 个画幅")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/整体|剩余.*秒|预计|67%/);
  });

  it("shows a measured FFmpeg time ratio for this phase", () => {
    show({ progress: { kind: "media-time", outTimeSeconds: 7.5, durationSeconds: 30 } });
    expect(screen.getByText("本阶段 25%")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "7.5");
    expect(screen.getByRole("progressbar")).toHaveAttribute("max", "30");
  });

  it.each([
    undefined,
    { kind: "units", completed: NaN, total: 4, unit: "镜头" },
    { kind: "units", completed: 1, total: Infinity, unit: "镜头" },
    { kind: "units", completed: 1, total: 0, unit: "镜头" },
    { kind: "units", completed: 1, total: -1, unit: "镜头" },
    { kind: "units", completed: -1, total: 3, unit: "镜头" },
    { kind: "units", completed: 4, total: 3, unit: "镜头" },
    { kind: "units", completed: 0.5, total: 3, unit: "镜头" },
    { kind: "units", completed: 1, total: 3.5, unit: "镜头" },
    { kind: "units", completed: 0, total: Number.MAX_SAFE_INTEGER + 1, unit: "镜头" },
    { kind: "units", completed: 1, total: 3, unit: "/private/file" },
    { kind: "media-time", outTimeSeconds: Infinity, durationSeconds: 30 },
    { kind: "media-time", outTimeSeconds: 1, durationSeconds: NaN },
    { kind: "media-time", outTimeSeconds: 1, durationSeconds: 0 },
    { kind: "media-time", outTimeSeconds: -1, durationSeconds: 30 },
    { kind: "media-time", outTimeSeconds: 31, durationSeconds: 30 },
    { kind: "unknown", outTimeSeconds: 15, durationSeconds: 30 },
  ])("keeps unavailable or invalid progress indeterminate: %j", (progress) => {
    show({ progress: progress as ExportProgressMeasure | undefined });
    expect(screen.getByRole("progressbar")).not.toHaveAttribute("value");
    expect(screen.getByText("暂时没有可用的进度数值。")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/NaN|Infinity|%|private/);
  });

  it("accepts actual zero and exact stage completion without claiming the export ended", () => {
    const { rerender } = show({
      progress: { kind: "units", completed: 0, total: 2, unit: "镜头" },
    });
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "0");
    rerender(
      <ExportProgress
        {...base}
        phase="checking"
        progress={{ kind: "media-time", outTimeSeconds: 30, durationSeconds: 30 }}
      />,
    );
    expect(screen.getByText("本阶段 100%")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "正在进行技术检查" })).toBeInTheDocument();
    expect(screen.queryByText("本次发布结束")).toBeNull();
  });

  it("never turns a stage into fabricated time-based progress", () => {
    vi.useFakeTimers();
    try {
      show({ phase: "joining" });
      act(() => vi.advanceTimersByTime(120_000));
      expect(screen.getByRole("progressbar")).not.toHaveAttribute("value");
      expect(document.body.textContent).not.toContain("%");
    } finally {
      vi.useRealTimers();
    }
  });

  it("latches a stop request immediately, including rapid double clicks", async () => {
    const onRequestCancel = vi.fn().mockResolvedValue(undefined);
    show({ onRequestCancel });
    const button = screen.getByRole("button", { name: "停止处理" });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(onRequestCancel).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "正在请求停止" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("等待处理结束的确认");
    expect(screen.queryByRole("heading", { name: "处理已停止" })).toBeNull();
  });

  it("only shows stopped when the host confirms it, keeping published results", () => {
    const published = [{ aspectRatio: "16:9" as const, label: "第一部分" }];
    const { rerender } = show({ cancelState: "requested", published });
    expect(screen.getByRole("button", { name: "正在请求停止" })).toBeDisabled();
    rerender(<ExportProgress {...base} cancelState="stopped" published={published} />);
    expect(screen.getByRole("heading", { name: "处理已停止" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "已发布文件" })).toHaveTextContent("第一部分");
    expect(screen.getByRole("status")).toHaveTextContent("已发布的文件会保留");
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("treats rejected stop acknowledgements as unconfirmed without leaking the error", async () => {
    show({
      onRequestCancel: vi.fn().mockRejectedValue(new Error("token=secret /private/process")),
    });
    fireEvent.click(screen.getByRole("button", { name: "停止处理" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("停止请求未得到确认"));
    expect(screen.getByRole("button", { name: "正在请求停止" })).toBeDisabled();
    expect(document.body.textContent).not.toMatch(/secret|private|处理已停止/);
  });

  it("allows a new operation to request its own stop while late acknowledgements stay separate", async () => {
    let rejectOld!: (reason: Error) => void;
    const onRequestCancel = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectOld = reject;
          }),
      )
      .mockResolvedValue(undefined);
    const { rerender } = show({ onRequestCancel });
    fireEvent.click(screen.getByRole("button", { name: "停止处理" }));
    rerender(
      <ExportProgress {...base} operationKey="next-operation" onRequestCancel={onRequestCancel} />,
    );
    expect(screen.getByRole("button", { name: "停止处理" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "停止处理" }));
    await act(async () => rejectOld(new Error("old")));
    expect(onRequestCancel).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("status")).toHaveTextContent("等待处理结束的确认");
    expect(screen.getByRole("status")).not.toHaveTextContent("未得到确认");
  });

  it.each(["waitingReview", "completed", "partial", "failed", "unknown"] as const)(
    "does not expose process-stop or stale percentages in %s",
    (phase) => {
      const { onRequestCancel } = show({
        phase,
        progress: { kind: "media-time", outTimeSeconds: 30, durationSeconds: 30 },
      });
      expect(screen.queryByRole("button")).toBeNull();
      expect(screen.queryByRole("progressbar")).toBeNull();
      expect(document.body.textContent).not.toContain("100%");
      expect(onRequestCancel).not.toHaveBeenCalled();
    },
  );

  it("keeps waiting for review distinct from a completed export", () => {
    show({ phase: "waitingReview" });
    expect(screen.getByRole("status")).toHaveTextContent("请在检查清单中审核结果");
    expect(screen.queryByText("本次发布结束")).toBeNull();
  });

  it("requires an available host capability before offering stop", () => {
    const { rerender } = show({ cancelState: "unavailable" });
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("当前步骤无法停止，请等待结果。")).toBeInTheDocument();
    rerender(<ExportProgress {...base} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("lists actual partial outputs and leaves unknown outcomes to verification", () => {
    show({ phase: "partial", published: [{ aspectRatio: "9:16", label: "已保存的第一版" }] });
    const files = screen.getByRole("region", { name: "已发布文件" });
    expect(within(files).getAllByRole("listitem")).toHaveLength(1);
    expect(files).toHaveTextContent("竖屏 9:16");
    expect(screen.getByRole("status")).toHaveTextContent("其余部分未全部完成");
    expect(document.body.textContent).not.toMatch(/没有输出|全部取消|都失败/);
  });

  it("uses a safe unknown phase and hides internal execution identity and unsafe output labels", () => {
    const { container } = show({
      phase: "Error: /private/output" as ExportPhase,
      published: [
        { aspectRatio: "16:9", label: "C:\\private\\film.mp4" },
        { aspectRatio: "9:16", label: "token=secret" },
        { aspectRatio: "16:9", label: "film_0123456789abcdef" },
      ],
    });
    expect(screen.getByRole("heading", { name: "当前处理状态待确认" })).toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/private|secret|internal-operation|0123456789abcdef/);
    expect(screen.getByRole("status")).toHaveTextContent("无法确认处理结果");
  });

  it("bounds long user labels and renders markup as text without creating elements", () => {
    const { container } = show({
      phase: "completed",
      published: [
        { aspectRatio: "16:9", label: "<img onerror=alert(1)>" },
        { aspectRatio: "9:16", label: "长标题😀".repeat(200) },
      ],
    });
    expect(screen.getByText("<img onerror=alert(1)>")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("region", { name: "已发布文件" }).textContent!.length).toBeLessThan(
      350,
    );
    expect(screen.getByRole("status")).toHaveTextContent("实际播放和试听");
  });
});

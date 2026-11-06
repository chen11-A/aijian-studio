import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ExportCheck, type ExportCheckProps } from "./ExportCheck";
import { SAMPLE_QC_REPORT } from "./stories/sampleData";

const warnings = {
  ...SAMPLE_QC_REPORT,
  issues: SAMPLE_QC_REPORT.issues.filter((i) => i.severity === "warn"),
};
function show(props: Partial<ExportCheckProps> = {}) {
  const onExport = vi.fn();
  const onCancel = vi.fn();
  const onFix = vi.fn();
  const view = render(
    <ExportCheck
      reviewMode
      report={warnings}
      onExport={onExport}
      onCancel={onCancel}
      onFix={onFix}
      {...props}
    />,
  );
  return { ...view, onExport, onCancel, onFix };
}

describe("staged export review", () => {
  it("requires an explicit review click for warnings without changing severity", () => {
    const { onExport } = show();
    expect(screen.getByText(/警告仍需人工审阅/)).toBeInTheDocument();
    expect(onExport).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "审核后发布" }));
    expect(onExport).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "直接导出" })).toBeNull();
  });

  it.each([
    { report: SAMPLE_QC_REPORT },
    { publishBlocked: true },
    { checking: true },
    { busy: true },
    { stale: true },
    { report: null },
    { report: { schemaVersion: 99 } },
    { error: "Error: /private/project/key.json" },
  ])("does not publish invalid, blocked, stale or busy output: %j", (props) => {
    const { onExport } = show(props);
    const publish = screen.getByRole("button", { name: "审核后发布" });
    expect(publish).toBeDisabled();
    fireEvent.click(publish);
    expect(onExport).not.toHaveBeenCalled();
  });

  it("allows cancelling stale review and does not publish", () => {
    const { onCancel, onExport } = show({ stale: true });
    fireEvent.click(screen.getByRole("button", { name: "取消本次导出" }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onExport).not.toHaveBeenCalled();
  });

  it("does not claim cancellation or navigate to fixes while publication is busy", () => {
    const { onCancel, onFix } = show({ busy: true });
    expect(screen.getByRole("button", { name: "取消本次导出" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "取消本次导出" }));
    for (const button of screen.getAllByRole("button", { name: /^去修/ })) {
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    expect(onCancel).not.toHaveBeenCalled();
    expect(onFix).not.toHaveBeenCalled();
  });

  it("states technical scope and outstanding human checks even for a clean report", () => {
    show({
      report: { ...SAMPLE_QC_REPORT, issues: [] },
      unverified: ["字幕仅作布局估算，仍需观看成片。"],
    });
    expect(screen.getByText("本次技术检测未发现问题")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "仍需人工确认" })).toHaveTextContent(
      "不验证对白完整性",
    );
    expect(screen.getByText("字幕仅作布局估算，仍需观看成片。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "审核后发布" })).toBeEnabled();
  });

  it("does not display diagnostic paths, IDs, objects, stack or secrets in review", () => {
    const issue = {
      ...warnings.issues[0],
      id: "internal-private-id",
      message: "Error: /private/output.mp4",
      suggestion: "token=private-secret",
      timeLabel: "C:\\private\\output.mp4",
      detail: {
        durationSeconds: 3,
        arbitrary: { token: "private-secret" },
        layout: "/private/layout.json",
      },
    };
    const { container } = show({
      report: { ...warnings, issues: [issue], assumptions: { path: "/private/result.mp4" } },
      fileName: "/private/output.mp4",
      unverified: ["token=private-secret"],
    });
    expect(container.innerHTML).not.toMatch(/private|internal-private-id|Error:/);
    expect(screen.getByText("检测到需要核对的问题。")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("待发布成片")).toBeInTheDocument();
  });

  it("hides raw check failures and invalid schema reasons", () => {
    const { container } = show({ error: "Error: /private/output.mp4 token=secret" });
    expect(container.innerHTML).not.toMatch(/private|token=|Error:/);
    expect(screen.getByRole("alert")).toHaveTextContent("本次技术检查未完成");
  });
});

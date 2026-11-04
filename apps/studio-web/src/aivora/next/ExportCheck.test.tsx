import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ExportCheck, issueWhere } from "./ExportCheck";
import type { QcIssue } from "./qcReport";
import { SAMPLE_QC_REPORT, sampleShotSpans } from "./stories/sampleData";

const shots = sampleShotSpans();

function renderCheck(props: Partial<Parameters<typeof ExportCheck>[0]> = {}) {
  const onFix = vi.fn();
  const onExport = vi.fn();
  const view = render(
    <ExportCheck report={SAMPLE_QC_REPORT} onFix={onFix} onExport={onExport} {...props} />,
  );
  return { ...view, onFix, onExport };
}

describe("ExportCheck", () => {
  it("has one 去修 per issue and one 直接导出, and no other buttons", () => {
    renderCheck({ shots, fileName: "雨夜旧书店-第1集.mp4" });
    const fixes = screen.getAllByRole("button", { name: /^去修/ });
    expect(fixes).toHaveLength(SAMPLE_QC_REPORT.issues.length);
    expect(screen.getAllByRole("button", { name: "直接导出" })).toHaveLength(1);
    expect(screen.getAllByRole("button")).toHaveLength(SAMPLE_QC_REPORT.issues.length + 1);
    expect(screen.getByText("雨夜旧书店-第1集.mp4")).toBeInTheDocument();
  });

  it("groups issues that block export first, with the checker's own words", () => {
    renderCheck({ shots });
    const block = screen.getByRole("region", { name: "要先处理" });
    expect(within(block).getByText("有几处声音太响，可能破音。")).toBeInTheDocument();
    expect(
      within(block).getByText("在声音设置里调低音量，导出后再听一遍最响的地方。"),
    ).toBeInTheDocument();
    const warn = screen.getByRole("region", { name: "建议看看" });
    expect(within(warn).getAllByRole("listitem")).toHaveLength(5);
    expect(screen.getByText(/有 6 处问题，其中 1 处要先处理/)).toBeInTheDocument();
    expect(
      screen.getByText("还有 1 处要先处理。直接导出也行，这些问题会留在成片里。"),
    ).toBeInTheDocument();
  });

  it("says 整片 for whole-program issues instead of second 0", () => {
    renderCheck({ shots });
    const peak = screen.getByText("有几处声音太响，可能破音。").closest("li")!;
    expect(within(peak).getByText("整片")).toBeInTheDocument();
    expect(within(peak).queryByText("第 0.0 秒")).toBeNull();
  });

  it("names the shot in words and keeps the code and time as small text", () => {
    renderCheck({ shots });
    const freeze = screen.getByText("这里的画面停住不动了。").closest("li")!;
    expect(within(freeze).getByText("第 2 场第 18 个镜头")).toBeInTheDocument();
    expect(within(freeze).getByText("scene-2-shot-18 · 2:38")).toHaveClass("nx-code");
  });

  it("falls back to the checker's time label without a shot list", () => {
    renderCheck();
    const freeze = screen.getByText("这里的画面停住不动了。").closest("li")!;
    expect(within(freeze).getByText("第 157.9 秒")).toBeInTheDocument();
    expect(within(freeze).getByText("2:38")).toBeInTheDocument();
  });

  it("keeps measurements under 「高级」 until it is opened", () => {
    renderCheck({ shots });
    const peak = screen.getByText("有几处声音太响，可能破音。").closest("li")!;
    const value = within(peak).getByText("-0.3");
    expect(value).not.toBeVisible();
    const advanced = within(peak).getByText("高级");
    fireEvent.click(advanced);
    expect(advanced.closest("details")).toHaveAttribute("open");
    expect(value).toBeVisible();
    expect(within(peak).getByText("true_peak-0.00-274.00")).toBeVisible();
    const program = screen.getByRole("complementary", { name: "导出" });
    expect(within(program).getByText("整片响度 LUFS")).not.toBeVisible();
    expect(within(program).getByText("-18.2")).toBeInTheDocument();
  });

  it("hands the issue to the caller on 去修 and exports on 直接导出", () => {
    const { onFix, onExport } = renderCheck({ shots });
    fireEvent.click(screen.getByRole("button", { name: "去修：这里的画面停住不动了。" }));
    expect(onFix).toHaveBeenCalledWith(
      expect.objectContaining({ id: "freeze-157.90-159.00", action: "regenerate_shot" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "直接导出" }));
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it("cannot export while checking", () => {
    renderCheck({ report: null, checking: true });
    expect(screen.getByRole("button", { name: "直接导出" })).toBeDisabled();
    expect(screen.getByText("检查完才能导出。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^去修/ })).toBeNull();
  });

  it("explains a check that could not run, and still allows export", () => {
    const { onExport } = renderCheck({ report: null, error: "没有找到 ffmpeg。" });
    expect(screen.getByRole("alert")).toHaveTextContent("没有找到 ffmpeg。");
    expect(screen.getByText(/成片没有经过检查/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "直接导出" }));
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it("refuses a report it cannot read instead of guessing", () => {
    renderCheck({ report: { schemaVersion: 2 } });
    expect(screen.getByRole("alert")).toHaveTextContent("检查结果读不出来：检查结果的版本不是 1");
    expect(screen.queryByRole("button", { name: /^去修/ })).toBeNull();
  });

  it("says when there is nothing to fix, or nothing checked yet", () => {
    const { rerender } = renderCheck({ report: { ...SAMPLE_QC_REPORT, issues: [] } });
    expect(screen.getByText("没有发现问题")).toBeInTheDocument();
    expect(screen.getByText("没有发现问题，可以导出。")).toBeInTheDocument();
    rerender(<ExportCheck report={null} onFix={vi.fn()} onExport={vi.fn()} />);
    expect(screen.getAllByText("还没有检查结果。").length).toBeGreaterThan(0);
  });

  it("says warnings do not stop the export", () => {
    renderCheck({
      report: {
        ...SAMPLE_QC_REPORT,
        issues: SAMPLE_QC_REPORT.issues.filter((issue) => issue.severity === "warn"),
      },
    });
    expect(screen.getByText("有 5 处建议看看，不影响导出。")).toBeInTheDocument();
    expect(screen.getByText(/有 5 处建议看看，没有要先处理的。/)).toBeInTheDocument();
    expect(screen.queryByText(/其中 0 处/)).toBeNull();
    expect(screen.queryByRole("region", { name: "要先处理" })).toBeNull();
  });

  it("shows a landscape export and an issue type it does not know", () => {
    const odd: QcIssue = {
      ...SAMPLE_QC_REPORT.issues[2]!,
      id: "new-1",
      type: "something_new",
      suggestion: "",
      detail: {},
    };
    renderCheck({
      report: {
        ...SAMPLE_QC_REPORT,
        media: { duration: 45, width: 1920, height: 1080 },
        issues: [odd],
      },
    });
    expect(screen.getByText("横屏 1920×1080 · 45 秒")).toBeInTheDocument();
    expect(screen.getByText("其他")).toBeInTheDocument();
    expect(screen.queryByText("高级", { selector: "li summary" })).toBeNull();
  });
});

describe("issueWhere", () => {
  it("uses the shot that contains the issue's start", () => {
    const issue = SAMPLE_QC_REPORT.issues[2]!;
    expect(issueWhere(issue, shots)).toEqual({
      text: "第 1 场第 4 个镜头",
      code: "scene-1-shot-4 · 0:13",
    });
    expect(issueWhere({ ...issue, time: 999 }, shots)).toEqual({
      text: "第 13.0 秒",
      code: "16:39",
    });
  });

  it("prefers the label the caller gives the shot", () => {
    const issue = { ...SAMPLE_QC_REPORT.issues[2]!, time: 4 };
    const named = [{ id: "02-shot-1", start: 0, end: 5, label: "第 2 场第 1 个镜头" }];
    expect(issueWhere(issue, named)).toEqual({
      text: "第 2 场第 1 个镜头",
      code: "02-shot-1 · 0:04",
    });
  });
});

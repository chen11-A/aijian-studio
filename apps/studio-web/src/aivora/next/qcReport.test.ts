import { describe, expect, it } from "vitest";
import { detailRows, readQcReport } from "./qcReport";
import { SAMPLE_QC_REPORT } from "./stories/sampleData";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function withIssue(change: (issue: Record<string, unknown>) => void): unknown {
  const report = clone(SAMPLE_QC_REPORT) as unknown as { issues: Record<string, unknown>[] };
  change(report.issues[0]!);
  return report;
}

describe("reading a packages/aivora-qc report", () => {
  it("accepts a version 1 report and keeps every issue in order", () => {
    const read = readQcReport(clone(SAMPLE_QC_REPORT));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.report.issues.map((issue) => issue.id)).toEqual(
      SAMPLE_QC_REPORT.issues.map((issue) => issue.id),
    );
    expect(read.report.issues[0]?.scope).toBe("program");
    expect(read.report.issues.at(-1)?.cue).toBe(27);
    expect(read.report.media.duration).toBe(274);
  });

  it("carries the optional fields only when they are there", () => {
    const read = readQcReport(
      withIssue((issue) => {
        delete issue.scope;
        issue.type = "something_new";
        issue.nextCue = 9;
        issue.estimated = true;
      }),
    );
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const issue = read.report.issues[0]!;
    expect(issue.type).toBe("something_new");
    expect(issue.scope).toBeUndefined();
    expect(issue.nextCue).toBe(9);
    expect(issue.estimated).toBe(true);
  });

  it("refuses anything that is not a version 1 report", () => {
    expect(readQcReport(null)).toEqual({ ok: false, reason: "检查结果不是对象" });
    expect(readQcReport([])).toEqual({ ok: false, reason: "检查结果不是对象" });
    expect(readQcReport({ ...clone(SAMPLE_QC_REPORT), schemaVersion: 2 })).toEqual({
      ok: false,
      reason: "检查结果的版本不是 1",
    });
    expect(readQcReport({ ...clone(SAMPLE_QC_REPORT), media: { duration: 1 } })).toMatchObject({
      ok: false,
      reason: "检查结果缺少成片的时长或尺寸",
    });
    expect(
      readQcReport({ ...clone(SAMPLE_QC_REPORT), audio: { present: true, integratedLufs: "x" } }),
    ).toMatchObject({ ok: false, reason: "检查结果缺少声音的测量" });
    expect(readQcReport({ ...clone(SAMPLE_QC_REPORT), issues: {} })).toMatchObject({
      ok: false,
      reason: "检查结果缺少 issues 列表",
    });
  });

  it("names the issue and the field that is wrong", () => {
    const reason = (change: (issue: Record<string, unknown>) => void) => {
      const read = readQcReport(withIssue(change));
      return read.ok ? "" : read.reason;
    };
    expect(reason((issue) => delete issue.id)).toBe("第 1 条问题缺少 id");
    expect(reason((issue) => (issue.severity = "error"))).toBe(
      "第 1 条问题的 severity 只能是 warn 或 block",
    );
    expect(reason((issue) => delete issue.time)).toBe("第 1 条问题缺少 time");
    expect(reason((issue) => delete issue.timeLabel)).toBe("第 1 条问题缺少 timeLabel");
    expect(reason((issue) => (issue.end = "274"))).toBe("第 1 条问题缺少 end");
    expect(reason((issue) => delete issue.type)).toBe("第 1 条问题缺少 type");
    expect(reason((issue) => delete issue.message)).toBe("第 1 条问题缺少 message");
    expect(reason((issue) => delete issue.suggestion)).toBe("第 1 条问题缺少 suggestion");
    expect(reason((issue) => (issue.action = "delete_all"))).toBe(
      "第 1 条问题的 action 不认识：delete_all",
    );
    expect(reason((issue) => (issue.detail = []))).toBe("第 1 条问题的 detail 不是对象");
    const report = clone(SAMPLE_QC_REPORT) as unknown as { issues: unknown[] };
    report.issues.splice(1, 0, "oops");
    expect(readQcReport(report)).toEqual({ ok: false, reason: "第 2 条问题不是对象" });
  });

  it("refuses a report without its assumptions", () => {
    const report = clone(SAMPLE_QC_REPORT) as unknown as Record<string, unknown>;
    delete report.assumptions;
    expect(readQcReport(report)).toEqual({ ok: false, reason: "检查结果缺少 assumptions" });
  });
});

describe("detail rows for 「高级」", () => {
  it("labels known measurements and formats every kind of value", () => {
    expect(
      detailRows({
        integratedLufs: -18.234,
        truePeakDbtp: null,
        estimated: true,
        audioStreamPresent: false,
        lineUnits: [22, 9.5],
        layout: { safeMargin: 0.1, alignment: "bottom-center" },
        somethingNew: "x",
        odd: undefined,
      }),
    ).toEqual([
      { label: "整片响度 LUFS", value: "-18.23" },
      { label: "真峰值 dBTP", value: "无法测量" },
      { label: "估算", value: "是" },
      { label: "有音轨", value: "否" },
      { label: "每行字数", value: "22、9.5" },
      { label: "字幕布局", value: "safeMargin=0.1，alignment=bottom-center" },
      { label: "somethingNew", value: "x" },
      { label: "odd", value: "undefined" },
    ]);
  });
});

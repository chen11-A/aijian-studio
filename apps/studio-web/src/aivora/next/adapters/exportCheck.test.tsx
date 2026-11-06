import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ExportCheck, issueWhere } from "../ExportCheck";
import { exportCheckData } from "./exportCheck";
import { SAMPLE_PROJECT, SAMPLE_PROJECT_QC_REPORT, sampleProjectJson } from "./sampleProject";

function props(...args: Parameters<typeof exportCheckData>) {
  const adapted = exportCheckData(...args);
  if (!adapted.ok) throw new Error("exportCheckData always gives props");
  return adapted.props;
}

describe("exportCheckData", () => {
  it("preserves actual review guards and unverified items without inventing QC fields", () => {
    const unverified = ["对白完整性需人工核对。"];
    const data = props(sampleProjectJson(), SAMPLE_PROJECT_QC_REPORT, {
      reviewMode: true,
      busy: true,
      stale: true,
      publishBlocked: true,
      unverified,
    });
    expect(data).toMatchObject({ reviewMode: true, busy: true, stale: true, publishBlocked: true });
    expect(data.unverified).toBe(unverified);
    expect(data.report).toBe(SAMPLE_PROJECT_QC_REPORT);
  });

  it("lays out the shots the export joins, named by scene and shot", () => {
    const data = props(sampleProjectJson(), SAMPLE_PROJECT_QC_REPORT);
    expect(data.shots).toEqual([
      { id: "scene-1-shot-1", start: 0, end: 4, label: "第 1 场第 1 个镜头" },
      { id: "scene-1-shot-2", start: 4, end: 7, label: "第 1 场第 2 个镜头" },
      { id: "scene-2-shot-1", start: 7, end: 12, label: "第 2 场第 1 个镜头" },
    ]);
    expect(data.fileName).toBe("雨夜旧书店-第1集.mp4");
    expect(data.report).toBe(SAMPLE_PROJECT_QC_REPORT);
    expect(data).toMatchObject({ checking: false, error: null });
    const silence = SAMPLE_PROJECT_QC_REPORT.issues[1]!;
    expect(issueWhere(silence, data.shots).text).toBe("第 2 场第 1 个镜头");
  });

  it("uses measured clip lengths when the host has them", () => {
    const data = props(sampleProjectJson(), null, { clipSeconds: [4.4, 0, 5.2] });
    expect(data.shots?.map((span) => [span.start, span.end])).toEqual([
      [0, 4.4],
      [4.4, 7.4],
      [7.4, 12.600000000000001],
    ]);
  });

  it("stops placing shots after one whose length is unknown", () => {
    const value = JSON.parse(JSON.stringify(SAMPLE_PROJECT)) as Record<string, unknown>;
    const shots = value.shots as Record<string, unknown>[];
    delete shots[1]!.seconds;
    const adapted = exportCheckData(value, null);
    expect(adapted.ok && adapted.props.shots?.map((span) => span.id)).toEqual(["scene-1-shot-1"]);
    expect(adapted.missing).toEqual(["shots[1].seconds"]);
  });

  it("passes the check state through and still shows the report without a project", () => {
    const adapted = exportCheckData("oops", SAMPLE_PROJECT_QC_REPORT, {
      checking: true,
      error: "没有找到 ffmpeg。",
    });
    expect(adapted).toEqual({
      ok: true,
      props: { report: SAMPLE_PROJECT_QC_REPORT, checking: true, error: "没有找到 ffmpeg。" },
      missing: ["project.json"],
    });
    const untitled = props({ title: "", seriesTitle: "", episodeTitle: "" }, null);
    expect(untitled.fileName).toBe("未命名-第1集.mp4");
    expect(untitled.shots).toEqual([]);
  });

  it("gives ExportCheck what it needs to name the shot of each issue", () => {
    render(
      <ExportCheck
        {...props(sampleProjectJson(), SAMPLE_PROJECT_QC_REPORT)}
        onFix={vi.fn()}
        onExport={vi.fn()}
      />,
    );
    const row = screen.getByText("这里有至少两秒听不到声音。").closest("li")!;
    expect(within(row).getByText("第 2 场第 1 个镜头")).toBeInTheDocument();
    expect(screen.getByText("雨夜旧书店-第1集.mp4")).toBeInTheDocument();
  });
});

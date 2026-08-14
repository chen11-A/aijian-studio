import { describe, expect, test } from "vitest";

import {
  defaultSelectedOperationId,
  eventTimeFlagLabels,
  formatEventTime,
  impactIcon,
  impactLabel,
  impactTone,
  isZeroImpact,
  type OperationSummary,
} from "./impact-report-model";

const baseSummary = {
  operation_id: `invop_${"1".repeat(32)}`,
  project_id: `prj_${"a".repeat(32)}`,
  changed_artifact_id: `art_${"2".repeat(32)}`,
  old_accepted_version_id: `ver_${"3".repeat(32)}`,
  new_accepted_version_id: `ver_${"4".repeat(32)}`,
  gate_decision_id: `dec_${"5".repeat(32)}`,
  created_at: "2026-08-03T12:00:00Z",
  affected_version_count: 0,
  independent_path_count: 0,
  impact_counts: { blocking: 0, render_only: 0, advisory: 0 },
  strongest_effective_impact: null,
} satisfies OperationSummary;

describe("impact report model", () => {
  test("labels severity with text and distinct icons", () => {
    expect(impactLabel("blocking")).toBe("阻断");
    expect(impactLabel("render_only")).toBe("仅渲染");
    expect(impactLabel("advisory")).toBe("提示");
    expect(impactLabel(null)).toBe("无影响");
    expect(impactIcon("blocking")).not.toBe(impactIcon("render_only"));
    expect(impactTone("blocking")).toBe("blocking");
  });

  test("selects the newest operation from deterministic oldest-first API order", () => {
    const older = { ...baseSummary, operation_id: `invop_${"1".repeat(32)}` };
    const newer = { ...baseSummary, operation_id: `invop_${"2".repeat(32)}` };
    expect(defaultSelectedOperationId([])).toBeNull();
    expect(defaultSelectedOperationId([older, newer])).toBe(newer.operation_id);
  });

  test("detects valid zero-impact history", () => {
    expect(isZeroImpact(baseSummary)).toBe(true);
    expect(
      isZeroImpact({
        ...baseSummary,
        affected_version_count: 1,
        independent_path_count: 1,
        impact_counts: { blocking: 1, render_only: 0, advisory: 0 },
        strongest_effective_impact: "blocking",
      }),
    ).toBe(false);
  });

  test("formats event timestamps and event-time flags", () => {
    expect(formatEventTime("not-a-date")).toBe("not-a-date");
    expect(formatEventTime("2026-08-03T12:00:00Z")).toMatch(/2026/);
    expect(
      eventTimeFlagLabels({
        affected_artifact_id: `art_${"6".repeat(32)}`,
        affected_version_id: `ver_${"7".repeat(32)}`,
        strongest_effective_impact: "blocking",
        general_stale: true,
        general_blocked: true,
        render_blocked: false,
        paths: [],
      }),
    ).toEqual(["通用过期（事件时）", "通用阻断（事件时）"]);
  });
});

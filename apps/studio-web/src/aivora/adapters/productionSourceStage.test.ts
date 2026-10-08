import { describe, expect, test } from "vitest";

import {
  selectProductionSourceStage,
  type ProductionSourceStage,
  type ProductionSourceStageNavigation,
} from "./productionSourceStage";

type Case = Readonly<{
  name: string;
  source: ProductionSourceStage;
  expected: ProductionSourceStageNavigation;
}>;

const cases: readonly Case[] = [
  {
    name: "loading has no destination",
    source: { kind: "loading" },
    expected: {
      status: "读取中",
      tone: "waiting",
      label: "正在读取来源状态",
      target: null,
      baselineNote: null,
    },
  },
  {
    name: "transport error returns to source review",
    source: { kind: "error" },
    expected: {
      status: "读取失败",
      tone: "waiting",
      label: "恢复来源审核",
      target: "source-review",
      baselineNote: null,
    },
  },
  {
    name: "identity inconsistency returns to source review",
    source: { kind: "inconsistent" },
    expected: {
      status: "身份不一致",
      tone: "waiting",
      label: "核对来源审核",
      target: "source-review",
      baselineNote: null,
    },
  },
  {
    name: "empty source routes to import",
    source: { kind: "empty" },
    expected: {
      status: "未导入",
      tone: "active",
      label: "导入小说原文",
      target: "source",
      baselineNote: null,
    },
  },
  {
    name: "draft without an old baseline is pending review",
    source: { kind: "draft", acceptedVersionNumber: null },
    expected: {
      status: "待审核",
      tone: "review",
      label: "审核来源版本",
      target: "source-review",
      baselineNote: null,
    },
  },
  {
    name: "draft preserves an old approved baseline only for story reading",
    source: { kind: "draft", acceptedVersionNumber: 3 },
    expected: {
      status: "新版待审核",
      tone: "review",
      label: "审核来源版本",
      target: "source-review",
      baselineNote: "新版尚未批准；旧批准基线 V3 仍可用于故事阅读",
    },
  },
  {
    name: "review without an old baseline remains in review",
    source: { kind: "review", acceptedVersionNumber: null },
    expected: {
      status: "审核中",
      tone: "review",
      label: "审核来源版本",
      target: "source-review",
      baselineNote: null,
    },
  },
  {
    name: "review preserves an old approved baseline only for story reading",
    source: { kind: "review", acceptedVersionNumber: 3 },
    expected: {
      status: "新版审核中",
      tone: "review",
      label: "审核来源版本",
      target: "source-review",
      baselineNote: "新版尚未批准；旧批准基线 V3 仍可用于故事阅读",
    },
  },
  {
    name: "approved identifies the current approved version",
    source: { kind: "approved", versionNumber: 8 },
    expected: {
      status: "已批准",
      tone: "approved",
      label: "审阅故事证据",
      target: "story",
      baselineNote: "最新来源 V8 已批准",
    },
  },
];

describe("production source stage", () => {
  test.each(cases)("$name", ({ source, expected }) => {
    expect(selectProductionSourceStage(source)).toEqual(expected);
  });

  test("only describes a navigation destination and has no approval action", () => {
    const navigation = selectProductionSourceStage({ kind: "approved", versionNumber: 8 });
    expect(Object.keys(navigation)).toEqual(["status", "tone", "label", "target", "baselineNote"]);
    expect(navigation).not.toHaveProperty("approve");
    expect(navigation).not.toHaveProperty("submit");
  });
});

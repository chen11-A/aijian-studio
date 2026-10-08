/**
 * Display-only source state extracted from the b334e31 ProductionChrome selector.
 * `target` names a possible destination; it is never an approval or submission command.
 */
export type ProductionSourceStage =
  | { kind: "loading" | "error" | "inconsistent" | "empty" }
  | { kind: "draft" | "review"; acceptedVersionNumber: number | null }
  | { kind: "approved"; versionNumber: number };

export type ProductionSourceStageTone = "active" | "waiting" | "review" | "approved";
export type ProductionSourceStageTarget = "source" | "source-review" | "story";

export type ProductionSourceStageNavigation = Readonly<{
  status: string;
  tone: ProductionSourceStageTone;
  label: string;
  target: ProductionSourceStageTarget | null;
  /** A historical accepted version may be read as story evidence, never treated as approval of a newer version. */
  baselineNote: string | null;
}>;

const oldBaselineNote = (versionNumber: number) =>
  `新版尚未批准；旧批准基线 V${versionNumber} 仍可用于故事阅读`;

/** Pure presentation selector; callers retain responsibility for all review mutations. */
export function selectProductionSourceStage(
  source: ProductionSourceStage,
): ProductionSourceStageNavigation {
  switch (source.kind) {
    case "loading":
      return {
        status: "读取中",
        tone: "waiting",
        label: "正在读取来源状态",
        target: null,
        baselineNote: null,
      };
    case "error":
      return {
        status: "读取失败",
        tone: "waiting",
        label: "恢复来源审核",
        target: "source-review",
        baselineNote: null,
      };
    case "inconsistent":
      return {
        status: "身份不一致",
        tone: "waiting",
        label: "核对来源审核",
        target: "source-review",
        baselineNote: null,
      };
    case "empty":
      return {
        status: "未导入",
        tone: "active",
        label: "导入小说原文",
        target: "source",
        baselineNote: null,
      };
    case "approved":
      return {
        status: "已批准",
        tone: "approved",
        label: "审阅故事证据",
        target: "story",
        baselineNote: `最新来源 V${source.versionNumber} 已批准`,
      };
    case "draft":
      return {
        status: source.acceptedVersionNumber === null ? "待审核" : "新版待审核",
        tone: "review",
        label: "审核来源版本",
        target: "source-review",
        baselineNote:
          source.acceptedVersionNumber === null
            ? null
            : oldBaselineNote(source.acceptedVersionNumber),
      };
    case "review":
      return {
        status: source.acceptedVersionNumber === null ? "审核中" : "新版审核中",
        tone: "review",
        label: "审核来源版本",
        target: "source-review",
        baselineNote:
          source.acceptedVersionNumber === null
            ? null
            : oldBaselineNote(source.acceptedVersionNumber),
      };
  }
}

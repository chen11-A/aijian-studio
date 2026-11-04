import type { SceneCoverage, UiNotice } from "./contracts3j";

/** User-facing evidence; codes remain structured and are never interpolated into copy. */
export function coverageNotice(coverage: SceneCoverage): UiNotice {
  if (coverage.ok) return { code: "COVERAGE_COMPLETE", text: "台词和结尾已覆盖。" };
  const missing: string[] = [];
  if (coverage.missingLines.length)
    missing.push(
      `有${coverage.missingLines.length}句台词没分到镜头里：${coverage.missingLines.map((line) => `「${line}」`).join("、")}`,
    );
  if (coverage.missingTail) missing.push(`结尾还没拍到：「${coverage.missingTail}」`);
  if (!missing.length) missing.push("有原文段落的场次归属需要核对");
  return {
    code: "COVERAGE_INCOMPLETE",
    text: "这一场还有内容需要补齐。",
    detail: `${missing.join("；")}。可以让导演再拆一次，或放进分镜后补镜头；请按原文核对顺序。`,
  };
}

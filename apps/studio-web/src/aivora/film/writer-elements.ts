import type { FilmScene } from "./project";

export type WriterElement = {
  type: "action" | "dialogue";
  text?: string;
  speaker?: string;
  kind?: string;
  line?: string;
  delivery?: string | null;
  /** Model attribution is retained separately from verified source ownership. */
  source?: string;
  sourceParagraphIds: string[];
  verification: "attributed" | "needs_review";
};

/** An element never supplies missing source prose or invents a paragraph assignment. */
export function writerElements(
  record: Record<string, unknown>,
  paragraphs: { id: string; text: string }[],
  reliableIds: string[],
): WriterElement[] {
  if (!Array.isArray(record.elements)) return [];
  const elements = record.elements.flatMap((value): WriterElement[] => {
    if (!value || typeof value !== "object") return [];
    const row = value as Record<string, unknown>;
    if (row.type !== "dialogue" && row.type !== "action") return [];
    const text = typeof row.text === "string" ? row.text : undefined;
    const line = typeof row.line === "string" ? row.line : undefined;
    if (row.type === "dialogue" ? !line?.trim() : !text?.trim()) return [];
    const source = typeof row.source === "string" ? row.source : undefined;
    const paragraph = paragraphs.find((item) => item.id === source);
    const attributed = Boolean(
      paragraph &&
      reliableIds.includes(paragraph.id) &&
      (row.type === "action" || paragraph.text.includes(line!)),
    );
    return [
      {
        type: row.type,
        ...(row.type === "action"
          ? { text }
          : {
              line,
              ...(typeof row.speaker === "string" ? { speaker: row.speaker } : {}),
              ...(typeof row.kind === "string" ? { kind: row.kind } : {}),
              ...(row.delivery === null || typeof row.delivery === "string"
                ? { delivery: row.delivery }
                : {}),
            }),
        ...(source ? { source } : {}),
        sourceParagraphIds: attributed ? [paragraph!.id] : [],
        verification: attributed ? "attributed" : "needs_review",
      },
    ];
  });
  const order = new Map(paragraphs.map((paragraph, index) => [paragraph.id, index]));
  return elements.sort(
    (a, b) =>
      (order.get(a.source ?? "") ?? Number.MAX_SAFE_INTEGER) -
      (order.get(b.source ?? "") ?? Number.MAX_SAFE_INTEGER),
  );
}

/** A changed scene invalidates the old writer annotations, even without userFields. */
export function writerSceneContext(scene: FilmScene | undefined): string {
  if (
    !scene?.writerSourceText ||
    scene.text !== scene.writerSourceText ||
    scene.userFields.includes("text")
  )
    return "";
  return `\n编剧结构（动作和说话人是编剧标注；台词已按来源逐字核对，必须保留完整台词；正文优先于镜数）：\n${JSON.stringify(
    {
      sourceParagraphIds: scene.sourceParagraphIds ?? [],
      elements: (scene.elements ?? []).filter((element) => element.verification === "attributed"),
      pendingElementCount: (scene.elements ?? []).filter(
        (element) => element.verification === "needs_review",
      ).length,
      paragraphCoverage: scene.paragraphCoverage,
      guidance: scene.writerPlan,
    },
  )}\nguidance 是编剧设计参考，预计时长和台词计数不是实际结果或覆盖证明；正文优先。段号沿用原文；保留在正文中的段落不代表归属已确认，可靠归属仅见 sourceParagraphIds。待核对元素不得当作原文；原文缺失和重复归属风险不得忽略。`;
}

/** Preserve the global source-number namespace, including paragraphs awaiting ownership review. */
export function writerNumberedScript(scene: FilmScene | undefined, story: string): string | null {
  if (
    !scene?.writerSourceText ||
    scene.text !== scene.writerSourceText ||
    scene.userFields.includes("text") ||
    !story.includes(scene.text)
  )
    return null;
  const paragraphs = scene.text.split("\n");
  if (!scene.writerParagraphIds || scene.writerParagraphIds.length !== paragraphs.length)
    return null;
  const numbered = paragraphs
    .map((text, index) => `[${scene.writerParagraphIds![index]}] ${text}`)
    .join("\n");
  return story.replace(scene.text, () => numbered);
}

import { speechSeconds } from "./phase2";
import { LINE_HEAD_SECONDS, LINE_TAIL_SECONDS } from "./audio";
export type DialogueSplitLine = { speaker: string; text: string };
export type DialogueSplitInput = {
  lines: DialogueSplitLine[];
  maxVideoSeconds: 10 | 15;
  versions: number;
};
export type DialogueSplitPart = {
  sourceLineIndex: number;
  /** UTF-16 indices into the exact corresponding sourceLines text. */
  startOffset: number;
  endOffset: number;
  speaker: string;
  text: string;
  estimatedSeconds: number;
};
export type DialogueSplitUnsupportedCode =
  | "INVALID_INPUT"
  | "NO_DIALOGUE"
  | "WITHIN_CAP"
  | "NO_SAFE_SENTENCE_BOUNDARY"
  | "PLAN_LIMIT"
  | "SEGMENTER_UNAVAILABLE"
  | "INPUT_CHANGED"
  | "FINGERPRINT_UNAVAILABLE";
export type DialogueSplitPlan =
  | {
      kind: "READY";
      timing: "estimate";
      requiresSplit: true;
      sourceLines: DialogueSplitLine[];
      modelCapSeconds: 10 | 15;
      versions: number;
      estimatedOriginalSeconds: number;
      headSeconds: number;
      tailSeconds: number;
      parts: DialogueSplitPart[];
      newShotCount: number;
      videoCount: number;
      limitations: string[];
    }
  | { kind: "UNSUPPORTED"; code: DialogueSplitUnsupportedCode; sourceLineIndex?: number };
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
/** Match production _video_cap. A model name outside the proven contract has no guessed cap. */
export function dialogueVideoCap(model: string, hasReferences: boolean): 10 | 15 | null {
  if (["grok-imagine-video-1.5", "grok-imagine-video-1.5-lite"].includes(model)) return 15;
  if (model === "grok-imagine-video") return hasReferences ? 10 : 15;
  return null;
}
function input(value: unknown): DialogueSplitInput | null {
  if (
    !object(value) ||
    Object.keys(value).sort().join() !== "lines,maxVideoSeconds,versions" ||
    ![10, 15].includes(Number(value.maxVideoSeconds)) ||
    typeof value.maxVideoSeconds !== "number" ||
    typeof value.versions !== "number" ||
    !Number.isInteger(value.versions) ||
    value.versions < 1 ||
    value.versions > 4 ||
    !Array.isArray(value.lines) ||
    value.lines.length < 1 ||
    value.lines.length > 100
  )
    return null;
  let total = 0;
  for (const line of value.lines) {
    if (
      !object(line) ||
      Object.keys(line).sort().join() !== "speaker,text" ||
      typeof line.speaker !== "string" ||
      line.speaker.length > 200 ||
      typeof line.text !== "string" ||
      line.text.length > 2000 ||
      line.text.includes("\0") ||
      line.speaker.includes("\0")
    )
      return null;
    total += line.text.length;
  }
  return total <= 20000 ? (value as DialogueSplitInput) : null;
}
/** No arbitrary character/word cut. Newlines are explicit authored boundaries; language
 * sentence segmentation keeps its exact substrings, including whitespace/punctuation. */
function sentenceRanges(text: string, segmenter: Intl.Segmenter): [number, number][] {
  const ranges: [number, number][] = [];
  const paragraphEnds = [...text.matchAll(/\r\n|[\r\n]/g)].map(
    (match) => match.index! + match[0].length,
  );
  if (paragraphEnds.at(-1) !== text.length) paragraphEnds.push(text.length);
  let from = 0,
    pending = 0;
  for (const end of paragraphEnds) {
    for (const item of segmenter.segment(text.slice(from, end))) {
      const start = from + item.index,
        stop = start + item.segment.length;
      if (!item.segment.trim()) {
        if (ranges.length) {
          ranges[ranges.length - 1]![1] = stop;
          pending = stop;
        }
      } else {
        // Intl may mark English honorifics/initials as sentences. Keep them attached.
        const previous = ranges.at(-1);
        const abbreviated =
          previous &&
          /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e)|\b[A-Za-z])\.\s*$/iu.test(
            text.slice(previous[0], previous[1]),
          );
        if (previous && abbreviated && start === previous[1] && start > from) previous[1] = stop;
        else ranges.push([pending, stop]);
      }
      if (item.segment.trim()) pending = stop;
    }
    from = end;
  }
  return ranges;
}
export function planDialogueSplit(value: unknown): DialogueSplitPlan {
  const request = input(value);
  if (!request) return { kind: "UNSUPPORTED", code: "INVALID_INPUT" };
  if (request.lines.some((line) => !line.text.trim()))
    return { kind: "UNSUPPORTED", code: "NO_DIALOGUE" };
  const headSeconds = LINE_HEAD_SECONDS,
    tailSeconds = LINE_TAIL_SECONDS;
  const estimatedOriginalSeconds =
    request.lines.reduce((sum, line) => sum + speechSeconds(line.text, null), 0) +
    headSeconds +
    tailSeconds;
  if (estimatedOriginalSeconds <= request.maxVideoSeconds)
    return { kind: "UNSUPPORTED", code: "WITHIN_CAP" };
  if (typeof Intl.Segmenter !== "function")
    return { kind: "UNSUPPORTED", code: "SEGMENTER_UNAVAILABLE" };
  const segmenter = new Intl.Segmenter(undefined, { granularity: "sentence" });
  const parts: DialogueSplitPart[] = [];
  for (const [sourceLineIndex, line] of request.lines.entries()) {
    const units = sentenceRanges(line.text, segmenter);
    let start = 0,
      end = 0;
    const append = () => {
      if (end <= start) return;
      const text = line.text.slice(start, end);
      parts.push({
        sourceLineIndex,
        startOffset: start,
        endOffset: end,
        speaker: line.speaker,
        text,
        estimatedSeconds: Math.ceil(speechSeconds(text, null) + headSeconds + tailSeconds - 1e-9),
      });
      start = end;
    };
    for (const [left, right] of units) {
      if (
        left !== end ||
        speechSeconds(line.text.slice(left, right), null) + headSeconds + tailSeconds >
          request.maxVideoSeconds
      )
        return { kind: "UNSUPPORTED", code: "NO_SAFE_SENTENCE_BOUNDARY", sourceLineIndex };
      if (
        speechSeconds(line.text.slice(start, right), null) + headSeconds + tailSeconds >
        request.maxVideoSeconds
      )
        append();
      end = right;
      if (parts.length >= 128) return { kind: "UNSUPPORTED", code: "PLAN_LIMIT" };
    }
    append();
    if (end !== line.text.length)
      return { kind: "UNSUPPORTED", code: "NO_SAFE_SENTENCE_BOUNDARY", sourceLineIndex };
    if (parts.length > 128) return { kind: "UNSUPPORTED", code: "PLAN_LIMIT" };
  }
  if (parts.length < 2) return { kind: "UNSUPPORTED", code: "NO_SAFE_SENTENCE_BOUNDARY" };
  return {
    kind: "READY",
    timing: "estimate",
    requiresSplit: true,
    sourceLines: request.lines.map((line) => ({ ...line })),
    modelCapSeconds: request.maxVideoSeconds,
    versions: request.versions,
    estimatedOriginalSeconds,
    headSeconds,
    tailSeconds,
    parts,
    newShotCount: parts.length,
    videoCount: parts.length * request.versions,
    limitations: [
      "时长按文字估算，不代表每段实际语音已符合视频上限。",
      "没有逐词时间，不切原配音，也不宣称口型或画面已对齐。",
      "视频数不含未来配音调用或失败重试；当前没有发起生成。",
      "拆镜结构与新增生成数量仍需明确确认；原镜头和媒体保持不变。",
    ],
  };
}

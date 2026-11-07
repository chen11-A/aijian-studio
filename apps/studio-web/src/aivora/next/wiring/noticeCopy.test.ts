import { describe, expect, it } from "vitest";
import { NOTICE_TEXT, normalizeNotice } from "../../film/notices";
import { NOTICE_COPY, noticeMatches, statusLine } from "./noticeCopy";

// What the workspace puts in the status bar for a message (pro/ProWorkspace.tsx setNotice).
const shownFor = (value: Parameters<typeof normalizeNotice>[0]) => {
  const structured = normalizeNotice(value);
  return {
    structured,
    shown:
      typeof value === "string"
        ? value
        : [structured.text, structured.detail].filter(Boolean).join(" "),
  };
};

/** The 101 codes GPT added on gpt/work-4a (docs/aivora/4a-notice-handoff.md). Until that branch
 * is merged, film/notices.ts here does not list them, so they are checked by name. */
const GPT_4A_CODES = [
  "BILLING_PROJECT_REQUIRED",
  "SHOT_STILL_INPUT_CHANGED",
  "STILL_CANDIDATE_PRESERVED",
  "ART_APPLIED_UNSAVED",
  "PROMPTER_APPLIED_UNSAVED",
  "REVIEW_REASON_REQUIRED",
  "REVIEW_INPUT_STALE",
  "REVIEW_INVALID",
  "REVIEW_SHOT_UNKNOWN_OR_DUPLICATE",
  "REVIEW_TAKE_UNKNOWN_OR_DUPLICATE",
  "REVIEW_RECOMMENDATION_UNVERIFIED",
  "PIPELINE_REQUEST_STALE",
  "VOICE_PROJECT_REQUIRED",
  "VOICE_METADATA_TIMEOUT",
  "VOICE_AUDIO_FAILED",
  "BILLING_PROJECT_STALE",
  "BILLING_PROJECT_ID_INVALID",
  "STATE_INVALID",
  "RUN_INTERRUPTED",
  "REQUEST_CANCELLED",
  "PIPELINE_ALREADY_RUNNING",
  "PIPELINE_INPUT_CHANGED",
  "CHECKPOINT_INVALID",
  "PIPELINE_TARGETS_CHANGED",
  "PIPELINE_TARGETS_INVALID",
  "HUMAN_REVIEW_ACCEPTED",
  "REQUEST_OUTCOME_UNKNOWN",
  "PIPELINE_INPUT_INVALID",
  "VIDEO_SUBMISSIONS_ESTIMATE",
  "PROJECT_REQUIRED",
  "PIPELINE_PREPARATION_INVALID",
  "PIPELINE_PREPARATION_REQUIRED",
  "STEP_RESULT_MISSING",
  "STEP_RESULT_STALE",
  "PROJECT_RESULT_MISMATCH",
  "PIPELINE_SAVE_FAILED",
  "PORTRAIT_CAPABILITY_REQUIRED",
  "LOCATION_IMAGE_INCOMPLETE",
  "PORTRAITS_INCOMPLETE",
  "MEDIA_CAPABILITY_REQUIRED",
  "MEDIA_RESULT_MISSING",
  "VIDEO_COVERAGE_INCOMPLETE",
  "VIDEO_FILE_MISSING",
  "ASSEMBLY_CAPABILITY_REQUIRED",
  "ASSEMBLY_RESULT_MISSING",
  "STEP_UNSUPPORTED",
  "PERFORMANCE_READY",
  "PERFORMANCE_OFFLINE",
  "PERFORMANCE_UNASSIGNED",
  "PERFORMANCE_VOICE_REVIEW",
  "SPEAKER_UNSPECIFIED",
  "MULTIPLE_SPEAKERS",
  "VOICE_NOT_UNIQUE",
  "UNKNOWN_PERFORMER",
  "PERFORMANCE_TARGETS_INCOMPLETE",
  "PERFORMANCE_PARSE_FAILED",
  "PERFORMANCE_NOT_REQUIRED",
  "EDITOR_UNDO_CONFLICT",
  "EDITOR_EDIT_CONFLICT",
  "PIPELINE_RECOVERY_FAILED",
  "VISUAL_REVIEW_REQUIRED",
  "ACTION_NOT_REQUIRED",
  "ACTION_PARSE_FAILED",
  "ART_PARSE_FAILED",
  "CAST_PARSE_FAILED",
  "DIRECTOR_PARSE_FAILED",
  "PROMPTER_PARSE_FAILED",
  "WRITER_PARSE_FAILED",
  "SCENE_NOT_FOUND",
  "SHOT_NOT_FOUND",
  "SOURCE_REQUIRED",
  "SCRIPT_COVERAGE_REVIEW",
  "STEP_COMPLETE",
  "TEXT_CANCELLED",
  "TEXT_REJECTED",
  "USER_FIELDS_PRESERVED",
  "PROJECT_MISMATCH",
  "SELECTION_MISMATCH",
  "NOTHING_TO_UNDO",
  "NO_CHANGES",
  "SUGGESTION_MISSING",
  "BUSY",
  "SAVE_DEFERRED",
  "SAVE_FAILED",
  "LOCK_METADATA_CHANGED",
  "TARGET_EDITED",
  "STRUCTURE_STALE",
  "SELECTION_REQUIRED",
  "DEPENDENT_WORK_EXISTS",
  "DEPENDENCIES_CHANGED",
  "DUPLICATE_OR_EMPTY_ID",
  "INVALID_CONTINUITY_REFERENCE",
  "INVALID_SCOPE_IDS",
  "INVALID_TARGET_ORDER",
  "MEDIA_REPLACEMENT_UNSUPPORTED",
  "NEW_SHOT_HAS_ASSETS_OR_DEPENDENCIES",
  "NONCONTIGUOUS_SCOPE",
  "OTHER_COLLECTION_CHANGED",
  "OUTSIDE_SCOPE_EDIT",
  "OUTSIDE_SCOPE_STRUCTURE",
  "PAGE_SCOPE_MISMATCH",
];

describe("NOTICE_COPY", () => {
  it("has a line for every code GPT can send", () => {
    const missing = Object.keys(NOTICE_TEXT).filter(
      (code) => !(code in NOTICE_COPY) && code !== "OPERATION_STATUS" && code !== "EDITOR_GUIDANCE",
    );
    expect(missing).toEqual([]);
  });

  it("has a line for every code GPT added for 4a", () => {
    expect(GPT_4A_CODES).toHaveLength(101);
    expect(GPT_4A_CODES.filter((code) => !NOTICE_COPY[code])).toEqual([]);
  });

  it("keeps the words the app does not use out of every line", () => {
    for (const [code, line] of Object.entries(NOTICE_COPY)) {
      expect(line, code).not.toMatch(
        /模型|提示词|接口|JSON|prompt|token|不是实拍|正式发行|。。|[A-Z]{3,}_[A-Z_]+/i,
      );
    }
  });
});

describe("statusLine", () => {
  it("words a coded message from the copy table and keeps the detail for the tooltip", () => {
    const { structured, shown } = shownFor({
      code: "STORYBOARD_READY",
      text: NOTICE_TEXT.STORYBOARD_READY,
      detail: "雨夜旧书店：29/16",
    });
    expect(statusLine(shown, structured)).toEqual({
      code: "STORYBOARD_READY",
      text: NOTICE_COPY.STORYBOARD_READY,
      detail: "雨夜旧书店：29/16",
    });
  });

  it("shows a plain sentence as it is, even when its wording looks like a code", () => {
    const { structured, shown } = shownFor("正在写第 2/3 场「码头仓库」");
    expect(structured.code).not.toBe("OPERATION_STATUS");
    expect(statusLine(shown, structured)).toEqual({
      code: structured.code,
      text: "正在写第 2/3 场「码头仓库」",
      detail: "",
    });
  });

  it("uses the copy for a sentence that is exactly a fallback line", () => {
    const { structured, shown } = shownFor(NOTICE_TEXT.AUTH_SIGNED_OUT);
    expect(statusLine(shown, structured)?.text).toBe(NOTICE_COPY.AUTH_SIGNED_OUT);
  });

  it("shows the caller's own sentence for codes that only point at it", () => {
    const { structured, shown } = shownFor({
      code: "OPERATION_STATUS",
      text: "画风在角色与场景里改",
      detail: "第二行",
    });
    expect(statusLine(shown, structured)).toEqual({
      code: "OPERATION_STATUS",
      text: "画风在角色与场景里改",
      detail: "第二行",
    });
  });

  it("falls back to GPT's text for a code that has no line yet", () => {
    const line = statusLine("新的提示", { code: "SOMETHING_NEW", text: "新的提示" });
    expect(line).toEqual({ code: "SOMETHING_NEW", text: "新的提示", detail: "" });
  });

  it("never shows program data from a detail", () => {
    const { structured, shown } = shownFor({
      code: "PORTRAIT_BATCH_RUNNING",
      text: "定妆照队列进度已更新。",
      detail: JSON.stringify({ total: 28, done: 5 }),
    });
    const line = statusLine(shown, structured);
    expect(line?.text).toBe(NOTICE_COPY.PORTRAIT_BATCH_RUNNING);
    expect(line?.detail).not.toContain("{");
  });

  it("shows nothing for an empty sentence", () => {
    expect(statusLine("  ", null)).toBeNull();
    expect(statusLine("", { code: "NOTICE_CLEAR", text: "" })).toBeNull();
  });

  it("does not use an event that belongs to another sentence", () => {
    const chat = normalizeNotice("导演拆好了。点「写入分镜」才会写入。");
    expect(noticeMatches(chat, "已保存")).toBe(false);
    expect(statusLine("已保存", null)).toEqual({
      code: "OPERATION_STATUS",
      text: "已保存",
      detail: "",
    });
  });
});

it("keeps incomplete coverage general and reports a completed repair only for its scene", () => {
  const detail = "少了台词：你来晚了。请补上这一句。";
  const incomplete = { code: "COVERAGE_INCOMPLETE", text: "覆盖检查未通过。", detail };
  expect(statusLine(`${incomplete.text} ${detail}`, incomplete)).toEqual({
    code: "COVERAGE_INCOMPLETE",
    text: "有的场还有内容没拍到，去分镜看看。",
    detail,
  });
  expect(
    statusLine("本场覆盖完整。", { code: "COVERAGE_COMPLETE", text: "本场覆盖完整。" })?.text,
  ).toBe("这一场的台词和结尾都有镜头了。");
});

describe("takeover generation, clean copy and capture notice contracts", () => {
  it.each([
    ["GENERATION_SELECTION_STALE", "所选镜头已经变化，请重新选择后生成。"],
    ["GENERATION_ALREADY_RUNNING", "这一批还在生成，请等完成后再试。"],
    ["CLEAN_COPY_NOT_REQUIRED", "没有需要补做的镜头。"],
    ["CLEAN_COPY_PROGRESS", "正在补做不带字幕的版本。"],
    ["CLEAN_COPY_INTERRUPTED", "补做中断，已经保存的版本会保留。请查看剩余镜头后重试。"],
    ["CLEAN_COPY_DONE", "不带字幕的版本补好了。"],
    ["CLEAN_COPY_FAILED", "不带字幕的版本没有补好，可以重试。"],
    ["CLEAN_COPY_SOURCE_MISSING", "找不到原来的合成记录，暂时不能补做。"],
    ["CLEAN_COPY_STALE", "作品或版本已经变化，已跳过旧结果。"],
    ["CLEAN_COPY_PARTIAL", "部分镜头已补好，请查看剩余镜头后重试。"],
    ["CAPTURE_ENABLED_REQUIRED", "先开启保存原始回复，再进行导演或动作生成。"],
    ["CAPTURE_REPLY_MISSING", "这个作品还没有匹配的导演原始回复。开启保存后再进行生成。"],
    ["CAPTURE_EXPORT_DONE", "排查文件已下载到本机。"],
    ["CAPTURE_EXPORT_FAILED", "排查文件没有导出，请重试。"],
  ])("renders %s using its specific final Chinese copy", (code, expected) => {
    const { structured, shown } = shownFor({ code, text: expected });
    expect(structured.code).toBe(code);
    expect(statusLine(shown, structured)).toEqual({ code, text: expected, detail: "" });
  });

  it("keeps a partial repair's missing source detail without claiming the whole batch succeeded", () => {
    const detail = "镜头 1 不带字幕的那份补好了。镜头 2 找不到当时的合成记录。";
    const { structured, shown } = shownFor({
      code: "CLEAN_COPY_PARTIAL",
      text: NOTICE_COPY.CLEAN_COPY_PARTIAL!,
      detail,
    });
    expect(statusLine(shown, structured)).toEqual({
      code: "CLEAN_COPY_PARTIAL",
      text: "部分镜头已补好，请查看剩余镜头后重试。",
      detail,
    });
    expect(statusLine(shown, structured)?.text).not.toBe(NOTICE_COPY.CLEAN_COPY_DONE);
  });

  it("keeps a captured reply count in the caller's sentence and distinguishes it from a film export", () => {
    const message = "已导出 2 场的排查文件，只下载到本机。";
    const { structured, shown } = shownFor(message);
    expect(structured.code).toBe("CAPTURE_EXPORT_DONE");
    expect(statusLine(shown, structured)).toEqual({
      code: "CAPTURE_EXPORT_DONE",
      text: message,
      detail: "",
    });
    expect(NOTICE_COPY.CAPTURE_EXPORT_DONE).not.toBe(NOTICE_COPY.EXPORT_DONE);
    expect(NOTICE_COPY.CAPTURE_EXPORT_FAILED).not.toBe(NOTICE_COPY.EXPORT_FAILED);
  });
});

it("distinguishes a prepared prompt proposal from confirmed field application", () => {
  for (const [code, text] of [
    ["PROMPTER_SUGGESTION_READY", "画面说明已准备好，确认后才修改。"],
    ["PROMPTER_FIELDS_APPLIED", "画面说明已修改。"],
  ]) {
    const notice = normalizeNotice({ code: code!, text: text! });
    expect(statusLine(text!, notice)).toEqual({ code, text, detail: "" });
  }
});

it("distinguishes whole-project art review from applied art fields", () => {
  for (const [code, text] of [
    ["ART_SUGGESTION_READY", "全项目美术建议已准备好，确认后才修改。"],
    ["ART_FIELDS_APPLIED", "全项目美术字段已修改。"],
  ]) {
    const notice = normalizeNotice({ code: code!, text: text! });
    expect(statusLine(text!, notice)).toEqual({ code, text, detail: "" });
  }
});

it("distinguishes current-scene director structure review from actual application", () => {
  for (const [code, text] of [
    ["DIRECTOR_STRUCTURE_READY", "本场导演结构建议已准备好，确认后才修改。"],
    ["DIRECTOR_STRUCTURE_APPLIED", "本场导演镜头结构已修改。"],
  ]) {
    const notice = normalizeNotice({ code: code!, text: text! });
    expect(statusLine(text!, notice)).toEqual({ code, text, detail: "" });
  }
});

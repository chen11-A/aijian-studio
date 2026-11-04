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

describe("NOTICE_COPY", () => {
  it("has a line for every code GPT can send", () => {
    const missing = Object.keys(NOTICE_TEXT).filter(
      (code) => !(code in NOTICE_COPY) && code !== "OPERATION_STATUS" && code !== "EDITOR_GUIDANCE",
    );
    expect(missing).toEqual([]);
  });

  it("keeps the words the app does not use out of every line", () => {
    for (const [code, line] of Object.entries(NOTICE_COPY)) {
      expect(line, code).not.toMatch(/模型|提示词|接口|JSON|prompt|token|不是实拍|正式发行|。。/i);
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

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import approved from "./fixtures/claude-48a5825-notice-copy.json";
import { normalizeNotice, NOTICE_TEXT } from "./notices";

describe("structured business notices", () => {
  it.each([
    ["这一镜没有台词。时长保持导演的选择。", "VOICE_EMPTY"],
    ["已写 18 镜，正在写表演。", "PERFORMANCE_PROGRESS"],
    ["正在写第 2/3 场「雨夜旧书店」", "DIRECTOR_PROGRESS"],
    ["镜头 8：正在用定妆照生成首帧。", "FIRST_FRAME_PROGRESS"],
    ["镜头 8 首帧未完成：供应商拒绝", "FIRST_FRAME_FAILED"],
    ["定妆照 3/12，失败 0。", "PORTRAIT_PROGRESS"],
    ["定妆照 4/12，失败 1。", "PORTRAIT_PROGRESS"],
    ["已导出到 C:\\Users\\User\\雨夜.mp4", "EXPORT_DONE"],
    ["已记下人物：林晚、沈砚。", "CAST_RECORDED"],
    ["读到 3 场。点「放入剧本」才会写入。", "IMPORT_READY"],
    ["已取消这一次。已经发出的请求不一定能停。", "GENERATION_CANCEL_REQUESTED"],
    ["已取消。还没开始的镜头不再生成。", "GENERATION_CANCELLED"],
    ["已暂停。已经发出的请求不一定能停。", "GENERATION_PAUSED"],
    ["没有生成成功，可以重试。", "GENERATION_FAILED"],
    ["没有导出成功，可以重试。", "EXPORT_FAILED"],
    ["编剧没有按格式返回，已停。没有写入离线剧本。点「继续」再试。", "WRITER_FAILED"],
    ["「医院」导演没有按格式返回，已停。", "DIRECTOR_FAILED"],
    ["已写入分镜。你改过的镜头没有被盖掉。", "SHOTS_APPLIED"],
    ["只重做镜头 3。确认表里点开始生成才会出视频。", "GENERATION_CONFIRM_REQUIRED"],
    ["模型列表里没有 grok-imagine-video-1.5-lite，不能先出草稿。", "DRAFT_MODEL_UNAVAILABLE"],
    ["还没生成：镜头1、镜头2。可以只导出已生成的。", "EXPORT_INCOMPLETE"],
    ["这个会员不能用这里的模型。", "ENTITLEMENT_DENIED"],
    ["这一句已重配，画面没有重新生成。", "VOICE_DONE"],
  ])("classifies %s as %s without putting dynamic values in the fallback", (message, code) => {
    const notice = normalizeNotice(message);
    expect(notice.code).toBe(code);
    expect(notice.text).toBe(NOTICE_TEXT[code as keyof typeof NOTICE_TEXT]);
    if (notice.text !== message) expect(notice.detail).toBe(message);
  });

  it("uses the approved copy table while preserving every documented legacy code", () => {
    const table = readFileSync(
      resolve(__dirname, "../../../../..", "docs/design/copy-zh.md"),
      "utf8",
    );
    const rows = [...table.matchAll(/^\| `([A-Z_]+)`\s*\| ([^|]+)\| ([^|]+)\|/gmu)].filter(
      (row) => row[1]! in NOTICE_TEXT && !["OPERATION_STATUS", "EDITOR_GUIDANCE"].includes(row[1]!),
    );
    const addedCodes = new Set([
      ...approved.entries.map((entry) => entry.code),
      "LOCATION_SOURCE_REQUIRED",
      "MULTI_VOICE_PROVIDER_REQUIRED",
      "DIALOGUE_VIDEO_LIMIT",
      "VIDEO_TOO_SHORT",
      "DIALOGUE_VIDEO_REQUIRED",
    ]);
    const legacyRows = rows.filter((row) => !addedCodes.has(row[1]!));
    const addedRows = rows.filter((row) => addedCodes.has(row[1]!));
    expect(legacyRows).toHaveLength(118);
    expect(addedRows).toHaveLength(106);
    for (const [, code, old, replacement] of addedRows) {
      expect(normalizeNotice({ code: code!, text: old!.trim() })).toMatchObject({
        code,
        text: replacement!.trim(),
      });
    }
    for (const [, code, old, replacement] of legacyRows) {
      const expected = replacement!.trim();
      expect(normalizeNotice(old!.trim()), code).toMatchObject({ code, text: expected });
      expect(normalizeNotice(expected), code).toEqual({ code, text: expected });
      expect(normalizeNotice({ code: code!, text: old!.trim() }), code).toMatchObject({
        code,
        text: expected,
      });
    }
  });

  it("preserves failure details and cancellation uncertainty with the revised copy", () => {
    expect(
      normalizeNotice({
        code: "GENERATION_CANCEL_REQUESTED",
        text: "镜头 5 已发出",
        detail: "还未确认停止",
      }),
    ).toEqual({
      code: "GENERATION_CANCEL_REQUESTED",
      text: "已取消。如果已经发给 Grok，它可能还会做完。",
      detail: "镜头 5 已发出\n还未确认停止",
    });
    expect(normalizeNotice("提示词没有按格式返回，未完成。")).toEqual({
      code: "PLANPROMPTER_FAILED",
      text: "画面说明这次没写完，可以再试一次。",
      detail: "提示词没有按格式返回，未完成。",
    });
  });

  it("classifies application-data save failures without confusing them with generation failures", () => {
    expect(normalizeNotice("没有写到应用数据目录，可以重试。")).toEqual({
      code: "SAVE_FAILED",
      text: NOTICE_TEXT.SAVE_FAILED,
      detail: "没有写到应用数据目录，可以重试。",
    });
    expect(normalizeNotice("没有生成成功，可以重试。").code).toBe("GENERATION_FAILED");
  });

  it("has a non-generic business code for every direct static workspace notice", () => {
    const source = readFileSync(resolve(__dirname, "../pro/ProWorkspace.tsx"), "utf8");
    const literals = [...source.matchAll(/setNotice\("([^"\n]*)"\)/gu)].map((match) => match[1]!);
    expect(literals.length).toBeGreaterThan(50);
    for (const message of literals)
      expect(normalizeNotice(message).code, message).not.toBe("OPERATION_STATUS");
  });

  it.each([
    ["镜头已变更，请重新生成建议。", "REQUEST_STALE"],
    ["台词或时长已修改，保留了你的修改。", "USER_EDIT_PRESERVED"],
    ["当前选择已改变，请回到美术建议所在页面再应用。", "SELECTION_MISMATCH"],
    ["内容后来改过，这次美术建议没有覆盖。请重新生成建议。", "EDITOR_EDIT_CONFLICT"],
    ["美术建议已应用，但还没有保存。", "ART_APPLIED_UNSAVED"],
    ["提示词已应用，但还没有保存。", "PROMPTER_APPLIED_UNSAVED"],
    ["镜头内容已修改，旧画面没有写入。", "SHOT_STILL_INPUT_CHANGED"],
    ["画面已加入候选，保留了你选择的首帧。", "STILL_CANDIDATE_PRESERVED"],
    ["作品已修改，已停下连续编导。保留了你的修改，请重新开始。", "REQUEST_STALE"],
    ["这次改动不能安全撤销，已保留当前内容。", "EDITOR_UNDO_CONFLICT"],
    ["内容后来改过，这次没有覆盖。", "EDITOR_EDIT_CONFLICT"],
    ["有表演尚未对应到镜头或人物，请核对后再写入。", "PERFORMANCE_UNASSIGNED"],
    ["配音语气还需核对，已保留原语气。", "PERFORMANCE_VOICE_REVIEW"],
    ["表演指导写好了。点「写入分镜」写到这一镜。", "PERFORMANCE_READY"],
    ["没有登录，已用离线表演指导。点「写入分镜」写到这一镜。", "PERFORMANCE_OFFLINE"],
  ])("keeps new action notice %s specific", (text, code) => {
    expect(normalizeNotice(text).code).toBe(code);
  });

  it("gives every agent step and editor reason a short Chinese fallback", () => {
    const files = [
      "../pro/pipeline-agent-actions.ts",
      "../pro/film-pipeline-controller.ts",
      "./production-pipeline.ts",
      "./review-report.ts",
      "../pro/pipeline-workspace-host.ts",
      "../pro/actions/voice-preview.ts",
      "../pro/actions/billing-project.ts",
      "../pro/actions/shot-still.ts",
      "../pro/actions/editor-host.ts",
      "../pro/actions/editor-context.ts",
      "../pro/actions/editor-changes.ts",
      "../pro/actions/editor-structure.ts",
    ];
    for (const file of files) {
      const source = readFileSync(resolve(__dirname, file), "utf8");
      const codes = [...source.matchAll(/"([A-Z][A-Z_]{2,})"/gu)].map((match) => match[1]!);
      for (const code of codes) {
        const notice = normalizeNotice({ code, text: code });
        expect(notice.text, `${file}: ${code}`).not.toBe(NOTICE_TEXT.OPERATION_STATUS);
        expect(notice.text, code).toMatch(/[\u4e00-\u9fff]/u);
      }
    }
  });

  it("clears messages explicitly and does not retain old details", () => {
    expect(normalizeNotice(" \n ")).toEqual({ code: "NOTICE_CLEAR", text: "" });
    expect(normalizeNotice({ code: "NOTICE_CLEAR", text: "old", detail: "old" })).toEqual({
      code: "NOTICE_CLEAR",
      text: "",
    });
  });

  it("does not repeat replaced static fallback copy as a new detail", () => {
    expect(normalizeNotice("导演等待超时，正在重试。")).toEqual({
      code: "STALL_RETRYING",
      text: NOTICE_TEXT.STALL_RETRYING,
    });
    expect(normalizeNotice("画面已生成。")).toEqual({
      code: "STILL_DONE",
      text: NOTICE_TEXT.STILL_DONE,
    });
    expect(
      normalizeNotice({
        code: "OPERATION_STATUS",
        text: "先选中当前镜头。",
        detail: "只影响这一场",
      }),
    ).toEqual({
      code: "OPERATION_STATUS",
      text: NOTICE_TEXT.OPERATION_STATUS,
      detail: "先选中当前镜头。\n只影响这一场",
    });
  });

  it("keeps explicit stage codes while moving long messages into detail", () => {
    expect(
      normalizeNotice({ code: "STILL_FAILED", text: "镜头 12 画面失败", detail: "供应商拒绝" }),
    ).toEqual({
      code: "STILL_FAILED",
      text: NOTICE_TEXT.STILL_FAILED,
      detail: "镜头 12 画面失败\n供应商拒绝",
    });
    expect(normalizeNotice({ code: "CUSTOM_STAGE", text: "新阶段的详细状态" })).toEqual({
      code: "CUSTOM_STAGE",
      text: NOTICE_TEXT.OPERATION_STATUS,
      detail: "新阶段的详细状态",
    });
  });

  it("exposes the generic fallback honestly without hashing or implying success", () => {
    expect(normalizeNotice("供应商返回了一种尚未登记的新状态")).toEqual({
      code: "OPERATION_STATUS",
      text: "请查看操作详情。",
      detail: "供应商返回了一种尚未登记的新状态",
    });
    expect(normalizeNotice({ code: "bad code", text: "invalid" }).code).toBe("OPERATION_STATUS");
    for (const text of Object.values(NOTICE_TEXT)) expect(text.length).toBeLessThanOrEqual(32);
  });
});

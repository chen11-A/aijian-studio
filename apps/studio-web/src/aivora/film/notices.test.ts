import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import approved from "./fixtures/claude-48a5825-notice-copy.json";
import { normalizeNotice, NOTICE_TEXT } from "./notices";
import { cleanCopyNotice, type CleanCopyOutcome } from "../pro/actions/clean-copy";

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
    const takeoverCodes = new Set([
      "GENERATION_SELECTION_STALE",
      "GENERATION_ALREADY_RUNNING",
      "CLEAN_COPY_NOT_REQUIRED",
      "CLEAN_COPY_PROGRESS",
      "CLEAN_COPY_INTERRUPTED",
      "CLEAN_COPY_DONE",
      "CLEAN_COPY_FAILED",
      "CLEAN_COPY_SOURCE_MISSING",
      "CLEAN_COPY_STALE",
      "CLEAN_COPY_PARTIAL",
      "CAPTURE_ENABLED_REQUIRED",
      "CAPTURE_REPLY_MISSING",
      "CAPTURE_EXPORT_DONE",
      "CAPTURE_EXPORT_FAILED",
    ]);
    const exportQcCodes = new Set([
      "EXPORT_QC_RUNNING",
      "EXPORT_QC_READY",
      "EXPORT_QC_FAILED",
      "EXPORT_QC_STALE",
      "EXPORT_QC_BLOCKED",
    ]);
    const referenceCodes = new Set([
      "ASSISTANT_REFERENCE_UNKNOWN",
      "ASSISTANT_REFERENCE_AMBIGUOUS",
      "ASSISTANT_REFERENCE_SYNTAX",
      "ASSISTANT_REFERENCE_STALE",
    ]);
    const artFieldCodes = new Set(["ART_SUGGESTION_READY", "ART_FIELDS_APPLIED"]);
    const actionFieldCodes = new Set(["ACTION_SUGGESTION_READY", "ACTION_FIELDS_APPLIED"]);
    const performanceFieldCodes = new Set([
      "PERFORMANCE_SUGGESTION_READY",
      "PERFORMANCE_FIELDS_APPLIED",
    ]);
    const promptFieldCodes = new Set(["PROMPTER_SUGGESTION_READY", "PROMPTER_FIELDS_APPLIED"]);
    const assemblyCodes = new Set([
      "ASSEMBLY_SHOT_REQUIRED",
      "ASSEMBLY_PARTIAL",
      "ASSEMBLY_SOURCE_CLOCK_MISMATCH",
      "ASSEMBLY_CLOCK_REQUIRED",
    ]);
    const historyCodes = new Set([
      "HISTORY_SAVED",
      "HISTORY_READ_FAILED",
      "HISTORY_RESTORED",
      "HISTORY_RESTORE_FAILED",
      "HISTORY_BACKUP_FAILED",
      "HISTORY_STALE",
    ]);
    const legacyRows = rows.filter(
      (row) =>
        !referenceCodes.has(row[1]!) &&
        !artFieldCodes.has(row[1]!) &&
        !actionFieldCodes.has(row[1]!) &&
        !performanceFieldCodes.has(row[1]!) &&
        !addedCodes.has(row[1]!) &&
        !takeoverCodes.has(row[1]!) &&
        !promptFieldCodes.has(row[1]!) &&
        !exportQcCodes.has(row[1]!) &&
        !historyCodes.has(row[1]!) &&
        !assemblyCodes.has(row[1]!),
    );
    const referenceRows = rows.filter((row) => referenceCodes.has(row[1]!));
    expect(referenceRows).toHaveLength(4);
    expect(new Set(referenceRows.map((row) => row[1]))).toEqual(referenceCodes);
    for (const [, code, fallback, copy] of referenceRows) {
      expect(NOTICE_TEXT[code as keyof typeof NOTICE_TEXT]).toBe(fallback!.trim());
      expect(normalizeNotice({ code: code!, text: fallback!.trim() })).toEqual({
        code,
        text: copy!.trim(),
      });
    }
    const addedRows = rows.filter((row) => addedCodes.has(row[1]!));
    const takeoverRows = rows.filter((row) => takeoverCodes.has(row[1]!));
    const promptFieldRows = rows.filter((row) => promptFieldCodes.has(row[1]!));
    const qcRows = rows.filter((row) => exportQcCodes.has(row[1]!));
    expect(qcRows).toHaveLength(5);
    expect(new Set(qcRows.map((row) => row[1]))).toEqual(exportQcCodes);
    for (const [, code, fallback, finalCopy] of qcRows) {
      expect(NOTICE_TEXT[code as keyof typeof NOTICE_TEXT]).toBe(fallback!.trim());
      expect(normalizeNotice({ code: code!, text: fallback!.trim() })).toEqual({
        code,
        text: finalCopy!.trim(),
      });
    }
    const historyRows = rows.filter((row) => historyCodes.has(row[1]!));
    expect(historyRows).toHaveLength(6);
    expect(new Set(historyRows.map((row) => row[1]))).toEqual(historyCodes);
    for (const [, code, fallback, finalCopy] of historyRows) {
      expect(NOTICE_TEXT[code as keyof typeof NOTICE_TEXT]).toBe(fallback!.trim());
      expect(normalizeNotice({ code: code!, text: fallback!.trim() })).toEqual({
        code,
        text: finalCopy!.trim(),
      });
    }
    const assemblyRows = rows.filter((row) => assemblyCodes.has(row[1]!));
    expect(assemblyRows).toHaveLength(4);
    expect(new Set(assemblyRows.map((row) => row[1]))).toEqual(assemblyCodes);
    for (const [, code, fallback, finalCopy] of assemblyRows) {
      expect(NOTICE_TEXT[code as keyof typeof NOTICE_TEXT]).toBe(fallback!.trim());
      expect(normalizeNotice({ code: code!, text: fallback!.trim() })).toEqual({
        code,
        text: finalCopy!.trim(),
      });
    }
    const performanceFieldRows = rows.filter((row) => performanceFieldCodes.has(row[1]!));
    expect(performanceFieldRows).toHaveLength(2);
    expect(new Set(performanceFieldRows.map((row) => row[1]))).toEqual(performanceFieldCodes);
    for (const [, code, fallback, finalCopy] of performanceFieldRows) {
      expect(NOTICE_TEXT[code as keyof typeof NOTICE_TEXT]).toBe(fallback!.trim());
      expect(normalizeNotice({ code: code!, text: fallback!.trim() })).toEqual({
        code,
        text: finalCopy!.trim(),
      });
    }
    const actionFieldRows = rows.filter((row) => actionFieldCodes.has(row[1]!));
    expect(actionFieldRows).toHaveLength(2);
    expect(new Set(actionFieldRows.map((row) => row[1]))).toEqual(actionFieldCodes);
    for (const [, code, fallback, finalCopy] of actionFieldRows) {
      expect(NOTICE_TEXT[code as keyof typeof NOTICE_TEXT]).toBe(fallback!.trim());
      expect(normalizeNotice({ code: code!, text: fallback!.trim() })).toEqual({
        code,
        text: finalCopy!.trim(),
      });
    }
    const artFieldRows = rows.filter((row) => artFieldCodes.has(row[1]!));
    expect(artFieldRows).toHaveLength(2);
    expect(new Set(artFieldRows.map((row) => row[1]))).toEqual(artFieldCodes);
    for (const [, code, fallback, finalCopy] of artFieldRows) {
      expect(NOTICE_TEXT[code as keyof typeof NOTICE_TEXT]).toBe(fallback!.trim());
      expect(normalizeNotice({ code: code!, text: fallback!.trim() })).toEqual({
        code,
        text: finalCopy!.trim(),
      });
    }
    expect(legacyRows).toHaveLength(118);
    expect(addedRows).toHaveLength(106);
    expect(takeoverRows).toHaveLength(14);
    expect(promptFieldRows).toHaveLength(2);
    expect(new Set(promptFieldRows.map((row) => row[1]))).toEqual(promptFieldCodes);
    for (const [, code, fallback, finalCopy] of promptFieldRows) {
      expect(NOTICE_TEXT[code as keyof typeof NOTICE_TEXT], code).toBe(fallback!.trim());
      expect(normalizeNotice({ code: code!, text: fallback!.trim() }), code).toEqual({
        code,
        text: finalCopy!.trim(),
      });
    }
    expect(new Set(takeoverRows.map((row) => row[1]))).toEqual(takeoverCodes);
    for (const [, code, fallback, finalCopy] of takeoverRows) {
      expect(NOTICE_TEXT[code as keyof typeof NOTICE_TEXT], code).toBe(fallback!.trim());
      expect(normalizeNotice({ code: code!, text: fallback!.trim() }), code).toEqual({
        code,
        text: finalCopy!.trim(),
      });
    }
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

  it.each([
    ["所选镜头已经变化，请重新选择后生成。", "GENERATION_SELECTION_STALE"],
    ["这一批还在生成，请等完成后再试。", "GENERATION_ALREADY_RUNNING"],
    ["补做不带字幕的版本需要桌面版。", "DESKTOP_REQUIRED"],
    ["没有需要补做的镜头。", "CLEAN_COPY_NOT_REQUIRED"],
    ["正在补做不带字幕的版本。", "CLEAN_COPY_PROGRESS"],
    ["这一次没有记到作品上，请稍后再试。", "BILLING_PROJECT_REQUIRED"],
    ["补做中断，已经保存的版本会保留。请查看剩余镜头后重试。", "CLEAN_COPY_INTERRUPTED"],
    ["先打开一个作品，再导出排查文件。", "PROJECT_REQUIRED"],
    ["先开启保存原始回复，再进行导演或动作生成。", "CAPTURE_ENABLED_REQUIRED"],
    ["作品内容已变化，请重新导出排查文件。", "REQUEST_STALE"],
    ["这个作品还没有匹配的导演原始回复。开启保存后再进行生成。", "CAPTURE_REPLY_MISSING"],
    ["排查文件没有导出，请重试。", "CAPTURE_EXPORT_FAILED"],
    ["已导出 3 场的排查文件，只下载到本机。", "CAPTURE_EXPORT_DONE"],
  ])("assigns the takeover notice %s its actual business code %s", (text, code) => {
    const notice = normalizeNotice(text);
    expect(notice.code).toBe(code);
    expect(notice.text).toBe(NOTICE_TEXT[code as keyof typeof NOTICE_TEXT]);
    expect(notice.detail ?? notice.text).toBe(text);
  });

  it.each([
    [["done"], "CLEAN_COPY_DONE"],
    [["done", "done"], "CLEAN_COPY_DONE"],
    [["failed"], "CLEAN_COPY_FAILED"],
    [["missing", "missing"], "CLEAN_COPY_SOURCE_MISSING"],
    [["stale"], "CLEAN_COPY_STALE"],
    [["done", "failed"], "CLEAN_COPY_PARTIAL"],
    [["done", "missing"], "CLEAN_COPY_PARTIAL"],
    [["done", "stale"], "CLEAN_COPY_PARTIAL"],
  ] as const)(
    "classifies actual clean-copy outcomes %s without claiming full completion",
    (statuses, code) => {
      const outcomes: CleanCopyOutcome[] = statuses.map((status, index) => ({
        shotId: `shot-${index + 1}`,
        shot: `镜头 ${index + 1}`,
        status,
        ...(status === "failed" ? { reason: "本机处理没有完成" } : {}),
      }));
      const text = cleanCopyNotice(outcomes);
      expect(normalizeNotice(text)).toMatchObject({ code, text: NOTICE_TEXT[code], detail: text });
    },
  );

  it("gives every direct reply-capture component notice a registered business code", () => {
    const source = readFileSync(resolve(__dirname, "../pro/ReplyCaptureSettings.tsx"), "utf8");
    const messages = [...source.matchAll(/onNotice\("([^"\n]*)"\)/gu)].map((match) => match[1]!);
    expect(messages).toHaveLength(5);
    for (const text of messages)
      expect(normalizeNotice(text).code, text).not.toBe("OPERATION_STATUS");
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
    // The button is 「放进分镜」 / 「放进剧本」 now; the old wording is still recognised.
    ["表演指导写好了。点「放进分镜」放到这一镜。", "PERFORMANCE_READY"],
    [
      "没登录，先用软件自己的规则写了表演，请看一下。点「放进分镜」放到这一镜。",
      "PERFORMANCE_OFFLINE",
    ],
    ["已放进分镜。你改过的镜头没有被盖掉。", "SHOTS_APPLIED"],
    ["镜头已经放进分镜。", "SHOTS_APPLIED"],
    ["已放进这一镜。你改过的字没有被盖掉。", "SHOT_APPLIED"],
    ["已放进剧本。你改过的场没有被盖掉。", "SCRIPT_APPLIED"],
    ["剧本已经放进去了。", "SCRIPT_APPLIED"],
    ["画风、外貌、场景和道具已放进去。你改过的外貌没有被盖掉。", "ART_APPLIED"],
    ["读到 3 场。点「放进剧本」才会放进去。", "IMPORT_READY"],
    ["这句话超过 15 秒，拆成两镜。点「放进分镜」才会放进去。", "DURATION_SPLIT_REQUIRED"],
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

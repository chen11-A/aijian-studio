import { expect, it } from "vitest";
import { normalizeNotice, presentNotice } from "./notices";

it("keeps diagnostic metadata but never displays raw codes in structured messages", () => {
  const input = {
    code: "ACTION_UNASSIGNED",
    text: "ACTION_UNASSIGNED",
    detail: "挥铁棍：ACTION_UNASSIGNED，请核对镜头。",
  };
  const result = presentNotice(input);
  expect(result.notice.code).toBe("ACTION_UNASSIGNED");
  expect(result.text).not.toContain("ACTION_UNASSIGNED");
  expect(result.text).toContain("挥铁棍");
  expect(input.text).toBe("ACTION_UNASSIGNED");
});

it("translates legacy diagnostic strings at the same chat/status boundary", () => {
  const result = presentNotice("ACTION_UNASSIGNED");
  expect(result.notice.code).toBe("ACTION_UNASSIGNED");
  expect(result.text).toContain("动作");
  expect(presentNotice("PROVIDER_UNKNOWN_FAILURE").text).not.toContain("PROVIDER_UNKNOWN_FAILURE");
  expect(presentNotice("NASA、AI、JSON、MP4 均保持原样。").text).toBe(
    "NASA、AI、JSON、MP4 均保持原样。",
  );
});

it("retains specific coverage evidence and next steps without leaking identifiers", () => {
  const result = normalizeNotice({
    code: "COVERAGE_INCOMPLETE",
    text: "结尾还没拍到。",
    detail: "缺少台词「你来晚了」。尾段：门外响起刹车声。请补上结尾。",
  });
  expect(result.code).toBe("COVERAGE_INCOMPLETE");
  expect(result.detail).toContain("你来晚了");
  expect(result.detail).toContain("刹车声");
  expect(result.detail).toContain("请补上结尾");
});

it("preserves quoted novel evidence and ordinary identifiers", () => {
  const prose = "角色 NASA_CENTER 说：『不是代码』。原文「ACTION_UNASSIGNED 是他的暗号」。";
  expect(presentNotice(prose).text).toBe(prose);
});

it("hides unknown diagnostics in mixed failures and explicit code details", () => {
  expect(presentNotice("失败：UNKNOWN_BACKEND_ERROR，请重试").text).not.toContain(
    "UNKNOWN_BACKEND_ERROR",
  );
  const result = presentNotice({
    code: "CUSTOM_BACKEND_STATE",
    text: "失败：CUSTOM_BACKEND_STATE",
    detail: "这一场：CUSTOM_BACKEND_STATE，请重试。",
  });
  expect(result.notice.code).toBe("CUSTOM_BACKEND_STATE");
  expect(result.text).not.toContain("CUSTOM_BACKEND_STATE");
  expect(result.text).toContain("这一场");
});

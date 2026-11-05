import { describe, expect, it } from "vitest";
import approved from "./fixtures/claude-48a5825-notice-copy.json";
import { normalizeNotice, NOTICE_TEXT } from "./notices";

describe("B11 delivered Claude notice contract", () => {
  it("keeps old text routing stable when two codes now share approved wording", () => {
    expect(NOTICE_TEXT.USER_FIELDS_PRESERVED).toBe(NOTICE_TEXT.USER_EDIT_PRESERVED);
    expect(normalizeNotice("你改过的地方都留着。").code).toBe("USER_EDIT_PRESERVED");
    expect(
      normalizeNotice({ code: "USER_FIELDS_PRESERVED", text: "已保留你修改的字段。" }),
    ).toMatchObject({ code: "USER_FIELDS_PRESERVED", text: "你改过的地方都留着。" });
  });

  it("retains all 101 independently delivered code mappings", () => {
    expect(approved.sourceCommit).toBe("48a582582f5d83cabb0299f3862bcb92c38a8cae");
    expect(approved.entries).toHaveLength(101);
    expect(new Set(approved.entries.map((entry) => entry.code)).size).toBe(101);
  });

  it.each(approved.entries)("uses approved $code copy without losing details", (entry) => {
    expect(NOTICE_TEXT[entry.code as keyof typeof NOTICE_TEXT]).toBe(entry.text);
    const notice = normalizeNotice({ code: entry.code, text: entry.legacy, detail: "核对原请求" });
    expect(notice).toMatchObject({ code: entry.code, text: entry.text });
    expect(notice.detail).toContain("核对原请求");
    expect(normalizeNotice(entry.legacy).code).toBe(entry.code);
  });
});

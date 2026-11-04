import { describe, expect, it, vi } from "vitest";
import type { CreateProjectInput } from "../../api/studio";
import { PROJECT_CREATE_JOURNAL_KEY as key, ProjectCreateJournal } from "./projectCreateJournal";
const input: CreateProjectInput = {
  name: "原创建",
  aspect_ratio: "16:9",
  target_duration_seconds: 60,
  source_language: "zh-CN",
};
function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: vi.fn((k: string) => values.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => {
      values.set(k, v);
    }),
    removeItem: vi.fn((k: string) => {
      values.delete(k);
    }),
  };
}
describe("project creation intent single-renderer journal", () => {
  it("retains the complete original input before dispatch and restores it without a new UUID", () => {
    const s = storage(),
      j = new ProjectCreateJournal(s),
      request = { ...input };
    const intent = j.begin(request)!;
    const raw = s.values.get(key);
    request.name = "迟到修改";
    intent.input.name = "篡改返回副本";
    const reopened = new ProjectCreateJournal(s);
    expect(reopened.read()).toMatchObject({
      kind: "READY",
      intent: { client_intent_id: intent.client_intent_id, input },
    });
    expect(reopened.begin(input)).toBeNull();
    expect(s.values.get(key)).toBe(raw);
  });
  it.each([NaN, Infinity, 29, 181, 60.5, null, "60"])(
    "blocks invalid duration %s before any journal write",
    (value) => {
      const s = storage();
      expect(
        new ProjectCreateJournal(s).begin({
          ...input,
          target_duration_seconds: value,
        } as unknown as CreateProjectInput),
      ).toBeNull();
      expect(s.setItem).not.toHaveBeenCalled();
    },
  );
  it.each([
    { name: "" },
    { name: "bad\nname" },
    { name: "x".repeat(81) },
    { aspect_ratio: "1:1" },
    { source_language: "en" },
    { extra: true },
  ])("blocks invalid closed input %j", (change) => {
    const s = storage();
    expect(
      new ProjectCreateJournal(s).begin({ ...input, ...change } as CreateProjectInput),
    ).toBeNull();
    expect(s.setItem).not.toHaveBeenCalled();
  });
  it.each(["{bad", '{"version":2}', '{"version":1,"client_intent_id":"bad","input":{}}'])(
    "keeps corrupt/unsupported original bytes %s blocked",
    (raw) => {
      const s = storage();
      s.values.set(key, raw);
      const j = new ProjectCreateJournal(s);
      expect(j.read().kind).toBe("BLOCKED");
      expect(j.begin(input)).toBeNull();
      expect(s.values.get(key)).toBe(raw);
      s.values.delete(key);
      expect(j.read().kind).toBe("BLOCKED");
      expect(s.values.get(key)).toBe(raw);
    },
  );
  it("refuses unavailable or unverified storage before a write can dispatch", () => {
    expect(new ProjectCreateJournal(null).begin(input)).toBeNull();
    const s = storage();
    s.setItem.mockImplementation(() => {});
    const j = new ProjectCreateJournal(s);
    expect(j.begin(input)).toBeNull();
    expect(j.read().kind).toBe("BLOCKED");
  });
  it("restores only a missing owned original and never allows a replacement command", () => {
    const s = storage(),
      j = new ProjectCreateJournal(s);
    j.begin(input);
    const raw = s.values.get(key);
    s.values.delete(key);
    expect(j.begin({ ...input, name: "替代" })).toBeNull();
    expect(s.values.get(key)).toBe(raw);
  });
  it("rejects same UUID with a substituted body without clearing or overwriting either intent", () => {
    const s = storage(),
      j = new ProjectCreateJournal(s),
      intent = j.begin(input)!;
    const replacement = JSON.stringify({ ...intent, input: { ...input, name: "另一个" } });
    s.values.set(key, replacement);
    expect(j.complete(intent)).toBe(false);
    expect(j.read()).toMatchObject({ kind: "BLOCKED", intent: { input } });
    expect(s.values.get(key)).toBe(replacement);
  });
  it("removes only the exact original intent on confirmed direct success", () => {
    const s = storage(),
      j = new ProjectCreateJournal(s),
      intent = j.begin(input)!;
    expect(j.complete({ ...intent, client_intent_id: crypto.randomUUID() })).toBe(false);
    expect(j.complete(intent)).toBe(true);
    expect(s.values.has(key)).toBe(false);
    expect(j.read()).toEqual({ kind: "READY", intent: null });
  });
  it("retains UNKNOWN if removal fails after deleting bytes", () => {
    const s = storage(),
      j = new ProjectCreateJournal(s),
      intent = j.begin(input)!;
    const raw = s.values.get(key);
    s.removeItem.mockImplementation((k) => {
      s.values.delete(k);
      throw new Error("remove failed");
    });
    expect(j.complete(intent)).toBe(false);
    expect(s.values.get(key)).toBe(raw);
    expect(j.read().kind).toBe("BLOCKED");
    expect(j.begin(input)).toBeNull();
  });
});

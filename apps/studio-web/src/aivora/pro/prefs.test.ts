import { afterEach, describe, expect, it } from "vitest";
import { readPrefs, writePrefs } from "./prefs";

afterEach(() => window.localStorage.removeItem("aivora.prefs"));

describe("prefs", () => {
  it("starts with 「AI 生成」 on, no folder and no beginner mode", () => {
    expect(readPrefs()).toEqual({ exportDir: "", aiMark: true, beginner: false });
  });

  it("keeps what was chosen and ignores what it cannot read", () => {
    writePrefs({ exportDir: "/tmp/films", aiMark: false, beginner: true });
    expect(readPrefs()).toEqual({ exportDir: "/tmp/films", aiMark: false, beginner: true });
    window.localStorage.setItem("aivora.prefs", "{not json");
    expect(readPrefs().aiMark).toBe(true);
    window.localStorage.setItem("aivora.prefs", JSON.stringify({ exportDir: 3, beginner: "yes" }));
    expect(readPrefs()).toEqual({ exportDir: "", aiMark: true, beginner: false });
  });
});

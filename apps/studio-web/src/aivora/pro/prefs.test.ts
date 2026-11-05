import { afterEach, describe, expect, it } from "vitest";
import { readGroupOpen, readPrefs, writeGroupOpen, writePrefs } from "./prefs";

afterEach(() => {
  window.localStorage.removeItem("aivora.prefs");
  window.localStorage.removeItem("aivora.board.groups");
});

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

  it("remembers which property groups were left open", () => {
    expect(readGroupOpen("sound", false)).toBe(false);
    expect(readGroupOpen("picture", true)).toBe(true);
    writeGroupOpen("sound", true);
    writeGroupOpen("picture", false);
    expect(readGroupOpen("sound", false)).toBe(true);
    expect(readGroupOpen("picture", true)).toBe(false);
  });
});

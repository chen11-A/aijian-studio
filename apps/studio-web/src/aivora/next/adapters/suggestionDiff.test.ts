import { describe, expect, it } from "vitest";
import { suggestionCounts, suggestionDiff, type SuggestionItem } from "./suggestionDiff";

const items = (prefix: string, texts: string[]): SuggestionItem[] =>
  texts.map((text, index) => ({ id: `${prefix}${index + 1}`, text }));

const kinds = (current: string[], proposed: string[]) =>
  suggestionDiff(items("a", current), items("b", proposed)).map((row) =>
    row.kind === "changed"
      ? `~${row.before.text}>${row.item.text}`
      : `${row.kind}:${row.item.text}`,
  );

describe("suggestionDiff", () => {
  it("keeps equal lines in place and calls everything new added when nothing is there", () => {
    expect(kinds([], ["推门", "抬头"])).toEqual(["added:推门", "added:抬头"]);
    expect(kinds(["推门", "抬头"], ["推门", "抬头"])).toEqual(["same:推门", "same:抬头"]);
  });

  it("calls a line changed only when it reads alike, otherwise removed and added", () => {
    expect(
      kinds(["推门", "风铃", "抬头", "放信", "看字", "车灯"], ["推门", "抬头看她", "放信", "刹车"]),
    ).toEqual([
      "same:推门",
      "removed:风铃",
      "~抬头>抬头看她",
      "same:放信",
      "removed:看字",
      "removed:车灯",
      "added:刹车",
    ]);
  });

  it("ignores spacing and compares who is in it and how long it is", () => {
    const current = [{ id: "a", text: "推门  进来", who: "林晚", tail: "3s" }];
    expect(
      suggestionDiff(current, [{ id: "b", text: "推门 进来", who: "林晚", tail: "3s" }])[0]?.kind,
    ).toBe("same");
    expect(
      suggestionDiff(current, [{ id: "b", text: "推门 进来", who: "林晚", tail: "2s" }])[0]?.kind,
    ).toBe("changed");
  });

  it("counts what changes", () => {
    const rows = suggestionDiff(
      items("a", ["推门进来", "林晚抬头", "放信"]),
      items("b", ["推门进来", "林晚抬头看他", "刹车声", "车灯"]),
    );
    expect(suggestionCounts(rows)).toEqual({ added: 2, changed: 1, removed: 1 });
  });
});

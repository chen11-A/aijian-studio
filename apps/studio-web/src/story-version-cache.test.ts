import { describe, expect, it } from "vitest";

import { cacheRecentVersion, touchRecentVersion } from "./story-version-cache";

describe("cacheRecentVersion", () => {
  it("evicts the least recently used immutable version", () => {
    const first = new Map([
      ["v1", { id: "v1", label: "first" }],
      ["v2", { id: "v2", label: "second" }],
      ["v3", { id: "v3", label: "third" }],
    ]);

    const refreshed = cacheRecentVersion(first, { id: "v1", label: "first refreshed" });
    const extended = cacheRecentVersion(refreshed, { id: "v4", label: "fourth" });

    expect([...extended.keys()]).toEqual(["v3", "v1", "v4"]);
    expect(extended.get("v1")?.label).toBe("first refreshed");
    expect(first.get("v1")?.label).toBe("first");
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects an invalid capacity of %s",
    (maxEntries) => {
      expect(() => cacheRecentVersion(new Map(), { id: "v1" }, maxEntries)).toThrow(RangeError);
    },
  );

  it("refreshes a real cache hit before the next insertion", () => {
    const initial = new Map([
      ["v1", { id: "v1" }],
      ["v2", { id: "v2" }],
      ["v3", { id: "v3" }],
    ]);

    const touched = touchRecentVersion(initial, "v1");
    const extended = cacheRecentVersion(touched, { id: "v4" });

    expect([...extended.keys()]).toEqual(["v3", "v1", "v4"]);
    expect(touchRecentVersion(extended, "missing")).toBe(extended);
    expect(touchRecentVersion(extended, "v4")).toBe(extended);
  });
});

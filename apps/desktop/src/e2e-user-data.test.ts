import { join, resolve } from "node:path";

import { describe, expect, test } from "vitest";

import { resolveE2EUserDataDirectory } from "./e2e-user-data";

describe("development E2E user data isolation", () => {
  const allowedRoot = resolve("C:/workspace/.aijian-dev");

  test("keeps the ordinary development profile when no override is requested", () => {
    expect(resolveE2EUserDataDirectory(undefined, allowedRoot)).toBeNull();
  });

  test("accepts only an explicit child of the evidence root", () => {
    const requested = join(allowedRoot, "electron-timeline-profile-123");
    expect(resolveE2EUserDataDirectory(requested, allowedRoot)).toBe(resolve(requested));
  });

  test.each([
    ["relative", "profile"],
    ["the root itself", allowedRoot],
    ["a sibling", resolve(allowedRoot, "../other")],
  ])("rejects %s", (_label, requested) => {
    expect(() => resolveE2EUserDataDirectory(requested, allowedRoot)).toThrow(
      /absolute path|must be a child/,
    );
  });
});

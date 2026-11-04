import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("v2 role examples", () => {
  it("are read by the app parsers", () => {
    const root = resolve(__dirname, "../../../../..");
    const output = execFileSync("node", ["packages/aivora-prompts/scripts/check-app-parsers.mjs"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(output).toContain("全部读对");
  });
});

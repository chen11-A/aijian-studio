import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, test } from "vitest";

test("all public contracts load in native Node without bundler extension substitution", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import { readFileSync } from "node:fs";
    const manifest = JSON.parse(readFileSync("package.json", "utf8"));
    for (const key of Object.keys(manifest.exports)) {
      await import(manifest.name + (key === "." ? "" : key.slice(1)));
    }
  `,
    ],
    {
      cwd: resolve(__dirname, "../../../packages/contracts"),
      encoding: "utf8",
      timeout: 15_000,
      windowsHide: true,
    },
  );
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
});

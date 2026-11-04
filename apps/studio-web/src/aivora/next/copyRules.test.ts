// Words the shipped workspace must never show (3J-U04, 3J-U13): it only signs in with a Grok
// membership, and the old 「草稿成片…不是实拍」 wording is gone. Checks the source of the
// workspace (pro/) and of the components it uses (next/), tests excluded.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("workspace wording", () => {
  it("never shows ChatGPT, 不是实拍, 正式发行 or a doubled full stop", () => {
    const testPath = expect.getState().testPath;
    if (!testPath) throw new Error("vitest did not say where this test file is");
    const here = dirname(testPath);
    const files = [...walk(here), ...walk(join(here, "../pro"))];
    expect(files.length).toBeGreaterThan(20);
    for (const file of files) {
      const text = readFileSync(file, "utf8")
        // Comments and the INTEGRATION notes may name what was removed.
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      expect(text, file).not.toMatch(/ChatGPT|不是实拍|正式发行|。。/);
    }
  });
});

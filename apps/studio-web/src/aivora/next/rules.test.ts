// Checks rules every file in next/ keeps: CSS uses only pro.css custom properties and no
// literal colors, every selector is scoped, nothing calls the desktop bridge, the network or
// storage, and imports stay within react and next/, except that volume.ts and adapters/ use the
// film helpers whose data they convert. CSS is read from disk: with vitest's default css
// setting a CSS import, even with ?raw, comes back as an empty string.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

type File = { path: string; text: string };

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

function load(): { pro: string; own: File[] } {
  const testPath = expect.getState().testPath;
  if (!testPath) throw new Error("vitest did not say where this test file is");
  const here = dirname(testPath);
  const own = walk(here)
    .filter((path) => /\.(css|tsx?)$/.test(path) && !/\.test\.tsx?$/.test(path))
    .map((path) => ({
      path: relative(here, path).split("\\").join("/"),
      text: readFileSync(path, "utf8"),
    }));
  return { pro: readFileSync(join(here, "../pro/pro.css"), "utf8"), own };
}

const withoutComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "");

describe("next/ styles", () => {
  it("finds the files it checks", () => {
    const { pro, own } = load();
    expect(pro).toContain(".pro-root");
    const next = own.find((file) => file.path === "next.css");
    expect(next?.text).toContain(".nx-root");
    expect(own.filter((file) => file.path.endsWith(".css")).length).toBeGreaterThanOrEqual(8);
  });

  it("only uses custom properties that pro.css defines", () => {
    const { pro, own } = load();
    const defined = new Set([...pro.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1]));
    let checked = 0;
    for (const file of own.filter((item) => /\.(css|tsx)$/.test(item.path))) {
      for (const match of file.text.matchAll(/var\((--[a-z0-9-]+)/g)) {
        const name = match[1]!;
        checked += 1;
        expect(defined.has(name), `${file.path} uses ${name}`).toBe(true);
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it("falls back to --accent wherever --accent-strong is used", () => {
    for (const file of load().own) {
      const uses = file.text.match(/var\(--accent-strong/g)?.length ?? 0;
      const withFallback = file.text.match(/var\(--accent-strong, var\(--accent\)\)/g)?.length ?? 0;
      expect(uses, file.path).toBe(withFallback);
    }
  });

  it("has no colors of its own", () => {
    for (const file of load().own.filter((item) => item.path.endsWith(".css"))) {
      expect(withoutComments(file.text), file.path).not.toMatch(
        /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|(?<![\w-])(white|black)(?![\w-])/,
      );
    }
  });

  it("scopes its rules so they cannot leak into the rest of the app", () => {
    for (const file of load().own.filter((item) => item.path.endsWith(".css"))) {
      const selectors = [...withoutComments(file.text).matchAll(/([^{};]+)\{/g)]
        .map((match) => match[1]!.trim())
        .filter((selector) => !selector.startsWith("@") && !/^(from|to|\d+%)$/.test(selector));
      expect(selectors.length, file.path).toBeGreaterThan(0);
      for (const group of selectors) {
        for (const selector of group.split(",").map((part) => part.trim())) {
          expect(selector, file.path).toMatch(/^(\.nx-root|\.pro-root\.nx-story)\b/);
        }
      }
    }
  });
});

describe("next/ components", () => {
  it("talk to nothing but their props: no bridge, IPC, network or storage", () => {
    for (const file of load().own.filter((item) => /\.tsx?$/.test(item.path))) {
      expect(file.text, file.path).not.toMatch(
        /window\.aijian|ipcRenderer|\bfetch\(|XMLHttpRequest|localStorage|sessionStorage|WebSocket/,
      );
    }
  });

  it("import only React and each other; stories load the styles, adapters the film helpers", () => {
    for (const file of load().own.filter((item) => /\.tsx?$/.test(item.path))) {
      const story = file.path.startsWith("stories/");
      const adapter = file.path.startsWith("adapters/");
      for (const match of file.text.matchAll(/(?:import|from)\s+["']([^"']+)["']/g)) {
        const spec = match[1]!;
        const allowed =
          spec === "react" ||
          (spec === "react-dom/client" && file.path === "stories/main.tsx") ||
          spec.startsWith("./") ||
          (file.path === "volume.ts" && spec === "../film/audio") ||
          (story && (spec === "../../pro/pro.css" || spec === "../next.css")) ||
          (story && /^\.\.\/[A-Za-z]+(\.story)?$/.test(spec)) ||
          (adapter && /^\.\.\/[A-Za-z]+$/.test(spec)) ||
          (adapter && /^\.\.\/\.\.\/film\/(audio|operations|project)$/.test(spec));
        expect(allowed, `${file.path} imports ${spec}`).toBe(true);
      }
    }
  });
});

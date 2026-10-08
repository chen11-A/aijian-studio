import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveAppUiRuntime } from "./app-ui-runtime";

function fixture(withRenderer = true) {
  const parent = join(process.env.AIJIAN_APP_UI_OUTPUT!, "temp", ".aijian-dev");
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, "app-ui-e1-test-"));
  const compiled = join(root, "build", "desktop");
  const renderer = join(root, "build", "renderer", "app-ui", "index.html");
  mkdirSync(compiled, { recursive: true });
  if (withRenderer) {
    mkdirSync(join(root, "build", "renderer", "app-ui"), { recursive: true });
    writeFileSync(renderer, "<!doctype html><title>fixture</title>", { flag: "wx" });
  }
  return { root, compiled, renderer };
}

describe("local App UI runtime boundary", () => {
  it("keeps ordinary product startup unchanged without the explicit App UI flag", () => {
    expect(resolveAppUiRuntime([], "not-a-runtime", false)).toBeNull();
  });

  it("selects only the compiled local workbench in its owned artifact root", () => {
    const paths = fixture();
    expect(resolveAppUiRuntime(["--aivora-app-ui"], paths.compiled, false)).toEqual({
      root: paths.root,
      renderer: paths.renderer,
    });
  });

  it("rejects this local candidate mode in packaged distribution", () => {
    const paths = fixture();
    expect(() => resolveAppUiRuntime(["--aivora-app-ui"], paths.compiled, true)).toThrow(
      /local candidate/,
    );
  });

  it("rejects an ordinary source directory before any profile or backend is created", () => {
    expect(() => resolveAppUiRuntime(["--aivora-app-ui"], process.cwd(), false)).toThrow(
      /owned artifact/,
    );
  });

  it("fails closed when the compiled renderer is missing instead of using a web URL", () => {
    const paths = fixture(false);
    expect(() => resolveAppUiRuntime(["--aivora-app-ui"], paths.compiled, false)).toThrow(
      /renderer/,
    );
  });
});

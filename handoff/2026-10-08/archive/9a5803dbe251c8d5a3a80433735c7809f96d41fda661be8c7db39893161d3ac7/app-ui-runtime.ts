import { existsSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

export type AppUiRuntime = {
  root: string;
  renderer: string;
};

export function resolveAppUiRuntime(
  args: readonly string[],
  compiledDirectory: string,
  isPackaged: boolean,
): AppUiRuntime | null {
  if (!args.includes("--aivora-app-ui")) return null;
  if (isPackaged) throw new Error("App UI mode is a local candidate, not a packaged distribution");
  const directory = resolve(compiledDirectory);
  const root = resolve(directory, "../..");
  if (
    basename(dirname(root)) !== ".aijian-dev" ||
    !basename(root).startsWith("app-ui-e1-") ||
    relative(join(root, "build", "desktop"), directory) !== "" ||
    !existsSync(directory) ||
    relative(directory, realpathSync(directory)) !== ""
  ) {
    throw new Error("App UI must run from its owned artifact build/desktop directory");
  }
  const renderer = join(root, "build", "renderer", "app-ui", "index.html");
  if (
    !existsSync(renderer) ||
    !statSync(renderer).isFile() ||
    relative(renderer, realpathSync(renderer)) !== ""
  ) {
    throw new Error("Compiled App UI renderer is missing or outside its owned artifact path");
  }
  return { root, renderer };
}

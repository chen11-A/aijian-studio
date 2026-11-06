import { stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
export type ProjectArchiveEngine = {
  archiveProject: (input: { projectDir: string; output: string }) => Promise<string>;
  restoreProject: (input: { archive: string; destination: string }) => Promise<string>;
};
/** Fixed bundled .mjs entry uses only Node builtins; no renderer/module-path selection. */
export async function loadProjectArchiveEngine(root: string): Promise<ProjectArchiveEngine> {
  const entry = join(root, "archive.mjs");
  if (!(await stat(entry)).isFile()) throw Error("RUNTIME_UNAVAILABLE");
  const module: unknown = await import(pathToFileURL(entry).href);
  if (
    !module ||
    typeof module !== "object" ||
    !("archiveProject" in module) ||
    !("restoreProject" in module) ||
    typeof module.archiveProject !== "function" ||
    typeof module.restoreProject !== "function"
  )
    throw Error("RUNTIME_UNAVAILABLE");
  return module as ProjectArchiveEngine;
}

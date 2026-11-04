import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { run } from "./process.mjs";
const helper = fileURLToPath(new URL("./archive.py", import.meta.url));

/** Archive the complete project directory, including relative asset/render paths. */
export async function archiveProject({ projectDir, output, pythonPath = "python3" }) {
  await run(pythonPath, [helper, "pack", path.resolve(projectDir), path.resolve(output)]);
  return path.resolve(output);
}

/** Destination must not exist; malformed archives never publish a partial project. */
export async function restoreProject({ archive, destination, pythonPath = "python3" }) {
  await run(pythonPath, [helper, "restore", path.resolve(archive), path.resolve(destination)]);
  return path.resolve(destination);
}

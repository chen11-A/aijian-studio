import { lstatSync, readFileSync } from "node:fs";
import { posix, win32 } from "node:path";

export function developmentPythonLaunch(
  repositoryRoot: string,
  platform: NodeJS.Platform = process.platform,
): { command: string; env: NodeJS.ProcessEnv } {
  if (platform !== "win32") {
    return { command: posix.join(repositoryRoot, ".venv", "bin", "python"), env: {} };
  }
  const venv = win32.join(repositoryRoot, ".venv");
  const launcher = win32.join(venv, "Scripts", "python.exe");
  const configPath = win32.join(venv, "pyvenv.cfg");
  const configInfo = lstatSync(configPath);
  if (!configInfo.isFile() || configInfo.isSymbolicLink() || configInfo.size > 65_536) {
    throw new Error("Development Python environment metadata is invalid");
  }
  const homes = readFileSync(configPath, "utf8")
    .split(/\r?\n/)
    .filter((line) => /^home\s*=/i.test(line.trim()))
    .map((line) => line.slice(line.indexOf("=") + 1).trim());
  const home = homes[0];
  if (
    homes.length !== 1 ||
    !home ||
    !/^[A-Za-z]:[\\/]/.test(home) ||
    [...home].some((character) => character.charCodeAt(0) < 32) ||
    home.split(/[\\/]/).includes("..")
  ) {
    throw new Error("Development Python requires one absolute local interpreter home");
  }
  const command = win32.join(home, "python.exe");
  if (command.toLowerCase() === launcher.toLowerCase()) {
    throw new Error("Development Python must not launch its redirector recursively");
  }
  for (const path of [command, launcher]) {
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error("Development Python executable is unavailable");
    }
  }
  // CPython's Windows venv executable creates another PID. Launch the same
  // interpreter directly with venv path setup; strict pipe PID checks stay intact.
  // https://github.com/python/cpython/blob/v3.12.15/Modules/getpath.py#L261-L277
  return { command, env: { __PYVENV_LAUNCHER__: launcher } };
}

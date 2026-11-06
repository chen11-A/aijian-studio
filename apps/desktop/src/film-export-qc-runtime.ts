import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute = promisify(execFile);
export type QcEngine = (
  path: string,
  options: {
    ffmpegPath: string;
    ffprobePath: string;
    srtPath?: string;
    dialogue?: { start: number; end: number }[];
  },
) => Promise<unknown>;
export type QcTools = { ffmpegPath: string; ffprobePath: string };
async function digest(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
/** Both hashes are checked before either binary executes; no PATH discovery. */
export async function verifiedQcTools(
  root: string,
  lockPath: string,
  platform = process.platform,
  readVersion: (binary: string) => Promise<string> = async (binary) =>
    (await execute(binary, ["-version"], { timeout: 10000, maxBuffer: 65536, encoding: "utf8" }))
      .stdout,
): Promise<QcTools> {
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  if (
    lock.schema_version !== 1 ||
    !/^\d+\.\d+\.\d+$/.test(lock.expected_version) ||
    !Array.isArray(lock.profiles)
  )
    throw new Error("TOOLS_UNAVAILABLE");
  const suffix = platform === "win32" ? ".exe" : "";
  const [ffmpegPath, ffprobePath] = await Promise.all([
    realpath(join(root, `ffmpeg${suffix}`)),
    realpath(join(root, `ffprobe${suffix}`)),
  ]);
  if (
    ffmpegPath === ffprobePath ||
    dirname(ffmpegPath) !== dirname(ffprobePath) ||
    !(await stat(ffmpegPath)).isFile() ||
    !(await stat(ffprobePath)).isFile()
  )
    throw new Error("TOOLS_UNAVAILABLE");
  const [ffmpegHash, ffprobeHash] = await Promise.all([digest(ffmpegPath), digest(ffprobePath)]);
  const profile = lock.profiles.find(
    (item: Record<string, unknown>) =>
      item.ffmpeg_sha256 === ffmpegHash && item.ffprobe_sha256 === ffprobeHash,
  );
  if (
    !profile ||
    !["LGPL", "GPL", "NONFREE"].includes(profile.license_class) ||
    !["DEVELOPMENT_ONLY", "RELEASE_REVIEW_REQUIRED"].includes(profile.distribution_status) ||
    (profile.license_class !== "LGPL" && profile.distribution_status !== "DEVELOPMENT_ONLY")
  )
    throw new Error("TOOLS_UNAVAILABLE");
  for (const [binary, name] of [
    [ffmpegPath, "ffmpeg"],
    [ffprobePath, "ffprobe"],
  ]) {
    const stdout = await readVersion(binary!);
    const version = stdout.match(
      new RegExp(`^${name} version (?:n)?(\\d+\\.\\d+\\.\\d+)(?:[ -]|$)`),
    )?.[1];
    const licence = stdout.includes("--enable-nonfree")
      ? "NONFREE"
      : stdout.includes("--enable-gpl")
        ? "GPL"
        : "LGPL";
    if (version !== lock.expected_version || licence !== profile.license_class)
      throw new Error("TOOLS_UNAVAILABLE");
  }
  return { ffmpegPath, ffprobePath };
}
/** Same four source files are staged into packaged resources/qc; no external module lookup. */
export async function loadQcEngine(root: string): Promise<QcEngine> {
  for (const name of ["index.mjs", "media.mjs", "rules.mjs", "subtitles.mjs"])
    if (!(await stat(join(root, name))).isFile()) throw new Error("CHECK_FAILED");
  const engine: unknown = await import(pathToFileURL(join(root, "index.mjs")).href);
  if (
    !engine ||
    typeof engine !== "object" ||
    !("checkExport" in engine) ||
    typeof engine.checkExport !== "function"
  )
    throw new Error("CHECK_FAILED");
  return engine.checkExport as QcEngine;
}

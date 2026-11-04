import { spawnSync } from "node:child_process";

/** Both tools must be resolvable. A missing pair is a skip, not a failed suite. */
export function ffmpegOnPath(): boolean {
  const finder = process.platform === "win32" ? "where" : "which";
  return ["ffmpeg", "ffprobe"].every((tool) => {
    const result = spawnSync(finder, [tool], { stdio: "ignore" });
    return result.status === 0;
  });
}

export const ffmpegSkipReason = "ffmpeg and ffprobe are not both on PATH";

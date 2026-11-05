import { lstat, mkdir, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import { dirname, extname, relative, isAbsolute } from "node:path";
import { mediaUrlPath, stillPath, trustedMediaPath } from "./film-library";

export type LastFrameHost = {
  roots: string[];
  filmsRoot: string;
  runFfmpeg: (args: string[]) => Promise<void>;
  probeDuration: (path: string) => Promise<number>;
  current?: () => boolean;
};
function failure(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

/** Extract the decoded last frame of a short, trusted local shot, without a supplier request. */
export async function extractFilmLastFrame(
  seriesId: string,
  videoPath: string,
  host: LastFrameHost,
): Promise<{ path: string; sourceVideoPath: string }> {
  const current = () => host.current?.() ?? true;
  if (!current()) throw failure("CONTINUITY_REQUEST_STALE");
  let source: string;
  try {
    source = trustedMediaPath(host.roots, mediaUrlPath(videoPath));
    if (extname(source).toLowerCase() !== ".mp4") throw failure("CONTINUITY_VIDEO_INVALID");
    const info = await stat(source);
    if (!info.isFile() || info.size === 0 || info.size > 80 * 1024 * 1024)
      throw failure("CONTINUITY_VIDEO_INVALID");
  } catch {
    throw failure("CONTINUITY_VIDEO_INVALID");
  }
  let duration: number;
  try {
    duration = await host.probeDuration(source);
  } catch {
    throw failure("CONTINUITY_PROBE_FAILED");
  }
  if (!current()) throw failure("CONTINUITY_REQUEST_STALE");
  if (!Number.isFinite(duration) || duration <= 0 || duration > 60)
    throw failure("CONTINUITY_DURATION_INVALID");
  const destination = stillPath(host.filmsRoot, seriesId);
  const folder = dirname(destination);
  try {
    const root = await realpath(host.filmsRoot);
    const assertContained = async (path: string) => {
      const inside = relative(root, await realpath(path));
      if (inside.startsWith("..") || isAbsolute(inside))
        throw failure("CONTINUITY_DESTINATION_INVALID");
    };
    // Inspect the nearest existing ancestor before mkdir follows any directory links.
    // lstat also detects dangling links: their realpath must fail, not be treated as absent.
    let ancestor = folder;
    for (;;) {
      try {
        await lstat(ancestor);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        const parent = dirname(ancestor);
        if (parent === ancestor) throw failure("CONTINUITY_DESTINATION_INVALID");
        ancestor = parent;
      }
    }
    await assertContained(ancestor);
    await mkdir(folder, { recursive: true });
    await assertContained(folder);
  } catch {
    throw failure("CONTINUITY_DESTINATION_INVALID");
  }
  const temporary = `${destination}.partial.png`;
  try {
    if (!current()) throw failure("CONTINUITY_REQUEST_STALE");
    // update=1 preserves only the latest decoded frame. No FPS-based seek or frame duplication.
    await host.runFfmpeg([
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-y",
      "-protocol_whitelist",
      "file,pipe",
      "-i",
      source,
      "-map",
      "0:v:0",
      "-an",
      "-sn",
      "-dn",
      "-vsync",
      "0",
      "-c:v",
      "png",
      "-update",
      "1",
      temporary,
    ]);
    if (!current()) throw failure("CONTINUITY_REQUEST_STALE");
    const info = await stat(temporary);
    if (!info.isFile() || info.size < 24 || info.size > 12 * 1024 * 1024)
      throw failure("CONTINUITY_FRAME_INVALID");
    const bytes = await readFile(temporary);
    if (
      !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      bytes.toString("ascii", 12, 16) !== "IHDR" ||
      bytes.readUInt32BE(16) === 0 ||
      bytes.readUInt32BE(20) === 0
    )
      throw failure("CONTINUITY_FRAME_INVALID");
    await rename(temporary, destination);
    if (!current()) {
      await rm(destination, { force: true });
      throw failure("CONTINUITY_REQUEST_STALE");
    }
    return { path: destination, sourceVideoPath: source };
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      typeof error.code === "string" &&
      error.code.startsWith("CONTINUITY_")
    )
      throw error;
    throw failure("CONTINUITY_EXTRACTION_FAILED");
  } finally {
    await rm(temporary, { force: true });
  }
}

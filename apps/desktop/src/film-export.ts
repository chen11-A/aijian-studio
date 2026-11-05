import { copyFile, lstat, mkdtemp, realpath, rename, rm, stat } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";
import { safeExportName } from "./film-library";

export type FilmExportOptions = { aspectRatio?: "16:9" | "9:16"; requestId?: string };

export function filmExportOptions(value: unknown): FilmExportOptions {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("EXPORT_OPTIONS_INVALID");
  const options = value as Record<string, unknown>;
  if (
    Object.keys(options).some((key) => !["aspectRatio", "requestId"].includes(key)) ||
    (options.aspectRatio !== undefined &&
      options.aspectRatio !== "16:9" &&
      options.aspectRatio !== "9:16") ||
    (options.requestId !== undefined &&
      (typeof options.requestId !== "string" || !/^[\w:-]{1,128}$/.test(options.requestId)))
  ) {
    throw new Error("EXPORT_OPTIONS_INVALID");
  }
  return options as FilmExportOptions;
}

export function filmCropFilter(ratio: "16:9" | "9:16"): string {
  const [w, h] = ratio.split(":").map(Number);
  const unit = `floor(min(iw/${w},ih/${h})/2)*2`;
  return `scale=trunc(iw*sar/2)*2:ih,setsar=1,crop=w='${w}*${unit}':h='${h}*${unit}':x='(iw-ow)/2':y='(ih-oh)/2'`;
}

/** Source must already have passed trustedMediaPath. Cancellation prevents publication;
 * the legacy runFfmpeg host cannot terminate a running process. */
export async function exportFilmFile(
  source: string,
  directory: string,
  name: string | undefined,
  options: FilmExportOptions,
  runFfmpeg: (args: string[]) => Promise<void>,
  cancelled: () => boolean = () => false,
): Promise<string> {
  const check = () => {
    if (cancelled())
      throw Object.assign(new Error("EXPORT_CANCELLED"), { code: "EXPORT_CANCELLED" });
  };
  check();
  if (!directory || directory.length > 4096 || directory.includes("\0") || !isAbsolute(directory))
    throw new Error("EXPORT_DIRECTORY_INVALID");
  const folder = await realpath(directory);
  if (!(await stat(folder)).isDirectory()) throw new Error("EXPORT_DIRECTORY_INVALID");
  const stem = safeExportName(name ?? basename(source)).replace(/\.mp4$/i, "");
  const destination = join(
    folder,
    `${stem}${options.aspectRatio ? `-${options.aspectRatio.replace(":", "x")}` : ""}.mp4`,
  );
  const sourceInfo = await stat(source);
  const validateDestination = async () => {
    if (resolve(source) === destination) throw new Error("EXPORT_SOURCE_OVERWRITE");
    const existing = await lstat(destination).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return null;
    });
    if (
      existing?.isSymbolicLink() ||
      (existing && existing.dev === sourceInfo.dev && existing.ino === sourceInfo.ino)
    )
      throw new Error("EXPORT_SOURCE_OVERWRITE");
  };
  await validateDestination();
  const temporary = await mkdtemp(join(folder, ".aivora-export-"));
  try {
    const output = join(temporary, "output.mp4");
    if (options.aspectRatio) {
      await runFfmpeg([
        "-nostdin",
        "-y",
        "-protocol_whitelist",
        "file,pipe",
        "-i",
        source,
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-vf",
        filmCropFilter(options.aspectRatio),
        "-c:v",
        "libx264",
        "-crf",
        "18",
        "-preset",
        "medium",
        "-c:a",
        "copy",
        "-sn",
        "-dn",
        "-movflags",
        "+faststart",
        output,
      ]);
    } else await copyFile(source, output);
    check();
    const result = await stat(output);
    if (!result.isFile() || result.size === 0) throw new Error("EXPORT_OUTPUT_INVALID");
    await validateDestination();
    check();
    await rename(output, destination);
    return destination;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

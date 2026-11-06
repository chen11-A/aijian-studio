import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";
import { safeExportName } from "./film-library";
import {
  SUBTITLE_FONT_FILE,
  SUBTITLE_LOOKS,
  coverAss,
  exportCanvas,
  subtitleAss,
  subtitleSrt,
  validCover,
  validCues,
  type ExportCanvasAspect,
  type ExportCover,
  type ExportCue,
  type ExportQuality,
  type SubtitleLook,
  type SubtitleMode,
} from "./film-subtitles";

export type FilmExportOptions = {
  /** Crop to this frame (the other aspect than the work's). */
  aspectRatio?: "16:9" | "9:16";
  requestId?: string;
  /** 4B-B09: the frame the export ends up in, the work's own unless aspectRatio crops. */
  canvas?: ExportCanvasAspect;
  quality?: ExportQuality;
  subtitles?: { mode: SubtitleMode; style: SubtitleLook; cues: ExportCue[] };
  /** `still` is a saved picture path or media URL, checked by the IPC host before use. */
  cover?: ExportCover & { still?: string };
};

/** Files the export writes beside the film. */
export type FilmExportExtras = { subtitlePath?: string; coverPath?: string };

/** Resolved by the main process, never taken from the renderer. */
export type FilmExportMedia = { fontFile?: string; coverStill?: string };

export type RunFfmpeg = (
  args: string[],
  options?: { cwd?: string; env?: Record<string, string> },
) => Promise<void>;

export function filmExportOptions(value: unknown): FilmExportOptions {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("EXPORT_OPTIONS_INVALID");
  const options = value as Record<string, unknown>;
  const aspect = (item: unknown) => item === undefined || item === "16:9" || item === "9:16";
  if (
    Object.keys(options).some(
      (key) =>
        !["aspectRatio", "requestId", "canvas", "quality", "subtitles", "cover"].includes(key),
    ) ||
    !aspect(options.aspectRatio) ||
    !aspect(options.canvas) ||
    (options.quality !== undefined && options.quality !== "1080p" && options.quality !== "720p") ||
    (options.requestId !== undefined &&
      (typeof options.requestId !== "string" || !/^[\w:-]{1,128}$/.test(options.requestId)))
  ) {
    throw new Error("EXPORT_OPTIONS_INVALID");
  }
  const result: FilmExportOptions = {
    ...(options.aspectRatio ? { aspectRatio: options.aspectRatio as "16:9" | "9:16" } : {}),
    ...(options.requestId ? { requestId: options.requestId as string } : {}),
    ...(options.canvas ? { canvas: options.canvas as ExportCanvasAspect } : {}),
    ...(options.quality ? { quality: options.quality as ExportQuality } : {}),
  };
  if (options.subtitles !== undefined) {
    const subtitles = options.subtitles as Record<string, unknown> | null;
    if (
      !subtitles ||
      typeof subtitles !== "object" ||
      Array.isArray(subtitles) ||
      Object.keys(subtitles).some((key) => !["mode", "style", "cues"].includes(key)) ||
      !["burn", "srt", "none"].includes(subtitles.mode as string) ||
      !SUBTITLE_LOOKS.includes(subtitles.style as SubtitleLook)
    )
      throw new Error("EXPORT_OPTIONS_INVALID");
    result.subtitles = {
      mode: subtitles.mode as SubtitleMode,
      style: subtitles.style as SubtitleLook,
      cues: validCues(subtitles.cues ?? []),
    };
  }
  if (options.cover !== undefined) result.cover = validCover(options.cover);
  return result;
}

/** The new options turn on the rendering path; older callers keep copy or crop as before. */
function rendered(options: FilmExportOptions): boolean {
  return Boolean(options.quality || options.subtitles || options.cover);
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
  runFfmpeg: RunFfmpeg,
  cancelled: () => boolean = () => false,
  media: FilmExportMedia = {},
  report?: (extras: FilmExportExtras) => void,
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
    let side: { srt: string; cover: string } = { srt: "", cover: "" };
    if (rendered(options)) {
      side = await renderFilm(source, temporary, output, options, media, runFfmpeg, check);
    } else if (options.aspectRatio) {
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
    const extras: FilmExportExtras = {};
    if (side.srt) {
      extras.subtitlePath = destination.replace(/\.mp4$/i, ".srt");
      await rename(side.srt, extras.subtitlePath);
    }
    if (side.cover) {
      extras.coverPath = destination.replace(/\.mp4$/i, "-封面.png");
      await rename(side.cover, extras.coverPath);
    }
    report?.(extras);
    return destination;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

/**
 * 4B-B09: one FFmpeg pass that crops (for the other aspect), scales to the chosen quality,
 * burns the subtitles in the chosen look and puts the cover in as the file's picture.
 * FFmpeg runs inside the temporary folder, so the .ass files and fonts are relative names and
 * no path ever needs filter escaping (a Windows drive letter would end the option).
 */
async function renderFilm(
  source: string,
  work: string,
  output: string,
  options: FilmExportOptions,
  media: FilmExportMedia,
  run: RunFfmpeg,
  check: () => void,
): Promise<{ srt: string; cover: string }> {
  const aspect = options.aspectRatio ?? options.canvas;
  if (!aspect) throw new Error("EXPORT_OPTIONS_INVALID");
  const frame = exportCanvas(aspect, options.quality ?? "1080p");
  const subtitles = options.subtitles;
  const burn = subtitles?.mode === "burn" && subtitles.cues.length > 0;
  const text = burn || Boolean(options.cover);
  let env: Record<string, string> | undefined;
  if (text) {
    if (!media.fontFile) throw new Error("EXPORT_FONT_MISSING");
    await mkdir(join(work, "fonts"));
    await copyFile(media.fontFile, join(work, "fonts", SUBTITLE_FONT_FILE));
    // Only the shipped face: no scan of the system's fonts, the same on Windows and Linux.
    const config = join(work, "fonts.conf");
    await writeFile(
      config,
      '<?xml version="1.0"?>\n<fontconfig><dir prefix="relative">fonts</dir><cachedir prefix="relative">fontcache</cachedir></fontconfig>\n',
      "utf8",
    );
    env = { FONTCONFIG_FILE: config };
  }
  const here = (args: string[]) => run(args, { cwd: work, ...(env ? { env } : {}) });
  const size = `${frame.width}:${frame.height}`;
  let cover = "";
  if (options.cover) {
    await writeFile(join(work, "cover.ass"), coverAss(options.cover, frame), "utf8");
    await here([
      "-nostdin",
      "-y",
      ...(media.coverStill
        ? ["-i", media.coverStill]
        : ["-f", "lavfi", "-i", `color=c=0x0e1014:s=${frame.width}x${frame.height}`]),
      "-vf",
      [
        media.coverStill
          ? `scale=${size}:force_original_aspect_ratio=increase,crop=${size},setsar=1`
          : "",
        "ass=cover.ass:fontsdir=fonts",
      ]
        .filter(Boolean)
        .join(","),
      "-frames:v",
      "1",
      "cover.png",
    ]);
    check();
    cover = join(work, "cover.png");
  }
  const filters = [
    options.aspectRatio ? filmCropFilter(options.aspectRatio) : "",
    `scale=${size}:force_original_aspect_ratio=decrease,pad=${size}:(ow-iw)/2:(oh-ih)/2,setsar=1`,
  ];
  let srt = "";
  if (subtitles && subtitles.cues.length) {
    if (burn) {
      await writeFile(
        join(work, "subs.ass"),
        subtitleAss(subtitles.cues, subtitles.style, frame),
        "utf8",
      );
      filters.push("ass=subs.ass:fontsdir=fonts");
    } else if (subtitles.mode === "srt") {
      srt = join(work, "film.srt");
      await writeFile(srt, subtitleSrt(subtitles.cues, subtitles.style, frame), "utf8");
    }
  }
  await here([
    "-nostdin",
    "-y",
    "-protocol_whitelist",
    "file,pipe",
    "-i",
    source,
    ...(cover ? ["-i", "cover.png"] : []),
    "-map",
    "0:v:0",
    "-map",
    "0:a?",
    ...(cover ? ["-map", "1:v:0"] : []),
    "-filter:v:0",
    filters.filter(Boolean).join(","),
    "-c:v:0",
    "libx264",
    "-crf",
    "18",
    "-preset",
    "medium",
    "-pix_fmt:v:0",
    "yuv420p",
    ...(cover ? ["-c:v:1", "mjpeg", "-disposition:v:1", "attached_pic"] : []),
    "-c:a",
    "copy",
    "-sn",
    "-dn",
    // The implicit label for AI-generated media, whatever the cover shows.
    "-metadata",
    "comment=AI-generated",
    "-movflags",
    "+faststart",
    output,
  ]);
  return { srt, cover };
}

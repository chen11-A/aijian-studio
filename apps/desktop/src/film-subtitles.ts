/**
 * 4B-B09: export-time subtitles and cover text, written as ASS for FFmpeg's libass filter.
 *
 * One `ass=` filter carries every cue, however many there are, so the command line stays short
 * on Windows. User text only ever goes into the .ass file, never into filter syntax. The looks
 * follow the 「字幕样式」 preview in the studio (next/SubtitleStyle.css): sizes and margins are
 * the same fractions of the frame height, the portrait lines wrap at 12 characters, and the
 * portrait subtitle sits above the platforms' buttons.
 */

export type SubtitleMode = "burn" | "srt" | "none";
export type SubtitleLook = "white" | "bar" | "yellow" | "film";
export type ExportQuality = "1080p" | "720p";
export type ExportCanvasAspect = "16:9" | "9:16";
/** Seconds from the start of the exported film. */
export type ExportCue = { text: string; start: number; end: number };
export type ExportCover = { title: string; subtitle: string; aiMark: boolean };
export type Canvas = { width: number; height: number };

export const SUBTITLE_LOOKS: readonly SubtitleLook[] = ["white", "bar", "yellow", "film"];
/** The face the installers ship (apps/studio-web/src/aivora/assets/v2). */
export const SUBTITLE_FONT_FILE = "NotoSansCJKsc-Regular.otf";
const FONT_FAMILY = "Noto Sans CJK SC";

export function exportCanvas(aspect: ExportCanvasAspect, quality: ExportQuality): Canvas {
  const short = quality === "720p" ? 720 : 1080;
  const long = Math.round((short * 16) / 9);
  return aspect === "9:16" ? { width: short, height: long } : { width: long, height: short };
}

/**
 * The studio's wrapLine (next/SubtitleStyle.tsx): break after 。！？，；、 so no line is longer
 * than max characters; a piece longer than max is cut every max characters.
 */
export function wrapSubtitle(text: string, max: number): string[] {
  const limit = Math.max(1, Math.floor(max));
  const lines: string[] = [];
  let current = "";
  for (const piece of text.split(/(?<=[。！？，；、])/u)) {
    if ([...current].length + [...piece].length <= limit) {
      current += piece;
      continue;
    }
    if (current) lines.push(current);
    const chars = [...piece];
    while (chars.length > limit) lines.push(chars.splice(0, limit).join(""));
    current = chars.join("");
  }
  if (current) lines.push(current);
  return lines;
}

type Look = {
  size: number;
  primary: string;
  outlineColour: string;
  backColour: string;
  bold: boolean;
  borderStyle: 1 | 3;
  outline: number;
  shadow: number;
  spacing: number;
};

/** ASS colours are &HAABBGGRR, with AA = 0 for opaque. */
function colour(hex: string, opacity = 1): string {
  const value = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((at) => value.slice(at, at + 2).toUpperCase());
  const alpha = Math.round((1 - Math.max(0, Math.min(1, opacity))) * 255)
    .toString(16)
    .toUpperCase()
    .padStart(2, "0");
  return `&H${alpha}${b}${g}${r}`;
}

const TEXT = "#e7e9ec";
const TEXT_2 = "#a3abb6";
const WARN = "#e8a33d";
const BG = "#0e1014";

function look(id: SubtitleLook, canvas: Canvas): Look {
  const portrait = canvas.height > canvas.width;
  const fraction = {
    white: portrait ? 0.034 : 0.05,
    bar: portrait ? 0.034 : 0.05,
    film: portrait ? 0.029 : 0.043,
    yellow: portrait ? 0.04 : 0.058,
  }[id];
  const size = Math.max(12, Math.round(canvas.height * fraction));
  const scale = size / 40;
  switch (id) {
    case "bar":
      return {
        size,
        primary: colour(TEXT),
        outlineColour: colour(BG, 0.62),
        backColour: colour(BG, 0),
        bold: false,
        borderStyle: 3,
        outline: Math.max(2, Math.round(size * 0.22)),
        shadow: 0,
        spacing: 0,
      };
    case "film":
      return {
        size,
        primary: colour(TEXT_2),
        outlineColour: colour(BG, 0),
        backColour: colour(BG, 0.7),
        bold: false,
        borderStyle: 1,
        outline: 0,
        shadow: Math.max(1, Math.round(2 * scale)),
        spacing: Math.round(0.5 * scale * 10) / 10,
      };
    case "yellow":
      return {
        size,
        primary: colour(WARN),
        outlineColour: colour(BG),
        backColour: colour(BG, 0.6),
        bold: true,
        borderStyle: 1,
        outline: Math.max(2, Math.round(size * 0.09)),
        shadow: Math.max(1, Math.round(3 * scale)),
        spacing: 0,
      };
    default:
      return {
        size,
        primary: colour(TEXT),
        outlineColour: colour(BG),
        backColour: colour(BG, 0.6),
        bold: true,
        borderStyle: 1,
        outline: Math.max(2, Math.round(size * 0.05)),
        shadow: Math.max(1, Math.round(2 * scale)),
        spacing: 0,
      };
  }
}

/** Most characters on one line: 12 in portrait, as the preview; the frame's width in landscape. */
export function subtitleLineLimit(lookId: SubtitleLook, canvas: Canvas): number {
  if (canvas.height > canvas.width) return 12;
  return Math.max(8, Math.floor((canvas.width * 0.86) / look(lookId, canvas).size));
}

function assTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds * 100));
  const centis = total % 100;
  const secs = Math.floor(total / 100) % 60;
  const mins = Math.floor(total / 6000) % 60;
  const hours = Math.floor(total / 360000);
  const two = (value: number) => String(value).padStart(2, "0");
  return `${hours}:${two(mins)}:${two(secs)}.${two(centis)}`;
}

function srtTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds * 1000));
  const millis = total % 1000;
  const secs = Math.floor(total / 1000) % 60;
  const mins = Math.floor(total / 60000) % 60;
  const hours = Math.floor(total / 3600000);
  const two = (value: number) => String(value).padStart(2, "0");
  return `${two(hours)}:${two(mins)}:${two(secs)},${String(millis).padStart(3, "0")}`;
}

/** Literal text: braces and backslashes would otherwise start ASS override tags. */
function assText(lines: string[]): string {
  return lines
    .map((line) => line.replace(/\\/g, "＼").replace(/\{/g, "｛").replace(/\}/g, "｝"))
    .join("\\N");
}

function styleLine(name: string, value: Look, alignment: number, margins: number[]): string {
  return [
    `Style: ${name}`,
    FONT_FAMILY,
    value.size,
    value.primary,
    value.primary,
    value.outlineColour,
    value.backColour,
    value.bold ? -1 : 0,
    0,
    0,
    0,
    100,
    100,
    value.spacing,
    0,
    value.borderStyle,
    value.outline,
    value.shadow,
    alignment,
    ...margins,
    1,
  ].join(",");
}

function header(canvas: Canvas, styles: string[]): string {
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${canvas.width}`,
    `PlayResY: ${canvas.height}`,
    // Lines are broken here, as in the preview; libass must not re-wrap them.
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "YCbCr Matrix: None",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    ...styles,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n");
}

/** Every cue in one look, bottom centre, with the preview's margins. */
export function subtitleAss(
  cues: readonly ExportCue[],
  lookId: SubtitleLook,
  canvas: Canvas,
): string {
  const value = look(lookId, canvas);
  const portrait = canvas.height > canvas.width;
  const side = Math.round(canvas.width * 0.07);
  const bottom = Math.round(canvas.height * (portrait ? 0.24 : 0.09));
  const limit = subtitleLineLimit(lookId, canvas);
  const events = cues.map(
    (cue) =>
      `Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},Sub,,0,0,0,,${assText(
        wrapSubtitle(cue.text, limit),
      )}`,
  );
  return `${header(canvas, [styleLine("Sub", value, 2, [side, side, bottom])])}\n${events.join("\n")}\n`;
}

/** A standalone subtitle file, wrapped the same way as the burned subtitles would be. */
export function subtitleSrt(
  cues: readonly ExportCue[],
  lookId: SubtitleLook,
  canvas: Canvas,
): string {
  const limit = subtitleLineLimit(lookId, canvas);
  return cues
    .map(
      (cue, index) =>
        `${index + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${wrapSubtitle(cue.text, limit).join("\n")}\n`,
    )
    .join("\n");
}

/**
 * The cover's words as in the studio's CoverEditor: the title in the middle (9% of the short
 * side, bold, letter-spaced), the episode under it in grey, and 「AI 生成」 in a dark box in the
 * top-right corner when it is on.
 */
export function coverAss(cover: ExportCover, canvas: Canvas): string {
  const short = Math.min(canvas.width, canvas.height);
  const titleSize = Math.max(18, Math.round(short * 0.09));
  const subSize = Math.max(12, Math.round(short * 0.04));
  const markSize = Math.max(12, Math.round(short * 0.03));
  const side = Math.round(canvas.width * 0.08);
  const corner = Math.round(Math.min(canvas.width, canvas.height) * 0.04);
  const title: Look = {
    size: titleSize,
    primary: colour(TEXT),
    outlineColour: colour(BG, 0),
    backColour: colour(BG, 0.7),
    bold: true,
    borderStyle: 1,
    outline: 0,
    shadow: Math.max(2, Math.round(titleSize * 0.08)),
    spacing: Math.max(1, Math.round(titleSize * 0.06)),
  };
  const sub: Look = {
    ...title,
    size: subSize,
    primary: colour(TEXT_2),
    bold: false,
    shadow: Math.max(1, Math.round(subSize * 0.08)),
    spacing: Math.max(1, Math.round(subSize * 0.05)),
  };
  const mark: Look = {
    size: markSize,
    primary: colour(TEXT),
    outlineColour: colour(BG, 0.55),
    backColour: colour(BG, 0),
    bold: false,
    borderStyle: 3,
    outline: Math.max(2, Math.round(markSize * 0.3)),
    shadow: 0,
    spacing: 0,
  };
  const titleLimit = Math.max(4, Math.floor((canvas.width * 0.84) / (titleSize * 1.08)));
  const subLimit = Math.max(6, Math.floor((canvas.width * 0.84) / (subSize * 1.05)));
  const middle = Math.round(canvas.height / 2);
  const styles = [
    // Alignment 2 (bottom centre) with MarginV puts the title's last line just above the middle.
    styleLine("Title", title, 2, [side, side, canvas.height - middle]),
    styleLine("Sub", sub, 8, [side, side, middle + Math.round(subSize * 0.6)]),
    styleLine("Mark", mark, 9, [corner, corner, corner]),
  ];
  const events = [
    cover.title.trim()
      ? `Dialogue: 0,0:00:00.00,0:00:10.00,Title,,0,0,0,,${assText(wrapSubtitle(cover.title.trim(), titleLimit))}`
      : "",
    cover.subtitle.trim()
      ? `Dialogue: 0,0:00:00.00,0:00:10.00,Sub,,0,0,0,,${assText(wrapSubtitle(cover.subtitle.trim(), subLimit))}`
      : "",
    cover.aiMark ? "Dialogue: 0,0:00:00.00,0:00:10.00,Mark,,0,0,0,,AI 生成" : "",
  ].filter(Boolean);
  return `${header(canvas, styles)}\n${events.join("\n")}\n`;
}

const CONTROL = {
  test: (text: string) => [...text].some((char) => char.charCodeAt(0) < 32 || char === "\u007f"),
};

/** Untrusted renderer input: bounded, finite and in order. */
export function validCues(value: unknown): ExportCue[] {
  if (!Array.isArray(value) || value.length > 4000) throw new Error("EXPORT_OPTIONS_INVALID");
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new Error("EXPORT_OPTIONS_INVALID");
    const cue = item as Record<string, unknown>;
    if (
      Object.keys(cue).some((key) => !["text", "start", "end"].includes(key)) ||
      typeof cue.text !== "string" ||
      !cue.text.trim() ||
      [...cue.text].length > 500 ||
      CONTROL.test(cue.text) ||
      typeof cue.start !== "number" ||
      typeof cue.end !== "number" ||
      !Number.isFinite(cue.start) ||
      !Number.isFinite(cue.end) ||
      cue.start < 0 ||
      cue.end <= cue.start ||
      cue.end > 86_400
    )
      throw new Error("EXPORT_OPTIONS_INVALID");
    return { text: cue.text.trim(), start: cue.start, end: cue.end };
  });
}

export function validCover(value: unknown): ExportCover & { still?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("EXPORT_OPTIONS_INVALID");
  const cover = value as Record<string, unknown>;
  const text = (field: unknown) =>
    typeof field === "string" && [...field].length <= 80 && !CONTROL.test(field);
  if (
    Object.keys(cover).some((key) => !["title", "subtitle", "aiMark", "still"].includes(key)) ||
    !text(cover.title) ||
    !text(cover.subtitle) ||
    typeof cover.aiMark !== "boolean" ||
    (cover.still !== undefined &&
      (typeof cover.still !== "string" ||
        cover.still.includes("\0") ||
        // A saved still's path or media URL, or a picture still held in memory as a data URL.
        cover.still.length > (/^data:image\//i.test(cover.still) ? 30_000_000 : 4096)))
  )
    throw new Error("EXPORT_OPTIONS_INVALID");
  return {
    title: cover.title as string,
    subtitle: cover.subtitle as string,
    aiMark: cover.aiMark,
    ...(typeof cover.still === "string" && cover.still ? { still: cover.still } : {}),
  };
}

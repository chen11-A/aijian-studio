export const STYLES = Object.freeze(["white", "yellow", "bar", "variety"]);

export function dimensions(orientation = "portrait") {
  if (!["portrait", "landscape"].includes(orientation)) throw new Error("画幅无效");
  return orientation === "portrait" ? [1080, 1920] : [1920, 1080];
}

// Count Unicode code points conservatively, including punctuation and Latin letters.
export function wrapText(text, limit) {
  if (typeof text !== "string" || !Number.isInteger(limit) || limit < 1)
    throw new Error("文字或行长无效");
  return text
    .replace(/\r/g, "")
    .split("\n")
    .flatMap((paragraph) => {
      const chars = Array.from(paragraph);
      const lines = [];
      while (chars.length > limit) {
        let cut = limit;
        for (let i = limit - 1; i >= 0; i--) {
          if (/[，。！？；、：,.!?;:]/u.test(chars[i])) {
            cut = i + 1;
            break;
          }
        }
        lines.push(chars.splice(0, cut).join(""));
      }
      if (chars.length) lines.push(chars.join(""));
      return lines;
    });
}

function timestamp(seconds, ass) {
  const scale = ass ? 100 : 1000;
  const ticks = Math.round(seconds * scale);
  const hours = Math.floor(ticks / (3600 * scale));
  const minutes = Math.floor(ticks / (60 * scale)) % 60;
  const secs = Math.floor(ticks / scale) % 60;
  const pad = (n, width = 2) => String(n).padStart(width, "0");
  return `${ass ? hours : pad(hours)}:${pad(minutes)}:${pad(secs)}${ass ? "." : ","}${pad(ticks % scale, ass ? 2 : 3)}`;
}

export function escapeAss(text) {
  // Full-width counterparts keep user input visible without creating ASS overrides.
  return text
    .replace(/\\/g, "＼")
    .replace(/\{/g, "｛")
    .replace(/\}/g, "｝")
    .replace(/[\r\n]/g, " ");
}

export function assHeader(
  orientation = "portrait",
  style = "white",
  fontFamily = "Noto Sans CJK SC",
) {
  const [w, h] = dimensions(orientation);
  if (!STYLES.includes(style)) throw new Error("字幕样式无效");
  if (typeof fontFamily !== "string" || !fontFamily || /[,\r\n]/.test(fontFamily))
    throw new Error("字体名称无效");
  const size = style === "variety" ? (orientation === "portrait" ? 60 : 76) : 56;
  const primary = style === "yellow" ? "&H0000FFFF" : "&H00FFFFFF";
  const margin = orientation === "portrait" ? 420 : 70;
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: ${w}\nPlayResY: ${h}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,${fontFamily},${size},${primary},&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,${style === "bar" ? 3 : 1},${style === "variety" ? 5 : 3},0,2,48,48,${margin},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
}

export function generateSubtitles(
  shots,
  { orientation = "portrait", style = "white", fontFamily } = {},
) {
  const header = assHeader(orientation, style, fontFamily);
  if (!Array.isArray(shots)) throw new Error("镜头台词必须为数组");
  const cues = [...shots]
    .map((shot) => {
      if (
        !shot ||
        !Number.isFinite(shot.start) ||
        !Number.isFinite(shot.end) ||
        shot.start < 0 ||
        shot.end - shot.start < 0.01 ||
        typeof shot.text !== "string" ||
        typeof shot.speaker !== "string" ||
        shot.shotId == null
      )
        throw new Error("镜头台词无效");
      return { ...shot, lines: wrapText(shot.text, orientation === "portrait" ? 16 : 22) };
    })
    .filter((shot) => shot.lines.length)
    .sort((a, b) => a.start - b.start);
  return {
    srt: cues
      .map(
        (cue, i) =>
          `${i + 1}\n${timestamp(cue.start, false)} --> ${timestamp(cue.end, false)}\n${cue.lines.join("\n")}\n`,
      )
      .join("\n"),
    ass:
      header +
      cues
        .map(
          (cue) =>
            `Dialogue: 0,${timestamp(cue.start, true)},${timestamp(cue.end, true)},Default,${escapeAss(cue.speaker).replace(/,/g, "，")},0,0,0,,${cue.lines.map(escapeAss).join("\\N")}\n`,
        )
        .join(""),
  };
}

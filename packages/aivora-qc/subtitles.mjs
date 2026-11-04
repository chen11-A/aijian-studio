import { issue } from "./rules.mjs";

function timestamp(value) {
  const match = /^(\d{2,}):([0-5]\d):([0-5]\d)[,.](\d{3})$/.exec(value);
  if (!match) throw new Error("SRT 时间码无效");
  return +match[1] * 3600 + +match[2] * 60 + +match[3] + +match[4] / 1000;
}

export function parseSrt(source) {
  const text = source
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!text) return [];
  return text
    .split(/\n[ \t]*\n/)
    .map((block, index) => {
      const lines = block.split("\n");
      if (/^\d+$/.test(lines[0].trim())) lines.shift();
      const timing = /^(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/.exec(lines.shift());
      if (!timing || !lines.length) throw new Error(`SRT 第 ${index + 1} 条格式无效`);
      const start = timestamp(timing[1]);
      const end = timestamp(timing[2]);
      if (end <= start) throw new Error(`SRT 第 ${index + 1} 条结束时间必须大于开始时间`);
      return {
        start,
        end,
        index: index + 1,
        lines: lines.map((line) => line.replace(/<[^>]*>|\{[^}]*\}/g, "")),
      };
    })
    .sort((a, b) => a.start - b.start || a.index - b.index);
}

export function checkSubtitles(source, width, height, options = {}) {
  const layout = {
    estimated: true,
    alignment: "bottom-center",
    autoWrap: false,
    safeMargin: 0.1,
    bottomMargin: 0.12,
    fontSizePx: Math.min(width, height) * 0.05,
    lineHeight: 1.2,
    maxLineUnits: 20,
    ...options,
  };
  for (const key of ["safeMargin", "bottomMargin", "fontSizePx", "lineHeight", "maxLineUnits"]) {
    if (!Number.isFinite(layout[key]) || layout[key] < 0)
      throw new Error(`subtitleLayout.${key} 无效`);
  }
  if (
    layout.safeMargin >= 0.5 ||
    layout.bottomMargin >= 1 ||
    layout.fontSizePx <= 0 ||
    layout.lineHeight < 1 ||
    layout.maxLineUnits <= 0
  )
    throw new Error("subtitleLayout 超出有效范围");
  layout.estimated = true;
  layout.alignment = "bottom-center";
  layout.autoWrap = false;
  layout.limitation =
    "仅估算显式布局；SRT 缺少可靠坐标，不测量烧录字幕，忽略样式/定位标签，不保证未知字体、描边与自动折行后的安全区。";
  layout.glyphWidth = "ASCII 0.6em，其他 Unicode 码点 1em；长度单位 ASCII 0.5，其余 1";
  const cues = parseSrt(source);
  const issues = [];
  for (const [position, cue] of cues.entries()) {
    const units = cue.lines.map((line) =>
      [...line].reduce((sum, char) => sum + (char.codePointAt(0) < 128 ? 0.5 : 1), 0),
    );
    const widths = cue.lines.map(
      (line) =>
        [...line].reduce((sum, char) => sum + (char.codePointAt(0) < 128 ? 0.6 : 1), 0) *
        layout.fontSizePx,
    );
    const extra = { cue: cue.index };
    if (units.some((length) => length > layout.maxLineUnits))
      issues.push(
        issue(
          "subtitle_line_length",
          cue.start,
          cue.end,
          `第 ${cue.index} 条字幕一行字太多，不容易读完。`,
          "在字幕编辑里删短文字、换行，或拆成两条字幕。",
          { ...extra, detail: { lineUnits: units, maxLineUnits: layout.maxLineUnits } },
        ),
      );
    const bottom = height * (1 - layout.bottomMargin);
    const top = bottom - cue.lines.length * layout.fontSizePx * layout.lineHeight;
    if (
      Math.max(...widths) > width * (1 - 2 * layout.safeMargin) ||
      top < height * layout.safeMargin ||
      bottom > height * (1 - layout.safeMargin)
    ) {
      issues.push(
        issue(
          "subtitle_safe_area",
          cue.start,
          cue.end,
          `第 ${cue.index} 条字幕可能太靠边，播放时容易被挡住。`,
          "在字幕编辑里缩小文字、往画面中间移或换行，再预览确认。",
          {
            ...extra,
            estimated: true,
            detail: {
              estimated: true,
              widthsPx: widths,
              topPx: top,
              bottomPx: bottom,
              width,
              height,
              layout,
            },
          },
        ),
      );
    }
    const next = cues[position + 1];
    if (next && cue.end > next.start)
      issues.push(
        issue(
          "subtitle_overlap",
          next.start,
          Math.min(cue.end, next.end),
          `第 ${cue.index} 条和第 ${next.index} 条字幕同时出现了。`,
          "在字幕时间轴上缩短上一条的显示时间，或把两条合在一起。",
          {
            ...extra,
            nextCue: next.index,
            detail: { overlapSeconds: Math.min(cue.end, next.end) - next.start },
          },
        ),
      );
  }
  return { issues, layout, cueCount: cues.length };
}

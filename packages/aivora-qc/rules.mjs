const descriptions = {
  black: ["这里黑了一会儿，画面看不到内容。", "在时间轴上剪掉这段黑画面，或补上缺少的视频。"],
  freeze: ["这里的画面停住不动了。", "在时间轴上缩短这段停顿，或重新生成这个镜头。"],
  silence: ["这里有至少两秒听不到声音。", "在时间轴上检查这段声音，补上对白或背景音乐。"],
};
const actions = {
  black: "trim",
  freeze: "regenerate_shot",
  silence: "adjust_volume",
  no_audio: "adjust_volume",
  loudness: "adjust_volume",
  true_peak: "adjust_volume",
  subtitle_safe_area: "edit_subtitle",
  subtitle_line_length: "edit_subtitle",
  subtitle_overlap: "edit_subtitle",
};

export function issue(type, start, end, message, suggestion, extra = {}) {
  const time = Math.max(0, start);
  return {
    id: `${type}-${time.toFixed(2)}-${end}${extra.cue === undefined ? "" : `-cue${extra.cue}`}`,
    severity: type === "true_peak" ? "block" : "warn",
    time,
    timeLabel: `第 ${time.toFixed(1)} 秒`,
    end,
    type,
    message,
    suggestion,
    action: actions[type] ?? "none",
    detail: {},
    ...extra,
  };
}

function covered(start, end, dialogue) {
  let cursor = start;
  for (const range of [...dialogue].sort((a, b) => a.start - b.start)) {
    if (range.end <= cursor) continue;
    if (range.start > cursor + 1e-6) return false;
    cursor = range.end;
    if (cursor >= end - 1e-6) return true;
  }
  return false;
}

export function intervalIssues(type, intervals, duration, dialogue = []) {
  return intervals.flatMap(({ start, end }) => {
    start = Math.max(0, start);
    end = Math.min(duration, end);
    const length = end - start;
    const limit =
      type === "black" ? 0.5 : type === "silence" ? 2 : covered(start, end, dialogue) ? 2 : 1;
    if (length + 1e-6 < limit) return [];
    if (type === "black" && length <= 0.5 + 1e-6 && (start <= 1e-6 || end >= duration - 1e-6))
      return [];
    return [
      issue(type, start, end, ...descriptions[type], {
        detail: {
          durationSeconds: length,
          thresholdSeconds: limit,
          ...(type === "black"
            ? { pixelThreshold: 0.1, blackPixelRatio: 0.98 }
            : { noiseDb: type === "freeze" ? -60 : -50 }),
        },
      }),
    ];
  });
}

export function audioIssues({ present = true, integratedLufs, truePeakDbtp }, duration) {
  if (!present)
    return [
      issue(
        "no_audio",
        0,
        duration,
        "这段视频没有声音。",
        "在时间轴上添加对白或背景音乐，并在导出时勾选声音。",
        { scope: "program", detail: { audioStreamPresent: false } },
      ),
    ];
  const issues = [];
  if (integratedLufs === null || integratedLufs < -17 || integratedLufs > -15) {
    issues.push(
      issue(
        "loudness",
        0,
        duration,
        integratedLufs === null
          ? "整片声音无法检查，可能没有声音或声音太短。"
          : integratedLufs < -17
            ? "整片声音偏小，听起来会比别的视频轻。"
            : "整片声音偏大，听起来会比别的视频响。",
        "先预览确认有声音，再在导出时打开‘自动调整音量’。",
        { scope: "program", detail: { integratedLufs, targetLufs: -16, toleranceLu: 1 } },
      ),
    );
  }
  if (truePeakDbtp !== null && truePeakDbtp > -1) {
    issues.push(
      issue(
        "true_peak",
        0,
        duration,
        "有几处声音太响，可能破音。",
        "在声音设置里调低音量，导出后再听一遍最响的地方。",
        { scope: "program", detail: { truePeakDbtp, maxTruePeakDbtp: -1 } },
      ),
    );
  }
  return issues;
}

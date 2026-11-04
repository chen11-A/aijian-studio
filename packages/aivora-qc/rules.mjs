const descriptions = {
  black: ["画面出现持续黑屏。", "检查素材缺失或转场，裁去黑帧或补齐画面。"],
  freeze: ["画面持续静止超过允许时长。", "缩短停顿，替换冻结帧或添加合适的画面运动。"],
  silence: ["音轨持续无声至少两秒。", "检查音轨断点，补录对白或添加适当的环境声。"],
};

export function issue(type, start, end, message, suggestion, extra = {}) {
  return { time: Math.max(0, start), end, type, message, suggestion, ...extra };
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
    return [issue(type, start, end, ...descriptions[type])];
  });
}

export function audioIssues({ integratedLufs, truePeakDbtp }, duration) {
  const issues = [];
  if (integratedLufs === null || integratedLufs < -17 || integratedLufs > -15) {
    issues.push(
      issue(
        "loudness",
        0,
        duration,
        integratedLufs === null
          ? "全片无法获得有效综合响度（可能无声或音频太短）。"
          : `全片综合响度为 ${integratedLufs} LUFS，不在 −16±1 LUFS 范围内。`,
        "检查音轨并将综合响度归一化至 −16 LUFS，再复测真峰值。",
        { scope: "program" },
      ),
    );
  }
  if (truePeakDbtp !== null && truePeakDbtp > -1) {
    issues.push(
      issue(
        "true_peak",
        0,
        duration,
        `全片真峰值为 ${truePeakDbtp} dBTP，高于 −1 dBTP。`,
        "使用真峰值限制器将上限设为 −1 dBTP 或更低并重新导出。",
        { scope: "program" },
      ),
    );
  }
  return issues;
}

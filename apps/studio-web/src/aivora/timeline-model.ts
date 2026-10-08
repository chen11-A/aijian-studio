export const TIMELINE_FPS = 24;
export function frameTimecode(
  frame: number,
  framesPerSecond = TIMELINE_FPS,
  mode: "NON_DROP_FRAME" | "DROP_FRAME" = "NON_DROP_FRAME",
) {
  let n = Math.max(0, Math.round(frame));
  const fps = Math.max(1, Math.round(framesPerSecond));
  // The contract permits DROP_FRAME only for 30000/1001.  It changes labels,
  // never the underlying frame duration.
  if (mode === "DROP_FRAME" && fps === 30) {
    const tenMinuteFrames = 17982;
    const withinTenMinutes = n % tenMinuteFrames;
    n +=
      Math.floor(n / tenMinuteFrames) * 18 +
      (withinTenMinutes >= 2 ? Math.floor((withinTenMinutes - 2) / 1798) * 2 : 0);
  }
  return [
    Math.floor(n / (fps * 3600)),
    Math.floor(n / (fps * 60)) % 60,
    Math.floor(n / fps) % 60,
    n % fps,
  ]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}
export function parseTimecode(
  value: string,
  total: number,
  framesPerSecond = TIMELINE_FPS,
  mode: "NON_DROP_FRAME" | "DROP_FRAME" = "NON_DROP_FRAME",
): number | null {
  if (!/^\d{2}:\d{2}:\d{2}:\d{2}$/.test(value)) return null;
  const [h, m, s, f] = value.split(":").map(Number) as [number, number, number, number];
  const fps = Math.max(1, Math.round(framesPerSecond));
  if (m >= 60 || s >= 60 || f >= fps) return null;
  if (mode === "DROP_FRAME" && fps !== 30) return null;
  if (mode === "DROP_FRAME" && m % 10 !== 0 && s === 0 && f < 2) return null;
  const labelledFrame = ((h * 60 + m) * 60 + s) * fps + f;
  const dropped = mode === "DROP_FRAME" ? 2 * (h * 60 + m - Math.floor((h * 60 + m) / 10)) : 0;
  const frame = labelledFrame - dropped;
  return frame <= total ? frame : null;
}
export function anchoredScroll(
  frame: number,
  scale: number,
  anchor: number,
  width: number,
  total: number,
) {
  return Math.max(0, Math.min(total * scale - width, frame * scale - anchor));
}
export function rulerStep(scale: number, spacing = 100) {
  const steps = [1, 2, 3, 4, 6, 8, 12, 24, 48, 120, 240, 480, 720, 1440, 2880, 5760];
  return steps.find((step) => step * scale >= spacing) ?? Math.ceil(spacing / scale / 5760) * 5760;
}

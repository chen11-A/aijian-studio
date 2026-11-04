const SHOT_ID = /^scene-([1-9][0-9]*)-shot-([1-9][0-9]*)(?:-take-[1-9][0-9]*)?$/;

/** 「第 2 场第 17 个镜头」 for scene-2-shot-17 and its takes. Other ids come back unchanged. */
export function shotLabel(id: string): string {
  const match = SHOT_ID.exec(id);
  return match ? `第 ${match[1]} 场第 ${match[2]} 个镜头` : id;
}

/** Minutes and seconds, rounded to the nearest second: 157.9 → "2:38". */
export function clockLabel(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 0;
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Length in words: 274 → 「4 分 34 秒」, 45 → 「45 秒」. */
export function durationLabel(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 0;
  const minutes = Math.floor(total / 60);
  return minutes > 0 ? `${minutes} 分 ${total % 60} 秒` : `${total} 秒`;
}

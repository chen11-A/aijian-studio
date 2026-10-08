/** Saved canvas choices supported by the bounded local DRAFT encoder. */
export const ASSEMBLY_CANVASES = [
  { width: 1920, height: 1080, label: "横屏 16:9 · 1920 × 1080" },
  { width: 1080, height: 1920, label: "竖屏 9:16 · 1080 × 1920" },
  { width: 1280, height: 720, label: "横屏 16:9 · 1280 × 720" },
  { width: 720, height: 1280, label: "竖屏 9:16 · 720 × 1280" },
  { width: 1080, height: 1080, label: "方形 1:1 · 1080 × 1080" },
] as const;

export function canvasKey(width: number, height: number): string {
  return `${width}x${height}`;
}

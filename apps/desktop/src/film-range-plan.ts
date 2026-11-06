import type { FilmRangePlan } from "@aijian/contracts/film-range";
export function planFilmRange(
  duration: number,
  start: number,
  end: number,
  fps: 24 | 25 | 30 = 24,
): FilmRangePlan | null {
  if (
    ![duration, start, end].every(Number.isFinite) ||
    duration <= 0 ||
    start < 0 ||
    end < 0 ||
    start > duration ||
    end > duration
  )
    return null;
  const first = Math.min(start, end);
  const last = Math.max(start, end);
  // Outward frame alignment retains the complete requested visual interval. It is not
  // inferred word/sentence timing. At least one whole second is required by ordinary video.
  const from = Math.floor(first * fps) / fps;
  const to = Math.min(Math.floor(duration * fps) / fps, Math.ceil(last * fps) / fps);
  if (to - from < 1 || to - from > 10 || (from === 0 && to >= duration - 1 / fps)) return null;
  return {
    requested: { start: first, end: last },
    effective: { start: from, end: to },
    duration,
    generationSeconds: Math.ceil(to - from),
    frameRate: fps,
    speech: "preserve-original-audio",
  };
}

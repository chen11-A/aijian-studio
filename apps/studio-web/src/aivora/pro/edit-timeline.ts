import type { FilmShot, FilmTake } from "../film/project";

/** A shot's box on the 剪辑 timeline, in pixels from the left of the track area. */
export type TimelineClip = { id: string; left: number; width: number };

/** A timeline box that may be folded down to a narrow mark (3JR-U02). */
export type EditClip = TimelineClip & { folded: boolean };

/** How wide a folded shot is: enough to see and click, not enough to crowd the track. */
export const FOLDED_WIDTH = 16;

/** A shot has a finished video: the timeline shows it at its real length. */
export function shotReady(shot: FilmShot): boolean {
  return shot.takes.some((take) => take.status === "done");
}

/** How wide a second is on the 剪辑 timeline before any zoom. */
export const PX_PER_SECOND = 52;

/** 5-3-08: the zoom steps of the 剪辑 timeline, in pixels a second; 52 is the start. */
export const ZOOM_STEPS = [6, 13, 26, 52, 104, 208] as const;

/** The next zoom step in or out from the current one (a fitted zoom sits between steps). */
export function stepZoom(pxPerSecond: number, direction: 1 | -1): number {
  if (direction > 0)
    return ZOOM_STEPS.find((step) => step > pxPerSecond + 0.5) ?? ZOOM_STEPS.at(-1)!;
  return [...ZOOM_STEPS].reverse().find((step) => step < pxPerSecond - 0.5) ?? ZOOM_STEPS[0];
}

/** 5-3-08: 「看全片」: the zoom that puts the whole cut in a track area this wide. */
export function fitZoom(totalSeconds: number, width: number): number {
  if (!(totalSeconds > 0) || !(width > 0)) return PX_PER_SECOND;
  return Math.max(ZOOM_STEPS[0], Math.min(ZOOM_STEPS.at(-1)!, (width - 24) / totalSeconds));
}

/** Ruler marks every this many seconds, so they stay readable at any zoom. */
export function rulerStep(totalSeconds: number, pxPerSecond: number): number {
  if (pxPerSecond >= 150) return 1;
  if (pxPerSecond >= 80) return 2;
  if (pxPerSecond < 10) return 30;
  if (pxPerSecond < 20) return 10;
  return totalSeconds > 120 ? 10 : 5;
}

/**
 * The 剪辑 timeline boxes: 52px a second unless zoomed. With `fold`, a shot with no video yet
 * becomes a narrow mark, so a few finished shots are not lost among many placeholders.
 */
export function editClipLayout(
  shots: readonly FilmShot[],
  fold: boolean,
  pxPerSecond: number = PX_PER_SECOND,
): EditClip[] {
  let left = 1;
  // At the starting zoom a shot is never narrower than 48px, as before; zoomed out it scales.
  const least =
    pxPerSecond >= PX_PER_SECOND ? 48 : Math.max(8, Math.round((48 * pxPerSecond) / PX_PER_SECOND));
  return shots.map((shot) => {
    const folded = fold && !shotReady(shot);
    const width = folded
      ? FOLDED_WIDTH
      : Math.max(least, Math.round(shot.seconds * pxPerSecond) - 2);
    const clip = { id: shot.id, left, width, folded };
    left += width + 2;
    return clip;
  });
}

/**
 * Ruler marks that land on a folded shot are dropped (except the very start): time runs on
 * inside the fold, so a mark there would print a jump of several seconds as a few pixels.
 */
export function ticksOutsideFolds<T extends { left: number; seconds: number }>(
  ticks: readonly T[],
  clips: readonly EditClip[],
): T[] {
  return ticks.filter(
    (tick) =>
      tick.seconds === 0 ||
      !clips.some(
        (clip) => clip.folded && tick.left >= clip.left && tick.left < clip.left + clip.width + 2,
      ),
  );
}

/** Ruler marks that would print on top of each other keep only the first of them. */
export function spacedTicks<T extends { left: number }>(ticks: readonly T[], gap = 56): T[] {
  const kept: T[] = [];
  for (const tick of ticks) {
    const last = kept.at(-1);
    if (!last || tick.left - last.left >= gap) kept.push(tick);
  }
  return kept;
}

/** Where one shot sits inside the joined rough cut, in seconds. */
export type CutSegment = { shotId: string; start: number; seconds: number };

/**
 * The take the joined rough cut uses for a shot: the chosen one when it has a file, otherwise
 * the first finished one with a file. Same rule as the assembly paths in ProWorkspace.
 */
export function cutTake(shot: FilmShot): FilmTake | undefined {
  return (
    shot.takes.find((take) => take.id === shot.selectedTakeId && take.videoPath) ??
    shot.takes.find((take) => take.status === "done" && take.videoPath)
  );
}

/**
 * The shots of the joined rough cut, in film order, with where each starts. Shots without a
 * video file are not in the cut. The planned lengths are stretched to the cut's real length
 * once the player knows it, so the playhead does not drift on long films.
 */
export function cutSegments(shots: readonly FilmShot[], cutSeconds = 0): CutSegment[] {
  const used = shots.filter((shot) => cutTake(shot));
  const planned = used.reduce((sum, shot) => sum + Math.max(0, shot.seconds), 0);
  const scale = cutSeconds > 0 && planned > 0 ? cutSeconds / planned : 1;
  let start = 0;
  return used.map((shot) => {
    const seconds = Math.max(0, shot.seconds) * scale;
    const segment = { shotId: shot.id, start, seconds };
    start += seconds;
    return segment;
  });
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Which shot of the joined cut is playing at a time, and how far into it. */
export function cutPosition(
  segments: readonly CutSegment[],
  seconds: number,
): { shotId: string; fraction: number } | null {
  if (segments.length === 0) return null;
  let segment = segments[0]!;
  for (const item of segments) {
    if (item.start <= seconds) segment = item;
    else break;
  }
  const fraction = segment.seconds > 0 ? clamp01((seconds - segment.start) / segment.seconds) : 0;
  return { shotId: segment.shotId, fraction };
}

/**
 * The playhead's x for a point inside a shot. A shot that is not on this timeline (the cut
 * also holds the other scenes) pins the playhead to the near end of the timeline.
 */
export function playheadX(
  clips: readonly TimelineClip[],
  shown: readonly FilmShot[],
  all: readonly FilmShot[],
  shotId: string,
  fraction: number,
): number {
  const index = shown.findIndex((shot) => shot.id === shotId);
  const clip = clips[index];
  if (clip) return clip.left + clamp01(fraction) * clip.width;
  const first = clips[0];
  const last = clips.at(-1);
  if (!first || !last) return 1;
  const order = all.findIndex((shot) => shot.id === shotId);
  const firstOrder = all.findIndex((shot) => shot.id === shown[0]?.id);
  return order >= 0 && firstOrder >= 0 && order < firstOrder ? first.left : last.left + last.width;
}

/** Seconds from the start of the timeline for a point inside the shot at `index`. */
export function timelineSeconds(
  shown: readonly FilmShot[],
  index: number,
  fraction: number,
): number {
  const before = shown.slice(0, Math.max(0, index)).reduce((sum, shot) => sum + shot.seconds, 0);
  return before + clamp01(fraction) * (shown[index]?.seconds ?? 0);
}

/** The x on the timeline for a time from its start, for the ruler's arrow keys. */
export function xAtSeconds(
  shown: readonly FilmShot[],
  clips: readonly TimelineClip[],
  seconds: number,
): number {
  let start = 0;
  for (const [index, shot] of shown.entries()) {
    const clip = clips[index];
    if (!clip) break;
    if (seconds <= start + shot.seconds || index === shown.length - 1) {
      const fraction = shot.seconds > 0 ? clamp01((seconds - start) / shot.seconds) : 0;
      return clip.left + fraction * clip.width;
    }
    start += shot.seconds;
  }
  return clips[0]?.left ?? 1;
}

/** The shot under an x on the timeline and how far into it; past either end snaps to it. */
export function pointAt(
  clips: readonly TimelineClip[],
  x: number,
): { index: number; fraction: number } | null {
  if (clips.length === 0) return null;
  for (const [index, clip] of clips.entries()) {
    if (x < clip.left + clip.width + 2) {
      const fraction = clip.width > 0 ? clamp01((x - clip.left) / clip.width) : 0;
      return { index, fraction };
    }
  }
  return { index: clips.length - 1, fraction: 1 };
}

/**
 * Where in the joined cut a point on the timeline is. A shot that is not in the cut (no video
 * yet) jumps to the start of the next shot that is, or the end of the cut when none follows.
 */
export function cutTimeAt(
  segments: readonly CutSegment[],
  shown: readonly FilmShot[],
  index: number,
  fraction: number,
): number | null {
  if (segments.length === 0) return null;
  const segmentOf = (shot: FilmShot | undefined) =>
    shot ? segments.find((item) => item.shotId === shot.id) : undefined;
  const own = segmentOf(shown[index]);
  if (own) return own.start + clamp01(fraction) * own.seconds;
  for (const shot of shown.slice(index + 1)) {
    const next = segmentOf(shot);
    if (next) return next.start;
  }
  const last = segments.at(-1)!;
  return last.start + last.seconds;
}

import type { AudioMixPlan } from "@aijian/contracts/film-audio-mix";
import type { FilmProject, FilmShot } from "../film/project";
import type { AudioClip } from "../film/audio";
/** Sound uses the shared actual clock. Pixel projection alone accounts for folded/missing
 * storyboard placeholders; it never converts subtitle text into a voice interval. */
export function audioTimelineBox(
  film: FilmProject,
  clip: AudioClip,
  shots: readonly FilmShot[],
  boxes: readonly { id: string; left: number; width: number }[],
  zoom: number,
  plan: AudioMixPlan | null,
): { left: number; width: number } | null {
  const shot = clip.shotId ? shots.find((shot) => shot.id === clip.shotId) : undefined;
  if (clip.shotId) {
    const selected =
      shot?.takes.find((take) => take.id === shot.selectedTakeId) ??
      (!shot?.selectedTakeId
        ? shot?.takes.find((take) => take.status === "done" && take.videoPath)
        : undefined);
    if (!selected || !clip.takeId || clip.takeId !== selected.id) return null;
  } else if (clip.takeId) return null;
  if (plan?.projectId === film.id) {
    const track = plan.tracks.find((track) => track.key === clip.id);
    if (track) {
      const scope = plan.shots.filter((row) => shots.some((shot) => shot.id === row.shotId));
      if (!scope.length) return null;
      const from = Math.max(track.startSeconds, scope[0]!.startSeconds),
        end = Math.min(
          track.endSeconds,
          scope.at(-1)!.startSeconds + scope.at(-1)!.durationSeconds,
        );
      if (end <= from) return null;
      const x = (seconds: number) => {
        const row =
          scope.find(
            (row) =>
              seconds >= row.startSeconds && seconds <= row.startSeconds + row.durationSeconds,
          ) ?? scope.at(-1)!;
        const box = boxes.find((box) => box.id === row.shotId);
        if (!box) return null;
        return (
          box.left +
          Math.max(0, Math.min(1, (seconds - row.startSeconds) / row.durationSeconds)) * box.width
        );
      };
      const left = x(from),
        right = x(end);
      return left === null || right === null ? null : { left, width: Math.max(1, right - left) };
    }
    // A muted but still bound source remains editable; it is not an audible plan track.
    if (!(film.audioMix?.lanes[clip.lane].muted || clip.gainDb <= -40)) return null;
  }
  const left =
    (shot ? (boxes.find((box) => box.id === shot.id)?.left ?? 1) : 1) + clip.startSeconds * zoom;
  const duration = clip.durationSeconds > 0 ? clip.durationSeconds : clip.waveform?.analyzedSeconds;
  return { left, width: duration && duration > 0 ? Math.max(1, duration * zoom) : 48 };
}

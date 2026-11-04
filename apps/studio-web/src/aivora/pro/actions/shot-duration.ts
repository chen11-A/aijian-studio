import { durationFromSpeech, speechSeconds, splitSpokenLine } from "../../film/phase2";
import type { FilmShot } from "../../film/project";

export function planShotDuration(shot: FilmShot, measured: number | null | undefined) {
  const line = shot.line.trim();
  const plan = durationFromSpeech(speechSeconds(line, measured ?? null), shot.seconds);
  if (!plan.fits) {
    const parts = splitSpokenLine(line);
    if (!parts) {
      return { kind: "notice" as const, notice: plan.note };
    }
    const first = durationFromSpeech(speechSeconds(parts[0], null), 2);
    const second = durationFromSpeech(speechSeconds(parts[1], null), 2);
    const splitShots = [
      {
        ...shot,
        line: parts[0],
        picture: parts[0],
        seconds: first.seconds,
        sound: { ...shot.sound, source: "dub" as const },
      },
      {
        ...shot,
        id: `${shot.id}-b`,
        no: shot.no + 1,
        line: parts[1],
        picture: parts[1],
        seconds: second.seconds,
        sound: { ...shot.sound, source: "dub" as const },
      },
    ];
    return { kind: "split" as const, shots: splitShots };
  }
  return {
    kind: "update" as const,
    seconds: plan.seconds,
    notice: measured == null ? `${plan.note} 配音没有播出来，时长按字数估算。` : plan.note,
  };
}
export function durationInputUnchanged(before: FilmShot, after: FilmShot): boolean {
  return (
    before.id === after.id &&
    before.sceneId === after.sceneId &&
    before.line === after.line &&
    before.seconds === after.seconds &&
    !after.userFields.includes("seconds")
  );
}

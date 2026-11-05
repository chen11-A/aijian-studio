import { durationFromSpeech, speechSeconds, splitSpokenLine } from "../../film/phase2";
import { shotLines } from "../../film/director-continuity";
import type { FilmShot } from "../../film/project";

export function planShotDuration(shot: FilmShot, measured: number | null | undefined) {
  const dialogue = shotLines(shot);
  const speakers = new Set(dialogue.map((row) => row.speaker.trim()));
  if (speakers.size > 1)
    return {
      kind: "notice" as const,
      notice: "这一镜有多位说话人，请先按说话人分配台词，再调整时长。",
    };
  const speaker = [...speakers][0] || shot.speaker?.trim() || "";
  const line = dialogue
    .map((row) => row.text)
    .join("\n")
    .trim();
  // A measurement of the compatibility scalar cannot time additional structured lines.
  if (line !== shot.line.trim()) measured = null;
  const plan = durationFromSpeech(speechSeconds(line, measured ?? null), shot.seconds);
  if (!plan.fits) {
    const parts = splitSpokenLine(line);
    if (!parts) {
      return { kind: "notice" as const, notice: plan.note };
    }
    // Preserve the exact trimmed utterance, including whitespace at the split boundary.
    // splitSpokenLine chooses a semantic break but trims both halves.
    const firstPart = parts[0];
    const secondPart = line.slice(firstPart.length);
    if (!line.startsWith(firstPart) || !secondPart.trim())
      return { kind: "notice" as const, notice: "这句台词还不能安全拆分，请手动确认分句。" };
    const pieces = [firstPart, secondPart];
    const timing = pieces.map((text) => durationFromSpeech(speechSeconds(text, null), 2));
    if (timing.some((item) => !item.fits))
      return {
        kind: "notice" as const,
        notice: "拆成两镜后仍有台词超过 15 秒，需要更多分镜。原镜头保持不变，请手动分句。",
      };
    const splitShots: FilmShot[] = pieces.map((text, index) => ({
      ...shot,
      id: index === 0 ? shot.id : crypto.randomUUID(),
      no: shot.no + index,
      line: text,
      lines: [{ speaker, text }],
      speaker,
      seconds: timing[index]!.seconds,
      sound: { ...shot.sound },
      // Both shots describe new timing/content. Existing assets stay in the base until
      // the confirmation transaction checks dependencies; they never prove these done.
      poster: "",
      takes: [],
      stills: [],
      selectedTakeId: "",
      continuityFrame: undefined,
      continuityFromShotId: undefined,
      directorPlan: undefined,
      actionPlan: undefined,
      performancePlan: undefined,
      directorFramePrompt: undefined,
      directorVideoPrompt: undefined,
      promptZh: undefined,
      promptEn: undefined,
    }));
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
    before.speaker === after.speaker &&
    JSON.stringify(shotLines(before)) === JSON.stringify(shotLines(after)) &&
    before.seconds === after.seconds &&
    !after.userFields.includes("seconds")
  );
}

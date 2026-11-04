import { assignVoice } from "../../film/operations";

/** 3J-U05: the gender and age choices on the character page (C8). */
export const GENDERS = ["男", "女"] as const;
export const AGE_BANDS = ["儿童", "少年", "青年", "中年", "老年"] as const;
export type Gender = (typeof GENDERS)[number] | "";
export type AgeBand = (typeof AGE_BANDS)[number] | "";

/**
 * The voices GPT picks from for one gender and age band, in GPT's order. Read through
 * assignVoice, which hands out the first voice not yet used and starts over once all are, so
 * the page always follows GPT's own lists instead of keeping a second copy of them.
 */
export function voicePoolFor(gender: Gender, ageBand: AgeBand): string[] {
  if (!gender || !ageBand) return [];
  const pool: string[] = [];
  const used = new Set<string>();
  for (;;) {
    const id = assignVoice("", "", used, gender, ageBand);
    if (!id || used.has(id)) return pool;
    used.add(id);
    pool.push(id);
  }
}

/** Every voice GPT gives to this gender at some age. */
export function voicesForGender(gender: Gender): Set<string> {
  return new Set(AGE_BANDS.flatMap((ageBand) => voicePoolFor(gender, ageBand)));
}

export type VoiceGroups = {
  /** Voices for this gender and age band: listed first. */
  fitting: { id: string; label: string }[];
  /** Other voices of the same gender. */
  others: { id: string; label: string }[];
};

/**
 * Splits the account's voice list for one character. Without a gender every voice is offered
 * (as `others`), since there is nothing to filter by yet. Voices GPT has not put under any
 * gender are left out once a gender is chosen. The voice the character has now always stays
 * in the list, so the box never shows an empty choice.
 */
export function voiceGroups(
  voices: readonly { id: string; label: string }[],
  gender: Gender,
  ageBand: AgeBand,
  current = "",
): VoiceGroups {
  if (!gender) return { fitting: [], others: [...voices] };
  const pool = voicePoolFor(gender, ageBand);
  const sameGender = voicesForGender(gender);
  const fitting = voices.filter((voice) => pool.includes(voice.id));
  const others = voices.filter(
    (voice) => !pool.includes(voice.id) && (sameGender.has(voice.id) || voice.id === current),
  );
  return { fitting, others };
}

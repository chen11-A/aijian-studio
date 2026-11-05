import { parseAgentReplyText } from "./agent-reply-compat";

/** Model declarations, kept separately from verified source text and generated media. */
export type WriterCharacterPlan = {
  name: string;
  identity?: string;
  gender?: string;
  ageBand?: string;
  firstParagraph?: string;
  brief?: string;
};
export type SceneWriterPlan = {
  sourceSceneId?: string;
  sourceNo?: number;
  title?: string;
  place?: string;
  interior?: boolean;
  time?: string;
  weather?: string;
  characters?: string[];
  mood?: string;
  keyEvent?: string;
  proposedText?: string;
  proposedDialogue?: string;
  beats?: string[];
  estimatedSeconds?: number;
};
export type WriterPlan = {
  sourceText: string;
  title?: string;
  logline?: string;
  hook?: string;
  cliffhanger?: string;
  declaredDialogueCount?: number;
  characters: WriterCharacterPlan[];
  locations: { name: string; prompt?: string }[];
};
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const strings = (value: unknown): string[] | undefined =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : undefined;
const mapped = (row: Record<string, unknown>, fields: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(fields).flatMap(([raw, key]) =>
      typeof row[raw] === "string" ? [[key, row[raw]]] : [],
    ),
  );
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value);
export function sceneWriterPlan(row: Record<string, unknown>): SceneWriterPlan {
  return {
    ...mapped(row, {
      id: "sourceSceneId",
      title: "title",
      place: "place",

      time: "time",
      weather: "weather",
      mood: "mood",
      key_event: "keyEvent",
      text: "proposedText",
      dialogue: "proposedDialogue",
    }),
    ...(typeof row.interior === "boolean" ? { interior: row.interior } : {}),
    ...(number(row.no) ? { sourceNo: row.no as number } : {}),
    ...(number(row.est_seconds) ? { estimatedSeconds: row.est_seconds as number } : {}),
    ...(strings(row.characters) ? { characters: strings(row.characters) } : {}),
    ...(strings(row.beats) ? { beats: strings(row.beats) } : {}),
  };
}
export function parseWriterPlan(reply: string, sourceText: string): WriterPlan | undefined {
  const value = parseAgentReplyText("writer", reply);
  const row = object(value);
  if (!Array.isArray(row.scenes)) return undefined;
  return {
    sourceText,
    ...mapped(row, {
      title: "title",
      logline: "logline",
      hook: "hook",
      cliffhanger: "cliffhanger",
    }),
    ...(number(row.dialogue_count) ? { declaredDialogueCount: row.dialogue_count as number } : {}),
    characters: (Array.isArray(row.characters) ? row.characters : []).flatMap((value) => {
      const person = object(value);
      if (typeof person.name !== "string" || !person.name.trim()) return [];
      return [
        {
          name: person.name.trim(),
          ...mapped(person, {
            identity: "identity",
            gender: "gender",
            age_band: "ageBand",
            first_paragraph: "firstParagraph",
            brief: "brief",
          }),
          ...(typeof person.ageBand === "string" ? { ageBand: person.ageBand } : {}),
        },
      ];
    }),
    locations: (Array.isArray(row.locations) ? row.locations : []).flatMap((value) => {
      const place = object(value);
      return typeof place.name === "string" && place.name.trim()
        ? [{ name: place.name.trim(), ...mapped(place, { prompt: "prompt" }) }]
        : [];
    }),
  };
}

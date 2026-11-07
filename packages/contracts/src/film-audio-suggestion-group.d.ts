import type { AudioSuggestionGroup, AudioSuggestionMemberReceipt } from "./film-audio-library.js";
export function normalizeAudioSuggestionGroup(value: unknown): AudioSuggestionGroup | null;
/** Hash the exact returned UTF-8 JSON with SHA256; no local path or authorization data. */
export function audioSuggestionMemberInput(value: unknown): string;
export function audioSuggestionMemberSetInput(
  members: readonly AudioSuggestionMemberReceipt[],
): string;

export function audioSuggestionGroupInputs(
  clips: unknown,
  groupId: string,
): {
  group: AudioSuggestionGroup;
  members: { key: string; clipId: string; creativeInput: string }[];
} | null;

import type { AssemblyAudioSegment, AssemblyContent } from "./episodeMediaAssembly";

type DialogueFields = Pick<
  AssemblyAudioSegment,
  "script_version_id" | "script_block_id" | "speaker_id" | "delivery"
>;
export type AssemblyDialogueBinding = {
  [Field in keyof DialogueFields]-?: NonNullable<DialogueFields[Field]>;
};

/** The backend identity uses the exact saved label, including whitespace and Unicode form. */
export async function scriptSpeakerId(
  projectId: string,
  episodeId: string,
  scriptVersionId: string,
  speaker: string,
): Promise<string | null> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle || typeof TextEncoder === "undefined") return null;
    const identity = new TextEncoder().encode(
      JSON.stringify([projectId, episodeId, scriptVersionId, speaker]),
    );
    const digest = new Uint8Array(await subtle.digest("SHA-256", identity));
    if (digest.length !== 32) return null;
    const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `spk_${hex.slice(0, 32)}`;
  } catch {
    return null;
  }
}

/** Checks reference syntax only; exact saved block/speaker/delivery validation belongs to the backend. */
export function validDialogueBinding(value: unknown): value is AssemblyDialogueBinding {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const binding = value as Record<string, unknown>;
  return (
    ["script_version_id", "script_block_id", "speaker_id", "delivery"].every((field) =>
      Object.hasOwn(binding, field),
    ) &&
    typeof binding.script_version_id === "string" &&
    /^ver_[0-9a-f]{32}$/.test(binding.script_version_id) &&
    typeof binding.script_block_id === "string" &&
    /^sblk_[0-9a-f]{32}$/.test(binding.script_block_id) &&
    typeof binding.speaker_id === "string" &&
    /^spk_[0-9a-f]{32}$/.test(binding.speaker_id) &&
    (binding.delivery === "ON_SCREEN" || binding.delivery === "OFF_SCREEN")
  );
}

/** A source edit preserves all imported media and timing, and changes only the selected audio. */
export function bindAssemblyDialogue(
  content: AssemblyContent,
  segmentId: string,
  binding: AssemblyDialogueBinding | null,
): AssemblyContent {
  if (
    (binding !== null && !validDialogueBinding(binding)) ||
    !content.audio_segments.some((segment) => segment.segment_id === segmentId)
  )
    return content;
  return {
    ...content,
    audio_segments: content.audio_segments.map((segment) => {
      if (segment.segment_id !== segmentId) return segment;
      const unlinked = { ...segment };
      delete unlinked.script_version_id;
      delete unlinked.script_block_id;
      delete unlinked.speaker_id;
      delete unlinked.delivery;
      return binding
        ? {
            ...unlinked,
            track_kind: "DIALOGUE",
            script_version_id: binding.script_version_id,
            script_block_id: binding.script_block_id,
            speaker_id: binding.speaker_id,
            delivery: binding.delivery,
          }
        : {
            ...unlinked,
            track_kind: "BGM",
            script_version_id: null,
            script_block_id: null,
            speaker_id: null,
            delivery: null,
          };
    }),
  };
}

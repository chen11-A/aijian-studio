/** QA-only browser entry to the shipped neutral helper, never an alternative implementation. */
export {
  audioSuggestionMemberInput,
  audioSuggestionMemberSetInput,
  audioSuggestionGroupInputs,
} from "@aijian/contracts/film-audio-suggestion-group";
export async function digestGroupText(value) {
  return [
    ...new Uint8Array(
      await globalThis.crypto.subtle.digest("SHA-256", new globalThis.TextEncoder().encode(value)),
    ),
  ]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}

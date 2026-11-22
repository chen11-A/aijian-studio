import { GROK_TTS_MODEL } from "@aijian/contracts/grok-auth";

/** Selection is not credential authority. No alternate provider, address, or model field. */
export function supportedGrokSpeechSelection(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const choice = raw as Record<string, unknown>;
  return (
    Object.keys(choice).length === 2 &&
    Object.hasOwn(choice, "provider") &&
    Object.hasOwn(choice, "modelId") &&
    choice.provider === "GROK_LOGIN" &&
    choice.modelId === GROK_TTS_MODEL
  );
}

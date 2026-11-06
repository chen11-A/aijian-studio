import type { GrokLoginBridge } from "../../grok-auth/transport";

export type VoicePreview = {
  audio: HTMLAudioElement;
  seconds: number | null;
  timestamps: boolean;
  dispose: () => void;
};
export type VoicePreviewHost = {
  speak: NonNullable<GrokLoginBridge["speak"]>;
  billing: () => Promise<string>;
  valid: () => boolean;
  audio?: (url: string) => HTMLAudioElement;
  metadataTimeoutMs?: number;
};
export async function prepareVoicePreview(
  voiceId: string,
  text: string,
  host: VoicePreviewHost,
): Promise<VoicePreview> {
  const projectId = await host.billing();
  if (!host.valid()) throw new Error("WORK_STALE");
  if (!projectId) throw new Error("VOICE_PROJECT_REQUIRED");
  const result = await host.speak({
    voiceId,
    text,
    projectId,
    idempotencyKey: crypto.randomUUID(),
  });
  if (!host.valid()) throw new Error("WORK_STALE");
  if (result.kind !== "OK") throw new Error(result.detail || "配音没有成功。");
  const binary = atob(result.audioBase64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: result.mime || "audio/mpeg" }));
  let audio: HTMLAudioElement;
  try {
    audio = (host.audio ?? ((source) => new Audio(source)))(url);
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    audio.onloadedmetadata = null;
    audio.onerror = null;
    audio.onended = null;
    try {
      audio.pause();
    } catch {
      /* Detached playback is already stopped. */
    }
    URL.revokeObjectURL(url);
  };
  try {
    const seconds = await new Promise<number>((resolve, reject) => {
      const finish = (error?: string) => {
        clearTimeout(timeout);
        clearInterval(check);
        audio.onloadedmetadata = null;
        audio.onerror = null;
        if (error) reject(new Error(error));
        else resolve(Number.isFinite(audio.duration) ? audio.duration : 0);
      };
      const timeout = setTimeout(
        () => finish("VOICE_METADATA_TIMEOUT"),
        host.metadataTimeoutMs ?? 10_000,
      );
      const check = setInterval(() => {
        if (!host.valid()) finish("WORK_STALE");
      }, 100);
      audio.onloadedmetadata = () => finish();
      audio.onerror = () => finish("VOICE_AUDIO_FAILED");
      if (audio.readyState >= 1) finish();
    });
    if (!host.valid()) throw new Error("WORK_STALE");
    return {
      audio,
      seconds: result.seconds ?? (seconds > 0 ? seconds : null),
      timestamps: Boolean(result.timestamps),
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}

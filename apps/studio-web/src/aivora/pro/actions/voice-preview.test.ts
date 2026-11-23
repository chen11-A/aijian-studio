import { afterEach, expect, it, vi } from "vitest";
import { selectCenteredModel } from "../../account/model-center";
import { prepareVoicePreview, type VoicePreviewHost } from "./voice-preview";

function setup(readyState = 1) {
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
  const audio = {
    readyState,
    duration: 3,
    pause: vi.fn(),
    onloadedmetadata: null,
    onerror: null,
    onended: null,
  } as unknown as HTMLAudioElement;
  const host: VoicePreviewHost = {
    speak: vi.fn<VoicePreviewHost["speak"]>().mockResolvedValue({
      kind: "OK",
      audioBase64: "AA==",
      mime: "audio/mpeg",
      seconds: 3,
      timestamps: false,
      billingAccountKind: "grok_login",
    }),
    billing: vi.fn(async () => "prj_test"),
    valid: () => true,
    audio: () => audio,
    metadataTimeoutMs: 1000,
  };
  return { host, audio, revoke };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  window.localStorage.clear();
});
it("uses member speech with billing and exposes an idempotent resource disposer", async () => {
  const { host, audio, revoke } = setup();
  const result = await prepareVoicePreview("eve", "台词", host);
  expect(host.speak).toHaveBeenCalledWith(
    expect.objectContaining({ voiceId: "eve", text: "台词", projectId: "prj_test" }),
  );
  expect(vi.mocked(host.speak).mock.calls[0]?.[0]).not.toHaveProperty("speechSelection");
  expect(result.seconds).toBe(3);
  result.dispose();
  result.dispose();
  expect(audio.pause).toHaveBeenCalledOnce();
  expect(revoke).toHaveBeenCalledOnce();
});
it("carries the captured model and original voice unchanged across billing", async () => {
  const { host } = setup();
  selectCenteredModel("SPEECH", { provider: "GROK_LOGIN", modelId: "grok-tts" });
  host.billing = async () => {
    selectCenteredModel("SPEECH", { provider: "GROK_LOGIN", modelId: "eve" });
    return "prj_test";
  };
  const result = await prepareVoicePreview("leo", "台词", host);
  expect(host.speak).toHaveBeenCalledWith(
    expect.objectContaining({
      voiceId: "leo",
      text: "台词",
      speechSelection: { provider: "GROK_LOGIN", modelId: "grok-tts" },
    }),
  );
  result.dispose();
});

it("reports an unsupported saved model without creating preview audio", async () => {
  const { host } = setup();
  selectCenteredModel("SPEECH", { provider: "GROK_LOGIN", modelId: "eve" });
  vi.mocked(host.speak).mockResolvedValue({
    kind: "ERROR",
    code: "SPEECH_MODEL_UNSUPPORTED",
    detail: "请在模型中心选择 Grok TTS",
    billingAccountKind: "grok_login",
  });
  await expect(prepareVoicePreview("leo", "台词", host)).rejects.toMatchObject({
    code: "SPEECH_MODEL_UNSUPPORTED",
    message: "请在模型中心选择 Grok TTS",
  });
  expect(host.speak).toHaveBeenCalledWith(
    expect.objectContaining({
      voiceId: "leo",
      speechSelection: { provider: "GROK_LOGIN", modelId: "eve" },
    }),
  );
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});

it("does not call speech after switching projects during billing", async () => {
  const { host } = setup();
  host.billing = async () => {
    host.valid = () => false;
    return "prj_old";
  };
  await expect(prepareVoicePreview("eve", "台词", host)).rejects.toThrow("WORK_STALE");
  expect(host.speak).not.toHaveBeenCalled();
});
it("rejects a late speech reply before creating any audio", async () => {
  const { host } = setup();
  const speak = host.speak;
  host.speak = async (...args) => {
    host.valid = () => false;
    return speak(...args);
  };
  await expect(prepareVoicePreview("eve", "台词", host)).rejects.toThrow("WORK_STALE");
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});
it.each(["timeout", "project"])(
  "bounds metadata waiting and releases audio on %s",
  async (reason) => {
    vi.useFakeTimers();
    const { host, revoke } = setup(0);
    const pending = prepareVoicePreview("eve", "台词", host);
    const failed = expect(pending).rejects.toThrow(
      reason === "timeout" ? "VOICE_METADATA_TIMEOUT" : "WORK_STALE",
    );
    await vi.advanceTimersByTimeAsync(0);
    if (reason === "project") host.valid = () => false;
    await vi.advanceTimersByTimeAsync(1000);
    await failed;
    expect(revoke).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  },
);
it("releases a created URL if audio construction throws", async () => {
  const { host, revoke } = setup();
  host.audio = () => {
    throw new Error("audio unavailable");
  };
  await expect(prepareVoicePreview("eve", "台词", host)).rejects.toThrow("audio unavailable");
  expect(revoke).toHaveBeenCalledOnce();
});

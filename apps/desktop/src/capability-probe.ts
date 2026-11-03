import type { AgentLog } from "./agent-log";

const DOT =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

type FetchLike = typeof fetch;

const PROBES: { name: string; path: string; body: Record<string, unknown> }[] = [
  {
    name: "reference-images",
    path: "/v1/videos/generations",
    body: {
      model: "grok-imagine-video-1.5",
      prompt: "The mark in <IMAGE_0> blinks once.",
      reference_images: [{ url: DOT }],
      duration: 1,
      aspect_ratio: "1:1",
      resolution: "720p",
    },
  },
  {
    name: "first-last-frame",
    path: "/v1/videos/generations",
    body: {
      model: "grok-imagine-video-1.5",
      prompt: "Hold.",
      image: { url: DOT },
      last_frame: { url: DOT },
      duration: 1,
      aspect_ratio: "1:1",
      resolution: "720p",
    },
  },
  {
    name: "keyframes",
    path: "/v1/videos/generations",
    body: {
      model: "grok-imagine-video-1.5",
      prompt: "Hold.",
      image: { url: DOT },
      keyframes: [{ image: { url: DOT }, timestamp_s: 1 }],
      duration: 2,
      aspect_ratio: "1:1",
      resolution: "720p",
    },
  },
  {
    name: "video-voice",
    path: "/v1/videos/generations",
    body: {
      model: "grok-imagine-video-1.5",
      prompt: "<AUDIO_0> says hello.",
      reference_audios: [{ voice_id: "eve" }],
      duration: 1,
      aspect_ratio: "1:1",
      resolution: "480p",
    },
  },
  {
    name: "vision",
    path: "/v1/chat/completions",
    body: {
      model: "grok-4.7",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Reply with one word: color." },
            { type: "image_url", image_url: { url: DOT } },
          ],
        },
      ],
      stream: false,
    },
  },
  {
    name: "tts-timestamps",
    path: "/v1/tts",
    body: {
      text: "你好。",
      voice_id: "eve",
      language: "zh",
      with_timestamps: true,
    },
  },
  {
    name: "image-edit",
    path: "/v1/images/edits",
    body: {
      model: "grok-imagine-image-2.0",
      prompt: "Make the dot blue.",
      image: { url: DOT, type: "image_url" },
      quality: "medium",
      response_format: "b64_json",
      n: 1,
    },
  },
  {
    name: "quality-medium",
    path: "/v1/images/generations",
    body: {
      model: "grok-imagine-image-2.0",
      prompt: "A red dot on white.",
      n: 1,
      response_format: "b64_json",
      quality: "medium",
      aspect_ratio: "1:1",
    },
  },
];

function shortBody(status: number, raw: string, contentType: string): string {
  if (contentType.startsWith("audio/") || contentType.startsWith("image/")) {
    return `bytes ${raw.length}`;
  }
  const trimmed = raw.replace(/\s+/g, " ").slice(0, 240);
  return trimmed || `HTTP ${status}`;
}

/** One minimal membership call per documented media capability. Not shown in the UI. */
export async function runCapabilityProbe(input: {
  fetch: FetchLike;
  token: string;
  log: AgentLog;
  api?: string;
}): Promise<void> {
  const api = (input.api ?? "https://api.x.ai/v1").replace(/\/$/, "");
  for (const probe of PROBES) {
    const started = Date.now();
    try {
      const response = await input.fetch(`${api}${probe.path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(probe.body),
        signal: AbortSignal.timeout(90_000),
      });
      const raw = await response.text();
      input.log.write({
        agent: "probe",
        model: String(probe.body.model ?? "tts"),
        endpoint: probe.name,
        httpStatus: response.status,
        durationMs: Date.now() - started,
        parsed: response.ok ? "accepted" : "rejected",
        body: shortBody(response.status, raw, response.headers.get("content-type") ?? ""),
      });
    } catch (error) {
      input.log.write({
        agent: "probe",
        model: String(probe.body.model ?? "tts"),
        endpoint: probe.name,
        httpStatus: 0,
        durationMs: Date.now() - started,
        parsed: "error",
        body: error instanceof Error ? error.message : "probe failed",
      });
    }
  }
}

import { randomUUID } from "node:crypto";
import { canonicalLoopbackOrigin } from "./sidecar-origin";

export type StoryFilmProvider = "stub" | "grok_subscription" | "xai_api_key" | "chatgpt";

export type StoryFilmCreateInput = {
  scene_label: string;
  narration: string;
  subtitle?: string;
  provider: StoryFilmProvider;
  confirmed: boolean;
  voice_id?: string;
  regenerate?: boolean;
};

const projectIdPattern = /^prj_[0-9a-f]{32}$/;
const providers = new Set<StoryFilmProvider>([
  "stub",
  "grok_subscription",
  "xai_api_key",
  "chatgpt",
]);

type Session = { origin: string; token: string };

function readable(value: unknown): value is { data: Record<string, unknown>; request_id: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { request_id?: unknown }).request_id === "string" &&
    typeof (value as { data?: unknown }).data === "object" &&
    (value as { data: unknown }).data !== null
  );
}

export function createStoryFilmClient(
  fetcher: typeof fetch,
  session: Session,
  newId: () => string = randomUUID,
) {
  const origin = canonicalLoopbackOrigin(session.origin);
  if (!/^[A-Za-z0-9_-]{43,256}$/.test(session.token)) {
    throw new Error("Local API is not available");
  }
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${session.token}`,
    Origin: "app://aijian",
  };

  async function read(response: Response): Promise<unknown> {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error("成片服务没有返回结果。可以改用本地占位再试一次。");
    }
    if (!readable(payload)) {
      throw new Error("成片服务没有完成。可以改用本地占位再试一次。");
    }
    if (!response.ok) {
      const message = payload.data.message;
      if (
        typeof message === "string" &&
        message.length > 0 &&
        message.length <= 240 &&
        !/[\r\n\0]/.test(message)
      ) {
        throw new Error(message);
      }
      throw new Error("成片服务没有完成。可以改用本地占位再试一次。");
    }
    return payload;
  }

  return {
    plan(projectId: string) {
      if (!projectIdPattern.test(projectId)) throw new Error("Invalid story film project");
      return fetcher(`${origin}/api/v1/projects/${projectId}/story-film/plan`, {
        headers,
      }).then(read);
    },
    progress(projectId: string) {
      if (!projectIdPattern.test(projectId)) throw new Error("Invalid story film project");
      return fetcher(`${origin}/api/v1/projects/${projectId}/story-film/progress`, {
        headers,
      }).then(read);
    },
    cancel(projectId: string) {
      if (!projectIdPattern.test(projectId)) throw new Error("Invalid story film project");
      return fetcher(`${origin}/api/v1/projects/${projectId}/story-film/cancel`, {
        method: "POST",
        headers,
      }).then(read);
    },
    create(projectId: string, input: StoryFilmCreateInput, mediaBearer?: string) {
      if (!projectIdPattern.test(projectId)) throw new Error("Invalid story film project");
      const idempotencyKey = `story-film:v1:${newId()}`;
      const requestHeaders: Record<string, string> = {
        ...headers,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      };
      if (mediaBearer) requestHeaders["X-Aivora-Media-Bearer"] = mediaBearer;
      return fetcher(`${origin}/api/v1/projects/${projectId}/story-film`, {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify({
          scene_label: input.scene_label,
          narration: input.narration,
          subtitle: input.subtitle ?? null,
          provider: input.provider,
          confirmed: input.confirmed,
          ...(input.voice_id ? { voice_id: input.voice_id } : {}),
          ...(input.regenerate ? { regenerate: true } : {}),
        }),
      }).then(read);
    },
  };
}

export function parseStoryFilmCreate(value: unknown): StoryFilmCreateInput {
  if (typeof value !== "object" || value === null) throw new Error("Invalid story film request");
  const body = value as Record<string, unknown>;
  const allowed = [
    "scene_label",
    "narration",
    "subtitle",
    "provider",
    "confirmed",
    "voice_id",
    "regenerate",
  ];
  if (Object.keys(body).some((key) => !allowed.includes(key))) {
    throw new Error("Invalid story film request");
  }
  const scene = body.scene_label;
  const narration = body.narration;
  const provider = body.provider;
  if (typeof scene !== "string" || scene.trim().length < 1 || scene.length > 80) {
    throw new Error("Invalid story film request");
  }
  if (typeof narration !== "string" || narration.trim().length < 1 || narration.length > 200) {
    throw new Error("Invalid story film request");
  }
  if (
    body.subtitle !== undefined &&
    (typeof body.subtitle !== "string" || body.subtitle.length > 57)
  ) {
    throw new Error("Invalid story film request");
  }
  if (typeof provider !== "string" || !providers.has(provider as StoryFilmProvider)) {
    throw new Error("Invalid story film request");
  }
  if (typeof body.confirmed !== "boolean") throw new Error("Invalid story film request");
  if (body.regenerate !== undefined && typeof body.regenerate !== "boolean") {
    throw new Error("Invalid story film request");
  }
  const voice = body.voice_id;
  if (voice !== undefined && (typeof voice !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(voice))) {
    throw new Error("Invalid story film request");
  }
  return {
    scene_label: scene.trim(),
    narration: narration.trim(),
    ...(typeof body.subtitle === "string" && body.subtitle.trim()
      ? { subtitle: body.subtitle.trim() }
      : {}),
    provider: provider as StoryFilmProvider,
    confirmed: body.confirmed,
    ...(typeof voice === "string" ? { voice_id: voice } : {}),
    ...(body.regenerate === true ? { regenerate: true } : {}),
  };
}

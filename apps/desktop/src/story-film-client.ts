import { randomUUID } from "node:crypto";
import { accessSync, constants, statSync } from "node:fs";
import { extname, isAbsolute } from "node:path";
import { mediaUrlPath, trustedMediaPath } from "./film-library";
import { canonicalLoopbackOrigin } from "./sidecar-origin";

export type StoryFilmProvider = "stub" | "grok_subscription" | "xai_api_key" | "chatgpt";

export type StoryFilmShotInput = {
  narration: string;
  prompt: string;
  subtitle?: string;
  duration_seconds: number;
  regenerate?: boolean;
  size?: string;
  angle?: string;
  move?: string;
  action?: string;
  performance?: string;
  identity?: string;
  voice_id?: string;
  still?: string;
  reference?: string;
  references?: string[];
  delivery?: string;
  lines?: { speaker: string; text: string }[];
};

export type StoryFilmCreateInput = {
  scene_label: string;
  narration: string;
  subtitle?: string;
  provider: StoryFilmProvider;
  confirmed: boolean;
  voice_id?: string;
  video_model?: string;
  regenerate?: boolean;
  style_block?: string;
  aspect_ratio?: "9:16" | "16:9";
  shots?: StoryFilmShotInput[];
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

/** Preserve supported remote frames; verify local frames before sending them to the service. */
function requireReferencedStill(
  shot: StoryFilmShotInput,
  mediaRoots: string[],
): StoryFilmShotInput {
  if (
    new Set(shot.lines?.filter((line) => line.text.trim()).map((line) => line.speaker.trim()))
      .size > 1
  ) {
    throw Object.assign(new Error("这一镜需要分角色配音。台词与字幕已保留。"), {
      code: "MULTI_VOICE_REQUIRED",
    });
  }
  if (!shot.reference?.trim() && !shot.references?.some((item) => item.trim())) return shot;
  // The server now creates a referenced first frame when no explicit frame was selected.
  if (!shot.still?.trim()) return shot;
  try {
    const url = new URL(shot.still);
    if (url.protocol === "https:" && url.hostname && !url.username && !url.password) return shot;
  } catch {
    /* Local paths are checked below. */
  }
  const source = mediaUrlPath(shot.still ?? "");
  const missing = "请先用定妆照生成本地首帧，再生成视频。当前首帧不存在或无法读取。";
  try {
    if (shot.still?.startsWith("aivora-media:")) {
      const url = new URL(shot.still);
      if (!["", "/"].includes(url.pathname) || url.searchParams.get("path") !== source)
        throw new Error(missing);
    }
    trustedMediaPath(mediaRoots, source);
    if (
      !isAbsolute(source) ||
      ![".png", ".jpg", ".jpeg", ".webp"].includes(extname(source).toLowerCase())
    )
      throw new Error(missing);
    const file = statSync(source);
    if (!file.isFile() || file.size <= 0 || file.size > 12_000_000) throw new Error(missing);
    accessSync(source, constants.R_OK);
  } catch {
    throw new Error(missing);
  }
  // Preserve the URL so the backend retains its own userData-root checks.
  return shot;
}

export function createStoryFilmClient(
  fetcher: typeof fetch,
  session: Session,
  newId: () => string = randomUUID,
  mediaRoots: string[] = [],
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
      const shots =
        input.provider === "stub"
          ? input.shots
          : input.shots?.map((shot) => requireReferencedStill(shot, mediaRoots));
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
          ...(input.video_model ? { video_model: input.video_model } : {}),
          ...(input.regenerate ? { regenerate: true } : {}),
          ...(input.style_block ? { style_block: input.style_block } : {}),
          ...(input.aspect_ratio ? { aspect_ratio: input.aspect_ratio } : {}),
          ...(shots && shots.length > 0 ? { shots } : {}),
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
    "video_model",
    "regenerate",
    "style_block",
    "aspect_ratio",
    "shots",
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
  if (typeof narration !== "string" || narration.trim().length < 1 || narration.length > 2000) {
    throw new Error("Invalid story film request");
  }
  if (
    body.subtitle !== undefined &&
    (typeof body.subtitle !== "string" || body.subtitle.length > 500)
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
  const videoModel = body.video_model;
  if (
    videoModel !== undefined &&
    (typeof videoModel !== "string" || !/^[A-Za-z0-9._-]{1,80}$/.test(videoModel))
  ) {
    throw new Error("Invalid story film request");
  }
  const styleBlock = optionalText(body, "style_block", 400);
  const aspect = body.aspect_ratio;
  if (aspect !== undefined && aspect !== "9:16" && aspect !== "16:9") {
    throw new Error("Invalid story film request");
  }
  const shots = parseShots(body.shots);
  return {
    scene_label: scene.trim(),
    narration: narration.trim(),
    ...(typeof body.subtitle === "string" && body.subtitle.trim()
      ? { subtitle: body.subtitle.trim() }
      : {}),
    provider: provider as StoryFilmProvider,
    confirmed: body.confirmed,
    ...(typeof voice === "string" ? { voice_id: voice } : {}),
    ...(typeof videoModel === "string" ? { video_model: videoModel } : {}),
    ...(body.regenerate === true ? { regenerate: true } : {}),
    ...(styleBlock ? { style_block: styleBlock } : {}),
    ...(aspect === "9:16" || aspect === "16:9" ? { aspect_ratio: aspect } : {}),
    ...(shots.length > 0 ? { shots } : {}),
  };
}

function optionalText(
  record: Record<string, unknown>,
  key: string,
  max: number,
): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > max) {
    throw new Error("Invalid story film request");
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseReferences(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("Invalid story film request");
  const kept: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") throw new Error("Invalid story film request");
    const trimmed = item.trim().slice(0, 500);
    if (!trimmed) continue;
    kept.push(trimmed);
    if (kept.length === 13) break;
  }
  return kept.length > 0 ? kept : undefined;
}

function parseShots(value: unknown): StoryFilmShotInput[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 10) throw new Error("Invalid story film request");
  return value.map((item) => {
    if (typeof item !== "object" || item === null) throw new Error("Invalid story film request");
    const shot = item as Record<string, unknown>;
    const allowed = [
      "narration",
      "prompt",
      "subtitle",
      "duration_seconds",
      "regenerate",
      "size",
      "angle",
      "move",
      "action",
      "performance",
      "identity",
      "voice_id",
      "still",
      "reference",
      "references",
      "delivery",
      "lines",
    ];
    if (Object.keys(shot).some((key) => !allowed.includes(key))) {
      throw new Error("Invalid story film request");
    }
    const narration = shot.narration;
    const prompt = shot.prompt;
    const duration = shot.duration_seconds;
    if (typeof narration !== "string" || narration.trim().length < 1 || narration.length > 2000) {
      throw new Error("Invalid story film request");
    }
    if (typeof prompt !== "string" || prompt.trim().length < 1 || prompt.length > 2000) {
      throw new Error("Invalid story film request");
    }
    if (
      shot.subtitle !== undefined &&
      (typeof shot.subtitle !== "string" || shot.subtitle.length > 500)
    ) {
      throw new Error("Invalid story film request");
    }
    if (
      typeof duration !== "number" ||
      !Number.isInteger(duration) ||
      duration < 1 ||
      duration > 15
    ) {
      throw new Error("Invalid story film request");
    }
    if (shot.regenerate !== undefined && typeof shot.regenerate !== "boolean") {
      throw new Error("Invalid story film request");
    }
    const size = optionalText(shot, "size", 20);
    const angle = optionalText(shot, "angle", 20);
    const move = optionalText(shot, "move", 20);
    const action = optionalText(shot, "action", 1000);
    const performance = optionalText(shot, "performance", 1000);
    const identity = optionalText(shot, "identity", 200);
    const voice = optionalText(shot, "voice_id", 64);
    const still = optionalText(shot, "still", 500);
    const reference = optionalText(shot, "reference", 500);
    const delivery = optionalText(shot, "delivery", 400);
    const references = parseReferences(shot.references);
    const lines = parseLines(shot.lines);
    return {
      narration: narration.trim(),
      prompt: prompt.trim(),
      duration_seconds: duration,
      ...(typeof shot.subtitle === "string" && shot.subtitle.trim()
        ? { subtitle: shot.subtitle.trim() }
        : {}),
      ...(shot.regenerate === true ? { regenerate: true } : {}),
      ...(size ? { size } : {}),
      ...(angle ? { angle } : {}),
      ...(move ? { move } : {}),
      ...(action ? { action } : {}),
      ...(performance ? { performance } : {}),
      ...(identity ? { identity } : {}),
      ...(voice ? { voice_id: voice } : {}),
      ...(still ? { still } : {}),
      ...(reference ? { reference } : {}),
      ...(references ? { references } : {}),
      ...(delivery ? { delivery } : {}),
      ...(lines ? { lines } : {}),
    };
  });
}

function parseLines(value: unknown): { speaker: string; text: string }[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 100) throw new Error("Invalid story film request");
  return value.map((line: unknown) => {
    if (!line || typeof line !== "object") throw new Error("Invalid story film request");
    const row = line as Record<string, unknown>;
    if (
      Object.keys(row).some((key) => !["speaker", "text"].includes(key)) ||
      typeof row.speaker !== "string" ||
      row.speaker.length > 100 ||
      typeof row.text !== "string" ||
      !row.text.trim() ||
      row.text.length > 2000
    )
      throw new Error("Invalid story film request");
    return { speaker: row.speaker.trim(), text: row.text };
  });
}

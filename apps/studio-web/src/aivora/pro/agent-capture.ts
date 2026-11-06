import type { FilmProject } from "../film/project";

/**
 * 3JR-B11 (R2-02): the person may let this computer keep the director's and the action
 * director's replies word for word, to replay them when a shot count or an action goes wrong.
 * Off by default. Kept only on this computer (not in the work, not in any log, never sent),
 * and turning it off deletes what was kept. The file it writes is what
 * `apps/studio-web/scripts/replay-3jr.mjs` reads.
 */
const SWITCH = "aivora.captureReplies";
const STORE = "aivora.agentCapture";
const MAX_ENTRIES = 60;
const MAX_CHARS = 3_000_000;

export type CapturedReply = {
  agent: "director" | "action";
  /** A coverage repair asks the director again; it is kept apart from the scene's first reply. */
  kind: "first" | "repair";
  sceneId: string;
  shotIds: string[];
  at: string;
  reply: string;
};

export function captureEnabled(): boolean {
  try {
    return window.localStorage.getItem(SWITCH) === "on";
  } catch {
    return false;
  }
}

export function setCaptureEnabled(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(SWITCH, "on");
    else {
      window.localStorage.removeItem(SWITCH);
      window.localStorage.removeItem(STORE);
    }
  } catch {
    // Blocked storage keeps nothing, which is the safe side.
  }
}

export function capturedReplies(): CapturedReply[] {
  try {
    const raw = window.localStorage.getItem(STORE);
    const value: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(value)
      ? value.filter(
          (item): item is CapturedReply =>
            Boolean(item) &&
            typeof item === "object" &&
            (item.agent === "director" || item.agent === "action") &&
            typeof item.reply === "string" &&
            typeof item.sceneId === "string" &&
            Array.isArray(item.shotIds),
        )
      : [];
  } catch {
    return [];
  }
}

export function clearCapturedReplies(): void {
  try {
    window.localStorage.removeItem(STORE);
  } catch {
    // Nothing to do.
  }
}

/** Called with every successful membership reply; keeps only the director's and the action's. */
export function recordAgentReply(
  agent: string,
  context: string,
  instruction: string,
  reply: string,
): void {
  if ((agent !== "director" && agent !== "action") || !reply.trim() || !captureEnabled()) return;
  const sceneId =
    /场次 id：([^\n]+)/u.exec(context)?.[1]?.trim() ??
    /"scene_id"\s*:\s*"([^"]+)"/u.exec(context)?.[1] ??
    "";
  const shotIds = [...context.matchAll(/"id"\s*:\s*"([^"]+)"/gu)]
    .map((match) => match[1]!)
    .slice(0, 64);
  const entry: CapturedReply = {
    agent,
    kind: /补齐|只补/u.test(instruction) ? "repair" : "first",
    sceneId,
    shotIds,
    at: new Date().toISOString(),
    reply,
  };
  let entries = [...capturedReplies(), entry].slice(-MAX_ENTRIES);
  while (entries.length > 1 && JSON.stringify(entries).length > MAX_CHARS)
    entries = entries.slice(1);
  try {
    window.localStorage.setItem(STORE, JSON.stringify(entries));
  } catch {
    // A full storage keeps what was there before.
  }
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The file to hand to the developers: every scene of this work with a kept director reply, in
 * scene order, with its latest first reply, its latest action reply and any repairs. The source
 * hash lets the replay tool refuse a file from another text. Null when nothing was kept.
 */
export async function captureFile(
  film: Pick<FilmProject, "title" | "sourceText" | "scenes" | "shots">,
): Promise<{ name: string; text: string; scenes: number } | null> {
  const entries = capturedReplies();
  const latest = (rows: CapturedReply[]) => rows.at(-1)?.reply;
  const scenes = film.scenes.flatMap((scene, index) => {
    const shotIds = new Set(
      film.shots.filter((shot) => shot.sceneId === scene.id).map((shot) => shot.id),
    );
    const director = entries.filter(
      (item) => item.agent === "director" && item.sceneId === scene.id,
    );
    const directorReply = latest(director.filter((item) => item.kind === "first"));
    if (!directorReply) return [];
    const actionReply = latest(
      entries.filter(
        (item) =>
          item.agent === "action" &&
          (item.sceneId === scene.id || item.shotIds.some((id) => shotIds.has(id))),
      ),
    );
    const repairs = director.filter((item) => item.kind === "repair").map((item) => item.reply);
    return [
      {
        sceneNo: index + 1,
        directorReply,
        ...(actionReply ? { actionReply } : {}),
        ...(repairs.length ? { directorRepairs: repairs } : {}),
      },
    ];
  });
  if (!scenes.length) return null;
  const text = `${JSON.stringify(
    {
      sourceSha256: await sha256Hex(film.sourceText),
      captureDeclaration: "real-capture",
      capturedBy: "AIVORA 保存原始回复（本机）",
      work: film.title,
      scenes,
    },
    null,
    2,
  )}\n`;
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  return { name: `aivora-排查-${stamp}.json`, text, scenes: scenes.length };
}

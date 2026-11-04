import type { FilmProject, FilmPortrait, FilmShot } from "../film/project";
import { portraitPrompts } from "../film/operations";

export type AgentReply = { text: string | null; detail: string; code?: string };

export async function retryDirectorTimeout(
  request: () => Promise<AgentReply>,
  progress: (message: string) => void,
): Promise<AgentReply> {
  const first = await request();
  if (first.code !== "TEXT_TIMEOUT") return first;
  progress("导演等待超时，正在自动重试（第 2 / 2 次）。");
  return request();
}

export function portraitReferences(film: FilmProject, shot?: FilmShot): string[] {
  const people = film.characters.filter((person) => !shot || shot.characters.includes(person.name));
  // Round-robin keeps every visible character ahead of additional angles.
  return [
    ...new Set(
      [0, 1, 2, 3]
        .flatMap((index) =>
          people.map(
            (person) => person.portraits.filter((portrait) => portrait.url)[index]?.url ?? "",
          ),
        )
        .filter(Boolean),
    ),
  ].slice(0, 13);
}

export async function generateMissingPortraits(
  base: FilmProject,
  characterId: string,
  current: () => FilmProject | null,
  apply: (film: FilmProject) => void,
  generate: (prompt: string) => Promise<{ url: string; reason: string }>,
  progress: (message: string) => void,
): Promise<void> {
  const character = base.characters.find((person) => person.id === characterId);
  if (!character) return;
  const prompts = portraitPrompts(character.name, character.identity, base.styleZh).filter(
    (item) => !character.portraits.some((portrait) => portrait.view === item.view && portrait.url),
  );
  const portraits: FilmPortrait[] = character.portraits.filter((item) => item.url);
  const failures: string[] = [];
  for (const [index, item] of prompts.entries()) {
    if (current()?.id !== base.id) return;
    progress(`正在生成${character.name}的${item.view}（${index + 1} / ${prompts.length}）。`);
    const made = await generate(item.prompt);
    if (!made.url) {
      failures.push(`${item.view}：${made.reason}`);
      continue;
    }
    portraits.push({ view: item.view, prompt: item.prompt, url: made.url });
    const live = current();
    if (!live || live.id !== base.id) return;
    apply({
      ...live,
      characters: live.characters.map((person) =>
        person.id === characterId ? { ...person, portraits: [...portraits] } : person,
      ),
    });
  }
  progress(
    failures.length
      ? `${character.name}还有 ${failures.length} 张未完成，可再次补全。${failures.join("；")}`
      : `${character.name}的四张定妆照已齐全。`,
  );
}

export function middlePath(path: string, length = 48): string {
  if (path.length <= length) return path;
  const side = Math.floor((length - 1) / 2);
  return `${path.slice(0, side)}…${path.slice(-side)}`;
}

export function fileMediaUrl(path: string | undefined): string {
  if (!path) return "";
  if (
    path.startsWith("aivora-media:") ||
    path.startsWith("data:") ||
    path.startsWith("blob:") ||
    path.startsWith("http")
  )
    return path;
  if (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)) {
    return `aivora-media://local/?path=${encodeURIComponent(path)}`;
  }
  return "";
}

export async function requestStill(
  seriesId: string,
  prompt: string,
  aspectRatio: "9:16" | "16:9" = "9:16",
  references: string[] = [],
): Promise<{ url: string; reason: string }> {
  const bridge = window.aijian;
  if (!seriesId || !bridge?.generateFilmStill) {
    return { url: "", reason: "请打开安装好的 AIVORA 再出图。" };
  }
  try {
    const result = await bridge.generateFilmStill(seriesId, prompt, aspectRatio, references);
    if (!result.path) return { url: "", reason: result.reason || "出图没有成功，可以重试。" };
    const url = fileMediaUrl(result.path);
    return { url: url || result.path, reason: "画面已生成。" };
  } catch {
    return { url: "", reason: "出图没有成功，可以重试。" };
  }
}

export function assistantInputVersion(film: FilmProject | null, sceneId: string): string {
  if (!film) return "";
  return JSON.stringify({
    scene: film.scenes.find((scene) => scene.id === sceneId),
    style: film.styleZh,
    characters: film.characters.map(({ name, identity }) => ({ name, identity })),
    shots: film.shots
      .filter((shot) => shot.sceneId === sceneId)
      .map(({ id, picture, action, line, performance }) => ({
        id,
        picture,
        action,
        line,
        performance,
      })),
  });
}

export function settleNextJob(
  base: FilmProject,
  shotId: string,
  status: "done" | "failed" | "queued",
): FilmProject {
  let marked = false;
  return {
    ...base,
    jobs: base.jobs.map((job) => {
      if (
        marked ||
        job.shotId !== shotId ||
        (job.status !== "running" && job.status !== "queued")
      ) {
        return job;
      }
      marked = true;
      return { ...job, status };
    }),
  };
}

export function dialogueMuted(film: FilmProject): boolean {
  return film.audioClips.some((clip) => clip.lane === "dialogue" && clip.gainDb <= -40);
}

export function isVoiceFile(path: string): boolean {
  return (
    path.startsWith("data:audio") ||
    /\.(mp3|wav|m4a|aac)(?:$|\?)/i.test(path.split(/[\\/]/).pop() ?? "")
  );
}

export async function requestShotStill(
  film: FilmProject,
  shot: FilmShot,
  prompt: string,
): Promise<{ url: string; reason: string }> {
  const visible = film.characters.filter(
    (person) =>
      shot.characters.includes(person.name) && person.portraits.some((portrait) => portrait.url),
  );
  if (visible.length > 5)
    return {
      url: "",
      reason:
        "这一镜有超过 5 位角色需要定妆照；当前图片模型最多接收 5 张，请拆镜后重试。视频仍支持最多 13 张定妆照加首帧。",
    };
  // One portrait per visible person before extra views, never silently omit a person.
  const available = portraitReferences(film, shot);
  const references = available.slice(0, 5);
  const made = await requestStill(
    film.seriesId,
    prompt,
    film.aspectRatio === "16:9" ? "16:9" : "9:16",
    references,
  );
  return {
    ...made,
    reason: `${made.reason} 首帧选用 ${references.length} 张定妆照（图片模型上限 5）；视频保留最多 13 张定妆照加首帧。`,
  };
}

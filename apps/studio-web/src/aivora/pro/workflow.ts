import type { artFromModel } from "../film/phase2";
import type { UiNotice } from "../film/contracts3j";
import type { FilmProject, FilmPortrait, FilmShot, FilmTake } from "../film/project";
import { dialogueTracks, firstFrameReferences, portraitPrompts } from "../film/operations";

export type AgentReply = { text: string | null; detail: string; code?: string };

export async function retryDirectorTimeout(
  request: () => Promise<AgentReply>,
  progress: (message: string) => void,
  notify?: (message: UiNotice) => void,
): Promise<AgentReply> {
  const first = await request();
  if (!["TEXT_TIMEOUT", "TEXT_STALLED", "STALL_RETRYING"].includes(first.code ?? "")) return first;
  const message = {
    code: "STALL_RETRYING",
    text: "导演等待超时，正在重试。",
    detail: "第 2 / 2 次",
  };
  notify?.(message);
  progress(`${message.text}（${message.detail}）`);
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
  const references = firstFrameReferences(film, shot);
  const made = await requestStill(
    film.seriesId,
    prompt.replace(/[^。！？\n]*<IMAGE_\d+>[^。！？\n]*[。！？]?/gi, "").trim(),
    film.aspectRatio === "16:9" ? "16:9" : "9:16",
    references,
  );
  return {
    ...made,
    reason: `${made.reason} 首帧选用 ${references.length} 张定妆照（图片模型上限 5）；视频保留最多 13 张定妆照加首帧。`,
  };
}

export async function hydrateFilm(film: FilmProject): Promise<FilmProject> {
  const shots = film.shots.map((shot) => ({
    ...shot,
    poster: shot.poster,
    takes: shot.takes.map((take) => {
      if (take.videoUrl || take.status !== "done") return take;
      const videoUrl = fileMediaUrl(take.videoPath);
      return videoUrl ? { ...take, videoUrl } : take;
    }),
  }));
  return { ...film, shots };
}

export function filmSignature(value: FilmProject): string {
  return JSON.stringify({
    ...value,
    savedAt: "",
    directory: "",
    assemblyUrl: "",
    shots: value.shots.map((shot) => ({
      ...shot,
      takes: shot.takes.map((take) => ({ ...take, videoUrl: "" })),
    })),
  });
}

export function replaceTakes(
  base: FilmProject,
  shotId: string,
  takes: FilmTake[],
  selected = "",
): FilmProject {
  return {
    ...base,
    shots: base.shots.map((item) =>
      item.id === shotId
        ? { ...item, takes, selectedTakeId: selected || item.selectedTakeId }
        : item,
    ),
  };
}

export function applyArtDraft(
  film: FilmProject,
  parsed: NonNullable<ReturnType<typeof artFromModel>>,
): FilmProject {
  const next = { ...film };
  if (parsed.styleZh) next.styleZh = parsed.styleZh;
  next.characters = next.characters.map((person) => {
    if (person.userFields.includes("identity")) return person;
    const found = parsed.identities.find((item) => item.name === person.name);
    return found ? { ...person, identity: found.identity } : person;
  });
  const places = [...next.locations];
  for (const place of parsed.places) {
    if (places.some((item) => item.name === place.name)) continue;
    places.push({
      id: `loc-${places.length + 1}`,
      name: place.name,
      prompt: place.prompt,
      ambience: place.ambience,
    });
  }
  next.locations = places;
  const props = [...next.props];
  for (const prop of parsed.props) {
    if (props.some((item) => item.name === prop.name)) continue;
    props.push({ id: `prop-${props.length + 1}`, name: prop.name, note: prop.note });
  }
  next.props = props;
  return next;
}

export function shotFrame(shot: FilmShot | undefined): string {
  if (!shot) return "";
  const poster = fileMediaUrl(shot.poster);
  if (poster) return poster;
  const take =
    shot.takes.find((item) => item.id === shot.selectedTakeId) ??
    shot.takes.find((item) => item.status === "done");
  return fileMediaUrl(take?.stillUrl);
}

export async function assembleCurrentFilm(
  base: FilmProject,
  paths: string[],
  current: () => FilmProject | null,
  apply: (film: FilmProject) => void,
  notice: (message: string) => void,
  valid: () => boolean,
): Promise<void> {
  const bridge = window.aijian;
  if (paths.length < 2 || !bridge?.assembleFilm || !valid()) return;
  try {
    const music = base.audioClips.find((clip) => clip.lane === "score" && clip.path);
    const result = await bridge.assembleFilm(
      base.seriesId,
      paths,
      music?.path ?? "",
      music ? music.gainDb : -14,
      dialogueTracks(base),
    );
    const latest = current();
    if (!valid() || !latest || latest.id !== base.id) return;
    apply({ ...latest, assemblyPath: result.path, assemblyUrl: fileMediaUrl(result.path) });
    if (result.reason) notice(result.reason);
  } catch {
    if (valid() && current()?.id === base.id) notice("多镜头没有接上，没有导出。");
  }
}

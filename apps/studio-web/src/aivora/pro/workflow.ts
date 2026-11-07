import {
  assemblyRenderKey,
  assemblySelection,
  readAssemblyInput,
  requestAssembly,
} from "./assembly";
import { prepareHistoryInput } from "./actions/persistent-history";
import type { FilmSaveLease } from "./film-persistence";
import { mergeArtDesign } from "../film/art-design";
import { constrainVisualPrompt, onScreenCharacters } from "../film/on-screen-characters";
import { mergeCostumes, withShotCostumes } from "../film/costume-rules";
import { locationReference, withLocationLayout } from "../film/location-reference";
import { setFilmStyle, withStyleBible } from "../film/style-bible";
import type { artFromModel } from "../film/phase2";
import type { UiNotice } from "../film/contracts3j";
import { normalizeNotice, NOTICE_TEXT } from "../film/notices";
import type { FilmProject, FilmPortrait, FilmShot, FilmTake } from "../film/project";
import {
  autoVoiceForCharacter,
  locationPlate,
  firstFrameReferences,
  portraitPrompts,
} from "../film/operations";

export type AgentReply = { text: string | null; detail: string; code?: string };
export type AgentRequestControl = { deadlineAt: number; signal: AbortSignal };

export async function retryDirectorTimeout(
  request: (control: AgentRequestControl) => Promise<AgentReply>,
  progress: (message: string) => void,
  notify?: (message: UiNotice) => void,
  options: { signal?: AbortSignal; current?: () => boolean; totalMs?: number } = {},
): Promise<AgentReply> {
  const totalMs = Number.isFinite(options.totalMs) ? Math.floor(options.totalMs!) : 300_000;
  const deadlineAt = Date.now() + Math.max(1, Math.min(totalMs, 300_000));
  const controller = new AbortController();
  let settle!: (reply: AgentReply) => void;
  const stopped = new Promise<AgentReply>((resolve) => {
    settle = resolve;
  });
  const stop = (reason: string) => {
    if (controller.signal.aborted) return;
    controller.abort();
    settle({
      text: null,
      detail:
        reason === "TEXT_TIMEOUT"
          ? NOTICE_TEXT.TEXT_TIMEOUT
          : reason === "REQUEST_STALE"
            ? NOTICE_TEXT.REQUEST_STALE
            : NOTICE_TEXT.OPERATION_CANCELLED,
      code: reason,
    });
  };
  const cancel = () => stop("TEXT_CANCELLED");
  const timer = setTimeout(() => stop("TEXT_TIMEOUT"), Math.max(0, deadlineAt - Date.now()));
  const watch = options.current
    ? setInterval(() => {
        if (!options.current?.()) stop("REQUEST_STALE");
      }, 100)
    : undefined;
  const check = () => {
    if (options.signal?.aborted) cancel();
    else if (options.current && !options.current()) stop("REQUEST_STALE");
    else if (Date.now() >= deadlineAt) stop("TEXT_TIMEOUT");
    return controller.signal.aborted;
  };
  options.signal?.addEventListener("abort", cancel, { once: true });
  const attempt = async () => {
    if (check()) return stopped;
    const result = await Promise.race([
      request({ deadlineAt, signal: controller.signal }),
      stopped,
    ]);
    return check() ? stopped : result;
  };
  try {
    const first = await attempt();
    if (check()) return stopped;
    if (!["TEXT_TIMEOUT", "TEXT_STALLED", "STALL_RETRYING"].includes(first.code ?? ""))
      return first;
    const message = {
      code: "STALL_RETRYING",
      text: "导演等待超时，正在重试。",
      detail: "第 2 / 2 次",
    };
    notify?.(message);
    progress(`${message.text}（${message.detail}）`);
    return await attempt();
  } finally {
    clearTimeout(timer);
    clearInterval(watch);
    options.signal?.removeEventListener("abort", cancel);
  }
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
  const prompts = portraitPrompts(character.name, character.identity, base.styleZh, {
    gender: character.gender,
    ageBand: character.ageBand,
  }).filter(
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
    if (!result.path) {
      const providerReason = result.reason || "";
      return {
        url: "",
        reason: stillFailureNotice(new Error(providerReason)).text,
      };
    }
    const url = fileMediaUrl(result.path);
    return { url: url || result.path, reason: "画面已生成。" };
  } catch (error) {
    return { url: "", reason: stillFailureNotice(error).text };
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

/** Use for portrait, location and prop image requests that already have a film snapshot. */
export async function requestFilmStill(
  film: FilmProject,
  prompt: string,
  references: string[] = [],
): Promise<{ url: string; reason: string }> {
  return requestStill(
    film.seriesId,
    withStyleBible(prompt, film.styleZh),
    film.aspectRatio,
    references,
  );
}

export async function requestShotStill(
  film: FilmProject,
  shot: FilmShot,
  prompt: string,
): Promise<{
  url: string;
  reason: string;
  diagnostics: { referenceCount: number; imageLimit: number; videoReferenceLimit: number };
}> {
  const visualFilm = { ...film, characters: onScreenCharacters(film, shot) };
  const visible = visualFilm.characters.filter((person) =>
    person.portraits.some((portrait) => portrait.url),
  );
  const portraitLimit = locationReference(visualFilm, shot) ? 4 : 5;
  if (visible.length > portraitLimit)
    return {
      url: "",
      reason: NOTICE_TEXT.STILL_CAST_LIMIT,
      diagnostics: { referenceCount: 0, imageLimit: 5, videoReferenceLimit: 13 },
    };
  // One portrait per visible person before extra views, never silently omit a person.
  const references = firstFrameReferences(visualFilm, shot);
  const made = await requestStill(
    film.seriesId,
    withStyleBible(
      constrainVisualPrompt(
        withShotCostumes(
          withLocationLayout(
            prompt.replace(/[^。！？\n]*<IMAGE_\d+>[^。！？\n]*[。！？]?/gi, "").trim(),
            film,
            shot,
          ),
          film,
          shot,
        ),
        film,
        shot,
      ),
      film.styleZh,
    ),
    film.aspectRatio === "16:9" ? "16:9" : "9:16",
    references,
  );
  return {
    ...made,
    diagnostics: { referenceCount: references.length, imageLimit: 5, videoReferenceLimit: 13 },
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

function mergeArtField(
  field: string,
  current: string,
  incoming: string,
  baseline: string | undefined,
  locks: Set<string>,
  knownDefault = false,
): { value: string; baseline?: string } {
  if (locks.has(field)) return { value: current, baseline };
  if (baseline !== undefined && current !== baseline) {
    locks.add(field);
    return { value: current, baseline };
  }
  if (baseline === undefined && current.trim() && !knownDefault) return { value: current };
  return incoming.trim() ? { value: incoming, baseline: incoming } : { value: current, baseline };
}

export function applyArtDraft(
  film: FilmProject,
  parsed: NonNullable<ReturnType<typeof artFromModel>>,
): FilmProject {
  let next = { ...(parsed.styleZh ? setFilmStyle(film, parsed.styleZh) : film) };
  if (parsed.design)
    next = { ...next, ...mergeArtDesign(film.artDesign, film.artDesignBaseline, parsed.design) };
  if (parsed.costumes) next = mergeCostumes(next, parsed.costumes);
  const used = new Set(next.characters.map((person) => person.voiceId).filter(Boolean));
  next.characters = next.characters.map((person) => {
    const found = parsed.identities.find((item) => item.name === person.name);
    if (!found) return person;
    const updated = {
      ...person,
      identity: person.userFields.includes("identity")
        ? person.identity
        : found.identity || person.identity,
      gender: person.userFields.includes("gender") ? person.gender : person.gender || found.gender,
      ageBand: person.userFields.includes("ageBand")
        ? person.ageBand
        : person.ageBand || found.ageBand,
    };
    const voiced = autoVoiceForCharacter(updated, used, film.sourceText);
    used.add(voiced.voiceId);
    return voiced;
  });
  const styleChanged = next.styleZh !== film.styleZh;
  const places = next.locations.map((place) =>
    styleChanged && place.referenceImage ? { ...place, referenceStyleRevision: -1 } : place,
  );
  for (const place of parsed.places) {
    const index = places.findIndex((item) => item.name === place.name);
    if (index >= 0) {
      const previous = places[index]!;
      const locks = new Set(previous.userFields ?? []);
      const prompt = mergeArtField(
        "prompt",
        previous.prompt,
        place.prompt,
        previous.artFields?.prompt,
        locks,
        previous.prompt === locationPlate(previous.name, film.styleZh, "夜"),
      );
      const ambience = mergeArtField(
        "ambience",
        previous.ambience,
        place.ambience,
        previous.artFields?.ambience,
        locks,
      );
      const layout = mergeArtField(
        "layout",
        previous.layout ?? "",
        place.layout ?? "",
        previous.artFields?.layout,
        locks,
      );
      places[index] = {
        ...previous,
        ...(layout.value ? { layout: layout.value } : {}),
        prompt: prompt.value,
        ambience: ambience.value,
        userFields: [...locks],
        artFields: {
          ...previous.artFields,
          ...(layout.baseline !== undefined ? { layout: layout.baseline } : {}),
          ...(prompt.baseline !== undefined ? { prompt: prompt.baseline } : {}),
          ...(ambience.baseline !== undefined ? { ambience: ambience.baseline } : {}),
        },
        ...((prompt.value !== previous.prompt || layout.value !== (previous.layout ?? "")) &&
        previous.referenceImage
          ? { referenceStyleRevision: -1 }
          : {}),
      };
    } else {
      places.push({
        id: `loc-${places.length + 1}`,
        name: place.name,
        prompt: place.prompt,
        ambience: place.ambience,
        ...(place.layout ? { layout: place.layout } : {}),
        artFields: {
          prompt: place.prompt,
          ambience: place.ambience,
          ...(place.layout ? { layout: place.layout } : {}),
        },
      });
    }
  }
  next.locations = places;
  const props = [...next.props];
  for (const prop of parsed.props) {
    const index = props.findIndex((item) => item.name === prop.name);
    if (index >= 0) {
      const previous = props[index]!;
      const locks = new Set(previous.userFields ?? []);
      const note = mergeArtField("note", previous.note, prop.note, previous.artFields?.note, locks);
      props[index] = {
        ...previous,
        note: note.value,
        userFields: [...locks],
        artFields: {
          ...previous.artFields,
          ...(note.baseline !== undefined ? { note: note.baseline } : {}),
        },
      };
    } else
      props.push({
        id: `prop-${props.length + 1}`,
        name: prop.name,
        note: prop.note,
        artFields: { note: prop.note },
      });
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
  host?: { acquire: (id: string) => Promise<FilmSaveLease>; signal?: AbortSignal },
): Promise<void> {
  const bridge = window.aijian;
  if (paths.length < 2 || !valid()) return;
  if (!bridge?.assembleFilmProject || !bridge.cancelFilmAssemblyOperation || !host) return;
  let prepared: Awaited<ReturnType<typeof prepareHistoryInput>> | undefined;
  let saving = false;
  try {
    prepared = await prepareHistoryInput(base, { current, apply, acquire: host.acquire });
    if (!valid() || host.signal?.aborted || !prepared.current()) return;
    const accepted = prepared.film,
      renderKey = assemblyRenderKey(accepted),
      control = {
        current,
        valid: () =>
          valid() && current()?.id === base.id && assemblyRenderKey(current()!) === renderKey,
        signal: host.signal,
      };
    if (assemblySelection(accepted).length !== paths.length) return;
    const input = await readAssemblyInput(accepted, control);
    if (!input) return;
    const result = await requestAssembly(accepted, input, control);
    if (!control.valid() || host.signal?.aborted) return;
    if (result.kind === "FAILED") {
      if (result.code !== "PROJECT_CHANGED" && result.code !== "OPERATION_STOPPED")
        notice(
          result.code === "SOURCE_TIME_MISMATCH"
            ? NOTICE_TEXT.ASSEMBLY_SOURCE_CLOCK_MISMATCH
            : NOTICE_TEXT.ASSEMBLY_FAILED,
        );
      return;
    }
    apply({ ...current()!, assemblyPath: result.path, assemblyUrl: fileMediaUrl(result.path) });
    const written = current();
    if (!written || written.id !== base.id) return;
    saving = true;
    await prepared.lease.save(
      written,
      () => valid() && !host.signal?.aborted && current() === written,
    );
    if (result.kind === "PARTIAL" && valid() && !host.signal?.aborted && current() === written)
      notice(NOTICE_TEXT.ASSEMBLY_PARTIAL);
  } catch {
    if (valid() && current()?.id === base.id && !host.signal?.aborted)
      notice(saving ? NOTICE_TEXT.SAVE_FAILED : NOTICE_TEXT.ASSEMBLY_FAILED);
  } finally {
    try {
      await prepared?.release();
    } catch {
      if (valid() && current()?.id === base.id && !host.signal?.aborted)
        notice(NOTICE_TEXT.SAVE_FAILED);
    }
  }
}

/** Status copy is one canonical sentence; provider/selection diagnostics stay separate. */
export function stillFailureNotice(error: unknown): UiNotice {
  if (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.startsWith("LOCATION_")
  ) {
    return {
      code: error.code,
      text:
        NOTICE_TEXT[error.code as keyof typeof NOTICE_TEXT] ??
        NOTICE_TEXT.LOCATION_IMAGE_INCOMPLETE,
    };
  }
  const reason = error instanceof Error ? error.message : "";
  if (reason === "TASK_TIMEOUT" || (error instanceof Error && error.name === "TimeoutError"))
    return { code: "TASK_TIMEOUT", text: NOTICE_TEXT.TASK_TIMEOUT };
  if (/拒绝|未获准/u.test(reason))
    return { code: "STILL_REJECTED", text: NOTICE_TEXT.STILL_REJECTED };
  const parsed = normalizeNotice(reason);
  const code = [
    "DESKTOP_REQUIRED",
    "GROK_MEMBERSHIP_REQUIRED",
    "REAUTH_REQUIRED",
    "STILL_CAST_LIMIT",
    "TASK_TIMEOUT",
  ].includes(parsed.code)
    ? parsed.code
    : "STILL_FAILED";
  return { code, text: NOTICE_TEXT[code as keyof typeof NOTICE_TEXT] };
}

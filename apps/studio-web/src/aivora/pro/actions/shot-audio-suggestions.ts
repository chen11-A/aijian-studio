import type {
  SuggestBundledFilmShotAudioInput,
  SuggestBundledFilmShotAudioResult,
  ShotAudioSuggestionNote,
} from "@aijian/contracts/film-audio-library";
import { audioMixEnvelope, audioMixSettings } from "@aijian/contracts/film-audio-mix-plan";
import { upgradeFilm, type FilmProject } from "../../film/project";
import { historyRecordHash } from "./persistent-history";
import type { LibraryHost, LibrarySelection } from "./audio-library";
import type { FilmSaveLease } from "../film-persistence";
export type ShotAudioPlan = Extract<SuggestBundledFilmShotAudioResult, { kind: "SUGGESTED" }>;
export type ShotAudioReadHost = Pick<LibraryHost, "current" | "selection" | "persistence">;
export type ShotAudioReadResult =
  | { kind: "ready"; plan: ShotAudioPlan; inputKey: string; attempts: number }
  | { kind: "failed"; message: string }
  | { kind: "stale" };
const notes = new Set<ShotAudioSuggestionNote["code"]>([
  "MUSIC_MOOD_UNDECIDED",
  "MUSIC_DISABLED",
  "MUSIC_QUIET",
  "MUSIC_MATCH_MISSING",
  "ACTION_TIME_UNCONFIRMED",
  "ACTION_TIME_INVALID",
  "ACTION_LABEL_MISSING",
  "DEVICE_TIME_UNCONFIRMED",
  "MATCH_MISSING",
  "PLANNED_TIMES_ONLY",
]);
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const text = (v: unknown): v is string => typeof v === "string" && v.length <= 8192;
const stable = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(stable)
    : object(v)
      ? Object.fromEntries(
          Object.entries(v)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, value]) => [key, stable(value)]),
        )
      : v;
/** Local display invalidation only. Native owns semantic fingerprint, hashes and source trust. */
export function shotAudioInputKey(
  film: FilmProject | null,
  selection: LibrarySelection | null,
): string | null {
  if (!film || !selection || selection.projectId !== film.id || selection.page !== "edit")
    return null;
  const shots = film.shots.filter((s) => s.id === selection.shotId);
  if (shots.length !== 1) return null;
  const shot = shots[0]!,
    takes = shot.takes.filter((t) => t.id === selection.takeId);
  if (
    shot.selectedTakeId !== selection.takeId ||
    takes.length !== 1 ||
    takes[0]!.status !== "done" ||
    !takes[0]!.videoPath
  )
    return null;
  const scenes = film.scenes.filter((s) => s.id === shot.sceneId);
  if (scenes.length !== 1) return null;
  const take = takes[0]!;
  return JSON.stringify(
    stable({
      scope: selection,
      style: film.styleZh,
      // Scene reference-image materialization is not an audio-planning input.
      scene: {
        id: scenes[0]!.id,
        title: scenes[0]!.title,
        where: scenes[0]!.where,
        ambience: scenes[0]!.ambience,
        text: scenes[0]!.text,
      },
      shot: {
        id: shot.id,
        sceneId: shot.sceneId,
        seconds: shot.seconds,
        picture: shot.picture,
        action: shot.action,
        line: shot.line,
        lines: shot.lines,
        sound: shot.sound,
        actionPlan: shot.actionPlan,
      },
      source: {
        id: take.id,
        videoPath: take.videoPath,
        cleanVideoPath: take.cleanVideoPath,
        durationSeconds: take.durationSeconds,
      },
      mix: audioMixSettings(film.audioMix),
    }),
  );
}
/** Reject an unusable native shape as a whole; never trim segments or repair envelopes in UI. */
export function validShotAudioPlan(
  value: unknown,
  input: SuggestBundledFilmShotAudioInput,
): value is ShotAudioPlan {
  if (
    !object(value) ||
    value.kind !== "SUGGESTED" ||
    value.projectId !== input.projectId ||
    value.shotId !== input.shotId ||
    value.takeId !== input.takeId ||
    value.projectHash !== input.expectedProjectHash ||
    !hash(value.planFingerprint) ||
    !hash(value.catalogSha256) ||
    !hash(value.pickerSha256) ||
    !finite(value.durationSeconds) ||
    value.durationSeconds <= 0 ||
    !Array.isArray(value.clips) ||
    value.clips.length > 128 ||
    !Array.isArray(value.warnings) ||
    !Array.isArray(value.limitations) ||
    value.warnings.length > 512 ||
    value.limitations.length > 1024
  )
    return false;
  const keys = new Set();
  for (const clip of value.clips) {
    if (
      !object(clip) ||
      typeof clip.key !== "string" ||
      !clip.key ||
      keys.has(clip.key) ||
      !["ambience", "sfx", "score"].includes(String(clip.lane)) ||
      !object(clip.asset) ||
      !object(clip.placement) ||
      !text(clip.reason)
    )
      return false;
    keys.add(clip.key);
    const a = clip.asset,
      p = clip.placement;
    if (
      !["id", "name", "category", "scene", "source", "author", "license"].every((k) =>
        text(a[k]),
      ) ||
      !["sfx", "music"].includes(String(a.type)) ||
      !Array.isArray(a.tags) ||
      !a.tags.every(text) ||
      !hash(a.sha256) ||
      !finite(a.durationSeconds) ||
      a.durationSeconds <= 0 ||
      typeof a.loopable !== "boolean" ||
      !(a.loudness === null || finite(a.loudness))
    )
      return false;
    if (
      (clip.lane === "score") !== (a.type === "music") ||
      !["startSeconds", "durationSeconds", "offsetSeconds", "gainDb"].every((k) => finite(p[k])) ||
      typeof p.loop !== "boolean"
    )
      return false;
    const start = p.startSeconds as number,
      duration = p.durationSeconds as number,
      offset = p.offsetSeconds as number,
      gain = p.gainDb as number;
    if (
      start < 0 ||
      duration <= 0 ||
      offset < 0 ||
      gain < -96 ||
      gain > 24 ||
      start + duration > value.durationSeconds + 1e-6 ||
      offset >= a.durationSeconds ||
      (!p.loop && offset + duration > a.durationSeconds + 1 / 48000) ||
      (p.loop && !a.loopable)
    )
      return false;
    if (clip.envelope !== undefined)
      try {
        audioMixEnvelope(clip.envelope);
      } catch {
        return false;
      }
  }
  return [...value.warnings, ...value.limitations].every(
    (n) =>
      object(n) &&
      notes.has(n.code as ShotAudioSuggestionNote["code"]) &&
      text(n.message) &&
      (n.index === undefined ||
        (Number.isSafeInteger(n.index) &&
          (n.index as number) >= 0 &&
          (n.index as number) <= 1024)) &&
      (n.seconds === undefined || finite(n.seconds)),
  );
}
const messages: Record<string, string> = {
  LIBRARY_UNAVAILABLE: "本地素材目录暂时不可用，请稍后重新查看。",
  ASSET_CHANGED: "本地素材或匹配规则已变化，请刷新后重新核对。",
  PROJECT_CHANGED: "作品或版本已变化，请重新查看本镜建议。",
  SOURCE_UNVERIFIED: "当前版本的来源暂时无法核验，还不能给出声音安排。",
  TOOLS_UNAVAILABLE: "本机媒体工具暂时不可用，请稍后重新查看。",
  BUSY: "本机正在核对这部作品，请完成后再刷新。",
  INVALID_INPUT: "当前镜头或版本无法确认，请重新选择。",
  PLAN_UNSUPPORTED: "这份声音安排暂时无法完整给出，请核对镜头和声音设置。",
};
function failure(value: unknown): string {
  if (
    object(value) &&
    value.kind === "FAILED" &&
    typeof value.code === "string" &&
    Object.hasOwn(messages, value.code)
  ) {
    if (
      value.code === "PLAN_UNSUPPORTED" &&
      value.reason === "TRACK_LIMIT" &&
      Number.isSafeInteger(value.maxSegments) &&
      Number.isSafeInteger(value.minimumRequiredSegments) &&
      (value.maxSegments as number) >= 0 &&
      (value.minimumRequiredSegments as number) > 0 &&
      (value.maxSegments as number) <= 128 &&
      (value.minimumRequiredSegments as number) <= 1024
    )
      return `声音安排至少需要 ${value.minimumRequiredSegments} 段，目前最多容纳 ${value.maxSegments} 段；没有截掉后面的片段。`;
    return messages[value.code]!;
  }
  return "声音建议没有完整读到，请刷新后重试。";
}
const rawRecord = (v: unknown, id: string): Record<string, unknown> | null =>
  object(v) && v.id === id ? v : null;
const withoutSaveMetadata = (raw: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(raw).filter(([key]) => !["savedAt", "directory"].includes(key)),
  );
export async function readShotAudioSuggestions(
  host: ShotAudioReadHost,
  current: () => boolean,
): Promise<ShotAudioReadResult> {
  const base = host.current(),
    selection = host.selection(),
    key = shotAudioInputKey(base, selection);
  if (!base || !selection || !key)
    return { kind: "failed", message: "先在剪辑页选一个已完成的视频版本，再查看声音建议。" };
  const bridge = window.aijian;
  if (!bridge?.readFilmProject || typeof bridge.suggestBundledFilmShotAudio !== "function")
    return {
      kind: "failed",
      message: "当前版本不支持查看本镜声音建议，请使用支持此功能的桌面版本。",
    };
  const valid = () => current() && shotAudioInputKey(host.current(), host.selection()) === key;
  let lease: FilmSaveLease | undefined,
    preflightFailed = false;
  try {
    lease = await host.persistence.acquire(base.id);
    await lease.save(base, () => current() && host.current() === base && valid());
  } catch {
    preflightFailed = true;
  } finally {
    try {
      await lease?.release();
    } catch {
      preflightFailed = true;
    }
  }
  if (!valid()) return { kind: "stale" };
  if (preflightFailed)
    return { kind: "failed", message: "当前编辑还没保存上，请先重试保存，再查看声音建议。" };
  try {
    let raw = rawRecord(await bridge.readFilmProject(base.id), base.id);
    if (!valid()) return { kind: "stale" };
    if (!raw || shotAudioInputKey(upgradeFilm(raw as Partial<FilmProject>), selection) !== key)
      return { kind: "failed", message: "已保存的镜头与当前编辑不一致，请重新核对后查看建议。" };
    for (let attempt = 1; attempt <= 2; attempt++) {
      const input = {
        projectId: base.id,
        expectedProjectHash: await historyRecordHash(raw),
        shotId: selection.shotId,
        takeId: selection.takeId,
      };
      if (!valid()) return { kind: "stale" };
      const reply: unknown = await bridge.suggestBundledFilmShotAudio(input);
      if (!valid()) return { kind: "stale" };
      if (validShotAudioPlan(reply, input))
        return { kind: "ready", plan: structuredClone(reply), inputKey: key, attempts: attempt };
      if (
        attempt === 1 &&
        object(reply) &&
        reply.kind === "FAILED" &&
        reply.code === "PROJECT_CHANGED" &&
        reply.unchanged === true
      ) {
        const fresh = rawRecord(await bridge.readFilmProject(base.id), base.id);
        if (!valid()) return { kind: "stale" };
        if (
          fresh &&
          shotAudioInputKey(upgradeFilm(fresh as Partial<FilmProject>), selection) === key &&
          (await historyRecordHash(withoutSaveMetadata(fresh))) ===
            (await historyRecordHash(withoutSaveMetadata(raw))) &&
          (await historyRecordHash(fresh)) !== (await historyRecordHash(raw))
        ) {
          raw = fresh;
          continue;
        }
      }
      return { kind: "failed", message: failure(reply) };
    }
  } catch {
    return valid()
      ? { kind: "failed", message: "声音建议暂时没有读到，可以刷新重试；没有新增声音片段。" }
      : { kind: "stale" };
  }
  return { kind: "failed", message: "声音建议没有完成，请刷新后重试。" };
}

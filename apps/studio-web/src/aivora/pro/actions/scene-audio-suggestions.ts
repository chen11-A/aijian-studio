import type {
  SuggestBundledFilmSceneAudioInput,
  SuggestBundledFilmSceneAudioResult,
} from "@aijian/contracts/film-audio-library";
import { audioMixSettings } from "@aijian/contracts/film-audio-mix-plan";
import { sceneAudioBinding } from "@aijian/contracts/film-scene-audio-binding";
import { upgradeFilm, type FilmProject } from "../../film/project";
import { historyRecordHash } from "./persistent-history";
import type { LibraryHost } from "./audio-library";
import type { FilmSaveLease } from "../film-persistence";
import { shotAudioInputKey, validShotAudioPlan } from "./shot-audio-suggestions";
export type SceneAudioPlan = Extract<
  SuggestBundledFilmSceneAudioResult,
  { kind: "SCENE_SUGGESTED" }
>;
export type SceneAudioSelection = { projectId: string; page: string; sceneId: string };
/** Ordered whole-film selection, never a scene-only substitute for native clock verification. */
export function sceneAudioSelection(film: FilmProject) {
  const rows = film.shots.map((shot) => {
    const takes = shot.takes.filter((take) => take.id === shot.selectedTakeId);
    return takes.length === 1 && takes[0]!.status === "done" && !!takes[0]!.videoPath
      ? { shotId: shot.id, takeId: takes[0]!.id }
      : null;
  });
  return rows.length > 0 &&
    rows.every((row) => row !== null) &&
    new Set(rows.map((row) => row!.shotId)).size === rows.length
    ? (rows as { shotId: string; takeId: string }[])
    : null;
}
const stable = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(stable)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, v]) => [key, stable(v)]),
        )
      : value;
/** Local creative invalidation only. Native owns actual clocks, bytes and authorization. */
export function sceneAudioInputKey(
  film: FilmProject | null,
  scope: SceneAudioSelection | null,
): string | null {
  if (
    !film ||
    !scope ||
    scope.projectId !== film.id ||
    scope.page !== "edit" ||
    film.scenes.filter((scene) => scene.id === scope.sceneId).length !== 1
  )
    return null;
  const selected = sceneAudioSelection(film);
  if (!selected || !film.shots.some((shot) => shot.sceneId === scope.sceneId)) return null;
  const keys = selected.map((row) => {
    const shot = film.shots.find((s) => s.id === row.shotId)!;
    const take = shot.takes.find((t) => t.id === row.takeId)!;
    return shot.sceneId === scope.sceneId
      ? shotAudioInputKey(film, { projectId: film.id, page: "edit", ...row })
      : JSON.stringify({
          shotId: shot.id,
          sceneId: shot.sceneId,
          takeId: take.id,
          videoPath: take.videoPath,
          cleanVideoPath: take.cleanVideoPath,
          durationSeconds: take.durationSeconds,
        });
  });
  if (keys.some((key) => !key)) return null;
  return JSON.stringify(
    stable({
      scope,
      keys,
      mix: audioMixSettings(film.audioMix),
      clips: film.audioClips.map((clip) => {
        // Analysis cache arrival does not change the sound arrangement being reviewed.
        return Object.fromEntries(Object.entries(clip).filter(([key]) => key !== "waveform"));
      }),
    }),
  );
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
/** All clock rows, segments and notes must be usable; no silently filtered partial plan. */
export function validSceneAudioPlan(
  value: unknown,
  input: SuggestBundledFilmSceneAudioInput,
): value is SceneAudioPlan {
  if (
    !object(value) ||
    value.kind !== "SCENE_SUGGESTED" ||
    value.projectId !== input.projectId ||
    value.sceneId !== input.sceneId ||
    value.projectHash !== input.expectedProjectHash ||
    ![value.planFingerprint, value.catalogSha256, value.pickerSha256].every(
      (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v),
    ) ||
    !object(value.clock) ||
    !finite(value.clock.durationSeconds) ||
    value.clock.durationSeconds <= 0 ||
    value.clock.durationSeconds > 36000 ||
    !Array.isArray(value.clock.shots) ||
    value.clock.shots.length !== input.expectedSelection.length ||
    !Array.isArray(value.clips) ||
    value.clips.length > 128 ||
    !Array.isArray(value.warnings) ||
    !Array.isArray(value.limitations) ||
    value.warnings.length > 512 ||
    value.limitations.length > 1024 ||
    !finite(value.sceneStartSeconds) ||
    !finite(value.sceneDurationSeconds) ||
    value.sceneStartSeconds < 0 ||
    value.sceneDurationSeconds <= 0
  )
    return false;
  try {
    if (sceneAudioBinding(value.sceneAudioBinding)?.sceneId !== input.sceneId) return false;
  } catch {
    return false;
  }
  let end = 0;
  const sceneRows: { start: number; duration: number; index: number }[] = [];
  for (let i = 0; i < value.clock.shots.length; i++) {
    const row = value.clock.shots[i],
      selected = input.expectedSelection[i];
    if (
      !object(row) ||
      row.shotId !== selected?.shotId ||
      row.takeId !== selected?.takeId ||
      typeof row.sceneId !== "string" ||
      !finite(row.startSeconds) ||
      row.startSeconds < 0 ||
      !finite(row.durationSeconds) ||
      row.durationSeconds <= 0 ||
      Math.abs(row.startSeconds - end) > 1e-6
    )
      return false;
    if (row.sceneId === input.sceneId)
      sceneRows.push({ start: row.startSeconds, duration: row.durationSeconds, index: i });
    end += row.durationSeconds;
  }
  if (
    !sceneRows.length ||
    sceneRows.some((row, i) => row.index !== sceneRows[0]!.index + i) ||
    Math.abs(end - value.clock.durationSeconds) > 1e-6 ||
    Math.abs(sceneRows[0]!.start - value.sceneStartSeconds) > 1e-6 ||
    Math.abs(sceneRows.reduce((sum, row) => sum + row.duration, 0) - value.sceneDurationSeconds) >
      1e-6
  )
    return false;
  const keys = new Set<string>();
  for (const clip of value.clips) {
    if (!object(clip) || typeof clip.key !== "string" || keys.has(clip.key)) return false;
    keys.add(clip.key);
    const row = value.clock.shots.find(
      (row) =>
        object(row) &&
        row.shotId === clip.shotId &&
        row.takeId === clip.takeId &&
        row.sceneId === input.sceneId,
    );
    if (
      !object(row) ||
      !validShotAudioPlan(
        {
          ...value,
          kind: "SUGGESTED",
          shotId: clip.shotId,
          takeId: clip.takeId,
          durationSeconds: row.durationSeconds,
          clips: [clip],
          warnings: [],
          limitations: [],
        },
        {
          projectId: input.projectId,
          expectedProjectHash: input.expectedProjectHash,
          shotId: String(clip.shotId),
          takeId: String(clip.takeId),
        },
      )
    )
      return false;
  }
  // Reuse the fixed note validator, with the one scene-specific code explicitly checked.
  return [...value.warnings, ...value.limitations].every((note) => {
    if (
      !object(note) ||
      (note.shotIndex !== undefined &&
        (!Number.isSafeInteger(note.shotIndex) ||
          Number(note.shotIndex) < 0 ||
          Number(note.shotIndex) >= input.expectedSelection.length))
    )
      return false;
    return validShotAudioPlan(
      {
        ...value,
        kind: "SUGGESTED",
        shotId: "note",
        takeId: "note",
        durationSeconds: value.sceneDurationSeconds,
        clips: [],
        warnings: [
          {
            ...note,
            code: note.code === "SCENE_MUSIC_MOOD_CONFLICT" ? "MUSIC_MOOD_UNDECIDED" : note.code,
          },
        ],
        limitations: [],
      },
      {
        projectId: input.projectId,
        expectedProjectHash: input.expectedProjectHash,
        shotId: "note",
        takeId: "note",
      },
    );
  });
}

/** Structural correspondence only; bytes/clock authorization remains native. */
export function sceneAudioClockMatches(plan: SceneAudioPlan, film: FilmProject): boolean {
  return (
    JSON.stringify(plan.clock.shots.map(({ shotId, takeId }) => ({ shotId, takeId }))) ===
      JSON.stringify(sceneAudioSelection(film)) &&
    plan.clock.shots.every(
      (row) =>
        film.shots.filter((s) => s.id === row.shotId && s.sceneId === row.sceneId).length === 1,
    )
  );
}
export type SceneAudioHost = LibraryHost & { sceneSelection: () => SceneAudioSelection | null };
export type SceneAudioReadResult =
  | { kind: "ready"; plan: SceneAudioPlan; inputKey: string; attempts: number }
  | { kind: "stale" }
  | { kind: "failed"; message: string };
const rawRecord = (v: unknown, id: string) => (object(v) && v.id === id ? v : null);
const withoutSaveMetadata = (v: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(v).filter(([key]) => !["savedAt", "directory"].includes(key)));
export async function readSceneAudioSuggestions(
  host: SceneAudioHost,
  current: () => boolean,
): Promise<SceneAudioReadResult> {
  const base = host.current(),
    scope = host.sceneSelection(),
    key = sceneAudioInputKey(base, scope),
    bridge = window.aijian;
  if (!base || !scope || !key)
    return { kind: "failed", message: "先核对全片已选视频和当前场次，再查看整场声音建议。" };
  if (!bridge?.readFilmProject || !bridge.suggestBundledFilmSceneAudio)
    return { kind: "failed", message: "当前桌面版本不支持整场声音建议，请更新后重试。" };
  const valid = () =>
    current() && sceneAudioInputKey(host.current(), host.sceneSelection()) === key;
  let lease: FilmSaveLease | undefined,
    failed = false;
  try {
    lease = await host.persistence.acquire(base.id);
    await lease.save(base, () => host.current() === base && valid());
  } catch {
    failed = true;
  } finally {
    try {
      await lease?.release();
    } catch {
      failed = true;
    }
  }
  if (!valid()) return { kind: "stale" };
  if (failed)
    return { kind: "failed", message: "当前编辑还没保存上，请先重试保存，再查看整场建议。" };
  try {
    let raw = rawRecord(await bridge.readFilmProject(base.id), base.id);
    if (!valid()) return { kind: "stale" };
    if (!raw || sceneAudioInputKey(upgradeFilm(raw as Partial<FilmProject>), scope) !== key)
      return { kind: "failed", message: "已保存的作品与当前编辑不一致，请先核对保存状态。" };
    for (let attempt = 1; attempt <= 2; attempt++) {
      const selected = sceneAudioSelection(upgradeFilm(raw as Partial<FilmProject>)!);
      if (!selected) return { kind: "stale" };
      const input = {
        projectId: base.id,
        sceneId: scope.sceneId,
        expectedProjectHash: await historyRecordHash(raw),
        expectedSelection: selected,
      };
      if (!valid()) return { kind: "stale" };
      const reply: unknown = await bridge.suggestBundledFilmSceneAudio(input);
      if (!valid()) return { kind: "stale" };
      if (
        validSceneAudioPlan(reply, input) &&
        sceneAudioClockMatches(reply, upgradeFilm(raw as Partial<FilmProject>)!)
      )
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
          sceneAudioInputKey(upgradeFilm(fresh as Partial<FilmProject>), scope) === key &&
          (await historyRecordHash(withoutSaveMetadata(fresh))) ===
            (await historyRecordHash(withoutSaveMetadata(raw))) &&
          (await historyRecordHash(fresh)) !== (await historyRecordHash(raw))
        ) {
          raw = fresh;
          continue;
        }
      }
      const reason = object(reply) ? reply.reason : null,
        code = object(reply) ? reply.code : null;
      const message =
        reason === "GLOBAL_CLOCK_UNAVAILABLE"
          ? "全片实际时钟尚不完整，请先完成并核对全部已选视频。"
          : reason === "SCENE_ORDER_UNSUPPORTED"
            ? "当前场次在全片中交错出现，暂不能完整安排整场声音。"
            : reason === "TRACK_LIMIT"
              ? "整场声音片段超过当前可支持范围，没有截掉后面的片段。"
              : code === "BUSY"
                ? "本机正在处理这部作品，请完成后再刷新。"
                : code === "LIBRARY_UNAVAILABLE"
                  ? "本地素材目录暂时不可用，请稍后重新查看。"
                  : code === "PROJECT_CHANGED"
                    ? "作品、选版或素材已变化，请重新查看整场建议。"
                    : code === "TOOLS_UNAVAILABLE"
                      ? "本机媒体工具暂时不可用，请稍后重新查看。"
                      : code === "SOURCE_UNVERIFIED"
                        ? "所选视频来源暂时无法核验，还不能安排整场声音。"
                        : "整场声音建议没有完整读到，请刷新后重试。";
      return { kind: "failed", message };
    }
  } catch {
    return valid()
      ? { kind: "failed", message: "整场声音建议暂时没有读到；没有新增声音片段，可以刷新重试。" }
      : { kind: "stale" };
  }
  return { kind: "failed", message: "整场声音建议没有完成，请刷新后重试。" };
}

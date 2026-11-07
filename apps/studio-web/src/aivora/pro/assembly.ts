import type {
  FilmAssemblyInput,
  FilmAssemblyResult,
  FilmAssemblyArtifact,
} from "@aijian/contracts/film-assembly";
import { audioMixSettings } from "@aijian/contracts/film-audio-mix-plan";
import { upgradeFilm, type FilmProject, type FilmTake } from "../film/project";
import { historyRecordHash } from "./actions/persistent-history";
export type AssemblyClock = Pick<FilmAssemblyArtifact, "shots" | "durationSeconds" | "incomplete">;
const clocks = new Map<string, { key: string; clock: AssemblyClock }>();
const selected = (shot: FilmProject["shots"][number]): FilmTake | undefined =>
  shot.selectedTakeId
    ? shot.takes.find(
        (take) => take.id === shot.selectedTakeId && take.status === "done" && take.videoPath,
      )
    : shot.takes.find((take) => take.status === "done" && take.videoPath);
export function assemblySelection(film: FilmProject) {
  return film.shots.flatMap((shot) => {
    const take = selected(shot);
    return take ? [{ shotId: shot.id, takeId: take.id }] : [];
  });
}
/** Render inputs only: no savedAt, assembly outputs or pipeline progress can restart this job. */
export function assemblyRenderKey(film: FilmProject) {
  return JSON.stringify(
    {
      projectId: film.id,
      seriesId: film.seriesId,
      shots: film.shots.map((shot) => ({
        id: shot.id,
        line: shot.line,
        lines: shot.lines ?? [],
        sound: shot.sound,
        take: (() => {
          const take = selected(shot);
          return take
            ? {
                id: take.id,
                shotId: take.shotId,
                status: take.status,
                videoPath: take.videoPath,
                cleanVideoPath: take.cleanVideoPath || "",
                subtitleCues: take.subtitleCues ?? [],
              }
            : null;
        })(),
      })),
      clips: film.audioClips.map((clip) => ({
        id: clip.id,
        lane: clip.lane,
        shotId: clip.shotId,
        takeId: clip.takeId,
        label: clip.label,
        path: clip.path,
        startSeconds: clip.startSeconds,
        durationSeconds: clip.durationSeconds,
        offsetSeconds: clip.offsetSeconds,
        gainDb: clip.gainDb,
        enabled: clip.enabled !== false,
        ...(clip.loop !== undefined ? { loop: clip.loop } : {}),
        ...(clip.envelope !== undefined ? { envelope: clip.envelope } : {}),
      })),
      audioMix: audioMixSettings(film.audioMix),
      subtitleStyle: film.subtitleStyle ?? "white",
    },
    (_key, value) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(
            Object.entries(value)
              .filter(([, v]) => v !== undefined)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
          )
        : value,
  );
}
export function rememberAssemblyClock(film: FilmProject, result: FilmAssemblyArtifact) {
  while (clocks.size >= 32) clocks.delete(clocks.keys().next().value!);
  clocks.set(result.path, {
    key: assemblyRenderKey(film),
    clock: {
      shots: structuredClone(result.shots),
      durationSeconds: result.durationSeconds,
      ...(result.incomplete ? { incomplete: result.incomplete } : {}),
    },
  });
}
export function assemblyClockState(film: FilmProject): "verified" | "stale" | "unverified" {
  const value = clocks.get(film.assemblyPath);
  return !value ? "unverified" : value.key === assemblyRenderKey(film) ? "verified" : "stale";
}
export function assemblyClock(film: FilmProject): AssemblyClock | undefined {
  const value = clocks.get(film.assemblyPath);
  return value?.key === assemblyRenderKey(film) ? value.clock : undefined;
}
export type AssemblyControl = {
  current: () => FilmProject | null;
  valid: () => boolean;
  signal?: AbortSignal;
};
export async function readAssemblyInput(
  base: FilmProject,
  control: AssemblyControl,
): Promise<FilmAssemblyInput | null> {
  const bridge = window.aijian,
    key = assemblyRenderKey(base),
    same = () =>
      control.valid() &&
      !control.signal?.aborted &&
      control.current()?.id === base.id &&
      assemblyRenderKey(control.current()!) === key;
  if (!same() || !bridge?.readFilmProject) return null;
  const raw = await bridge.readFilmProject(base.id);
  if (!same() || raw?.id !== base.id) return null;
  const canonical = upgradeFilm(raw);
  if (!canonical || assemblyRenderKey(canonical) !== key) return null;
  const expectedHash = await historyRecordHash(raw);
  if (!same()) return null;
  return { projectId: base.id, expectedHash, expectedSelection: assemblySelection(base) };
}
/** One native operation; cancellation requests never mean the child already stopped. */
export async function requestAssembly(
  base: FilmProject,
  input: FilmAssemblyInput,
  control: AssemblyControl,
): Promise<FilmAssemblyResult> {
  const bridge = window.aijian,
    key = assemblyRenderKey(base),
    same = () =>
      control.valid() &&
      !control.signal?.aborted &&
      control.current()?.id === base.id &&
      assemblyRenderKey(control.current()!) === key;
  if (!bridge?.assembleFilmProject || !bridge.cancelFilmAssemblyOperation)
    return { kind: "FAILED", code: "TOOLS_UNAVAILABLE" };
  if (!same()) return { kind: "FAILED", code: "PROJECT_CHANGED" };
  const operationId = crypto.randomUUID();
  let sent = false;
  const stop = () => {
    if (sent) return;
    sent = true;
    void bridge.cancelFilmAssemblyOperation!(operationId).catch(() => undefined);
  };
  control.signal?.addEventListener("abort", stop, { once: true });
  const interval = setInterval(() => {
    if (!same()) stop();
  }, 100);
  try {
    if (!same()) return { kind: "FAILED", code: "PROJECT_CHANGED" };
    const result = await bridge.assembleFilmProject(input, operationId);
    if (!same()) return { kind: "FAILED", code: "PROJECT_CHANGED" };
    if (result.kind !== "FAILED") {
      if (
        result.kind === "PARTIAL"
          ? !["audio", "loudness", "subtitles"].includes(result.incomplete ?? "")
          : result.incomplete !== undefined
      )
        return { kind: "FAILED", code: "ASSEMBLY_FAILED" };
      if (
        result.path.length > 4096 ||
        result.path.includes("\0") ||
        result.projectId !== base.id ||
        result.projectHash !== input.expectedHash ||
        !Number.isFinite(result.durationSeconds) ||
        result.durationSeconds <= 0 ||
        !/^\/|^[a-z]:[\\/]/i.test(result.path) ||
        !/\.mp4$/i.test(result.path)
      )
        return { kind: "FAILED", code: "ASSEMBLY_FAILED" };
      let at = 0;
      if (
        !Array.isArray(result.shots) ||
        result.shots.length !== input.expectedSelection.length ||
        !result.shots.every((row, index) => {
          const expected = input.expectedSelection[index];
          const valid =
            !!expected &&
            row.shotId === expected.shotId &&
            row.takeId === expected.takeId &&
            Number.isFinite(row.startSeconds) &&
            Math.abs(row.startSeconds - at) < 0.000001 &&
            Number.isFinite(row.durationSeconds) &&
            row.durationSeconds > 0 &&
            row.durationSeconds <= 36000;
          at += row.durationSeconds;
          return valid;
        }) ||
        Math.abs(at - result.durationSeconds) > 0.05
      )
        return { kind: "FAILED", code: "ASSEMBLY_FAILED" };
      rememberAssemblyClock(base, result);
    }
    return result;
  } finally {
    clearInterval(interval);
    control.signal?.removeEventListener("abort", stop);
  }
}

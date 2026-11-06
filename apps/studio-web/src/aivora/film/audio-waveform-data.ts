import type { FilmAudioWaveform } from "@aijian/contracts/film-audio-waveform";

type Row = Record<string, unknown>;
const row = (value: unknown): Row =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : {};
/** Stable input for SHA256; never sent as an IPC path or rendered as user copy. */
export function filmAudioSourceIdentity(film: unknown, clip: unknown): string {
  const project = row(film),
    audio = row(clip);
  const shot = (Array.isArray(project.shots) ? project.shots : [])
    .map(row)
    .find((s) => s.id === audio.shotId);
  const selected = typeof shot?.selectedTakeId === "string" ? shot.selectedTakeId : "";
  const take = (Array.isArray(shot?.takes) ? shot.takes : [])
    .map(row)
    .find((t) => t.id === selected);
  return JSON.stringify([
    project.id,
    audio.id,
    audio.lane,
    audio.shotId,
    audio.takeId,
    audio.label,
    audio.path ?? "",
    audio.offsetSeconds,
    audio.durationSeconds,
    selected,
    take?.videoPath ?? "",
    take?.status ?? "",
    project.seriesId ?? "",
    project.backendProjectId ?? "",
  ]);
}
export function validFilmAudioWaveform(value: unknown): value is FilmAudioWaveform {
  const item = row(value);
  return (
    item.schemaVersion === 1 &&
    typeof item.sourceKey === "string" &&
    /^[a-f0-9]{64}$/.test(item.sourceKey) &&
    typeof item.sourceSha256 === "string" &&
    /^[a-f0-9]{64}$/.test(item.sourceSha256) &&
    typeof item.offsetSeconds === "number" &&
    Number.isFinite(item.offsetSeconds) &&
    item.offsetSeconds >= 0 &&
    typeof item.durationSeconds === "number" &&
    Number.isFinite(item.durationSeconds) &&
    item.durationSeconds >= 0 &&
    typeof item.analyzedSeconds === "number" &&
    Number.isFinite(item.analyzedSeconds) &&
    item.analyzedSeconds > 0 &&
    item.analyzedSeconds <= 1800 &&
    Array.isArray(item.peaks) &&
    item.peaks.length >= 2 &&
    item.peaks.length <= 256 &&
    Array.from(item.peaks).every(
      (p) => typeof p === "number" && Number.isFinite(p) && p >= 0 && p <= 1,
    )
  );
}

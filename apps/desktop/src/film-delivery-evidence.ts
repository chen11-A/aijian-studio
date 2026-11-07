import type {
  FilmDeliveryTechnical,
  FilmDeliveryQcSummary,
  FilmDeliveryManifest,
} from "@aijian/contracts/film-delivery-evidence";
import type { FilmRecord } from "./film-library";

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const number = (value: unknown, min = 0, max = 1e9): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
    ? value
    : null;
const integer = (value: unknown, min = 0, max = 1e9): number | null =>
  Number.isInteger(value) ? number(value, min, max) : null;
const name = (value: unknown): string | null =>
  typeof value === "string" &&
  /^[a-zA-Z0-9_.()+-]{1,48}$/.test(value) &&
  !["unknown", "unspecified", "N/A"].includes(value)
    ? value
    : null;
const keys = (value: Record<string, unknown>, expected: string[]) =>
  Object.keys(value).length === expected.length &&
  expected.every((key) => Object.hasOwn(value, key));

/** Reject unexpected objects; project only closed primitives from the optional pinned engine observation. */
export function deliveryTechnical(value: unknown): FilmDeliveryTechnical | null {
  const row = object(value);
  if (
    !row ||
    !keys(row, ["durationSeconds", "durationBasis", "video", "audioTracks"]) ||
    !["video-stream", "container", "unknown"].includes(String(row.durationBasis))
  )
    return null;
  const source = object(row.video);
  if (
    row.video !== null &&
    (!source ||
      !keys(source, [
        "codec",
        "width",
        "height",
        "displayWidth",
        "displayHeight",
        "averageFrameRate",
        "pixelFormat",
        "colorSpace",
        "colorPrimaries",
        "colorTransfer",
        "colorRange",
      ]))
  )
    return null;
  const video = source
    ? {
        codec: name(source.codec),
        width: integer(source.width, 1, 32768),
        height: integer(source.height, 1, 32768),
        displayWidth: integer(source.displayWidth, 1, 32768),
        displayHeight: integer(source.displayHeight, 1, 32768),
        averageFrameRate: number(source.averageFrameRate, Number.EPSILON, 1000),
        pixelFormat: name(source.pixelFormat),
        colorSpace: name(source.colorSpace),
        colorPrimaries: name(source.colorPrimaries),
        colorTransfer: name(source.colorTransfer),
        colorRange: name(source.colorRange),
      }
    : null;
  if (row.audioTracks !== null && (!Array.isArray(row.audioTracks) || row.audioTracks.length > 128))
    return null;
  const audioTracks: NonNullable<FilmDeliveryTechnical["audioTracks"]> = [];
  for (const value of Array.isArray(row.audioTracks) ? row.audioTracks : []) {
    const audio = object(value);
    if (
      !audio ||
      !keys(audio, ["index", "codec", "sampleRate", "channels", "channelLayout"]) ||
      !Number.isInteger(audio.index) ||
      number(audio.index, 0, 65535) === null
    )
      return null;
    audioTracks.push({
      index: audio.index as number,
      codec: name(audio.codec),
      sampleRate: integer(audio.sampleRate, 1, 768000),
      channels: integer(audio.channels, 1, 128),
      channelLayout: name(audio.channelLayout),
    });
  }
  return {
    durationSeconds: number(row.durationSeconds, Number.EPSILON),
    durationBasis: row.durationBasis as FilmDeliveryTechnical["durationBasis"],
    video,
    audioTracks: row.audioTracks === null ? null : audioTracks,
  };
}

export function deliveryQc(report: unknown): FilmDeliveryQcSummary {
  const row = object(report),
    audio = object(row?.audio);
  const counts = { block: 0, warn: 0, info: 0 };
  let complete =
    row?.schemaVersion === 1 && Array.isArray(row.issues) && row.issues.length <= 10000;
  if (complete)
    for (const value of row!.issues as unknown[]) {
      const issue = object(value),
        severity = issue?.severity;
      if (severity !== "block" && severity !== "warn" && severity !== "info") {
        complete = false;
        break;
      }
      counts[severity] += 1;
    }
  return {
    schemaVersion: 1,
    status: !complete ? "unknown" : counts.block ? "blocked" : counts.warn ? "warnings" : "clear",
    counts: complete ? counts : null,
    integratedLufs: number(audio?.integratedLufs, -300, 100),
    truePeakDbtp: number(audio?.truePeakDbtp, -300, 100),
  };
}

export function deliverySelection(
  record: FilmRecord,
  selected: { shotId: string; takeId: string; label: string }[],
  clock: { id: string; start: number; end: number }[],
): FilmDeliveryManifest["selection"] {
  const safeId = (value: string) => (/^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : null);
  return selected.map((item, index) => {
    const shot = Array.isArray(record.shots)
      ? object(record.shots.find((value) => object(value)?.id === item.shotId))
      : null;
    const takes = Array.isArray(shot?.takes) ? shot.takes : [];
    const take = object(takes.find((value) => object(value)?.id === item.takeId));
    const version = integer(take?.index, 1, 1000000);
    const scenes = Array.isArray(record.scenes) ? record.scenes : [];
    const sceneIndex = scenes.findIndex((value) => object(value)?.id === shot?.sceneId);
    const sceneNo = integer(object(scenes[sceneIndex])?.no, 1, 1000000);
    const shotNo = integer(shot?.no, 1, 1000000);
    const when = clock[index]?.id === item.shotId ? clock[index] : undefined;
    const start = number(when?.start),
      end = number(when?.end);
    return {
      shotId: safeId(item.shotId),
      takeId: safeId(item.takeId),
      label: `${sceneNo !== null ? `第 ${sceneNo} 场 · ` : ""}${shotNo !== null ? `镜头 ${shotNo}` : `选材第 ${index + 1} 镜`}`,
      versionLabel: version !== null ? `第 ${version} 版` : null,
      startSeconds: start !== null && end !== null && end > start ? start : null,
      endSeconds: start !== null && end !== null && end > start ? end : null,
    };
  });
}

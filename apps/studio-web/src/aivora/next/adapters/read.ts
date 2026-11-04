import { AUDIO_LANE_ORDER, type AudioLaneId } from "../../film/audio";
import type { FilmJob, FilmTake } from "../../film/project";

/**
 * A parsed project.json as the adapters use it. The desktop saves a FilmProject (film/project.ts)
 * as films/<seriesId>/episodes/<episodeId>/project.json. Nothing is filled in: a value that is
 * missing or of the wrong type is read as "" or null, a list entry without an id is skipped,
 * and the path of each such field goes into missing, for example "shots[2].seconds".
 * upgradeFilm in film/project.ts is not used, because it fills gaps with defaults such as a
 * scene called 第 1 场.
 */
export type ProjectScene = {
  id: string;
  no: number | null;
  title: string;
  where: string;
  text: string;
};

export type ProjectTake = {
  id: string;
  /** The version number the app shows as 第 N 版. */
  index: number | null;
  status: FilmTake["status"];
  stillUrl: string;
  videoPath: string;
  reason: string;
  createdAt: string;
};

export type ProjectShot = {
  id: string;
  sceneId: string;
  no: number | null;
  size: string;
  /** Length in seconds as saved. The exported clip can be up to about a second longer or shorter. */
  seconds: number | null;
  picture: string;
  action: string;
  line: string;
  musicMood: string;
  poster: string;
  stills: string[];
  takes: ProjectTake[];
  selectedTakeId: string;
};

export type ProjectJob = {
  id: string;
  shotId: string;
  kind: FilmJob["kind"];
  take: number | null;
  status: FilmJob["status"];
  reason: string;
};

export type ProjectClip = {
  id: string;
  lane: AudioLaneId;
  shotId: string;
  gainDb: number | null;
  path: string;
};

export type ProjectView = {
  id: string;
  title: string;
  seriesTitle: string;
  episodeTitle: string;
  aspectRatio: "9:16" | "16:9" | null;
  scenes: ProjectScene[];
  shots: ProjectShot[];
  jobs: ProjectJob[];
  audioClips: ProjectClip[];
  missing: string[];
};

export type ProjectRead = { ok: true; project: ProjectView } | { ok: false; reason: string };

type Row = Record<string, unknown>;

const TAKE_STATUS: readonly FilmTake["status"][] = ["queued", "running", "done", "failed"];
const JOB_STATUS: readonly FilmJob["status"][] = [
  "queued",
  "blocked",
  "running",
  "done",
  "failed",
  "cancelled",
];
const JOB_KIND: readonly FilmJob["kind"][] = ["video", "keyframe", "portrait"];

const isRow = (value: unknown): value is Row =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string => (typeof value === "string" ? value : "");

const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return allowed.includes(value as T) ? (value as T) : null;
}

/** The rows of a list field. Rows that are not objects with an id are skipped and noted. */
function rows(value: unknown, path: string, missing: string[]): { row: Row; path: string }[] {
  if (!Array.isArray(value)) {
    missing.push(path);
    return [];
  }
  return value.flatMap((item, index) => {
    const at = `${path}[${index}]`;
    if (isRow(item) && text(item.id)) return [{ row: item, path: at }];
    missing.push(at);
    return [];
  });
}

function needed<T>(value: T | null, path: string, missing: string[]): T | null {
  if (value === null) missing.push(path);
  return value;
}

function readTake(row: Row, path: string, missing: string[]): ProjectTake | null {
  const status = oneOf(row.status, TAKE_STATUS);
  if (!status) {
    missing.push(`${path}.status`);
    return null;
  }
  return {
    id: text(row.id),
    index: needed(count(row.index), `${path}.index`, missing),
    status,
    stillUrl: text(row.stillUrl),
    videoPath: text(row.videoPath),
    reason: text(row.reason),
    createdAt: text(row.createdAt),
  };
}

function readShot(row: Row, path: string, missing: string[]): ProjectShot {
  const sound = isRow(row.sound) ? row.sound : {};
  const stills = Array.isArray(row.stills)
    ? row.stills.flatMap((item) => (isRow(item) && text(item.url) ? [text(item.url)] : []))
    : [];
  const sceneId = text(row.sceneId);
  if (!sceneId) missing.push(`${path}.sceneId`);
  return {
    id: text(row.id),
    sceneId,
    no: needed(count(row.no), `${path}.no`, missing),
    size: text(row.size),
    seconds: needed(count(row.seconds), `${path}.seconds`, missing),
    picture: text(row.picture),
    action: text(row.action),
    line: text(row.line),
    musicMood: text(sound.musicMood),
    poster: text(row.poster),
    stills,
    takes: rows(row.takes, `${path}.takes`, missing).flatMap((item) => {
      const take = readTake(item.row, item.path, missing);
      return take ? [take] : [];
    }),
    selectedTakeId: text(row.selectedTakeId),
  };
}

function readJob(row: Row, path: string, missing: string[]): ProjectJob | null {
  const kind = oneOf(row.kind, JOB_KIND);
  const status = oneOf(row.status, JOB_STATUS);
  if (!kind || !status) {
    missing.push(`${path}.${kind ? "status" : "kind"}`);
    return null;
  }
  return {
    id: text(row.id),
    shotId: text(row.shotId),
    kind,
    take: count(row.take),
    status,
    reason: text(row.reason),
  };
}

function readClip(row: Row, path: string, missing: string[]): ProjectClip | null {
  const lane = oneOf(row.lane, AUDIO_LANE_ORDER);
  if (!lane) {
    missing.push(`${path}.lane`);
    return null;
  }
  return {
    id: text(row.id),
    lane,
    shotId: text(row.shotId),
    gainDb: needed(count(row.gainDb), `${path}.gainDb`, missing),
    path: text(row.path),
  };
}

/** Reads a parsed project.json. Only a value that is not an object at all is refused. */
export function readProject(value: unknown): ProjectRead {
  if (!isRow(value)) return { ok: false, reason: "作品记录不是一份完整的作品，读不出来。" };
  const missing: string[] = [];
  for (const key of ["title", "seriesTitle", "episodeTitle"]) {
    if (typeof value[key] !== "string") missing.push(key);
  }
  const aspectRatio = oneOf(value.aspectRatio, ["9:16", "16:9"] as const);
  if (!aspectRatio) missing.push("aspectRatio");
  return {
    ok: true,
    project: {
      id: text(value.id),
      title: text(value.title),
      seriesTitle: text(value.seriesTitle),
      episodeTitle: text(value.episodeTitle),
      aspectRatio,
      scenes: rows(value.scenes, "scenes", missing).map(({ row, path }) => ({
        id: text(row.id),
        no: needed(count(row.no), `${path}.no`, missing),
        title: text(row.title),
        where: text(row.where),
        text: text(row.text),
      })),
      shots: rows(value.shots, "shots", missing).map(({ row, path }) =>
        readShot(row, path, missing),
      ),
      jobs: rows(value.jobs, "jobs", missing).flatMap(({ row, path }) => {
        const job = readJob(row, path, missing);
        return job ? [job] : [];
      }),
      audioClips: rows(value.audioClips, "audioClips", missing).flatMap(({ row, path }) => {
        const clip = readClip(row, path, missing);
        return clip ? [clip] : [];
      }),
      missing,
    },
  };
}

import { deliveryQc, deliverySelection, deliveryTechnical } from "./film-delivery-evidence";
import { writeDeliveryManifest } from "./film-delivery-manifest";
import type {
  FilmDeliveryTechnical,
  FilmDeliveryQcSummary,
  FilmDeliveryManifest,
  FilmDeliveryEvidenceResult,
} from "@aijian/contracts/film-delivery-evidence";
import { audioMixSettings } from "@aijian/contracts/film-audio-mix-plan";
import { normalizeMixedAudio, type AudioNormalizer } from "./film-audio-normalize";
import { resolveAudioMix } from "./film-audio-mix-sources";
import { renderAudioMix } from "./film-audio-mix";
import { exportBlockedByStaleMaterial, readStoredAudioDecision } from "./film-export-record";
import { muxSilentAac } from "./film-silent-export";
import type { ExportWork } from "./film-export-operation";
import { exportFileHash, copyExportFile } from "./film-export-io";
import type {
  FilmExportQcInput,
  FilmExportQcPrepared,
  FilmExportQcFailure,
  FilmExportQcPublishResult,
} from "@aijian/contracts/film-export-qc";
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, realpath, link, rm, stat, readdir } from "node:fs/promises";
import { join, relative, isAbsolute, sep } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  joinClips,
  mediaUrlPath,
  readProject,
  resolveExportFileName,
  trustedMediaPath,
  type FilmRecord,
} from "./film-library";
import { exportFilmFile, type FilmExportExtras } from "./film-export";
import { subtitleSrt, exportCanvas, validCues, type ExportCue } from "./film-subtitles";
import type { QcEngine, QcTools, QcRunner } from "./film-export-qc-runtime";
const execute = promisify(execFile);

/**
 * Compile-time switch, not a runtime setting. Default names number themselves.
 * Edited names pass "error" at the call site and do not read this constant.
 */
const defaultNameCollision = "suffix" as const;
/** Base name is 1. The next free set is -2, then -3, and stops here. */
const EXPORT_NAME_SUFFIX_LIMIT = 99;

type PlannedExport = {
  aspectRatio: "16:9" | "9:16";
  extras: FilmExportExtras;
  stem: string;
};

function numberedBase(fileName: string, index: number): string {
  const base = fileName.replace(/\.mp4$/i, "");
  return index <= 1 ? base : `${base}-${index}`;
}

/** One sequence number covers every aspect. mp4, subtitles and cover move together. */
function planExportNames(
  fileName: string,
  outputs: { aspectRatio: "16:9" | "9:16"; extras: FilmExportExtras }[],
  index: number,
): PlannedExport[] {
  const multiple = outputs.length > 1;
  const base = numberedBase(fileName, index);
  return outputs.map((output) => ({
    aspectRatio: output.aspectRatio,
    extras: output.extras,
    stem: multiple ? `${base}-${output.aspectRatio.replace(":", "x")}` : base,
  }));
}

function plannedFileNames(plan: PlannedExport[]): string[] {
  const names: string[] = [];
  for (const item of plan) {
    names.push(`${item.stem}.mp4`);
    if (item.extras.subtitlePath) names.push(`${item.stem}.srt`);
    if (item.extras.coverPath) names.push(`${item.stem}-封面.png`);
  }
  return names;
}

/** Case-insensitive, so Windows does not treat `Film.mp4` and `film.mp4` as different files. */
async function directoryNames(directory: string): Promise<Set<string>> {
  return new Set((await readdir(directory)).map((name) => name.toLowerCase()));
}

function namesCollide(present: Set<string>, names: string[]): boolean {
  return names.some((name) => present.has(name.toLowerCase()));
}

function nextFreeExportPlan(
  fileName: string,
  outputs: { aspectRatio: "16:9" | "9:16"; extras: FilmExportExtras }[],
  present: Set<string>,
  mode: "error" | "suffix",
  start = 1,
): { plan: PlannedExport[]; index: number } {
  const last = mode === "suffix" ? EXPORT_NAME_SUFFIX_LIMIT : 1;
  for (let index = start; index <= last; index += 1) {
    const plan = planExportNames(fileName, outputs, index);
    if (!namesCollide(present, plannedFileNames(plan))) return { plan, index };
  }
  fail(mode === "suffix" ? "EXPORT_NAME_EXHAUSTED" : "EXPORT_NAME_TAKEN");
}

function exportNameTaken(error: unknown): boolean {
  return (
    (error instanceof Error && error.message === "EXPORT_NAME_TAKEN") ||
    (error as NodeJS.ErrnoException).code === "EEXIST"
  );
}

async function linkNewFile(from: string, to: string): Promise<void> {
  try {
    await link(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") fail("EXPORT_NAME_TAKEN");
    throw error;
  }
}
type Row = Record<string, unknown>;
const object = (value: unknown): Row | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : null;
const text = (value: unknown) => (typeof value === "string" ? value : "");
function fail(code: FilmExportQcFailure["code"]): never {
  throw new Error(code);
}
const failure = (error: unknown): FilmExportQcFailure => {
  const code = error instanceof Error ? error.message : "";
  return {
    kind: "FAILED",
    code: [
      "AUDIO_MIX_LIMIT",
      "INVALID_INPUT",
      "PROJECT_CHANGED",
      "MISSING_MEDIA",
      "CLEAN_COPY_REQUIRED",
      "TOOLS_UNAVAILABLE",
      "RECEIPT_STALE",
      "PUBLISH_FAILED",
      "QC_BLOCKED",
      "SOURCE_UNVERIFIED",
      "BUSY",
      "MATERIALS_STALE",
      "AUDIO_DECISION_INVALID",
      "UNSUPPORTED_AUDIO_CHANNELS",
      "EXPORT_NAME_INVALID",
      "EXPORT_NAME_TAKEN",
      "EXPORT_NAME_EXHAUSTED",
    ].includes(code)
      ? (code as FilmExportQcFailure["code"])
      : "CHECK_FAILED",
  };
};
export function qcInput(value: unknown): FilmExportQcInput {
  const input = object(value),
    settings = object(input?.settings);
  if (
    !input ||
    Object.keys(input).some(
      (key) =>
        !["projectId", "expectedSelection", "settings", "qcReceipt", "requestedFileName"].includes(
          key,
        ),
    ) ||
    !/^film_[a-z0-9]{16,40}$/.test(text(input.projectId)) ||
    !Array.isArray(input.expectedSelection) ||
    !input.expectedSelection.length ||
    input.expectedSelection.length > 1000 ||
    !settings ||
    Object.keys(settings).some(
      (key) =>
        !["aiMark", "aspects", "quality", "style", "subtitles", "autoAdjustVolume"].includes(key),
    ) ||
    ["aiMark", "aspects", "quality", "style", "subtitles"].some((key) => !(key in settings)) ||
    (settings.autoAdjustVolume !== undefined && typeof settings.autoAdjustVolume !== "boolean") ||
    (input.requestedFileName !== undefined && typeof input.requestedFileName !== "string")
  )
    fail("INVALID_INPUT");
  if (
    !Array.isArray(settings.aspects) ||
    !settings.aspects.length ||
    settings.aspects.length > 2 ||
    new Set(settings.aspects).size !== settings.aspects.length ||
    settings.aspects.some((value) => !["16:9", "9:16"].includes(text(value))) ||
    !["720p", "1080p"].includes(text(settings.quality)) ||
    !["burn", "srt", "none"].includes(text(settings.subtitles)) ||
    !["white", "bar", "yellow", "film"].includes(text(settings.style)) ||
    typeof settings.aiMark !== "boolean"
  )
    fail("INVALID_INPUT");
  const ids = new Set<string>();
  for (const value of input.expectedSelection) {
    const item = object(value);
    if (
      !item ||
      Object.keys(item).sort().join() !== "shotId,takeId" ||
      !text(item.shotId) ||
      text(item.shotId).length > 128 ||
      typeof item.takeId !== "string" ||
      item.takeId.length > 128 ||
      ids.has(text(item.shotId))
    )
      fail("INVALID_INPUT");
    ids.add(text(item.shotId));
  }
  return JSON.parse(
    JSON.stringify({
      projectId: input.projectId,
      expectedSelection: input.expectedSelection,
      settings,
      ...(typeof input.requestedFileName === "string"
        ? { requestedFileName: input.requestedFileName }
        : {}),
    }),
  );
}
function sha(path: string, work?: ExportWork) {
  const task = exportFileHash(path, work?.signal);
  return work ? work.track(task) : task;
}
function copy(source: string, destination: string, work?: ExportWork) {
  const task = copyExportFile(source, destination, work?.signal);
  return work ? work.track(task) : task;
}

function within(root: string, path: string) {
  const part = relative(root, path);
  return !!part && !isAbsolute(part) && part !== ".." && !part.startsWith(`..${sep}`);
}
export type FilmQcHost = {
  publishedPaths?: Set<string>;
  filmsRoot: string;
  storyFilmsRoot: string;
  temporaryRoot: string;
  tools: (signal?: AbortSignal) => Promise<QcTools>;
  runner?: () => Promise<QcRunner>;
  engine: () => Promise<QcEngine>;
  font: () => string | undefined;
  pickDirectory: () => Promise<string | null>;
  read?: (id: string) => Promise<FilmRecord | null>;
  now?: () => number;
  normalizer?: () => Promise<AudioNormalizer>;
  audioOwner?: (
    projectId: string,
    path: string,
    sha: string,
    selected?: { path: string; sha: string },
  ) => Promise<boolean>;
  storyOwner?: (projectId: string, path: string, sha256: string) => Promise<boolean>;
};
type Clip = {
  shotId: string;
  label: string;
  path: string;
  takeId: string;
  nativePath: string;
  cues: ExportCue[];
  line: string;
};
type Snapshot = {
  record: FilmRecord;
  clips: Clip[];
  mix: Awaited<ReturnType<typeof resolveAudioMix>>;
  fingerprint: string;
  coverStill?: string;
  coverData?: string;
  audioDecision?: FilmDeliveryManifest["audioDecision"];
};
type Prepared = {
  input: FilmExportQcInput;
  fingerprint: string;
  folder: string;
  created: number;
  outputs: {
    aspectRatio: "16:9" | "9:16";
    path: string;
    hash: string;
    extras: FilmExportExtras;
    extraHashes: Record<string, string>;
    technical: FilmDeliveryTechnical | null;
    qc: FilmDeliveryQcSummary;
  }[];
  owner: string;
  ownerGeneration: number;
  blocked: boolean;
  fileName: string;
  selection: FilmDeliveryManifest["selection"];
  unverified: string[];
  audioDecision?: FilmDeliveryManifest["audioDecision"];
};
/** Main's persisted project and selection are authoritative; renderer never supplies media paths. */
export function createFilmExportQc(host: FilmQcHost) {
  const receipts = new Map<string, Prepared>();
  const active = new Map<string, { owner: string; projectId: string }>();
  const publishing = new Set<string>();
  const epochs = new Map<string, number>();
  const ownerEpochs = new Map<string, number>();
  const now = host.now ?? Date.now;
  const read = host.read ?? ((id: string) => readProject(host.filmsRoot, id));
  async function snapshot(input: FilmExportQcInput, work?: ExportWork): Promise<Snapshot> {
    const record = await read(input.projectId);
    if (
      !record ||
      record.id !== input.projectId ||
      !/^film_[a-z0-9]{16,40}$/.test(record.seriesId) ||
      !Array.isArray(record.shots) ||
      record.shots.length !== input.expectedSelection.length
    )
      fail("PROJECT_CHANGED");
    if (
      (input.settings.autoAdjustVolume ?? false) !==
      audioMixSettings(record.audioMix).autoAdjustVolume
    )
      fail("PROJECT_CHANGED");
    const films = await realpath(host.filmsRoot);
    const series = await realpath(join(films, record.seriesId));
    if (relative(films, series) !== record.seriesId) fail("SOURCE_UNVERIFIED");
    const episode = join(series, "episodes", record.id);
    const story = await realpath(host.storyFilmsRoot).catch(() => "");
    const local = (value: unknown, video = false) => {
      const raw = mediaUrlPath(text(value));
      if (!raw) return "";
      const path = trustedMediaPath([series, ...(story ? [story] : [])], raw);
      if (video && !/\.mp4$/i.test(path)) fail("MISSING_MEDIA");
      return path;
    };
    const clips: Clip[] = [];
    for (const [index, unknownShot] of record.shots.entries()) {
      const shot = object(unknownShot),
        expected = input.expectedSelection[index];
      if (
        !shot ||
        !expected ||
        shot.id !== expected.shotId ||
        (text(shot.selectedTakeId) ||
          (Array.isArray(shot.takes)
            ? text(
                shot.takes
                  .map(object)
                  .find((take) => take?.status === "done" && text(take.videoPath))?.id,
              )
            : "")) !== expected.takeId
      )
        fail("PROJECT_CHANGED");
      const take = Array.isArray(shot.takes)
        ? shot.takes.map(object).find((t) => t?.id === expected.takeId)
        : null;
      if (!take || take.status !== "done" || take.shotId !== shot.id || !text(take.videoPath))
        fail("MISSING_MEDIA");
      const line =
        Array.isArray(shot.lines) && shot.lines.length
          ? shot.lines.map((line) => text(object(line)?.text)).join("\n")
          : text(shot.line);
      const clean = text(take.cleanVideoPath);
      if (!clean && line && input.settings.subtitles !== "burn") fail("CLEAN_COPY_REQUIRED");
      const path = local(clean || take.videoPath, true);
      if (!path || (await stat(path)).size <= 0) fail("MISSING_MEDIA");
      if (
        !within(episode, path) &&
        !(
          story &&
          within(story, path) &&
          host.storyOwner &&
          (await host.storyOwner(text(record.backendProjectId), path, await sha(path, work)))
        )
      )
        fail("SOURCE_UNVERIFIED");
      const nativePath = local(take.videoPath, true);
      if (
        !within(episode, nativePath) &&
        !(
          story &&
          within(story, nativePath) &&
          host.storyOwner &&
          (await host.storyOwner(
            text(record.backendProjectId),
            nativePath,
            await sha(nativePath, work),
          ))
        )
      )
        fail("SOURCE_UNVERIFIED");
      clips.push({
        shotId: text(shot.id),
        label: `镜头 ${index + 1}`,
        path,
        takeId: expected.takeId,
        nativePath,
        line,
        cues:
          clean && input.settings.subtitles !== "none" ? validCues(take.subtitleCues ?? []) : [],
      });
    }
    const cover = object(record.cover);
    const coverRaw = text(cover?.backgroundUrl);
    const coverData = coverRaw.startsWith("data:image/") ? coverRaw : undefined;
    if (coverData && !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=\s]+$/.test(coverData))
      fail("SOURCE_UNVERIFIED");
    if (coverData && Buffer.byteLength(coverData) > 17000000) fail("SOURCE_UNVERIFIED");
    const coverStill = coverRaw && !coverData ? local(coverRaw) : undefined;
    if (coverStill && !/\.(png|jpe?g|webp)$/i.test(coverStill)) fail("MISSING_MEDIA");
    const hashes = await Promise.all(
      [
        ...new Set([
          ...clips.flatMap((c) => [c.path, c.nativePath]),
          ...(coverStill ? [coverStill] : []),
        ]),
      ].map(async (path) => [path, await sha(path, work)]),
    );
    const mixTools = await host.tools(work?.signal);
    const managed = host.runner ? await host.runner() : undefined;
    const executor: QcRunner =
      managed ??
      (async (binary, args, options) =>
        execute(binary, args, {
          encoding: "utf8",
          maxBuffer: 1024 * 1024,
          timeout: 600000,
          signal: options?.signal,
        }));
    const mixRun: QcRunner = (binary, args, options) => {
      const task = executor(binary, args, options);
      return work ? work.track(task) : task;
    };
    const selection = clips.map((clip) => ({
      shotId: clip.shotId,
      takeId: clip.takeId,
      videoPath: clip.nativePath,
      visualPath: clip.path,
    }));
    let audioDecision;
    try {
      audioDecision = readStoredAudioDecision(record);
    } catch {
      fail("AUDIO_DECISION_INVALID");
    }
    const mix = await resolveAudioMix(record, selection, {
      filmsRoot: host.filmsRoot,
      storyFilmsRoot: host.storyFilmsRoot,
      tools: mixTools,
      run: mixRun,
      signal: work?.signal,
      audioOwner: host.audioOwner,
      videoOwner: host.storyOwner,
      allowWideChannels: audioDecision === "SILENT_BY_USER",
    });
    const content = Object.fromEntries(
      Object.entries(record).filter(([key]) => !["savedAt", "directory"].includes(key)),
    );
    return {
      record,
      clips,
      coverStill,
      coverData,
      mix,
      audioDecision,
      fingerprint: JSON.stringify({
        content,
        hashes,
        audioHashes: mix.hashes,
        plan: mix.plan,
        settings: input.settings,
      }),
    };
  }
  async function remove(token: string) {
    const old = receipts.get(token);
    receipts.delete(token);
    if (old) await rm(old.folder, { recursive: true, force: true });
  }
  async function current(
    input: FilmExportQcInput,
    fingerprint: string,
    owner: string,
    generation: number,
    work?: ExportWork,
  ) {
    work?.signal.throwIfAborted();
    if ((ownerEpochs.get(owner) ?? 0) !== generation) fail("PROJECT_CHANGED");
    if (
      (await snapshot(input, work)).fingerprint !== fingerprint ||
      (ownerEpochs.get(owner) ?? 0) !== generation
    )
      fail("PROJECT_CHANGED");
    work?.signal.throwIfAborted();
  }
  return {
    async prepare(
      owner: string,
      value: unknown,
      work?: ExportWork,
    ): Promise<FilmExportQcPrepared | FilmExportQcFailure> {
      let folder = "";
      let activeKey = "";
      try {
        const input = qcInput(value);
        const ownerGeneration = ownerEpochs.get(owner) ?? 0;
        const key = `${owner}\n${input.projectId}`;
        if (active.has(key)) fail("BUSY");
        activeKey = key;
        active.set(key, { owner, projectId: input.projectId });
        const epoch = (epochs.get(input.projectId) ?? 0) + 1;
        epochs.set(input.projectId, epoch);
        for (const [token, old] of receipts)
          if (
            old.owner === owner &&
            (old.input.projectId === input.projectId || now() - old.created > 600000)
          )
            await remove(token);
        if ([...receipts.values()].filter((item) => item.owner === owner).length >= 4)
          fail("CHECK_FAILED");
        work?.phase("preparing");
        const base = await snapshot(input, work);
        const audioDecision = base.audioDecision;
        if (exportBlockedByStaleMaterial(base.mix.plan.limitations)) fail("MATERIALS_STALE");
        const fileName = resolveExportFileName(
          input.requestedFileName,
          `${text(base.record.seriesTitle) || text(base.record.title)}-${text(base.record.episodeTitle) || "成片"}`,
        );
        const tools = await host.tools(work?.signal).catch(() => fail("TOOLS_UNAVAILABLE"));
        const engine = await host.engine();
        await current(input, base.fingerprint, owner, ownerGeneration, work);
        await mkdir(host.temporaryRoot, { recursive: true });
        folder = await mkdtemp(join(host.temporaryRoot, "export-qc-"));
        const managed = host.runner ? await host.runner() : undefined;
        const run = async (
          args: string[],
          options?: { cwd?: string; env?: Record<string, string> },
        ) => {
          work?.signal.throwIfAborted();
          if (managed) {
            const task = managed(tools.ffmpegPath, args, {
              timeoutMs: 600000,
              maxBuffer: 1024 * 1024,
              signal: work?.signal,
              ...options,
              env: { ...process.env, ...options?.env },
            });
            await (work ? work.track(task) : task);
            return;
          }
          await execute(tools.ffmpegPath, args, {
            timeout: 600000,
            maxBuffer: 1024 * 1024,
            ...options,
            env: { ...process.env, ...options?.env },
          });
        };
        let coverStill = base.coverStill;
        if (base.coverData) {
          const { writeFile } = await import("node:fs/promises");
          coverStill = join(folder, "cover-image");
          await writeFile(
            coverStill,
            Buffer.from(base.coverData.slice(base.coverData.indexOf(",") + 1), "base64"),
          );
        }
        const sources: string[] = [],
          shots: FilmExportQcPrepared["shots"] = [],
          cues: ExportCue[] = [],
          dialogue: { start: number; end: number }[] = [];
        let at = 0;
        work?.phase("preparing", {
          kind: "units",
          completed: 0,
          total: base.clips.length,
          unit: "镜头",
        });
        for (const [index, clip] of base.clips.entries()) {
          work?.signal.throwIfAborted();
          const seconds = base.mix.plan.shots[index]!.durationSeconds;
          const start = at;
          shots.push({ id: clip.shotId, label: clip.label, start, end: at + seconds });
          cues.push(
            ...clip.cues.map((cue) => {
              if (cue.end > seconds + 0.05) fail("CHECK_FAILED");
              return { ...cue, start: cue.start + at, end: cue.end + at };
            }),
          );
          // No measured speech intervals: storyboard/subtitle layout never widens QC rules.
          sources.push(clip.path);
          at += seconds;
          work?.phase("preparing", {
            kind: "units",
            completed: index + 1,
            total: base.clips.length,
            unit: "镜头",
          });
        }
        let assembled = join(folder, "assembly.mp4");
        work?.phase("joining");
        if (sources.length === 1) await copy(sources[0]!, assembled, work);
        else await joinClips(sources, assembled, run);
        work?.phase("mixing");
        const mixTools = await host.tools(work?.signal);
        const mixExecute: QcRunner =
          managed ??
          (async (binary, args, options) =>
            execute(binary, args, {
              encoding: "utf8",
              maxBuffer: 1024 * 1024,
              timeout: 600000,
              signal: options?.signal,
            }));
        const mixRunner: QcRunner = (binary, args, options) => {
          const task = mixExecute(binary, args, options);
          return work ? work.track(task) : task;
        };
        const mixed = join(folder, "mixed.mp4");
        if (audioDecision === "SILENT_BY_USER") {
          await muxSilentAac(assembled, mixed, mixTools, mixRunner, work?.signal);
        } else {
          await renderAudioMix(
            assembled,
            mixed,
            base.mix.plan,
            base.mix.paths,
            mixTools,
            mixRunner,
            work?.signal,
          );
        }
        assembled = mixed;
        let normalizer: AudioNormalizer | undefined;
        let audioApplicable =
          audioDecision === "SILENT_BY_USER" ? false : base.mix.plan.tracks.length > 0;
        if (input.settings.autoAdjustVolume && audioApplicable) {
          if (!host.normalizer) fail("TOOLS_UNAVAILABLE");
          normalizer = await host.normalizer();
          assembled = await normalizeMixedAudio(
            mixed,
            join(folder, "normalized.mp4"),
            normalizer,
            mixTools,
            mixRunner,
            work?.signal,
          );
        }
        const outputs: Prepared["outputs"] = [],
          reports: FilmExportQcPrepared["outputs"] = [];
        for (const aspectRatio of input.settings.aspects) {
          work?.signal.throwIfAborted();
          work?.phase("rendering", {
            kind: "units",
            completed: outputs.length,
            total: input.settings.aspects.length,
            unit: "画幅",
          });
          const outputFolder = join(folder, aspectRatio.replace(":", "x"));
          await mkdir(outputFolder);
          let extras: FilmExportExtras = {};
          const cover = object(base.record.cover);
          const path = await exportFilmFile(
            assembled,
            outputFolder,
            "film",
            {
              aspectRatio,
              canvas: aspectRatio,
              quality: input.settings.quality,
              subtitles: { mode: input.settings.subtitles, style: input.settings.style, cues },
              cover: {
                title:
                  text(cover?.title) || text(base.record.seriesTitle) || text(base.record.title),
                subtitle: text(cover?.subtitle) || text(base.record.episodeTitle),
                aiMark: input.settings.aiMark,
              },
            },
            run,
            () => Boolean(work?.signal.aborted) || epochs.get(input.projectId) !== epoch,
            { fontFile: host.font(), coverStill },
            (value) => {
              extras = value;
            },
          );
          work?.phase("rendering", {
            kind: "units",
            completed: outputs.length + 1,
            total: input.settings.aspects.length,
            unit: "画幅",
          });
          // The QC package cannot inspect burned text. Give it an independently retained SRT for estimates.
          let srtPath = extras.subtitlePath;
          if (!srtPath && cues.length && input.settings.subtitles === "burn") {
            const { writeFile } = await import("node:fs/promises");
            srtPath = join(outputFolder, "check.srt");
            await writeFile(
              srtPath,
              subtitleSrt(
                cues,
                input.settings.style,
                exportCanvas(aspectRatio, input.settings.quality),
              ),
            );
          }
          work?.phase("checking", {
            kind: "units",
            completed: outputs.length,
            total: input.settings.aspects.length,
            unit: "画幅",
          });
          let technical: FilmDeliveryTechnical | null = null;
          const checking = engine(path, {
            onMediaInfo: (value) => {
              technical = deliveryTechnical(value);
            },
            signal: work?.signal,
            ...tools,
            ...(srtPath ? { srtPath } : {}),
            dialogue,
          });
          const report = await (work ? work.track(checking) : checking);
          work?.phase("checking", {
            kind: "units",
            completed: outputs.length + 1,
            total: input.settings.aspects.length,
            unit: "画幅",
          });
          work?.phase("checking-final");
          if (!object(report) || object(report)?.schemaVersion !== 1) fail("CHECK_FAILED");
          const extraHashes: Record<string, string> = {};
          for (const extra of Object.values(extras))
            if (extra) extraHashes[extra] = await sha(extra, work);
          outputs.push({
            aspectRatio,
            path,
            hash: await sha(path, work),
            extras,
            extraHashes,
            technical,
            qc: deliveryQc(report),
          });
          if (normalizer) {
            const measured = await normalizer.measureAudioLoudness(
              path,
              mixTools.ffmpegPath,
              (binary, args) =>
                mixRunner(binary, args, {
                  signal: work?.signal,
                  timeoutMs: 600000,
                  maxBuffer: 1024 * 1024,
                }),
            );
            audioApplicable = normalizer.assertNormalizedAudio(measured).applicable;
          }
          reports.push({ aspectRatio, report });
        }
        await current(input, base.fingerprint, owner, ownerGeneration, work);
        if (epochs.get(input.projectId) !== epoch) fail("PROJECT_CHANGED");
        const unverified: string[] = [
          ...(audioDecision === "SILENT_BY_USER"
            ? ["用户选择本片静音。成片写入一条与视频时长一致的静音 AAC 音轨，不表示内容有声。"]
            : []),
          ...(base.mix.plan.limitations.includes("NATIVE_DIALOGUE_UNKNOWN")
            ? ["部分原声尚未分类对白，配乐按整个有声片段保守避让；未做语音识别。"]
            : []),
          input.settings.autoAdjustVolume
            ? audioApplicable
              ? "已按最终文件复测全片响度；此项不代表试听或对白完整性验证。"
              : "本次没有有声内容，有限响度目标未适用；静音保持静音。"
            : "自动调整音量已关闭，保留片段和整轨设置，仍按原QC规则测量。",
          "台词是否说完未检查：需要真实播放和试听。",
          "人物、动作连续性与口型同步需要人工观看；烧录字幕未做视觉检测，旁路字幕仅估算时间和布局。",
          "音乐避让按有声片段保守处理；尚无可靠的逐句语音对齐，不证明对白完整性。",
        ];
        const token = randomUUID();
        receipts.set(token, {
          input,
          fingerprint: base.fingerprint,
          folder,
          created: now(),
          outputs,
          owner,
          ownerGeneration,
          fileName,
          selection: deliverySelection(base.record, base.clips, shots),
          unverified: [...unverified],
          ...(audioDecision ? { audioDecision } : {}),
          blocked: reports.some(
            (item) =>
              Array.isArray(object(item.report)?.issues) &&
              (object(item.report)!.issues as unknown[]).some(
                (issue) => object(issue)?.severity === "block",
              ),
          ),
        });
        folder = "";
        return {
          kind: "READY",
          qcReceipt: token,
          outputs: reports,
          shots,
          fileName,
          unverified,
        };
      } catch (error) {
        return work?.signal.aborted
          ? { kind: "FAILED", code: "OPERATION_STOPPED" }
          : failure(error);
      } finally {
        if (activeKey) active.delete(activeKey);
        if (folder) await rm(folder, { recursive: true, force: true });
      }
    },
    async publish(
      owner: string,
      value: unknown,
      work?: ExportWork,
    ): Promise<FilmExportQcPublishResult> {
      let token = "";
      let consumed = false;
      let cleanupFolder = "";
      let publishKey = "";
      const outputs: {
        aspectRatio: "16:9" | "9:16";
        path: string;
        subtitlePath?: string;
        coverPath?: string;
      }[] = [];
      let preparedForEvidence: Prepared | undefined;
      let evidenceDirectory = "";
      let deliveryEvidence: FilmDeliveryEvidenceResult | undefined;
      const evidence = async (complete: boolean): Promise<FilmDeliveryEvidenceResult> => {
        if (deliveryEvidence) return deliveryEvidence;
        const prepared = preparedForEvidence;
        if (!prepared || !evidenceDirectory)
          return { kind: "FAILED", code: "EVIDENCE_UNAVAILABLE", files: [] };
        deliveryEvidence = await writeDeliveryManifest({
          directory: evidenceDirectory,
          published: outputs,
          checked: prepared.outputs.map((item) => ({
            aspectRatio: item.aspectRatio,
            videoSha256: item.hash,
            subtitleSha256: item.extras.subtitlePath
              ? item.extraHashes[item.extras.subtitlePath]
              : undefined,
            coverSha256: item.extras.coverPath
              ? item.extraHashes[item.extras.coverPath]
              : undefined,
            technical: item.technical,
            qc: item.qc,
          })),
          selection: prepared.selection,
          settings: prepared.input.settings,
          unverified: prepared.unverified,
          ...(prepared.audioDecision ? { audioDecision: prepared.audioDecision } : {}),
          complete,
          now: now(),
          work,
          assertCurrent: () =>
            current(prepared.input, prepared.fingerprint, owner, prepared.ownerGeneration, work),
        });
        return deliveryEvidence;
      };
      try {
        const input = qcInput(value);
        token = text(object(value)?.qcReceipt);
        const prepared = receipts.get(token);
        if (
          !prepared ||
          prepared.owner !== owner ||
          now() - prepared.created > 600000 ||
          JSON.stringify(input) !== JSON.stringify(prepared.input)
        )
          fail("RECEIPT_STALE");
        preparedForEvidence = prepared;
        if (publishing.has(token)) fail("BUSY");
        publishing.add(token);
        publishKey = token;
        if (prepared.blocked) fail("QC_BLOCKED");
        await current(input, prepared.fingerprint, owner, prepared.ownerGeneration, work);
        work?.phase("publishing");
        work?.cancellable(false);
        const directory = await host.pickDirectory();
        work?.cancellable(true);
        work?.signal.throwIfAborted();
        if (!directory) return { kind: "CANCELLED" };
        await current(input, prepared.fingerprint, owner, prepared.ownerGeneration, work);
        if (receipts.get(token) !== prepared) fail("RECEIPT_STALE");
        const target = await realpath(directory);
        evidenceDirectory = target;
        if (!(await stat(target)).isDirectory()) fail("PUBLISH_FAILED");
        for (const output of prepared.outputs) {
          if ((await sha(output.path, work)) !== output.hash) fail("RECEIPT_STALE");
          for (const [path, hash] of Object.entries(output.extraHashes))
            if ((await sha(path, work)) !== hash) fail("RECEIPT_STALE");
        }
        // Names are chosen before the receipt is spent. A collision keeps the render.
        const mode =
          prepared.input.requestedFileName === undefined ? defaultNameCollision : "error";
        let index = 1;
        while (outputs.length < prepared.outputs.length) {
          const present = await directoryNames(target);
          const { plan, index: chosen } = nextFreeExportPlan(
            prepared.fileName,
            prepared.outputs,
            present,
            mode,
            index,
          );
          index = chosen;
          const linked: string[] = [];
          const announced: string[] = [];
          try {
            for (const item of plan) {
              const output = prepared.outputs.find((row) => row.aspectRatio === item.aspectRatio)!;
              work?.phase("publishing", {
                kind: "units",
                completed: outputs.length,
                total: prepared.outputs.length,
                unit: "画幅",
              });
              await current(input, prepared.fingerprint, owner, prepared.ownerGeneration, work);
              const destination = join(target, `${item.stem}.mp4`);
              const temporary = await mkdtemp(join(target, ".aivora-qc-"));
              try {
                const pending = join(temporary, "film.mp4");
                await copy(output.path, pending, work);
                if ((await sha(pending, work)) !== output.hash) fail("PUBLISH_FAILED");
                const sidecars: {
                  kind: "subtitlePath" | "coverPath";
                  pending: string;
                  destination: string;
                }[] = [];
                for (const [kind, path] of Object.entries(output.extras)) {
                  if (!path) continue;
                  const sideDestination = join(
                    target,
                    kind === "subtitlePath" ? `${item.stem}.srt` : `${item.stem}-封面.png`,
                  );
                  const sidePending = join(
                    temporary,
                    kind === "subtitlePath" ? "film.srt" : "cover.png",
                  );
                  await copy(path, sidePending, work);
                  if ((await sha(sidePending, work)) !== output.extraHashes[path])
                    fail("PUBLISH_FAILED");
                  sidecars.push({
                    kind: kind as "subtitlePath" | "coverPath",
                    pending: sidePending,
                    destination: sideDestination,
                  });
                }
                await current(input, prepared.fingerprint, owner, prepared.ownerGeneration, work);
                work?.signal.throwIfAborted();
                work?.cancellable(false);
                await linkNewFile(pending, destination);
                linked.push(destination);
                const saved: {
                  aspectRatio: "16:9" | "9:16";
                  path: string;
                  subtitlePath?: string;
                  coverPath?: string;
                } = { aspectRatio: output.aspectRatio, path: destination };
                outputs.push(saved);
                for (const side of sidecars) {
                  await linkNewFile(side.pending, side.destination);
                  linked.push(side.destination);
                  saved[side.kind] = side.destination;
                }
                work?.phase("publishing", {
                  kind: "units",
                  completed: outputs.length,
                  total: prepared.outputs.length,
                  unit: "画幅",
                });
                if (outputs.length < prepared.outputs.length) work?.cancellable(true);
              } finally {
                await rm(temporary, { recursive: true, force: true });
              }
            }
            for (const saved of outputs) {
              const canonical = realpathSync(saved.path);
              host.publishedPaths?.add(canonical);
              announced.push(canonical);
              work?.published(saved.aspectRatio);
            }
          } catch (error) {
            for (const path of announced) host.publishedPaths?.delete(path);
            try {
              for (const path of linked) await rm(path, { force: true });
            } catch {
              /* A failed delete must not replace the original publish error. */
            }
            outputs.length = 0;
            if (exportNameTaken(error) && mode === "suffix") {
              index += 1;
              if (index > EXPORT_NAME_SUFFIX_LIMIT) fail("EXPORT_NAME_EXHAUSTED");
              continue;
            }
            throw error;
          }
        }
        receipts.delete(token);
        consumed = true;
        cleanupFolder = prepared.folder;
        const delivered = await evidence(true);
        await rm(prepared.folder, { recursive: true, force: true });
        return {
          kind:
            delivered.kind === "WRITTEN" && !delivered.cleanupUnconfirmed ? "PUBLISHED" : "PARTIAL",
          outputs,
          deliveryEvidence: delivered,
        };
      } catch (error) {
        if (exportNameTaken(error)) return { kind: "FAILED", code: "EXPORT_NAME_TAKEN" };
        const failed = work?.signal.aborted
          ? { kind: "FAILED" as const, code: "OPERATION_STOPPED" as const }
          : failure(error);
        return outputs.length
          ? { kind: "PARTIAL", outputs, deliveryEvidence: await evidence(false) }
          : failed.code === "CHECK_FAILED"
            ? { kind: "FAILED", code: "PUBLISH_FAILED" }
            : failed;
      } finally {
        if (work?.signal.aborted && token) {
          await remove(token);
        }
        if (publishKey) publishing.delete(publishKey);
        if (consumed) {
          receipts.delete(token);
          if (cleanupFolder) await rm(cleanupFolder, { recursive: true, force: true });
        }
      }
    },
    async dispose(owner: string) {
      ownerEpochs.set(owner, (ownerEpochs.get(owner) ?? 0) + 1);
      for (const state of active.values())
        if (state.owner === owner)
          epochs.set(state.projectId, (epochs.get(state.projectId) ?? 0) + 1);
      for (const [token, entry] of receipts) if (entry.owner === owner) await remove(token);
    },
    async discard(owner: string, token: string) {
      if (receipts.get(token)?.owner === owner) await remove(token);
    },
  };
}

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
import { mkdir, mkdtemp, realpath, link, rm, stat } from "node:fs/promises";
import { join, relative, isAbsolute, sep } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  applyDialogue,
  joinClips,
  mediaUrlPath,
  mixMusic,
  readProject,
  safeExportName,
  trustedMediaPath,
  type FilmRecord,
} from "./film-library";
import { exportFilmFile, type FilmExportExtras } from "./film-export";
import { subtitleSrt, exportCanvas, validCues, type ExportCue } from "./film-subtitles";
import type { QcEngine, QcTools, QcRunner } from "./film-export-qc-runtime";
const execute = promisify(execFile);
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
      (key) => !["projectId", "expectedSelection", "settings", "qcReceipt"].includes(key),
    ) ||
    !/^film_[a-z0-9]{16,40}$/.test(text(input.projectId)) ||
    !Array.isArray(input.expectedSelection) ||
    !input.expectedSelection.length ||
    input.expectedSelection.length > 1000 ||
    !settings ||
    Object.keys(settings).sort().join() !==
      ["aiMark", "aspects", "quality", "style", "subtitles"].sort().join()
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
  storyOwner?: (projectId: string, path: string, sha256: string) => Promise<boolean>;
};
type Clip = {
  shotId: string;
  label: string;
  path: string;
  voice: string;
  cues: ExportCue[];
  line: string;
};
type Snapshot = {
  record: FilmRecord;
  clips: Clip[];
  score: string;
  gain: number;
  fingerprint: string;
  coverStill?: string;
  coverData?: string;
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
  }[];
  owner: string;
  ownerGeneration: number;
  blocked: boolean;
  fileName: string;
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
    const audio = Array.isArray(record.audioClips)
      ? record.audioClips.map(object).filter((v): v is Row => !!v)
      : [];
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
      const voice = audio.find(
        (item) =>
          item.lane === "dialogue" &&
          item.shotId === shot.id &&
          (!text(item.takeId) || item.takeId === take.id) &&
          text(item.path),
      );
      clips.push({
        shotId: text(shot.id),
        label: `镜头 ${index + 1}`,
        path,
        voice: voice ? (Number(voice.gainDb) <= -40 ? "mute" : local(voice.path)) : "",
        line,
        cues:
          clean && input.settings.subtitles !== "none" ? validCues(take.subtitleCues ?? []) : [],
      });
    }
    const score = audio.find((item) => item.lane === "score" && text(item.path));
    const scorePath = score ? local(score.path) : "";
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
          ...clips.flatMap((c) => [c.path, ...(c.voice && c.voice !== "mute" ? [c.voice] : [])]),
          ...(scorePath ? [scorePath] : []),
          ...(coverStill ? [coverStill] : []),
        ]),
      ].map(async (path) => [path, await sha(path, work)]),
    );
    const content = Object.fromEntries(
      Object.entries(record).filter(([key]) => !["savedAt", "directory"].includes(key)),
    );
    return {
      record,
      clips,
      coverStill,
      coverData,
      score: scorePath,
      gain:
        score && typeof score.gainDb === "number" && Number.isFinite(score.gainDb)
          ? score.gainDb
          : -14,
      fingerprint: JSON.stringify({ content, hashes, settings: input.settings }),
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
        const duration = async (path: string) => {
          work?.signal.throwIfAborted();
          const args = [
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=nw=1:nk=1",
            path,
          ];
          const probe = managed
            ? managed(tools.ffprobePath, args, {
                timeoutMs: 30000,
                maxBuffer: 65536,
                signal: work?.signal,
              })
            : execute(
                tools.ffprobePath,
                [
                  "-v",
                  "error",
                  "-show_entries",
                  "format=duration",
                  "-of",
                  "default=nw=1:nk=1",
                  path,
                ],
                { timeout: 30000, maxBuffer: 65536 },
              );
          const { stdout } = await (work ? work.track(probe) : probe);
          const seconds = Number(stdout.trim());
          if (!Number.isFinite(seconds) || seconds <= 0) fail("CHECK_FAILED");
          return seconds;
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
          const seconds = await duration(clip.path);
          const start = at;
          shots.push({ id: clip.shotId, label: clip.label, start, end: at + seconds });
          cues.push(
            ...clip.cues.map((cue) => {
              if (cue.end > seconds + 0.05) fail("CHECK_FAILED");
              return { ...cue, start: cue.start + at, end: cue.end + at };
            }),
          );
          // No measured speech intervals: do not widen freeze thresholds using storyboard text.
          if (clip.voice) work?.phase("mixing");
          sources.push(
            clip.voice
              ? await applyDialogue(
                  clip.path,
                  clip.voice,
                  join(folder, `voice-${index}.mp4`),
                  run,
                  duration,
                )
              : clip.path,
          );
          at += seconds;
          work?.phase("preparing", {
            kind: "units",
            completed: index + 1,
            total: base.clips.length,
            unit: "镜头",
          });
        }
        const assembled = join(folder, "assembly.mp4");
        work?.phase("joining");
        if (sources.length === 1) await copy(sources[0]!, assembled, work);
        else await joinClips(sources, assembled, run);
        if (base.score) {
          work?.phase("mixing");
          await mixMusic(assembled, base.score, run, base.gain, duration);
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
          const checking = engine(path, {
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
          outputs.push({ aspectRatio, path, hash: await sha(path, work), extras, extraHashes });
          reports.push({ aspectRatio, report });
        }
        await current(input, base.fingerprint, owner, ownerGeneration, work);
        if (epochs.get(input.projectId) !== epoch) fail("PROJECT_CHANGED");
        const fileName = safeExportName(
          `${text(base.record.seriesTitle) || text(base.record.title)}-${text(base.record.episodeTitle) || "成片"}`,
        );
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
          unverified: [
            "台词是否说完未检查：需要真实播放和试听。",
            "人物、动作连续性与口型同步需要人工观看；烧录字幕未做视觉检测，旁路字幕仅估算时间和布局。",
            "对白轨沿用现有整轨替换方式，轨道偏移与细调音量未在此重做。",
          ],
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
        receipts.delete(token);
        consumed = true;
        cleanupFolder = prepared.folder;
        const target = await realpath(directory);
        if (!(await stat(target)).isDirectory()) fail("PUBLISH_FAILED");
        // Receipt identity makes each output name unique; existing originals are never overwritten.
        for (const output of prepared.outputs) {
          if ((await sha(output.path, work)) !== output.hash) fail("RECEIPT_STALE");
          for (const [path, hash] of Object.entries(output.extraHashes))
            if ((await sha(path, work)) !== hash) fail("RECEIPT_STALE");
          work?.phase("publishing", {
            kind: "units",
            completed: outputs.length,
            total: prepared.outputs.length,
            unit: "画幅",
          });
          await current(input, prepared.fingerprint, owner, prepared.ownerGeneration, work);
          const stem = `${prepared.fileName.replace(/\.mp4$/i, "")}-${token.slice(0, 8)}-${output.aspectRatio.replace(":", "x")}`;
          const destination = join(target, `${stem}.mp4`);
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
              const destination = join(
                target,
                kind === "subtitlePath" ? `${stem}.srt` : `${stem}-封面.png`,
              );
              const pending = join(temporary, kind === "subtitlePath" ? "film.srt" : "cover.png");
              await copy(path, pending, work);
              if ((await sha(pending, work)) !== output.extraHashes[path]) fail("PUBLISH_FAILED");
              sidecars.push({ kind: kind as "subtitlePath" | "coverPath", pending, destination });
            }
            await current(input, prepared.fingerprint, owner, prepared.ownerGeneration, work);
            work?.signal.throwIfAborted();
            work?.cancellable(false);
            await link(pending, destination);
            host.publishedPaths?.add(realpathSync(destination));
            const saved: {
              aspectRatio: "16:9" | "9:16";
              path: string;
              subtitlePath?: string;
              coverPath?: string;
            } = { aspectRatio: output.aspectRatio, path: destination };
            outputs.push(saved);
            work?.published(output.aspectRatio);
            for (const side of sidecars) {
              await link(side.pending, side.destination);
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
        await rm(prepared.folder, { recursive: true, force: true });
        return { kind: "PUBLISHED", outputs };
      } catch (error) {
        const failed = work?.signal.aborted
          ? { kind: "FAILED" as const, code: "OPERATION_STOPPED" as const }
          : failure(error);
        return outputs.length
          ? { kind: "PARTIAL", outputs }
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

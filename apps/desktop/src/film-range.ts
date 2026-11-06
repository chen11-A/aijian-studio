import { randomUUID } from "node:crypto";
import { mkdir, realpath, rm, stat, mkdtemp, readFile } from "node:fs/promises";
import { isAbsolute, join, relative, extname } from "node:path";
import type { FilmRangeGateway, FilmRangePlan } from "@aijian/contracts/film-range";
import {
  transactFilmProject,
  compareAndSwapProject,
  mediaUrlPath,
  readProject,
  type FilmRecord,
} from "./film-library";
import { createFilmHistory, filmHistoryRecordHash } from "./film-history";
import { exportFileHash } from "./film-export-io";
import type { QcRunner, QcTools } from "./film-export-qc-runtime";
import { planFilmRange } from "./film-range-plan";
import { rangeMedia, renderFilmRange } from "./film-range-render";
import { validCues, type ExportCue } from "./film-subtitles";
import type { StoryFilmCreateInput } from "./story-film-client";
type Row = Record<string, unknown>;
const obj = (v: unknown): Row =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {};
const rows = (v: unknown): Row[] => (Array.isArray(v) ? v.map(obj) : []);
const unique = (v: Row[]) =>
  v.every((x) => typeof x.id === "string" && x.id) && new Set(v.map((x) => x.id)).size === v.length;
type Host = {
  generate?: (
    projectId: string,
    input: StoryFilmCreateInput,
    canDispatch: () => Promise<boolean>,
  ) => Promise<{ data: Record<string, unknown> }>;
  temporaryRoot?: string;
  filmsRoot: string;
  storyFilmsRoot: string;
  tools: () => Promise<QcTools>;
  run: QcRunner;
  cleanOwner: (
    projectId: string,
    original: { path: string; sha: string },
    clean: { path: string; sha: string },
  ) => Promise<boolean>;
  storyOwner: (projectId: string, path: string, sha: string) => Promise<boolean>;
};
type Pending = {
  record: FilmRecord;
  source: string;
  sourceSha: string;
  original: { path: string; sha: string };
  subtitleCues: ExportCue[];
  shotId: string;
  takeId: string;
  plan: FilmRangePlan;
  tools: QcTools;
  expires: number;
  dispatched?: boolean;
  segmentTakeId?: string;
};
/** Main holds all paths and source identity. One owner-local plan is consumed once, even
 * when stitching fails. Generated segment remains a real, independently retained take. */
export function createFilmRanges(host: Host): FilmRangeGateway {
  const plans = new Map<string, Pending>();
  const history = createFilmHistory({ filmsRoot: host.filmsRoot });
  const semantic = (record: FilmRecord) => {
    const copy = { ...record };
    delete copy.savedAt;
    return filmHistoryRecordHash(copy);
  };
  const active = new Set<string>();
  const finishing = new Map<string, { projectId: string; controller: AbortController }>();
  async function selected(
    record: FilmRecord,
    shotId: string,
    takeId: string,
    requireSelected: boolean,
  ) {
    const shots = rows(record.shots);
    if (!unique(shots)) throw new Error("PROJECT_CHANGED");
    const shot = shots.find((x) => x.id === shotId);
    const takes = rows(shot?.takes);
    if (!shot || !unique(takes)) throw new Error("PROJECT_CHANGED");
    const chosen = shot.selectedTakeId || takes.find((x) => x.status === "done" && x.videoPath)?.id;
    const take = takes.find((x) => x.id === takeId);
    if (
      !take ||
      take.status !== "done" ||
      take.shotId !== shotId ||
      (requireSelected && chosen !== takeId)
    )
      throw new Error("PROJECT_CHANGED");
    return { shot, take };
  }
  async function trusted(record: FilmRecord, take: Row) {
    const root = await realpath(host.filmsRoot);
    const series = await realpath(join(root, record.seriesId));
    if (relative(root, series) !== record.seriesId) throw new Error("SOURCE_UNVERIFIED");
    const episode = await realpath(join(series, "episodes", record.id));
    if (relative(series, episode) !== join("episodes", record.id))
      throw new Error("SOURCE_UNVERIFIED");
    const path = await realpath(mediaUrlPath(String(take.videoPath ?? "")));
    if (extname(path).toLowerCase() !== ".mp4" || !(await stat(path)).isFile())
      throw new Error("SOURCE_UNVERIFIED");
    const sha = await exportFileHash(path);
    const media = join(episode, "media");
    const canonicalMedia = await realpath(media).catch(() => "");
    const inside =
      canonicalMedia && relative(episode, canonicalMedia) === "media"
        ? relative(canonicalMedia, path)
        : "";
    if (inside && !inside.startsWith("..") && !isAbsolute(inside)) return { path, sha };
    const story = await realpath(host.storyFilmsRoot).catch(() => "");
    if (
      !story ||
      relative(story, path).startsWith("..") ||
      isAbsolute(relative(story, path)) ||
      typeof record.backendProjectId !== "string" ||
      !(await host.storyOwner(record.backendProjectId, path, sha))
    )
      throw new Error("SOURCE_UNVERIFIED");
    return { path, sha };
  }
  return {
    async prepareFilmRange(input) {
      try {
        for (const [id, plan] of plans) if (plan.expires < Date.now()) plans.delete(id);
        if (
          !input ||
          Object.keys(input).sort().join() !== "end,expectedHash,projectId,shotId,start,takeId" ||
          !/^film_[a-z0-9]{16,40}$/.test(input.projectId) ||
          !/^[a-f0-9]{64}$/.test(input.expectedHash)
        )
          throw new Error("PROJECT_CHANGED");
        const record = await readProject(host.filmsRoot, input.projectId);
        if (
          !record ||
          record.id !== input.projectId ||
          filmHistoryRecordHash(record) !== input.expectedHash
        )
          throw new Error("PROJECT_CHANGED");
        const { take } = await selected(record, input.shotId, input.takeId, true);
        const original = await trusted(record, take);
        const source =
          typeof take.cleanVideoPath === "string" && take.cleanVideoPath
            ? await trusted(record, { ...take, videoPath: take.cleanVideoPath })
            : original;
        if (
          typeof record.backendProjectId !== "string" ||
          !(await host.cleanOwner(record.backendProjectId, original, source))
        )
          throw new Error("CLEAN_SOURCE_REQUIRED");
        const subtitleCues = validCues(take.subtitleCues ?? []);
        const tools = await host.tools().catch(() => {
          throw new Error("TOOLS_UNAVAILABLE");
        });
        const media = await rangeMedia(source.path, tools, host.run).catch(() => {
          throw new Error("UNSUPPORTED_SOURCE");
        });
        const originalMedia =
          source.path === original.path
            ? media
            : await rangeMedia(original.path, tools, host.run).catch(() => {
                throw new Error("UNSUPPORTED_SOURCE");
              });
        if (
          media.fps !== originalMedia.fps ||
          media.width !== originalMedia.width ||
          media.height !== originalMedia.height ||
          Math.abs(media.duration - originalMedia.duration) > 1 / Number(media.fps.split("/")[0]) ||
          subtitleCues.some((cue) => cue.end > media.duration + 1 / Number(media.fps.split("/")[0]))
        )
          throw new Error("UNSUPPORTED_SOURCE");
        const fps = Number(media.fps.split("/")[0]) as 24 | 25 | 30;
        if (media.width * 9 !== media.height * 16 && media.width * 16 !== media.height * 9)
          throw new Error("UNSUPPORTED_SOURCE");
        const plan = planFilmRange(media.duration, input.start, input.end, fps);
        if (!plan) throw new Error("INVALID_RANGE");
        // Re-read after probing/hash: no edit during preparation becomes a valid baseline.
        const latest = await readProject(host.filmsRoot, record.id);
        if (filmHistoryRecordHash(latest) !== input.expectedHash)
          throw new Error("PROJECT_CHANGED");
        const planId = `rng_${randomUUID().replaceAll("-", "")}`;
        for (const [id, item] of plans) if (item.record.id === record.id) plans.delete(id);
        if (plans.size >= 32) plans.delete(plans.keys().next().value!);
        plans.set(planId, {
          record,
          source: source.path,
          sourceSha: source.sha,
          original,
          subtitleCues,
          shotId: input.shotId,
          takeId: input.takeId,
          plan,
          tools,
          expires: Date.now() + 30 * 60000,
        });
        return { kind: "READY", planId, plan };
      } catch (error) {
        const code = error instanceof Error ? error.message : "SOURCE_UNVERIFIED";
        return {
          kind: "FAILED",
          code:
            code === "CLEAN_SOURCE_REQUIRED" ||
            code === "INVALID_RANGE" ||
            code === "PROJECT_CHANGED" ||
            code === "UNSUPPORTED_SOURCE" ||
            code === "TOOLS_UNAVAILABLE"
              ? code
              : "SOURCE_UNVERIFIED",
        };
      }
    },
    async generateFilmRange(input) {
      const pending = plans.get(input?.planId);
      if (
        !pending ||
        pending.dispatched ||
        pending.record.id !== input.projectId ||
        pending.expires < Date.now() ||
        input.confirmed !== true ||
        typeof input.prompt !== "string" ||
        !input.prompt.trim() ||
        input.prompt.length > 2000 ||
        !host.generate ||
        !host.temporaryRoot ||
        active.has(input.projectId)
      )
        return { kind: "FAILED", code: "PROJECT_CHANGED", requestMayHaveRun: false };
      pending.dispatched = true;
      active.add(input.projectId);
      let folder = "",
        dispatched = false;
      try {
        const current = await readProject(host.filmsRoot, input.projectId);
        if (
          !current ||
          current.id !== input.projectId ||
          filmHistoryRecordHash(current) !== input.expectedHash ||
          semantic(current) !== semantic(pending.record)
        )
          return { kind: "FAILED", code: "PROJECT_CHANGED", requestMayHaveRun: false };
        const capture = await history.capture({
          projectId: input.projectId,
          expectedHash: input.expectedHash,
          reason: "before-batch-generation",
        });
        if (capture.kind !== "CAPTURED")
          return { kind: "FAILED", code: "BACKUP_FAILED", requestMayHaveRun: false };
        // Authentication, ordinary provider request and its existing idempotency remain in
        // the normal client. No endpoint, retry, speech timing or provider extension is invented.
        if (
          (await exportFileHash(pending.source)) !== pending.sourceSha ||
          (await exportFileHash(pending.original.path)) !== pending.original.sha
        )
          throw new Error("SOURCE_CHANGED");
        const tools = await host.tools();
        await mkdir(host.temporaryRoot, { recursive: true });
        folder = await mkdtemp(join(host.temporaryRoot, "range-"));
        const first = join(folder, "first.jpg");
        await host.run(
          tools.ffmpegPath,
          [
            "-v",
            "error",
            "-nostdin",
            "-ss",
            String(pending.plan.effective.start),
            "-protocol_whitelist",
            "file,pipe",
            "-i",
            pending.source,
            "-frames:v",
            "1",
            "-y",
            first,
          ],
          { timeoutMs: 30000 },
        );
        const media = await rangeMedia(pending.source, tools, host.run);
        if (!/^prj_[a-f0-9]{32}$/.test(String(current.backendProjectId)))
          throw new Error("PROJECT_CHANGED");
        if (media.width * 9 !== media.height * 16 && media.width * 16 !== media.height * 9)
          throw new Error("UNSUPPORTED_SOURCE");
        const latest = await readProject(host.filmsRoot, current.id);
        if (!plans.has(input.planId) || !latest || semantic(latest) !== semantic(current))
          return { kind: "FAILED", code: "PROJECT_CHANGED", requestMayHaveRun: false };
        if (
          (await exportFileHash(pending.source)) !== pending.sourceSha ||
          (await exportFileHash(pending.original.path)) !== pending.original.sha
        )
          throw new Error("SOURCE_CHANGED");
        const still = `data:image/jpeg;base64,${(await readFile(first)).toString("base64")}`;
        const response = await host.generate(
          String(current.backendProjectId),
          {
            scene_label: String(current.title || "局部画面").slice(0, 80),
            narration: "。",
            subtitle: "",
            provider: "grok_subscription",
            confirmed: true,
            video_model: "grok-imagine-video-1.5",
            regenerate: true,
            aspect_ratio: media.width > media.height ? "16:9" : "9:16",
            shots: [
              {
                narration: "。",
                prompt: input.prompt,
                subtitle: "",
                duration_seconds: pending.plan.generationSeconds,
                still,
              },
            ],
          },
          async () => {
            const latest = await readProject(host.filmsRoot, current.id);
            if (
              !plans.has(input.planId) ||
              !latest ||
              semantic(latest) !== semantic(current) ||
              (await exportFileHash(pending.source)) !== pending.sourceSha ||
              (await exportFileHash(pending.original.path)) !== pending.original.sha
            )
              return false;
            dispatched = true;
            return true;
          },
        );
        const data = response.data;
        if (data.status !== "SUCCEEDED" || typeof data.output_path !== "string")
          throw new Error("GENERATION_UNCONFIRMED");
        const id = `take_${randomUUID()}`;
        let project: FilmRecord | null = null;
        await transactFilmProject(host.filmsRoot, current.id, async (latest, write) => {
          if (!latest) return;
          const target = rows(latest.shots).find((row) => row.id === pending.shotId);
          if (!target || !unique(rows(latest.shots)) || !unique(rows(target.takes))) return;
          const candidate = {
            id,
            shotId: pending.shotId,
            index: rows(target.takes).length + 1,
            status: "done",
            videoPath: data.output_path,
            videoUrl: "",
            stillUrl: "",
            prompt: input.prompt,
            createdAt: new Date().toISOString(),
            reason: "局部重做的生成段，尚未接回原片。",
          };
          await trusted(latest, candidate);
          project = await write({
            ...latest,
            shots: rows(latest.shots).map((row) =>
              row.id === pending.shotId ? { ...row, takes: [...rows(row.takes), candidate] } : row,
            ),
          } as FilmRecord);
        });
        if (!project) throw new Error("GENERATION_UNCONFIRMED");
        pending.segmentTakeId = id;
        return { kind: "GENERATED", project, segmentTakeId: id };
      } catch {
        return { kind: "FAILED", code: "GENERATION_UNCONFIRMED", requestMayHaveRun: dispatched };
      } finally {
        active.delete(input.projectId);
        if (folder) await rm(folder, { recursive: true, force: true }).catch(() => undefined);
      }
    },
    async finishFilmRange(input) {
      const pending = plans.get(input?.planId);
      plans.delete(input?.planId);
      const fail = (code: "PROJECT_CHANGED" | "SOURCE_UNVERIFIED" | "SPLICE_FAILED") => ({
        kind: "FAILED" as const,
        code,
        segmentRetained: true as const,
      });
      if (
        !pending ||
        pending.expires < Date.now() ||
        pending.record.id !== input.projectId ||
        active.has(input.projectId) ||
        pending.segmentTakeId !== input.segmentTakeId
      )
        return fail("PROJECT_CHANGED");
      active.add(input.projectId);
      const controller = new AbortController();
      finishing.set(input.planId, { projectId: input.projectId, controller });
      let output = "";
      let committed = false;
      let outputTakeId = "";
      try {
        const current = await readProject(host.filmsRoot, input.projectId);
        if (
          !current ||
          current.id !== input.projectId ||
          filmHistoryRecordHash(current) !== input.expectedHash
        )
          return fail("PROJECT_CHANGED");
        await selected(current, pending.shotId, pending.takeId, true);
        const { shot, take: segment } = await selected(
          current,
          pending.shotId,
          input.segmentTakeId,
          false,
        );
        if (input.segmentTakeId === pending.takeId) return fail("PROJECT_CHANGED");
        // The only permitted change since planning is the one generated candidate take.
        const previous = {
          ...current,
          shots: rows(current.shots).map((row) =>
            row.id === pending.shotId
              ? { ...row, takes: rows(row.takes).filter((t) => t.id !== input.segmentTakeId) }
              : row,
          ),
        };
        if (semantic(previous) !== semantic(pending.record)) return fail("PROJECT_CHANGED");
        const replacement = await trusted(current, segment);
        if (
          typeof current.backendProjectId !== "string" ||
          !(await host.cleanOwner(current.backendProjectId, replacement, replacement))
        )
          return fail("SOURCE_UNVERIFIED");
        if (
          (await exportFileHash(pending.source)) !== pending.sourceSha ||
          (await exportFileHash(pending.original.path)) !== pending.original.sha
        )
          return fail("SOURCE_UNVERIFIED");
        const folder = join(host.filmsRoot, current.seriesId, "episodes", current.id, "media");
        await mkdir(folder, { recursive: true });
        const canonical = await realpath(folder);
        if (
          relative(await realpath(host.filmsRoot), canonical) !==
          join(current.seriesId, "episodes", current.id, "media")
        )
          return fail("SOURCE_UNVERIFIED");
        output = join(canonical, `range-${randomUUID()}.mp4`);
        const tools = await host.tools();
        await renderFilmRange(
          pending.source,
          replacement.path,
          output,
          pending.plan,
          tools,
          host.run,
          controller.signal,
          pending.original.path,
        );
        if (
          (await exportFileHash(pending.source)) !== pending.sourceSha ||
          (await exportFileHash(pending.original.path)) !== pending.original.sha ||
          (await exportFileHash(replacement.path)) !== replacement.sha
        )
          return fail("SOURCE_UNVERIFIED");
        const id = `take_${randomUUID()}`;
        outputTakeId = id;
        const newTake = {
          id,
          shotId: pending.shotId,
          index: rows(shot.takes).length + 1,
          status: "done",
          videoPath: output,
          videoUrl: "",
          stillUrl: "",
          prompt: segment.prompt || "",
          createdAt: new Date().toISOString(),
          durationSeconds: pending.plan.duration,
          cleanVideoPath: output,
          ...(pending.subtitleCues.length ? { subtitleCues: pending.subtitleCues } : {}),
          reason: "仅重做所选时间段画面，保留原音轨；未验证口型。",
        };
        const next = {
          ...current,
          assemblyPath: "",
          assemblyUrl: "",
          shots: rows(current.shots).map((row) =>
            row.id === pending.shotId
              ? { ...row, takes: [...rows(row.takes), newTake], selectedTakeId: id }
              : row,
          ),
        } as FilmRecord;
        controller.signal.throwIfAborted();
        const saved = await compareAndSwapProject(host.filmsRoot, current, next);
        if (!saved) return fail("PROJECT_CHANGED");
        committed = true;
        return { kind: "SPLICED", project: saved };
      } catch {
        // A project file can be written before a later index write fails. Never delete
        // media referenced by a real committed record or claim an unchanged result.
        const latest = await readProject(host.filmsRoot, input.projectId).catch(() => null);
        if (
          latest &&
          rows(latest.shots).some((shot) =>
            rows(shot.takes).some((take) => take.id === outputTakeId && take.videoPath === output),
          )
        ) {
          committed = true;
          return { kind: "PARTIAL", project: latest };
        }
        return fail("SPLICE_FAILED");
      } finally {
        active.delete(input.projectId);
        finishing.delete(input.planId);
        if (output && !committed) await rm(output, { force: true }).catch(() => undefined);
      }
    },
    async discardFilmRange(projectId, planId) {
      if (plans.get(planId)?.record.id === projectId) plans.delete(planId);
      const live = finishing.get(planId);
      if (live?.projectId === projectId) live.controller.abort();
    },
  };
}

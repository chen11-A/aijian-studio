import { resolveAudioMix } from "./film-audio-mix-sources";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import type {
  AddBundledFilmAudioInput,
  AddBundledFilmAudioResult,
  FilmAudioLibraryFailure,
  FilmAudioLibraryGateway,
} from "@aijian/contracts/film-audio-library";
import { buildAudioMixPlan } from "@aijian/contracts/film-audio-mix-plan";
import { filmHistoryRecordHash } from "./film-history";
import { readProject, transactFilmProject, type FilmRecord } from "./film-library";
import { exportFileHash, copyExportFile } from "./film-export-io";
import { probeMixSource } from "./film-audio-mix";
import { loadTrustedAudioLibrary, publicAudioCatalog } from "./film-audio-library-runtime";
import type { QcRunner, QcTools } from "./film-export-qc-runtime";
const object = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const exact = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).sort().join() === keys.sort().join();
const failure = (error: unknown): FilmAudioLibraryFailure => ({
  kind: "FAILED",
  code: ([
    "INVALID_INPUT",
    "LIBRARY_UNAVAILABLE",
    "ASSET_CHANGED",
    "PROJECT_CHANGED",
    "SOURCE_UNVERIFIED",
    "PLACEMENT_UNSUPPORTED",
    "BUSY",
    "WRITE_FAILED",
    "WRITE_UNCONFIRMED",
    "TOOLS_UNAVAILABLE",
  ].includes(error instanceof Error ? error.message : "")
    ? (error as Error).message
    : "WRITE_FAILED") as FilmAudioLibraryFailure["code"],
  unchanged: true,
});
function fail(code: FilmAudioLibraryFailure["code"]): never {
  throw Error(code);
}
function input(value: unknown): AddBundledFilmAudioInput {
  const row = object(value),
    place = object(row?.placement);
  if (
    !row ||
    !place ||
    !exact(row, [
      "projectId",
      "expectedProjectHash",
      "catalogSha256",
      "assetId",
      "expectedAssetSha256",
      "shotId",
      "takeId",
      "lane",
      "placement",
    ]) ||
    !exact(place, ["startSeconds", "durationSeconds", "offsetSeconds", "gainDb", "loop"]) ||
    !/^film_[a-z0-9]{16,40}$/.test(String(row.projectId)) ||
    ![row.expectedProjectHash, row.catalogSha256, row.expectedAssetSha256].every(
      (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v),
    ) ||
    ![row.assetId, row.shotId, row.takeId].every(
      (v) => typeof v === "string" && v.length > 0 && v.length <= 160 && !v.includes("\0"),
    ) ||
    !["ambience", "sfx", "score"].includes(String(row.lane)) ||
    ![place.startSeconds, place.durationSeconds, place.offsetSeconds, place.gainDb].every(
      (v) => typeof v === "number" && Number.isFinite(v),
    ) ||
    Number(place.startSeconds) < 0 ||
    Number(place.offsetSeconds) < 0 ||
    Number(place.durationSeconds) <= 0 ||
    Number(place.durationSeconds) > 36000 ||
    Number(place.gainDb) < -40 ||
    Number(place.gainDb) > 12 ||
    typeof place.loop !== "boolean"
  )
    fail("INVALID_INPUT");
  return row as unknown as AddBundledFilmAudioInput;
}
function selected(record: FilmRecord, request: AddBundledFilmAudioInput) {
  const shots = Array.isArray(record.shots) ? record.shots.map(object) : [];
  const matches = shots.filter((shot) => shot?.id === request.shotId);
  const shot = matches[0];
  if (matches.length !== 1 || !shot || !Array.isArray(shot.takes)) fail("PROJECT_CHANGED");
  const takes = shot.takes.map(object),
    chosen = shot.selectedTakeId
      ? takes.find((take) => take?.id === shot.selectedTakeId)
      : takes.find((take) => take?.status === "done" && take.videoPath);
  if (
    !chosen ||
    chosen.id !== request.takeId ||
    chosen.shotId !== shot.id ||
    chosen.status !== "done" ||
    typeof chosen.videoPath !== "string" ||
    takes.filter((take) => take?.id === chosen.id).length !== 1
  )
    fail("PROJECT_CHANGED");
  return chosen;
}
export function createFilmAudioLibrary(host: {
  filmsRoot: string;
  storyFilmsRoot: string;
  libraryRoot: () => string;
  tools: () => Promise<QcTools>;
  run: QcRunner;
  videoOwner: (projectId: string, path: string, sha256: string) => Promise<boolean>;
  /** Scheduling hook used by real-file CAS regressions, not an alternate persistence path. */
  beforeCommit?: () => Promise<void>;
}): FilmAudioLibraryGateway {
  const active = new Set<string>();
  async function episode(record: FilmRecord) {
    const root = await realpath(host.filmsRoot),
      series = await realpath(join(root, record.seriesId));
    if (relative(root, series) !== record.seriesId) fail("SOURCE_UNVERIFIED");
    const folder = await realpath(join(series, "episodes", record.id));
    if (relative(series, folder) !== join("episodes", record.id)) fail("SOURCE_UNVERIFIED");
    return folder;
  }
  return {
    async listBundledFilmAudio() {
      try {
        return publicAudioCatalog(await loadTrustedAudioLibrary(host.libraryRoot()));
      } catch (error) {
        return failure(
          error instanceof Error && error.message === "ASSET_CHANGED"
            ? error
            : Error("LIBRARY_UNAVAILABLE"),
        );
      }
    },
    async addBundledFilmAudio(value): Promise<AddBundledFilmAudioResult> {
      let folder = "",
        project = "",
        committed = false,
        acquired = false,
        writeStarted = false,
        pendingClipId = "";
      try {
        const request = input(value);
        project = request.projectId;
        if (active.has(project)) fail("BUSY");
        active.add(project);
        acquired = true;
        const base = await readProject(host.filmsRoot, project);
        if (
          !base ||
          base.id !== project ||
          filmHistoryRecordHash(base) !== request.expectedProjectHash
        )
          fail("PROJECT_CHANGED");
        const take = selected(base, request);
        const busy = (record: FilmRecord) =>
          (Array.isArray(record.jobs) &&
            record.jobs.some((row) =>
              ["queued", "running"].includes(String(object(row)?.status)),
            )) ||
          object(record.productionPipeline)?.status === "running";
        if (busy(base)) fail("BUSY");
        const library = await loadTrustedAudioLibrary(host.libraryRoot()).catch((error) =>
          fail(
            error instanceof Error && error.message === "ASSET_CHANGED"
              ? "ASSET_CHANGED"
              : "LIBRARY_UNAVAILABLE",
          ),
        );
        if (library.manifestSha256 !== request.catalogSha256) fail("ASSET_CHANGED");
        const asset = library.assets.find((asset) => asset.id === request.assetId);
        if (!asset || asset.sha256 !== request.expectedAssetSha256) fail("ASSET_CHANGED");
        if (
          (asset.type === "music") !== (request.lane === "score") ||
          (request.placement.loop && !asset.loopable)
        )
          fail("PLACEMENT_UNSUPPORTED");
        const local = await episode(base).catch(() => fail("SOURCE_UNVERIFIED"));
        const tools = await host.tools().catch(() => fail("TOOLS_UNAVAILABLE"));
        const selection = [
          {
            shotId: request.shotId,
            takeId: request.takeId,
            videoPath: String(take.videoPath),
            ...(typeof take.cleanVideoPath === "string" && take.cleanVideoPath
              ? { visualPath: take.cleanVideoPath }
              : {}),
          },
        ];
        // Reuse the exact final mix roots, ownership and clean-visual clock. Other existing
        // audio is not being auditioned or repaired by an explicit single-resource import.
        const selectedSources = (record: FilmRecord) =>
          resolveAudioMix({ ...record, audioClips: [] }, selection, {
            filmsRoot: host.filmsRoot,
            storyFilmsRoot: host.storyFilmsRoot,
            tools,
            run: host.run,
            videoOwner: host.videoOwner,
          });
        const visual = await selectedSources(base).catch(() => fail("SOURCE_UNVERIFIED"));
        const sound = await probeMixSource(asset.file, tools, host.run);
        const duration = visual.plan.durationSeconds;
        if (!(duration > 0) || !sound.hasAudio) fail("PLACEMENT_UNSUPPORTED");
        const plan = buildAudioMixPlan({
          projectId: project,
          durationSeconds: duration,
          shots: [
            {
              shotId: request.shotId,
              takeId: request.takeId,
              nativeSourceKey: "silent",
              startSeconds: 0,
              durationSeconds: duration,
              hasDialogue: false,
            },
          ],
          sources: { silent: { durationSeconds: duration, hasAudio: false }, selected: sound },
          clips: [
            {
              id: "selected",
              lane: request.lane,
              shotId: request.shotId,
              takeId: request.takeId,
              label: "",
              sourceKey: "selected",
              ...request.placement,
            },
          ],
        });
        const planned = plan.tracks[0];
        // A fully muted explicit placement is valid; other source/window failures are not.
        if (
          request.placement.startSeconds + request.placement.durationSeconds >
            duration + 0.000001 ||
          request.placement.offsetSeconds >= sound.durationSeconds ||
          (!request.placement.loop &&
            request.placement.durationSeconds >
              sound.durationSeconds - request.placement.offsetSeconds + 0.000001) ||
          (request.placement.gainDb > -40 &&
            (!planned ||
              Math.abs(
                planned.endSeconds - planned.startSeconds - request.placement.durationSeconds,
              ) > 0.000001))
        )
          fail("PLACEMENT_UNSUPPORTED");
        const media = join(local, "media");
        await mkdir(media, { recursive: true });
        if (relative(local, await realpath(media)) !== "media") fail("SOURCE_UNVERIFIED");
        folder = await mkdtemp(join(media, ".audio-library-"));
        const copied = join(folder, "asset.ogg");
        await copyExportFile(asset.file, copied);
        if (
          (await exportFileHash(copied)) !== asset.sha256 ||
          (await exportFileHash(asset.file)) !== asset.sha256
        )
          fail("ASSET_CHANGED");
        await host.beforeCommit?.();
        return await transactFilmProject(host.filmsRoot, project, async (current, write) => {
          if (
            !current ||
            filmHistoryRecordHash(current) !== request.expectedProjectHash ||
            busy(current) ||
            (await episode(current)) !== local
          )
            fail("PROJECT_CHANGED");
          selected(current, request);
          const latestSources = await selectedSources(current).catch(() => fail("PROJECT_CHANGED"));
          if (
            JSON.stringify(latestSources.hashes) !== JSON.stringify(visual.hashes) ||
            latestSources.plan.durationSeconds !== duration
          )
            fail("PROJECT_CHANGED");
          if ((await exportFileHash(copied)) !== asset.sha256) fail("ASSET_CHANGED");
          const clipId = `audio-${randomUUID()}`;
          const clip = {
            id: clipId,
            lane: request.lane,
            shotId: request.shotId,
            takeId: request.takeId,
            label: asset.name,
            ...request.placement,
            path: copied,
            enabled: true,
            libraryAsset: asset.provenance,
          };
          pendingClipId = clipId;
          writeStarted = true;
          const stored = await write({
            ...current,
            audioClips: [...(Array.isArray(current.audioClips) ? current.audioClips : []), clip],
          });
          committed = true;
          return { kind: "ADDED" as const, clipId, project: stored };
        });
      } catch (error) {
        if (writeStarted) {
          const current = await readProject(host.filmsRoot, project).catch(() => undefined);
          const retained =
            current &&
            Array.isArray(current.audioClips) &&
            current.audioClips.some((row) => object(row)?.id === pendingClipId);
          if (current == null || retained) {
            committed = true;
            return { kind: "FAILED", code: "WRITE_UNCONFIRMED", unchanged: false };
          }
        }
        return failure(error);
      } finally {
        if (folder && !committed)
          await rm(folder, { recursive: true, force: true }).catch(() => undefined);
        if (acquired) active.delete(project);
      }
    },
  };
}

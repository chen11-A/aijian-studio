import { resolveAudioMix } from "./film-audio-mix-sources";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import type {
  AddBundledFilmAudioInput,
  AddBundledFilmAudioResult,
  FilmAudioLibraryFailure,
  FilmAudioLibraryGateway,
  InspectBundledFilmAudioTargetInput,
  InspectBundledFilmAudioTargetResult,
  SuggestBundledFilmShotAudioResult,
} from "@aijian/contracts/film-audio-library";
import { audioMixSettings, buildAudioMixPlan } from "@aijian/contracts/film-audio-mix-plan";
import { filmHistoryRecordHash } from "./film-history";
import { mediaUrlPath, readProject, transactFilmProject, type FilmRecord } from "./film-library";
import { exportFileHash, copyExportFile } from "./film-export-io";
import { probeMixSource } from "./film-audio-mix";
import {
  loadTrustedAudioLibrary,
  publicAudioCatalog,
  loadTrustedAudioPicker,
} from "./film-audio-library-runtime";
import type { QcRunner, QcTools } from "./film-export-qc-runtime";
import {
  shotAudioContext,
  compileShotAudioSuggestion,
  ShotAudioSuggestionLimit,
} from "./film-shot-audio-suggestions";
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
    "PLAN_UNSUPPORTED",
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
function targetInput(value: unknown): InspectBundledFilmAudioTargetInput {
  const row = object(value);
  if (
    !row ||
    !exact(row, ["projectId", "expectedProjectHash", "shotId", "takeId"]) ||
    typeof row.projectId !== "string" ||
    !/^film_[a-z0-9]{16,40}$/.test(row.projectId) ||
    typeof row.expectedProjectHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(row.expectedProjectHash) ||
    ![row.shotId, row.takeId].every(
      (id) => typeof id === "string" && id.length > 0 && id.length <= 160 && !id.includes("\0"),
    )
  )
    fail("INVALID_INPUT");
  return { ...row } as unknown as InspectBundledFilmAudioTargetInput;
}

function selected(
  record: FilmRecord,
  request: Pick<AddBundledFilmAudioInput, "shotId" | "takeId">,
) {
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
  async function selectedSources(
    record: FilmRecord,
    request: Pick<AddBundledFilmAudioInput, "shotId" | "takeId">,
    tools: QcTools,
  ) {
    const take = selected(record, request);
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
    // Identical ownership and actual native/clean visual clock for inspection and addition.
    // Other clips and unmade shots are outside this explicit target-only operation.
    return resolveAudioMix({ ...record, audioClips: [] }, selection, {
      filmsRoot: host.filmsRoot,
      storyFilmsRoot: host.storyFilmsRoot,
      tools,
      run: host.run,
      videoOwner: host.videoOwner,
    });
  }
  return {
    async suggestBundledFilmShotAudio(value): Promise<SuggestBundledFilmShotAudioResult> {
      let project = "",
        acquired = false;
      try {
        const request = targetInput(value);
        project = request.projectId;
        if (active.has(project)) fail("BUSY");
        active.add(project);
        acquired = true;
        const current = async () => {
          const record = await readProject(host.filmsRoot, project);
          if (
            !record ||
            record.id !== project ||
            filmHistoryRecordHash(record) !== request.expectedProjectHash
          )
            fail("PROJECT_CHANGED");
          selected(record, request);
          return record;
        };
        const base = await current();
        const tools = await host.tools().catch(() => fail("TOOLS_UNAVAILABLE"));
        const before = await selectedSources(base, request, tools).catch(() =>
          fail("SOURCE_UNVERIFIED"),
        );
        let directory: string;
        try {
          directory = await realpath(host.libraryRoot());
        } catch {
          fail("LIBRARY_UNAVAILABLE");
        }
        const library = await loadTrustedAudioLibrary(directory).catch((error) =>
          fail(
            error instanceof Error && error.message === "ASSET_CHANGED"
              ? "ASSET_CHANGED"
              : "LIBRARY_UNAVAILABLE",
          ),
        );
        const picker = await loadTrustedAudioPicker(directory).catch((error) =>
          fail(
            error instanceof Error && error.message === "ASSET_CHANGED"
              ? "ASSET_CHANGED"
              : "LIBRARY_UNAVAILABLE",
          ),
        );
        const durationSeconds = before.plan.durationSeconds;
        const context = shotAudioContext(base, request.shotId, durationSeconds);
        const raw = picker.pickAudio(
          context.scene,
          library.assets.map((asset) => ({
            id: asset.id,
            path: asset.file,
            type: asset.type,
            category: asset.category,
            name: asset.name,
            tags: [...asset.tags],
            scene: asset.scene,
            source: asset.source,
            author: asset.author,
            license: asset.license,
            duration: asset.durationSeconds,
            loop: asset.loopable,
            loopable: asset.loopable,
            loudness: asset.loudness,
          })),
        );
        const compiled = compileShotAudioSuggestion(
          raw,
          library,
          durationSeconds,
          context.allowMusic,
          128 - before.plan.tracks.length,
        );
        const after = await selectedSources(await current(), request, tools).catch(() =>
          fail("PROJECT_CHANGED"),
        );
        if (
          durationSeconds !== after.plan.durationSeconds ||
          JSON.stringify(before.hashes) !== JSON.stringify(after.hashes)
        )
          fail("PROJECT_CHANGED");
        const latestLibrary = await loadTrustedAudioLibrary(directory).catch(() =>
          fail("ASSET_CHANGED"),
        );
        if (
          JSON.stringify(publicAudioCatalog(library)) !==
          JSON.stringify(publicAudioCatalog(latestLibrary))
        )
          fail("ASSET_CHANGED");
        await picker.verify().catch(() => fail("ASSET_CHANGED"));
        try {
          if ((await realpath(host.libraryRoot())) !== directory) fail("ASSET_CHANGED");
        } catch {
          fail("ASSET_CHANGED");
        }
        // The final probes may race a source replacement with the same duration.
        // Rehash every actual native/clean source after all library work.
        for (const [path, sha] of Object.entries(after.hashes))
          if ((await exportFileHash(path).catch(() => "")) !== sha) fail("PROJECT_CHANGED");
        await current();
        const limitations = [...context.limitations, ...compiled.limitations];
        const take = selected(base, request);
        const nativePath = after.paths[`video:${request.shotId}:${request.takeId}`];
        if (!nativePath) fail("PROJECT_CHANGED");
        const visualPath =
          typeof take.cleanVideoPath === "string" && take.cleanVideoPath
            ? await realpath(mediaUrlPath(take.cleanVideoPath))
            : nativePath;
        if (!after.hashes[nativePath] || !after.hashes[visualPath]) fail("PROJECT_CHANGED");
        // This is reviewed creative intent, not a write token. Fresh complete raw hashes
        // still guard every read above and are returned separately for the next CAS.
        const planFingerprint = createHash("sha256")
          .update(
            JSON.stringify({
              version: "shot-audio-suggestion-v1",
              target: { projectId: project, shotId: request.shotId, takeId: request.takeId },
              context: context.semantic,
              mix: audioMixSettings(base.audioMix),
              catalog: library.manifestSha256,
              picker: picker.sha256,
              durationSeconds,
              sources: {
                native: {
                  sha256: after.hashes[nativePath],
                  clock: after.sources[`video:${request.shotId}:${request.takeId}`],
                },
                visual: { sha256: after.hashes[visualPath], durationSeconds },
              },
              clips: compiled.clips,
              warnings: compiled.warnings,
              limitations,
            }),
          )
          .digest("hex");
        return {
          kind: "SUGGESTED",
          projectId: project,
          shotId: request.shotId,
          takeId: request.takeId,
          projectHash: request.expectedProjectHash,
          durationSeconds,
          catalogSha256: library.manifestSha256,
          pickerSha256: picker.sha256,
          planFingerprint,
          ...compiled,
          limitations,
        };
      } catch (error) {
        if (error instanceof ShotAudioSuggestionLimit)
          return {
            kind: "FAILED",
            code: "PLAN_UNSUPPORTED",
            unchanged: true,
            reason: "TRACK_LIMIT",
            maxSegments: error.maxSegments,
            minimumRequiredSegments: error.minimumRequiredSegments,
          };
        const result = failure(error);
        return ["WRITE_FAILED", "WRITE_UNCONFIRMED"].includes(result.code)
          ? { kind: "FAILED", code: "PLAN_UNSUPPORTED", unchanged: true }
          : result;
      } finally {
        if (acquired) active.delete(project);
      }
    },
    async inspectBundledFilmAudioTarget(value): Promise<InspectBundledFilmAudioTargetResult> {
      let project = "",
        acquired = false;
      try {
        const request = targetInput(value);
        project = request.projectId;
        if (active.has(project)) fail("BUSY");
        active.add(project);
        acquired = true;
        const current = async () => {
          const record = await readProject(host.filmsRoot, project);
          if (
            !record ||
            record.id !== project ||
            filmHistoryRecordHash(record) !== request.expectedProjectHash
          )
            fail("PROJECT_CHANGED");
          selected(record, request);
          return record;
        };
        const base = await current();
        const tools = await host.tools().catch(() => fail("TOOLS_UNAVAILABLE"));
        const before = await selectedSources(base, request, tools).catch(() =>
          fail("SOURCE_UNVERIFIED"),
        );
        const after = await selectedSources(await current(), request, tools).catch(() =>
          fail("PROJECT_CHANGED"),
        );
        if (!(before.plan.durationSeconds > 0) || !Number.isFinite(before.plan.durationSeconds))
          fail("SOURCE_UNVERIFIED");
        if (
          before.plan.durationSeconds !== after.plan.durationSeconds ||
          JSON.stringify(before.hashes) !== JSON.stringify(after.hashes)
        )
          fail("PROJECT_CHANGED");
        for (const [path, sha] of Object.entries(after.hashes))
          if ((await exportFileHash(path).catch(() => "")) !== sha) fail("PROJECT_CHANGED");
        await current();
        return {
          kind: "TARGET",
          projectId: project,
          shotId: request.shotId,
          takeId: request.takeId,
          projectHash: request.expectedProjectHash,
          durationSeconds: after.plan.durationSeconds,
        };
      } catch (error) {
        return failure(error);
      } finally {
        if (acquired) active.delete(project);
      }
    },
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
        selected(base, request);
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
        const visual = await selectedSources(base, request, tools).catch(() =>
          fail("SOURCE_UNVERIFIED"),
        );
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
          const latestSources = await selectedSources(current, request, tools).catch(() =>
            fail("PROJECT_CHANGED"),
          );
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

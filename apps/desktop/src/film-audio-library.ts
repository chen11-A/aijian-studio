import {
  audioSuggestionMemberInput,
  audioSuggestionMemberSetInput,
} from "@aijian/contracts/film-audio-suggestion-group";
import { resolveAudioMix } from "./film-audio-mix-sources";
import { sceneAudioSelectionInput } from "@aijian/contracts/film-scene-audio-binding";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import type {
  ApplyBundledFilmShotAudioInput,
  ApplyBundledFilmSceneAudioInput,
  SuggestBundledFilmSceneAudioInput,
  SuggestBundledFilmSceneAudioResult,
  ApplyBundledFilmShotAudioResult,
  AudioSuggestionReceipt,
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
import { audioMixArgs, audioMixCommandLength, probeMixSource } from "./film-audio-mix";
import {
  loadTrustedAudioLibrary,
  publicAudioCatalog,
  loadTrustedAudioPicker,
} from "./film-audio-library-runtime";
import type { QcRunner, QcTools } from "./film-export-qc-runtime";
import {
  shotAudioContext,
  sceneAudioContext,
  compileSceneAudioSuggestion,
  compileShotAudioSuggestion,
  ShotAudioSuggestionLimit,
} from "./film-shot-audio-suggestions";
const object = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const exact = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).sort().join() === keys.sort().join();
class SceneAudioScopeError extends Error {
  constructor(readonly reason: "GLOBAL_CLOCK_UNAVAILABLE" | "SCENE_ORDER_UNSUPPORTED") {
    super("PLAN_UNSUPPORTED");
  }
}
const failure = (error: unknown): FilmAudioLibraryFailure =>
  error instanceof SceneAudioScopeError
    ? { kind: "FAILED", code: "PLAN_UNSUPPORTED", unchanged: true, reason: error.reason }
    : {
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
      };
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

function applyInput(value: unknown): ApplyBundledFilmShotAudioInput {
  const row = object(value);
  if (
    !row ||
    !exact(row, [
      "projectId",
      "expectedProjectHash",
      "shotId",
      "takeId",
      "catalogSha256",
      "pickerSha256",
      "planFingerprint",
      "lanes",
    ]) ||
    ![row.catalogSha256, row.pickerSha256, row.planFingerprint].every(
      (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v),
    ) ||
    !Array.isArray(row.lanes) ||
    row.lanes.length < 1 ||
    row.lanes.length > 3 ||
    new Set(row.lanes).size !== row.lanes.length ||
    row.lanes.some((v) => typeof v !== "string" || !["ambience", "sfx", "score"].includes(v))
  )
    fail("INVALID_INPUT");
  const target = targetInput({
    projectId: row.projectId,
    expectedProjectHash: row.expectedProjectHash,
    shotId: row.shotId,
    takeId: row.takeId,
  });
  return {
    ...target,
    catalogSha256: String(row.catalogSha256),
    pickerSha256: String(row.pickerSha256),
    planFingerprint: String(row.planFingerprint),
    lanes: [...row.lanes] as ApplyBundledFilmShotAudioInput["lanes"],
  };
}
function sceneInput(
  value: unknown,
  apply = false,
): SuggestBundledFilmSceneAudioInput | ApplyBundledFilmSceneAudioInput {
  const row = object(value);
  const keys = ["projectId", "expectedProjectHash", "sceneId", "expectedSelection"];
  if (
    !row ||
    !exact(
      row,
      apply ? [...keys, "catalogSha256", "pickerSha256", "planFingerprint", "lanes"] : keys,
    ) ||
    typeof row.projectId !== "string" ||
    !/^film_[a-z0-9]{16,40}$/.test(row.projectId) ||
    typeof row.expectedProjectHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(row.expectedProjectHash) ||
    typeof row.sceneId !== "string" ||
    !row.sceneId ||
    row.sceneId.length > 160 ||
    row.sceneId.includes("\0") ||
    !Array.isArray(row.expectedSelection) ||
    !row.expectedSelection.length ||
    row.expectedSelection.length > 128 ||
    row.expectedSelection.some((raw) => {
      const pair = object(raw);
      return (
        !pair ||
        !exact(pair, ["shotId", "takeId"]) ||
        ![pair.shotId, pair.takeId].every(
          (id) => typeof id === "string" && id.length > 0 && id.length <= 160 && !id.includes("\0"),
        )
      );
    }) ||
    new Set(row.expectedSelection.map((raw) => object(raw)?.shotId)).size !==
      row.expectedSelection.length
  )
    fail("INVALID_INPUT");
  if (
    apply &&
    (![row.catalogSha256, row.pickerSha256, row.planFingerprint].every(
      (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v),
    ) ||
      !Array.isArray(row.lanes) ||
      !row.lanes.length ||
      row.lanes.length > 3 ||
      new Set(row.lanes).size !== row.lanes.length ||
      row.lanes.some((v) => !["ambience", "sfx", "score"].includes(String(v))))
  )
    fail("INVALID_INPUT");
  return structuredClone(row) as unknown as
    SuggestBundledFilmSceneAudioInput | ApplyBundledFilmSceneAudioInput;
}
function sceneSelection(record: FilmRecord, request: SuggestBundledFilmSceneAudioInput) {
  if (Array.isArray(record.shots) && record.shots.length !== request.expectedSelection.length)
    throw new SceneAudioScopeError("GLOBAL_CLOCK_UNAVAILABLE");
  if (
    !Array.isArray(record.shots) ||
    !Array.isArray(record.scenes) ||
    record.scenes.filter((raw) => object(raw)?.id === request.sceneId).length !== 1
  )
    fail("PROJECT_CHANGED");
  const ids = new Set<string>();
  return request.expectedSelection.map((pair, index) => {
    const shot = object(record.shots![index]);
    if (
      !shot ||
      shot.id !== pair.shotId ||
      typeof shot.sceneId !== "string" ||
      ids.has(pair.shotId)
    )
      fail("PROJECT_CHANGED");
    ids.add(pair.shotId);
    const take = selected(record, pair);
    return {
      ...pair,
      videoPath: String(take.videoPath),
      ...(typeof take.cleanVideoPath === "string" && take.cleanVideoPath
        ? { visualPath: take.cleanVideoPath }
        : {}),
    };
  });
}
const digest = (input: string) => createHash("sha256").update(input).digest("hex");
const projectBusy = (record: FilmRecord) =>
  (Array.isArray(record.jobs) &&
    record.jobs.some((row) => ["queued", "running"].includes(String(object(row)?.status)))) ||
  object(record.productionPipeline)?.status === "running";
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
  audioOwner?: (
    projectId: string,
    path: string,
    sha256: string,
    selected?: { path: string; sha: string },
  ) => Promise<boolean>;
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
  async function compileSuggestion(
    request: InspectBundledFilmAudioTargetInput,
  ): Promise<Extract<SuggestBundledFilmShotAudioResult, { kind: "SUGGESTED" }>> {
    const project = request.projectId;
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
  }
  async function compileSceneSuggestion(
    request: SuggestBundledFilmSceneAudioInput,
  ): Promise<Extract<SuggestBundledFilmSceneAudioResult, { kind: "SCENE_SUGGESTED" }>> {
    const current = async () => {
      const record = await readProject(host.filmsRoot, request.projectId);
      if (
        !record ||
        record.id !== request.projectId ||
        filmHistoryRecordHash(record) !== request.expectedProjectHash
      )
        fail("PROJECT_CHANGED");
      sceneSelection(record, request);
      return record;
    };
    const base = await current();
    const tools = await host.tools().catch(() => fail("TOOLS_UNAVAILABLE"));
    const resolve = (record: FilmRecord) =>
      resolveAudioMix({ ...record, audioClips: [] }, sceneSelection(record, request), {
        filmsRoot: host.filmsRoot,
        storyFilmsRoot: host.storyFilmsRoot,
        tools,
        run: host.run,
        videoOwner: host.videoOwner,
      });
    const before = await resolve(base).catch(() => fail("SOURCE_UNVERIFIED"));
    const clock = before.plan.shots.map((shot, index) => ({
      shotId: shot.shotId,
      takeId: shot.takeId,
      sceneId: String(object(base.shots![index])?.sceneId),
      startSeconds: shot.startSeconds,
      durationSeconds: shot.durationSeconds,
    }));
    const rows = clock.map((shot, index) => ({
      ...shot,
      nativeSha256: before.selectedSources[index]!.native.sha256,
      visualSha256: before.selectedSources[index]!.visual.sha256,
    }));
    let selectionInput: string;
    try {
      selectionInput = sceneAudioSelectionInput(request.sceneId, rows);
    } catch {
      throw new SceneAudioScopeError("SCENE_ORDER_UNSUPPORTED");
    }
    const target = clock.filter((shot) => shot.sceneId === request.sceneId);
    const sceneStartSeconds = target[0]!.startSeconds;
    const windows = target.map((shot) => ({
      ...shot,
      startSeconds: shot.startSeconds - sceneStartSeconds,
    }));
    const context = sceneAudioContext(base, windows);
    const directory = await Promise.resolve()
      .then(() => host.libraryRoot())
      .then((path) => realpath(path))
      .catch(() => fail("LIBRARY_UNAVAILABLE"));
    const library = await loadTrustedAudioLibrary(directory).catch(() =>
      fail("LIBRARY_UNAVAILABLE"),
    );
    const picker = await loadTrustedAudioPicker(directory).catch(() => fail("LIBRARY_UNAVAILABLE"));
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
    const compiled = compileSceneAudioSuggestion(
      raw,
      library,
      windows,
      context.allowMusic,
      128 - before.plan.tracks.length,
    );
    const after = await resolve(await current()).catch(() => fail("PROJECT_CHANGED"));
    if (
      JSON.stringify(before.selectedSources) !== JSON.stringify(after.selectedSources) ||
      JSON.stringify(before.plan.shots) !== JSON.stringify(after.plan.shots) ||
      JSON.stringify(before.hashes) !== JSON.stringify(after.hashes)
    )
      fail("PROJECT_CHANGED");
    const finalLibrary = await loadTrustedAudioLibrary(directory).catch(() =>
      fail("ASSET_CHANGED"),
    );
    if (
      JSON.stringify(publicAudioCatalog(library)) !==
      JSON.stringify(publicAudioCatalog(finalLibrary))
    )
      fail("ASSET_CHANGED");
    await picker.verify().catch(() => fail("ASSET_CHANGED"));
    if ((await realpath(host.libraryRoot()).catch(() => "")) !== directory) fail("ASSET_CHANGED");
    for (const [path, sha] of Object.entries(after.hashes))
      if ((await exportFileHash(path).catch(() => "")) !== sha) fail("PROJECT_CHANGED");
    await current();
    const limitations = [...context.limitations, ...compiled.limitations];
    const sceneAudioBinding = {
      schemaVersion: 1 as const,
      sceneId: request.sceneId,
      selectionSha256: digest(selectionInput),
    };
    const planFingerprint = digest(
      JSON.stringify({
        version: "scene-audio-suggestion-v1",
        projectId: request.projectId,
        sceneId: request.sceneId,
        context: context.semantic,
        mix: audioMixSettings(base.audioMix),
        catalog: library.manifestSha256,
        picker: picker.sha256,
        selection: JSON.parse(selectionInput),
        clips: compiled.clips,
        warnings: compiled.warnings,
        limitations,
      }),
    );
    return {
      kind: "SCENE_SUGGESTED",
      projectId: request.projectId,
      sceneId: request.sceneId,
      projectHash: request.expectedProjectHash,
      catalogSha256: library.manifestSha256,
      pickerSha256: picker.sha256,
      planFingerprint,
      clock: { durationSeconds: before.plan.durationSeconds, shots: clock },
      sceneStartSeconds,
      sceneDurationSeconds: windows.reduce((sum, shot) => sum + shot.durationSeconds, 0),
      sceneAudioBinding,
      ...compiled,
      limitations,
    };
  }
  async function applySuggestion(
    value: unknown,
    scene: boolean,
  ): Promise<ApplyBundledFilmShotAudioResult> {
    let project = "",
      folder = "",
      acquired = false,
      writeStarted = false,
      retain = false;
    const pendingIds = new Set<string>();
    try {
      const request = scene
        ? (sceneInput(value, true) as ApplyBundledFilmSceneAudioInput)
        : applyInput(value);
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
      if (projectBusy(base)) fail("BUSY");
      const recompile = () =>
        "sceneId" in request ? compileSceneSuggestion(request) : compileSuggestion(request);
      const proposal = await recompile();
      const matches = (result: typeof proposal) => {
        if (
          result.catalogSha256 !== request.catalogSha256 ||
          result.pickerSha256 !== request.pickerSha256
        )
          fail("ASSET_CHANGED");
        if (result.planFingerprint !== request.planFingerprint) fail("PROJECT_CHANGED");
      };
      matches(proposal);
      const clips = proposal.clips.filter((clip) => request.lanes.includes(clip.lane));
      if (!clips.length) fail("PLAN_UNSUPPORTED");
      const directory = await realpath(host.libraryRoot()).catch(() => fail("LIBRARY_UNAVAILABLE"));
      const library = await loadTrustedAudioLibrary(directory).catch(() => fail("ASSET_CHANGED"));
      const picker = await loadTrustedAudioPicker(directory).catch(() => fail("ASSET_CHANGED"));
      if (
        library.manifestSha256 !== request.catalogSha256 ||
        picker.sha256 !== request.pickerSha256
      )
        fail("ASSET_CHANGED");
      const local = await episode(base).catch(() => fail("SOURCE_UNVERIFIED"));
      const media = join(local, "media");
      await mkdir(media, { recursive: true });
      if (relative(local, await realpath(media)) !== "media") fail("SOURCE_UNVERIFIED");
      folder = await mkdtemp(join(media, ".audio-suggestion-"));
      const copies = new Map<string, string>();
      const groupId = `audio-group-${randomUUID()}`;
      const additions = [];
      for (const clip of clips) {
        const asset = library.assets.find(
          (asset) => asset.id === clip.asset.id && asset.sha256 === clip.asset.sha256,
        );
        if (!asset) fail("ASSET_CHANGED");
        const identity = JSON.stringify([asset.id, asset.sha256]);
        let path = copies.get(identity);
        if (!path) {
          path = join(folder, `${copies.size}.ogg`);
          await copyExportFile(asset.file, path);
          if (
            (await exportFileHash(path)) !== asset.sha256 ||
            (await exportFileHash(asset.file)) !== asset.sha256
          )
            fail("ASSET_CHANGED");
          copies.set(identity, path);
        }
        const id = `audio-${randomUUID()}`;
        pendingIds.add(id);
        additions.push({
          id,
          lane: clip.lane,
          shotId:
            "shotId" in clip ? String(clip.shotId) : "shotId" in request ? request.shotId : "",
          takeId:
            "takeId" in clip ? String(clip.takeId) : "takeId" in request ? request.takeId : "",
          ...("sceneAudioBinding" in proposal
            ? { sceneAudioBinding: proposal.sceneAudioBinding }
            : {}),
          label: asset.name,
          ...clip.placement,
          ...(clip.envelope ? { envelope: structuredClone(clip.envelope) } : {}),
          enabled: true,
          path,
          libraryAsset: asset.provenance,
          key: clip.key,
        });
      }
      const members = additions.map((clip) => ({
        key: clip.key,
        clipId: clip.id,
        creativeSha256: digest(audioSuggestionMemberInput(clip)),
      }));
      const receipt: AudioSuggestionReceipt = {
        schemaVersion: 1,
        groupId,
        planFingerprint: proposal.planFingerprint,
        memberCount: members.length,
        memberSetSha256: digest(audioSuggestionMemberSetInput(members)),
        members,
      };
      const persistent = additions.map(({ key, ...clip }) => ({
        ...clip,
        suggestionGroup: {
          schemaVersion: 1 as const,
          groupId,
          planFingerprint: receipt.planFingerprint,
          key,
          memberCount: receipt.memberCount,
          memberSetSha256: receipt.memberSetSha256,
        },
      }));
      const tools = await host.tools().catch(() => fail("TOOLS_UNAVAILABLE"));
      await host.beforeCommit?.();
      return await transactFilmProject(host.filmsRoot, project, async (current, write) => {
        if (
          !current ||
          current.id !== project ||
          filmHistoryRecordHash(current) !== request.expectedProjectHash ||
          projectBusy(current) ||
          (await episode(current)) !== local
        )
          fail("PROJECT_CHANGED");
        if ("sceneId" in request) sceneSelection(current, request);
        else selected(current, request);
        if ((await realpath(host.libraryRoot())) !== directory) fail("ASSET_CHANGED");
        // Recompile the reviewed entire plan; lane selection never clips its segments.
        matches(await recompile());
        const next = {
          ...current,
          audioClips: [
            ...(Array.isArray(current.audioClips) ? current.audioClips : []),
            ...persistent,
          ],
        };
        const choices =
          "sceneId" in request
            ? sceneSelection(current, request)
            : (() => {
                const take = selected(current, request);
                return [
                  {
                    shotId: request.shotId,
                    takeId: request.takeId,
                    videoPath: String(take.videoPath),
                    ...(typeof take.cleanVideoPath === "string"
                      ? { visualPath: take.cleanVideoPath }
                      : {}),
                  },
                ];
              })();
        const resolved = await resolveAudioMix(next, choices, {
          filmsRoot: host.filmsRoot,
          storyFilmsRoot: host.storyFilmsRoot,
          tools,
          run: host.run,
          videoOwner: host.videoOwner,
          audioOwner: host.audioOwner,
        }).catch((error: unknown) => {
          if (error instanceof Error && error.message === "SOURCE_UNVERIFIED")
            fail("SOURCE_UNVERIFIED");
          if (error instanceof Error && error.message === "SOURCE_CHANGED") fail("PROJECT_CHANGED");
          fail("PLAN_UNSUPPORTED");
        });
        // Validate real source windows, including every selected segment, rather than silently trimming.
        for (const clip of persistent) {
          const track = resolved.plan.tracks.find((track) => track.key === clip.id);
          if (
            clip.gainDb > -40 &&
            !audioMixSettings(current.audioMix).lanes[clip.lane].muted &&
            (!track ||
              Math.abs(track.endSeconds - track.startSeconds - clip.durationSeconds) > 0.000001)
          )
            fail("PLACEMENT_UNSUPPORTED");
        }
        const nativePath = resolved.paths[`video:${choices[0]!.shotId}:${choices[0]!.takeId}`];
        if (!nativePath) fail("SOURCE_UNVERIFIED");
        const args = audioMixArgs(
          nativePath,
          join(folder, "output.mp4"),
          resolved.plan,
          resolved.paths,
        );
        const filter = args.indexOf("-filter_complex");
        if (filter >= 0) {
          args[filter] = "-filter_complex_script";
          args[filter + 1] = join(folder, "filter.txt");
        }
        if (audioMixCommandLength(tools.ffmpegPath, args) > 30000) fail("PLAN_UNSUPPORTED");
        await picker.verify().catch(() => fail("ASSET_CHANGED"));
        const finalCatalog = await loadTrustedAudioLibrary(directory).catch(() =>
          fail("ASSET_CHANGED"),
        );
        if (
          JSON.stringify(publicAudioCatalog(finalCatalog)) !==
            JSON.stringify(publicAudioCatalog(library)) ||
          (await realpath(host.libraryRoot())) !== directory
        )
          fail("ASSET_CHANGED");
        for (const [path, sha] of Object.entries(resolved.hashes))
          if ((await exportFileHash(path)) !== sha) fail("PROJECT_CHANGED");
        const finalRecord = await readProject(host.filmsRoot, project);
        if (
          !finalRecord ||
          finalRecord.id !== project ||
          filmHistoryRecordHash(finalRecord) !== request.expectedProjectHash
        )
          fail("PROJECT_CHANGED");
        writeStarted = true;
        const stored = await write(next);
        retain = true;
        const actual = await readProject(host.filmsRoot, project);
        if (!actual || filmHistoryRecordHash(actual) !== filmHistoryRecordHash(stored))
          fail("WRITE_UNCONFIRMED");
        return { kind: "ADDED" as const, project: actual, receipt };
      });
    } catch (error) {
      if (writeStarted) {
        const current = await readProject(host.filmsRoot, project).catch(() => undefined);
        if (
          retain ||
          !current ||
          current.id !== project ||
          (Array.isArray(current.audioClips) &&
            current.audioClips.some((clip) => pendingIds.has(String(object(clip)?.id))))
        ) {
          retain = true;
          return { kind: "FAILED", code: "WRITE_UNCONFIRMED", unchanged: false };
        }
      }
      if (error instanceof ShotAudioSuggestionLimit)
        return {
          kind: "FAILED",
          code: "PLAN_UNSUPPORTED",
          unchanged: true,
          reason: "TRACK_LIMIT",
          maxSegments: error.maxSegments,
          minimumRequiredSegments: error.minimumRequiredSegments,
        };
      return failure(error);
    } finally {
      if (folder && !retain)
        await rm(folder, { recursive: true, force: true }).catch(() => undefined);
      if (acquired) active.delete(project);
    }
  }
  return {
    applyBundledFilmShotAudio: (value) => applySuggestion(value, false),
    applyBundledFilmSceneAudio: (value) => applySuggestion(value, true),
    async suggestBundledFilmSceneAudio(value): Promise<SuggestBundledFilmSceneAudioResult> {
      let project = "",
        acquired = false;
      try {
        const request = sceneInput(value);
        project = request.projectId;
        if (active.has(project)) fail("BUSY");
        active.add(project);
        acquired = true;
        return await compileSceneSuggestion(request);
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
        return failure(error);
      } finally {
        if (acquired) active.delete(project);
      }
    },
    async suggestBundledFilmShotAudio(value): Promise<SuggestBundledFilmShotAudioResult> {
      let project = "",
        acquired = false;
      try {
        const request = targetInput(value);
        project = request.projectId;
        if (active.has(project)) fail("BUSY");
        active.add(project);
        acquired = true;
        return await compileSuggestion(request);
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

import { realpathSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  stat,
  lstat,
  readdir,
  rm,
  link,
} from "node:fs/promises";
import { join, dirname, basename, extname, relative, isAbsolute } from "node:path";
import type {
  FilmProjectArchiveInput,
  FilmProjectArchiveExport,
  FilmProjectArchiveImport,
  FilmProjectArchiveFailure,
} from "@aijian/contracts/film-project-archive";
import {
  readProject,
  writeProject,
  trustedMediaPath,
  mediaUrlPath,
  type FilmRecord,
} from "./film-library";
import { filmHistoryRecordText } from "./film-history";
import { exportFileHash, copyExportFile } from "./film-export-io";
import type { ProjectArchiveEngine } from "./film-project-archive-runtime";
type Row = Record<string, unknown>;
const object = (v: unknown): Row =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {};
const text = (v: unknown) => (typeof v === "string" ? v : "");
const id = /^film_[a-z0-9]{16,40}$/;
const sha = (v: unknown) => createHash("sha256").update(filmHistoryRecordText(v)).digest("hex");
const inside = (root: string, file: string) => {
  const rel = relative(root, file);
  return !!rel && !rel.startsWith("..") && !isAbsolute(rel);
};
function fail(code: FilmProjectArchiveFailure["code"]): never {
  throw Error(code);
}
const failure = (error: unknown): FilmProjectArchiveFailure => ({
  kind: "FAILED",
  code: ([
    "INVALID_INPUT",
    "BUSY",
    "PROJECT_CHANGED",
    "SOURCE_MISSING",
    "SOURCE_UNVERIFIED",
    "ARCHIVE_INVALID",
    "OUTPUT_EXISTS",
    "WRITE_FAILED",
    "RUNTIME_UNAVAILABLE",
  ].includes(error instanceof Error ? error.message : "")
    ? (error as Error).message
    : "WRITE_FAILED") as FilmProjectArchiveFailure["code"],
});
const newId = () => `film_${randomUUID().replaceAll("-", "")}`;
const projectKeys = new Set(
  "schemaVersion id seriesId seriesTitle episodeNo episodeTitle title stylePreset styleZh styleRevision characters scenes shots takesPerShot parallelism maxRetryRounds draft locations props sourceText narrationVoiceId audioClips audioMix aspectRatio subtitleStyle cover writerPlan artDesign artDesignBaseline reviewReports costumes costumeRisks unassignedBeats".split(
    " ",
  ),
);
const removeKeys =
  /^(?:backendProjectId|projectId|episodeId|directory|assemblyPath|assemblyUrl|exportPath|savedAt|jobs|pipeline|productionPipeline|productionInputFingerprint|waveform|interruptedFrom|__proto__|constructor|prototype|qcReceipt|receipt|operationId|idempotencyKey|requestId|taskId|access[_-]?token|refresh[_-]?token|api[_-]?key|authorization|cookie|password|secret|credentials?|voiceId|voiceCode|voiceDefault|narrationVoiceId)$/i;
const sensitiveKeys =
  /token|secret|credential|authorization|password|cookie|session|receipt|idempotency|api[_-]?key|(?:operation|execution|run|request|task)[_-]?id|(?:project|episode|account|artifact|assembly[_-]?version)[_-]?id|(?:source|owner|provenance)[_-]?proof/i;
const mediaKeys = new Set([
  "poster",
  "stillUrl",
  "videoUrl",
  "videoPath",
  "cleanVideoPath",
  "url",
  "referenceImage",
  "sourceVideoPath",
  "path",
  "backgroundUrl",
  "preview",
]);
/** Explicit project scope plus recursive removal of machine/account/execution bindings. */
export function portableProject(record: FilmRecord): FilmRecord {
  const clean = (value: unknown, depth = 0): unknown => {
    if (depth > 64) fail("ARCHIVE_INVALID");
    if (Array.isArray(value)) return value.map((v) => clean(v, depth + 1));
    if (value && typeof value === "object") {
      const row = object(value),
        result: Row = Object.create(null);
      for (const [key, item] of Object.entries(row)) {
        if (key === "reviewedVideoPrompt") {
          const review = object(item);
          // The cache key contains local project/voice identities. Only creative text is
          // portable; a new work must organize and confirm its own facts again.
          if (review.schemaVersion === 1 && typeof review.text === "string")
            result[key] = { schemaVersion: 1, text: review.text, factsKey: "" };
          continue;
        }
        if (!removeKeys.test(key) && !sensitiveKeys.test(key)) result[key] = clean(item, depth + 1);
      }
      return result;
    }
    if (typeof value === "number" && !Number.isFinite(value)) fail("ARCHIVE_INVALID");
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) return value;
    return null;
  };
  const selected = Object.fromEntries(
    Object.entries(record).filter(([key]) => projectKeys.has(key)),
  );
  const result = clean(selected) as FilmRecord;
  result.backendProjectId = "";
  result.jobs = [];
  result.assemblyPath = "";
  result.assemblyUrl = "";
  result.exportPath = "";
  result.directory = "";
  result.savedAt = "";
  result.narrationVoiceId = "";
  if (Array.isArray(result.shots))
    for (const value of result.shots) {
      const shot = object(value);
      if (Array.isArray(shot.takes))
        for (const value of shot.takes) {
          const take = object(value);
          if (["running", "queued", "blocked"].includes(text(take.status))) {
            take.status = "failed";
            take.reason = "导入的工程不会自动继续生成，请检查后手动操作。";
          }
          const lip = object(take.lipSync);
          if (lip.lipSync === "pending") {
            lip.lipSync = "failed";
            lip.lipSyncReason = "导入后没有继续口型处理，请检查后手动操作。";
          }
        }
    }
  return result;
}
async function mapMedia(
  value: unknown,
  resolve: (ref: string) => Promise<string>,
  depth = 0,
): Promise<unknown> {
  if (depth > 64) fail("ARCHIVE_INVALID");
  if (Array.isArray(value)) {
    const out = [];
    for (const v of value) out.push(await mapMedia(v, resolve, depth + 1));
    return out;
  }
  if (value && typeof value === "object") {
    const out: Row = Object.create(null);
    for (const [key, item] of Object.entries(object(value))) {
      if (mediaKeys.has(key) && typeof item === "string" && item) {
        // Session playback URLs are redundant when the take already has a canonical video path.
        if (key === "videoUrl" && text(object(value).videoPath)) {
          out[key] = "";
          continue;
        }
        out[key] = await resolve(item);
      } else out[key] = await mapMedia(item, resolve, depth + 1);
    }
    return out;
  }
  return value;
}
type Asset = { entry: string; sha256: string; bytes: number };
type Manifest = {
  schemaVersion: 1;
  kind: "aivora-film-project";
  projectSha256: string;
  assets: Asset[];
};
export type ProjectArchiveHost = {
  filmsRoot: string;
  storyFilmsRoot: string;
  temporaryRoot: string;
  engine: () => Promise<ProjectArchiveEngine>;
  pickExport: (title: string) => Promise<string | null>;
  pickImport: () => Promise<string | null>;
  storyOwner?: (backendProjectId: string, path: string, hash: string) => Promise<boolean>;
  read?: (id: string) => Promise<FilmRecord | null>;
  write?: (record: FilmRecord) => Promise<FilmRecord>;
  allocateIdentity?: () => { projectId: string; seriesId: string };
};
function assertProject(record: FilmRecord) {
  if (
    !id.test(record.id) ||
    !id.test(record.seriesId) ||
    !Array.isArray(record.scenes) ||
    !Array.isArray(record.shots) ||
    !Array.isArray(record.characters) ||
    !Array.isArray(record.audioClips)
  )
    fail("ARCHIVE_INVALID");
  const unique = (rows: unknown[]) => {
    const ids = rows.map((v) => text(object(v).id));
    return ids.every(Boolean) && new Set(ids).size === ids.length;
  };
  if (
    !unique(record.shots) ||
    !unique(record.scenes) ||
    !unique(record.characters) ||
    !unique(record.audioClips as unknown[])
  )
    fail("ARCHIVE_INVALID");
  for (const shot of record.shots) {
    const row = object(shot);
    if (
      !Array.isArray(row.takes) ||
      !unique(row.takes) ||
      !record.scenes.some((scene) => object(scene).id === row.sceneId)
    )
      fail("ARCHIVE_INVALID");
    if (row.takes.some((take) => object(take).shotId !== row.id)) fail("ARCHIVE_INVALID");
    if (
      text(row.selectedTakeId) &&
      !row.takes.some((take) => object(take).id === row.selectedTakeId)
    )
      fail("ARCHIVE_INVALID");
  }
}
async function listFiles(root: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  for (const name of await readdir(root)) {
    const file = join(root, name),
      info = await lstat(file);
    if (info.isDirectory()) out.push(...(await listFiles(file, `${prefix}${name}/`)));
    else if (info.isFile()) out.push(prefix + name);
    else fail("ARCHIVE_INVALID");
  }
  return out;
}
export function createProjectArchives(host: ProjectArchiveHost) {
  let busy = false;
  const read = host.read ?? ((projectId: string) => readProject(host.filmsRoot, projectId));
  const write = host.write ?? ((record: FilmRecord) => writeProject(host.filmsRoot, record));
  async function temporary() {
    await mkdir(host.temporaryRoot, { recursive: true });
    return mkdtemp(join(host.temporaryRoot, "project-package-"));
  }
  return {
    async export(value: unknown): Promise<FilmProjectArchiveExport> {
      if (busy) return failure(Error("BUSY"));
      busy = true;
      let stage = "",
        publishStage = "";
      try {
        const input = object(value);
        if (
          Object.keys(input).sort().join() !== "expectedHash,projectId" ||
          !id.test(text(input.projectId)) ||
          !/^[a-f0-9]{64}$/.test(text(input.expectedHash))
        )
          fail("INVALID_INPUT");
        const request = input as FilmProjectArchiveInput,
          base = await read(request.projectId);
        if (!base || base.id !== request.projectId || sha(base) !== request.expectedHash)
          fail("PROJECT_CHANGED");
        assertProject(base);
        const chosen = await host.pickExport(text(base.title));
        if (!chosen) return { kind: "CANCELLED" };
        const parent = realpathSync.native(dirname(chosen)),
          output = join(parent, basename(chosen));
        try {
          await lstat(output);
          fail("OUTPUT_EXISTS");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        let engine: ProjectArchiveEngine;
        try {
          engine = await host.engine();
        } catch {
          fail("RUNTIME_UNAVAILABLE");
        }
        stage = await temporary();
        const root = join(stage, "portable");
        await mkdir(join(root, "media"), { recursive: true });
        const series = realpathSync.native(join(host.filmsRoot, base.seriesId)),
          films = realpathSync.native(host.filmsRoot);
        if (relative(films, series) !== base.seriesId) fail("SOURCE_UNVERIFIED");
        let story = "";
        try {
          story = realpathSync.native(host.storyFilmsRoot);
        } catch {
          /* Optional story root. */
        }
        const assets = new Map<string, Asset>(),
          sources = new Map<string, string>();
        let total = 0;
        const record = (await mapMedia(portableProject(base), async (ref) => {
          if (ref.startsWith("data:")) {
            const match =
              /^data:(image\/(?:png|jpeg|webp)|audio\/(?:mpeg|wav)|video\/mp4);base64,([A-Za-z0-9+/=\s]+)$/.exec(
                ref,
              );
            if (!match || ref.length > 120 * 1024 * 1024) fail("SOURCE_MISSING");
            const bytes = Buffer.from(match[2]!.replace(/\s/g, ""), "base64");
            if (!bytes.length || bytes.length > 80 * 1024 * 1024) fail("SOURCE_MISSING");
            const hash = createHash("sha256").update(bytes).digest("hex"),
              extension = match[1]!.split("/")[1] === "mpeg" ? "mp3" : match[1]!.split("/")[1]!;
            const entry = `media/${hash}.${extension}`;
            if (!assets.has(entry)) {
              total += bytes.length;
              if (total > 8 * 1024 ** 3 || assets.size >= 9000) fail("ARCHIVE_INVALID");
              await writeFile(join(root, entry), bytes, { flag: "wx" });
              assets.set(entry, { entry, sha256: hash, bytes: bytes.length });
            }
            return `bundle:${entry}`;
          }
          let source: string;
          try {
            source = trustedMediaPath([series, ...(story ? [story] : [])], mediaUrlPath(ref));
          } catch {
            fail("SOURCE_MISSING");
          }
          const already = sources.get(source);
          if (already) return `bundle:media/${already}${extname(source).toLowerCase()}`;
          const info = await stat(source);
          if (!info.isFile() || info.size <= 0) fail("SOURCE_MISSING");
          const hash = await exportFileHash(source);
          const local =
            inside(join(series, "episodes", base.id), source) ||
            inside(join(series, "media"), source) ||
            inside(join(series, "music"), source) ||
            inside(join(series, "stills"), source);
          if (
            !local &&
            !(
              story &&
              inside(story, source) &&
              host.storyOwner &&
              (await host.storyOwner(text(base.backendProjectId), source, hash))
            )
          )
            fail("SOURCE_UNVERIFIED");
          const entry = `media/${hash}${extname(source).toLowerCase()}`;
          if (!assets.has(entry)) {
            total += info.size;
            if (total > 8 * 1024 ** 3 || assets.size >= 9000) fail("ARCHIVE_INVALID");
            await copyExportFile(source, join(root, entry));
            if ((await exportFileHash(join(root, entry))) !== hash) fail("PROJECT_CHANGED");
            assets.set(entry, { entry, sha256: hash, bytes: info.size });
          }
          sources.set(source, hash);
          return `bundle:${entry}`;
        })) as FilmRecord;
        const raw = JSON.stringify(record);
        if (Buffer.byteLength(raw) > 8_000_000) fail("ARCHIVE_INVALID");
        await writeFile(join(root, "project.json"), raw, { flag: "wx" });
        const manifest: Manifest = {
          schemaVersion: 1,
          kind: "aivora-film-project",
          projectSha256: await exportFileHash(join(root, "project.json")),
          assets: [...assets.values()],
        };
        await writeFile(join(root, "manifest.json"), JSON.stringify(manifest), { flag: "wx" });
        const archive = await engine.archiveProject({
          projectDir: root,
          output: join(stage, "project.zip"),
        });
        for (const [source, hash] of sources)
          if ((await exportFileHash(source)) !== hash) fail("PROJECT_CHANGED");
        if (sha(await read(request.projectId)) !== request.expectedHash) fail("PROJECT_CHANGED");
        publishStage = await mkdtemp(join(parent, ".aivora-package-"));
        const publishTemp = join(publishStage, "package.zip");
        await copyExportFile(archive, publishTemp);
        if ((await exportFileHash(archive)) !== (await exportFileHash(publishTemp)))
          fail("WRITE_FAILED");
        if (sha(await read(request.projectId)) !== request.expectedHash) fail("PROJECT_CHANGED");
        try {
          await link(publishTemp, output);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EEXIST") fail("OUTPUT_EXISTS");
          throw error;
        }
        return { kind: "EXPORTED", mediaCount: assets.size };
      } catch (error) {
        return failure(error);
      } finally {
        await Promise.allSettled([
          publishStage ? rm(publishStage, { recursive: true, force: true }) : Promise.resolve(),
          stage ? rm(stage, { recursive: true, force: true }) : Promise.resolve(),
        ]);
        busy = false;
      }
    },
    async import(): Promise<FilmProjectArchiveImport> {
      if (busy) return failure(Error("BUSY"));
      busy = true;
      let stage = "",
        reservation = "";
      try {
        const archive = await host.pickImport();
        if (!archive) return { kind: "CANCELLED" };
        let engine: ProjectArchiveEngine;
        try {
          engine = await host.engine();
        } catch {
          fail("RUNTIME_UNAVAILABLE");
        }
        stage = await temporary();
        const unpacked = join(stage, "unpacked");
        try {
          await engine.restoreProject({ archive, destination: unpacked });
        } catch {
          fail("ARCHIVE_INVALID");
        }
        const manifestPath = join(unpacked, "manifest.json"),
          projectPath = join(unpacked, "project.json");
        if (
          (await stat(manifestPath)).size > 4_000_000 ||
          (await stat(projectPath)).size > 8_000_000
        )
          fail("ARCHIVE_INVALID");
        const manifest = object(JSON.parse(await readFile(manifestPath, "utf8")));
        if (
          manifest.schemaVersion !== 1 ||
          manifest.kind !== "aivora-film-project" ||
          !Array.isArray(manifest.assets) ||
          manifest.assets.length > 9000 ||
          !/^[a-f0-9]{64}$/.test(text(manifest.projectSha256))
        )
          fail("ARCHIVE_INVALID");
        if ((await exportFileHash(projectPath)) !== manifest.projectSha256) fail("ARCHIVE_INVALID");
        const assets = new Map<string, Asset>();
        let total = 0;
        for (const value of manifest.assets) {
          const row = object(value),
            entry = text(row.entry),
            hash = text(row.sha256);
          if (
            !/^media\/[a-f0-9]{64}\.(mp4|png|jpe?g|webp|wav|mp3|ogg)$/.test(entry) ||
            !entry.includes(hash) ||
            !/^[a-f0-9]{64}$/.test(hash) ||
            assets.has(entry) ||
            typeof row.bytes !== "number" ||
            !Number.isSafeInteger(row.bytes) ||
            row.bytes <= 0
          )
            fail("ARCHIVE_INVALID");
          const file = join(unpacked, entry);
          if ((await stat(file)).size !== row.bytes || (await exportFileHash(file)) !== hash)
            fail("ARCHIVE_INVALID");
          total += row.bytes;
          if (total > 8 * 1024 ** 3) fail("ARCHIVE_INVALID");
          assets.set(entry, { entry, sha256: hash, bytes: row.bytes });
        }
        const files = await listFiles(unpacked),
          allowed = new Set(["manifest.json", "project.json", ...assets.keys()]);
        if (files.length !== allowed.size || files.some((f) => !allowed.has(f)))
          fail("ARCHIVE_INVALID");
        const record = portableProject(
          JSON.parse(await readFile(projectPath, "utf8")) as FilmRecord,
        );
        assertProject(record);
        const { projectId, seriesId } = host.allocateIdentity?.() ?? {
          projectId: newId(),
          seriesId: newId(),
        };
        if (!id.test(projectId) || !id.test(seriesId) || projectId === seriesId)
          fail("INVALID_INPUT");
        await mkdir(host.filmsRoot, { recursive: true });
        const candidate = join(realpathSync.native(host.filmsRoot), seriesId);
        try {
          await mkdir(candidate, { mode: 0o700 });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EEXIST") fail("OUTPUT_EXISTS");
          throw error;
        }
        reservation = candidate;
        const folder = join(reservation, "episodes", projectId, "media");
        await mkdir(folder, { recursive: true });
        for (const asset of assets.values()) {
          const target = join(folder, basename(asset.entry));
          await copyExportFile(join(unpacked, asset.entry), target);
          if ((await exportFileHash(target)) !== asset.sha256) fail("ARCHIVE_INVALID");
        }
        const referenced = new Set<string>();
        const restored = (await mapMedia(record, async (ref) => {
          if (!ref.startsWith("bundle:")) fail("ARCHIVE_INVALID");
          const entry = ref.slice(7);
          if (!assets.has(entry)) fail("ARCHIVE_INVALID");
          referenced.add(entry);
          return join(folder, basename(entry));
        })) as FilmRecord;
        if (referenced.size !== assets.size) fail("ARCHIVE_INVALID");
        restored.id = projectId;
        restored.seriesId = seriesId;
        restored.seriesTitle = `${text(restored.seriesTitle) || text(restored.title) || "未命名作品"}（导入）`;
        const saved = await write(restored);
        if (saved.id !== projectId || saved.seriesId !== seriesId) fail("WRITE_FAILED");
        reservation = "";
        return { kind: "IMPORTED", projectId, mediaCount: assets.size };
      } catch (error) {
        if (
          stage &&
          !reservation &&
          ![
            "INVALID_INPUT",
            "BUSY",
            "OUTPUT_EXISTS",
            "ARCHIVE_INVALID",
            "RUNTIME_UNAVAILABLE",
          ].includes(error instanceof Error ? error.message : "")
        )
          return failure(Error("ARCHIVE_INVALID"));
        return failure(error);
      } finally {
        await Promise.allSettled([
          reservation ? rm(reservation, { recursive: true, force: true }) : Promise.resolve(),
          stage ? rm(stage, { recursive: true, force: true }) : Promise.resolve(),
        ]);
        busy = false;
      }
    },
  };
}
export function registerProjectArchives<T>(
  handle: (channel: string, listener: (event: T, ...args: unknown[]) => Promise<unknown>) => void,
  authorized: (event: T) => boolean,
  host: ProjectArchiveHost,
) {
  const archive = createProjectArchives(host);
  handle("film:project-archive-export", async (event, ...args) =>
    !authorized(event) || args.length !== 1
      ? failure(Error("INVALID_INPUT"))
      : archive.export(args[0]),
  );
  handle("film:project-archive-import", async (event, ...args) =>
    !authorized(event) || args.length !== 0 ? failure(Error("INVALID_INPUT")) : archive.import(),
  );
}

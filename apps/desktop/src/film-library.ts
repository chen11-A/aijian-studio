import { randomBytes } from "node:crypto";
import { realpathSync } from "node:fs";
import { copyFile, mkdir, open, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, extname, join, resolve, sep } from "node:path";

export const IMAGE_MODEL = "grok-imagine-image-2.0";
const IMAGE_URL = "https://api.x.ai/v1/images/generations";
const idPattern = /^film_[a-z0-9]{16,40}$/;
const mediaExtensions = new Set([".mp4", ".png", ".jpg", ".jpeg", ".webp", ".wav", ".mp3"]);
const maxMediaBytes = 80 * 1024 * 1024;
const maxStillBytes = 12 * 1024 * 1024;

export type FilmRecord = {
  id: string;
  seriesId: string;
  title?: string;
  seriesTitle?: string;
  episodeNo?: number;
  episodeTitle?: string;
  shots?: unknown[];
  savedAt?: string;
  directory?: string;
  assemblyUrl?: string;
  [key: string]: unknown;
};

export type SeriesEntry = {
  id: string;
  title: string;
  savedAt: string;
  path: string;
};

export type EpisodeEntry = {
  id: string;
  seriesId: string;
  title: string;
  no: number;
  shots: number;
  done: number;
  savedAt: string;
};

type IndexFile = { series: SeriesEntry[] };

function assertId(value: string): string {
  if (!idPattern.test(value)) throw new Error("Invalid film");
  return value;
}

function seriesDir(root: string, seriesId: string): string {
  return join(root, assertId(seriesId));
}

function episodePath(root: string, seriesId: string, episodeId: string): string {
  return join(seriesDir(root, seriesId), "episodes", assertId(episodeId), "project.json");
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

async function readIndex(root: string): Promise<SeriesEntry[]> {
  const index = await readJson<IndexFile>(join(root, "index.json"));
  return Array.isArray(index?.series) ? index.series : [];
}

async function writeIndex(root: string, series: SeriesEntry[]): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeAtomic(join(root, "index.json"), JSON.stringify({ series }));
}

const mediaKeys = new Set(["poster", "stillUrl", "videoUrl", "url", "assemblyUrl", "preview"]);

function mediaExtension(type: string): string {
  if (type.includes("png")) return ".png";
  if (type.includes("jpeg") || type.includes("jpg")) return ".jpg";
  if (type.includes("webp")) return ".webp";
  if (type.includes("mp4")) return ".mp4";
  if (type.includes("wav")) return ".wav";
  if (type.includes("mpeg") || type.includes("mp3")) return ".mp3";
  return "";
}

async function saveDataUrl(directory: string, value: string): Promise<string> {
  const match = /^data:([^;,]+);base64,([a-z0-9+/=\s]+)$/i.exec(value);
  if (!match) return "";
  const ext = mediaExtension(match[1] ?? "");
  if (!ext) return "";
  const bytes = Buffer.from((match[2] ?? "").replace(/\s/g, ""), "base64");
  if (bytes.byteLength <= 0 || bytes.byteLength > maxMediaBytes) return "";
  const folder = join(directory, "media");
  await mkdir(folder, { recursive: true });
  const destination = join(folder, `${randomBytes(8).toString("hex")}${ext}`);
  await writeFile(destination, bytes);
  return destination;
}

async function materializeMedia(value: unknown, directory: string): Promise<unknown> {
  if (Array.isArray(value)) {
    const rows = [];
    for (const item of value) rows.push(await materializeMedia(item, directory));
    return rows;
  }
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === "string" && mediaKeys.has(key)) {
      if (item.startsWith("data:")) out[key] = await saveDataUrl(directory, item);
      else if (item.startsWith("blob:")) out[key] = "";
      else out[key] = item;
    } else if (item && typeof item === "object") {
      out[key] = await materializeMedia(item, directory);
    } else {
      out[key] = item;
    }
  }
  return out;
}

function asFilm(value: unknown): FilmRecord {
  if (typeof value !== "object" || value === null) throw new Error("Invalid film");
  const film = value as FilmRecord;
  assertId(film.id);
  assertId(film.seriesId);
  const raw = JSON.stringify(film);
  if (raw.length > 8_000_000) throw new Error("作品太大，没法保存。");
  return film;
}

const writeTails = new Map<string, Promise<void>>();

export function enqueueWrite<T>(key: string, job: () => Promise<T>): Promise<T> {
  const previous = writeTails.get(key) ?? Promise.resolve();
  const run = previous.then(job, job);
  writeTails.set(
    key,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

async function writeAtomic(path: string, body: string): Promise<void> {
  const temp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  const handle = await open(temp, "w");
  try {
    await handle.writeFile(body);
    await handle.sync();
  } finally {
    await handle.close();
  }
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await rename(temp, path);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES") throw error;
      await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)));
    }
  }
  await rename(temp, path);
}

function withoutSessionUrls(film: FilmRecord): FilmRecord {
  const copy = structuredClone(film);
  if (typeof copy.assemblyUrl === "string" && copy.assemblyUrl.startsWith("blob:")) {
    copy.assemblyUrl = "";
  }
  if (!Array.isArray(copy.shots)) return copy;
  copy.shots = copy.shots.map((shot) => {
    if (typeof shot !== "object" || shot === null) return shot;
    const row = { ...(shot as Record<string, unknown>) };
    if (!Array.isArray(row.takes)) return row;
    row.takes = row.takes.map((take) => {
      if (typeof take !== "object" || take === null) return take;
      const item = { ...(take as Record<string, unknown>) };
      for (const key of ["videoUrl", "stillUrl"]) {
        if (typeof item[key] === "string" && item[key].startsWith("blob:")) item[key] = "";
      }
      return item;
    });
    return row;
  });
  return copy;
}

function episodeView(film: FilmRecord): EpisodeEntry {
  const shots = Array.isArray(film.shots) ? film.shots : [];
  const done = shots.filter((shot) => {
    if (typeof shot !== "object" || shot === null) return false;
    const takes = (shot as { takes?: unknown }).takes;
    return (
      Array.isArray(takes) &&
      takes.some(
        (take) =>
          typeof take === "object" &&
          take !== null &&
          (take as { status?: unknown }).status === "done",
      )
    );
  }).length;
  return {
    id: film.id,
    seriesId: film.seriesId,
    title: film.episodeTitle || `第 ${film.episodeNo || 1} 集`,
    no: film.episodeNo || 1,
    shots: shots.length,
    done,
    savedAt: film.savedAt || "",
  };
}

export async function listSeries(root: string): Promise<SeriesEntry[]> {
  const rows = await readIndex(root);
  return rows
    .filter((item) => idPattern.test(item.id))
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export async function listEpisodes(root: string, seriesId: string): Promise<EpisodeEntry[]> {
  const directory = join(seriesDir(root, seriesId), "episodes");
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return [];
  }
  const rows: EpisodeEntry[] = [];
  for (const name of names) {
    if (!idPattern.test(name)) continue;
    const film = await readJson<FilmRecord>(join(directory, name, "project.json"));
    if (!film || film.seriesId !== seriesId || film.id !== name) continue;
    rows.push(episodeView(film));
  }
  return rows.sort((a, b) => a.no - b.no);
}

export async function readProject(root: string, id: string): Promise<FilmRecord | null> {
  assertId(id);
  for (const series of await listSeries(root)) {
    const direct = await readJson<FilmRecord>(episodePath(root, series.id, id));
    if (direct?.id === id) return { ...direct, directory: seriesDir(root, series.id) };
  }
  const episodes = await listEpisodes(root, id);
  const first = episodes[0];
  if (!first) return null;
  const film = await readJson<FilmRecord>(episodePath(root, id, first.id));
  return film ? { ...film, directory: seriesDir(root, id) } : null;
}

export async function writeProject(root: string, value: unknown): Promise<FilmRecord> {
  return enqueueWrite(`film:${root}`, () => writeProjectNow(root, value));
}

async function writeProjectNow(root: string, value: unknown): Promise<FilmRecord> {
  const seriesId =
    value &&
    typeof value === "object" &&
    typeof (value as { seriesId?: unknown }).seriesId === "string"
      ? (value as { seriesId: string }).seriesId
      : "";
  const directory = seriesId ? seriesDir(root, seriesId) : root;
  const storedMedia = await materializeMedia(value, directory);
  const film = withoutSessionUrls(asFilm(storedMedia));
  const savedAt = new Date().toISOString();
  const stored: FilmRecord = { ...film, savedAt, directory };
  await mkdir(dirname(episodePath(root, film.seriesId, film.id)), { recursive: true });
  await writeAtomic(episodePath(root, film.seriesId, film.id), JSON.stringify(stored));
  await writeAtomic(
    join(directory, "series.json"),
    JSON.stringify({ id: film.seriesId, title: film.seriesTitle || film.title || "未命名作品" }),
  );
  const rows = (await readIndex(root)).filter((item) => item.id !== film.seriesId);
  rows.unshift({
    id: film.seriesId,
    title: String(film.seriesTitle || film.title || "未命名作品"),
    savedAt,
    path: directory,
  });
  await writeIndex(root, rows);
  return stored;
}

export async function deleteProject(root: string, id: string): Promise<void> {
  assertId(id);
  const episode = await readProject(root, id);
  if (episode && episode.id === id && episode.seriesId !== id) {
    await rm(dirname(episodePath(root, episode.seriesId, id)), { recursive: true, force: true });
    const left = await listEpisodes(root, episode.seriesId);
    if (left.length === 0) await deleteProject(root, episode.seriesId);
    return;
  }
  await rm(seriesDir(root, id), { recursive: true, force: true });
  await writeIndex(
    root,
    (await readIndex(root)).filter((item) => item.id !== id),
  );
}

export async function renameSeries(root: string, seriesId: string, title: string): Promise<void> {
  const name = title.trim();
  if (!name || name.length > 80) return;
  assertId(seriesId);
  const directory = seriesDir(root, seriesId);
  await mkdir(directory, { recursive: true });
  await writeAtomic(join(directory, "series.json"), JSON.stringify({ id: seriesId, title: name }));
  for (const episode of await listEpisodes(root, seriesId)) {
    const film = await readJson<FilmRecord>(episodePath(root, seriesId, episode.id));
    if (!film) continue;
    film.seriesTitle = name;
    film.title = name;
    await writeAtomic(episodePath(root, seriesId, film.id), JSON.stringify(film));
  }
  const rows = (await readIndex(root)).map((item) =>
    item.id === seriesId ? { ...item, title: name } : item,
  );
  await writeIndex(root, rows);
}

function inside(root: string, target: string): boolean {
  const base = realpathSync(root);
  const prefix = base.endsWith(sep) ? base : `${base}${sep}`;
  return target === base || target.startsWith(prefix);
}

export function trustedMediaPath(roots: string[], raw: string): string {
  if (raw.length === 0 || raw.length > 4096 || raw.includes("\0")) {
    throw new Error("Invalid film path");
  }
  if (raw.split(/[/\\]/).includes("..")) throw new Error("Invalid film path");
  let target: string;
  try {
    target = realpathSync(resolve(raw));
  } catch {
    throw new Error("Invalid film path");
  }
  if (!mediaExtensions.has(extname(target).toLowerCase())) throw new Error("Invalid film path");
  const allowed = roots.some((root) => {
    try {
      return inside(root, target);
    } catch {
      return false;
    }
  });
  if (!allowed) throw new Error("Invalid film path");
  return target;
}

export async function readMedia(roots: string[], raw: string): Promise<Uint8Array> {
  const path = trustedMediaPath(roots, raw);
  const bytes = new Uint8Array(await readFile(path));
  if (bytes.byteLength <= 0 || bytes.byteLength > maxMediaBytes) {
    throw new Error("Film media is too large");
  }
  return bytes;
}

export async function joinClips(
  sources: string[],
  destination: string,
  run: (args: string[]) => Promise<void>,
): Promise<{ path: string; reason: string }> {
  if (sources.length === 0) throw new Error("没有可以接上的视频。");
  await mkdir(dirname(destination), { recursive: true });
  if (sources.length === 1) {
    await copyFile(sources[0]!, destination);
    return { path: destination, reason: "" };
  }
  const list = `${destination}.txt`;
  const body = sources.map((source) => `file '${source.replaceAll("'", "'\\''")}'`).join("\n");
  await writeFile(list, body);
  try {
    await run(["-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", destination]);
    return { path: destination, reason: "" };
  } catch (error) {
    await rm(destination, { force: true });
    const message = error instanceof Error ? error.message : "";
    if (message.includes("没有找到安装包里的 ffmpeg")) throw error;
    throw new Error(
      message ? `多镜头没有接上，没有导出。${message}` : "多镜头没有接上，没有导出。",
      {
        cause: error,
      },
    );
  } finally {
    await rm(list, { force: true });
  }
}

export function bundledFfmpeg(
  resourcesPath: string,
  platform: NodeJS.Platform,
  extra: { execPath?: string; envRoot?: string } = {},
): string {
  const name = platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const candidates: string[] = [];
  if (extra.envRoot) candidates.push(join(extra.envRoot, name));
  if (resourcesPath) candidates.push(join(resourcesPath, "media", name));
  if (extra.execPath) {
    const electronDir = dirname(extra.execPath);
    candidates.push(join(electronDir, "..", "..", "ffmpeg", "bin", name));
    candidates.push(join(electronDir, "..", "ffmpeg", "bin", name));
  }
  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  throw new Error("没有找到安装包里的 ffmpeg。");
}

export function musicMixArgs(
  video: string,
  music: string,
  destination: string,
  gainDb = -14,
): string[] {
  const gain = Math.max(0.02, Math.min(1, 10 ** (gainDb / 20)));
  return [
    "-y",
    "-i",
    video,
    "-stream_loop",
    "-1",
    "-i",
    music,
    "-filter_complex",
    `[1:a]volume=${gain.toFixed(4)},afade=t=in:st=0:d=0.2[pre];` +
      "[0:a]asplit=2[dry][sc];" +
      "[pre][sc]sidechaincompress=threshold=0.03:ratio=12:attack=5:release=120[bed];" +
      "[dry][bed]amix=inputs=2:duration=first:normalize=0:dropout_transition=0[a]",
    "-map",
    "0:v",
    "-map",
    "[a]",
    "-c:v",
    "copy",
    "-shortest",
    destination,
  ];
}

export async function mixMusic(
  video: string,
  music: string,
  run: (args: string[]) => Promise<void>,
  gain: boolean | number = -14,
): Promise<{ path: string; reason: string }> {
  const gainDb = typeof gain === "number" ? gain : -14;
  const mixed = `${video}.mix.mp4`;
  await run(musicMixArgs(video, music, mixed, gainDb));
  await copyFile(mixed, video);
  await rm(mixed, { force: true });
  return { path: video, reason: "" };
}

export async function importMusicFile(
  root: string,
  seriesId: string,
  source: string,
): Promise<string> {
  assertId(seriesId);
  if (!source || source.includes("\0") || source.split(/[/\\]/).includes("..")) {
    throw new Error("Invalid film path");
  }
  const ext = extname(source).toLowerCase();
  if (!new Set([".mp3", ".wav"]).has(ext)) throw new Error("Invalid film path");
  let target: string;
  try {
    target = realpathSync(resolve(source));
  } catch {
    throw new Error("Invalid film path");
  }
  const bytes = await readFile(target);
  if (bytes.byteLength <= 0 || bytes.byteLength > maxMediaBytes)
    throw new Error("Film media is too large");
  const directory = join(seriesDir(root, seriesId), "music");
  await mkdir(directory, { recursive: true });
  const destination = join(directory, `bed${ext}`);
  await writeFile(destination, bytes);
  return destination;
}

export function assemblyPath(root: string, seriesId: string): string {
  return join(seriesDir(root, seriesId), "assembly", "rough-cut.mp4");
}

export function stillPath(root: string, seriesId: string): string {
  return join(seriesDir(root, seriesId), "stills", `${randomBytes(8).toString("hex")}.png`);
}

type ImageRow = { b64_json?: unknown; url?: unknown };

export async function requestStill(options: {
  prompt: string;
  token: string | null;
  fetcher: typeof fetch;
  destination: string;
  model?: string;
}): Promise<{ path: string; reason: string }> {
  const prompt = options.prompt.trim().slice(0, 2000);
  if (!options.token) return { path: "", reason: "需要重新登录后再出图。" };
  if (!prompt) return { path: "", reason: "没有可以出图的提示词。" };
  let response: Response;
  try {
    response = await options.fetcher(IMAGE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: options.model ?? IMAGE_MODEL,
        prompt,
        n: 1,
        response_format: "b64_json",
      }),
    });
  } catch {
    return { path: "", reason: "出图没有成功，可以重试。" };
  }
  if (response.status === 401 || response.status === 403) {
    return { path: "", reason: "需要重新登录后再出图。" };
  }
  if (!response.ok) return { path: "", reason: "出图没有成功，可以重试。" };
  let payload: { data?: ImageRow[] };
  try {
    payload = (await response.json()) as { data?: ImageRow[] };
  } catch {
    return { path: "", reason: "出图没有成功，可以重试。" };
  }
  const row = payload.data?.[0];
  let bytes: Uint8Array | null = null;
  if (typeof row?.b64_json === "string" && row.b64_json.length > 0) {
    bytes = new Uint8Array(Buffer.from(row.b64_json, "base64"));
  } else if (typeof row?.url === "string" && row.url.startsWith("https://")) {
    const downloaded = await options.fetcher(row.url);
    if (!downloaded.ok) return { path: "", reason: "出图没有成功，可以重试。" };
    bytes = new Uint8Array(await downloaded.arrayBuffer());
  }
  if (!bytes || bytes.byteLength < 8 || bytes.byteLength > maxStillBytes) {
    return { path: "", reason: "出图没有成功，可以重试。" };
  }
  await mkdir(dirname(options.destination), { recursive: true });
  await writeFile(options.destination, bytes);
  return { path: options.destination, reason: "" };
}

const exportIllegal = new Set(["\\", "/", ":", "*", "?", '"', "<", ">", "|"]);

/** Drop characters a file name cannot keep. Control codes are rejected by code point, not a regex. */
export function stripUnsafeFileChars(name: string): string {
  return Array.from(name)
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && !exportIllegal.has(character);
    })
    .join("");
}

export function safeExportName(name: string): string {
  const cleaned = stripUnsafeFileChars(basename(name)).replace(/\s+/g, "").trim().slice(0, 80);
  if (!cleaned || cleaned === "." || cleaned === "..") return "aivora-film.mp4";
  if (cleaned.toLowerCase().endsWith(".mp4")) return cleaned;
  return `${cleaned.replace(/\.+$/, "").slice(0, 76)}.mp4`;
}

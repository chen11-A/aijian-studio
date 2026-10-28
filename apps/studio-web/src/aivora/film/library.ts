import { FILM_KEY, readFilm, upgradeFilm, type FilmProject } from "./project";

export const BROWSER_DIRECTORY = "浏览器里，还没写到应用数据目录";
const INDEX_KEY = "aivora.film.index";
const ACTIVE_KEY = "aivora.film.activeId";
const BODY_PREFIX = "aivora.film.v1.";

export type FilmIndexEntry = {
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

type FilmBridge = {
  listFilmSeries?: () => Promise<FilmIndexEntry[]>;
  readFilmProject?: (id: string) => Promise<FilmProject | null>;
  writeFilmProject?: (film: FilmProject) => Promise<FilmProject>;
  deleteFilmProject?: (id: string) => Promise<void>;
  renameFilmSeries?: (seriesId: string, title: string) => Promise<void>;
  listFilmEpisodes?: (seriesId: string) => Promise<EpisodeEntry[]>;
};

function bridge(): FilmBridge | null {
  const api = window.aijian as FilmBridge | undefined;
  if (api?.listFilmSeries && api.readFilmProject && api.writeFilmProject) return api;
  return null;
}

export function filmDiskReady(): boolean {
  return bridge() !== null;
}

function readIndex(storage: Storage): FilmIndexEntry[] {
  const raw = storage.getItem(INDEX_KEY);
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as FilmIndexEntry[];
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writeIndex(storage: Storage, rows: FilmIndexEntry[]) {
  storage.setItem(INDEX_KEY, JSON.stringify(rows));
}

function remember(storage: Storage, film: FilmProject) {
  const savedAt = new Date().toISOString();
  const stored = { ...film, savedAt, directory: film.directory || BROWSER_DIRECTORY };
  storage.setItem(BODY_PREFIX + stored.id, JSON.stringify(stored));
  storage.setItem(ACTIVE_KEY, stored.id);
  const rows = readIndex(storage).filter(
    (item) => item.id !== stored.seriesId && item.id !== stored.id,
  );
  rows.unshift({
    id: stored.seriesId,
    title: stored.seriesTitle || stored.title,
    savedAt,
    path: BROWSER_DIRECTORY,
  });
  writeIndex(storage, rows);
  return stored;
}

function migrateLegacy(storage: Storage) {
  if (!storage.getItem(FILM_KEY)) return;
  const film = readFilm(storage);
  storage.removeItem(FILM_KEY);
  if (!film) return;
  if (!/^film_[a-z0-9]{16,40}$/.test(film.id)) film.id = "film_legacy000000000001";
  if (!/^film_[a-z0-9]{16,40}$/.test(film.seriesId)) film.seriesId = "film_legacyseries000001";
  remember(storage, film);
}

export async function listFilms(storage: Storage = window.localStorage): Promise<FilmIndexEntry[]> {
  const desktop = bridge();
  if (desktop?.listFilmSeries) return desktop.listFilmSeries();
  migrateLegacy(storage);
  return readIndex(storage);
}

export async function listEpisodes(
  seriesId: string,
  storage: Storage = window.localStorage,
): Promise<EpisodeEntry[]> {
  const desktop = bridge();
  if (desktop?.listFilmEpisodes) return desktop.listFilmEpisodes(seriesId);
  migrateLegacy(storage);
  const rows: EpisodeEntry[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key?.startsWith(BODY_PREFIX)) continue;
    const film = readBody(storage, key.slice(BODY_PREFIX.length));
    if (!film || film.seriesId !== seriesId) continue;
    rows.push({
      id: film.id,
      seriesId: film.seriesId,
      title: film.episodeTitle || `第 ${film.episodeNo || 1} 集`,
      no: film.episodeNo || 1,
      shots: film.shots.length,
      done: film.shots.filter((shot) => shot.takes.some((take) => take.status === "done")).length,
      savedAt: film.savedAt,
    });
  }
  return rows.sort((a, b) => a.no - b.no);
}

function readBody(storage: Storage, id: string): FilmProject | null {
  const raw = storage.getItem(BODY_PREFIX + id);
  if (!raw) return null;
  storage.setItem(FILM_KEY, raw);
  const film = readFilm(storage);
  storage.removeItem(FILM_KEY);
  return film;
}

export async function readSaved(
  id: string,
  storage: Storage = window.localStorage,
): Promise<FilmProject | null> {
  const desktop = bridge();
  if (desktop?.readFilmProject) {
    const stored = await desktop.readFilmProject(id);
    return stored ? upgradeFilm(stored) : null;
  }
  migrateLegacy(storage);
  const direct = readBody(storage, id);
  if (direct) return direct;
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key?.startsWith(BODY_PREFIX)) continue;
    const film = readBody(storage, key.slice(BODY_PREFIX.length));
    if (film?.seriesId === id) return film;
  }
  return null;
}

export async function saveFilm(
  film: FilmProject,
  storage: Storage = window.localStorage,
): Promise<FilmProject> {
  const desktop = bridge();
  if (desktop?.writeFilmProject) {
    const stored = await desktop.writeFilmProject(film);
    return { ...stored, assemblyUrl: film.assemblyUrl };
  }
  return remember(storage, film);
}

export async function removeFilm(
  id: string,
  storage: Storage = window.localStorage,
): Promise<void> {
  const desktop = bridge();
  if (desktop?.deleteFilmProject) {
    await desktop.deleteFilmProject(id);
    return;
  }
  const direct = readBody(storage, id);
  if (direct) {
    storage.removeItem(BODY_PREFIX + id);
    const episodes = await listEpisodes(direct.seriesId, storage);
    if (episodes.length === 0) {
      writeIndex(
        storage,
        readIndex(storage).filter((item) => item.id !== direct.seriesId),
      );
    }
    if (storage.getItem(ACTIVE_KEY) === id) storage.removeItem(ACTIVE_KEY);
    return;
  }
  for (const episode of await listEpisodes(id, storage))
    storage.removeItem(BODY_PREFIX + episode.id);
  writeIndex(
    storage,
    readIndex(storage).filter((item) => item.id !== id),
  );
}

export async function renameFilm(
  seriesId: string,
  title: string,
  storage: Storage = window.localStorage,
): Promise<void> {
  const name = title.trim();
  if (!name) return;
  const desktop = bridge();
  if (desktop?.renameFilmSeries) {
    await desktop.renameFilmSeries(seriesId, name);
    return;
  }
  for (const episode of await listEpisodes(seriesId, storage)) {
    const film = readBody(storage, episode.id);
    if (film) remember(storage, { ...film, seriesTitle: name, title: name });
  }
  const rows = readIndex(storage).map((item) =>
    item.id === seriesId ? { ...item, title: name } : item,
  );
  writeIndex(storage, rows);
}

export function activeFilmId(storage: Storage = window.localStorage): string {
  return storage.getItem(ACTIVE_KEY) ?? "";
}

export function mediaUrl(bytes: Uint8Array, mime: string): string {
  const copy = Uint8Array.from(bytes);
  return URL.createObjectURL(new Blob([copy], { type: mime }));
}

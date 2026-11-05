import { beforeEach, describe, expect, it, vi } from "vitest";
import { newEpisode, sampleFilm, writeFilm } from "./project";
import {
  prepareFilmSnapshot,
  listEpisodes,
  listFilms,
  readSaved,
  removeFilm,
  renameFilm,
} from "./library";

describe("film library", () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete window.aijian;
  });

  it("prepares through the desktop bridge without writing or remembering a snapshot", async () => {
    const film = sampleFilm();
    const prepared = { ...film, assemblyUrl: "/media/prepared.mp4" };
    const prepare = vi.fn(async () => prepared);
    const write = vi.fn();
    window.aijian = {
      prepareFilmProject: prepare,
      writeFilmProject: write,
    } as unknown as Window["aijian"];
    expect(await prepareFilmSnapshot(film)).toBe(prepared);
    expect(prepare).toHaveBeenCalledWith(film);
    expect(write).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  });

  it("rejects stale preparation before dispatch and after materialization", async () => {
    const film = sampleFilm();
    let current = true;
    const prepare = vi.fn(async () => {
      current = false;
      return film;
    });
    window.aijian = { prepareFilmProject: prepare } as unknown as Window["aijian"];
    await expect(prepareFilmSnapshot(film, () => false)).rejects.toMatchObject({
      code: "PIPELINE_OWNER_CHANGED",
    });
    expect(prepare).not.toHaveBeenCalled();
    await expect(prepareFilmSnapshot(film, () => current)).rejects.toMatchObject({
      code: "PIPELINE_OWNER_CHANGED",
    });
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(localStorage.length).toBe(0);
  });

  it("requires preparation support instead of pretending session media is durable", async () => {
    await expect(prepareFilmSnapshot(sampleFilm())).rejects.toMatchObject({
      code: "PIPELINE_PREPARATION_REQUIRED",
    });
  });

  it("keeps two episodes in one series and does not overwrite another series", async () => {
    const first = sampleFilm();
    const second = newEpisode(first);
    second.title = "雨夜巷战";
    const other = sampleFilm();
    other.id = "film_other0000000000001";
    other.seriesId = "film_otherseries0000001";
    other.seriesTitle = "另一部";
    other.title = "另一部";
    const { saveFilm } = await import("./library");
    await saveFilm(first);
    await saveFilm(second);
    await saveFilm(other);
    const index = await listFilms();
    expect(index.map((item) => item.id).sort()).toEqual(
      ["film_otherseries0000001", "film_sampleseries00001"].sort(),
    );
    const episodes = await listEpisodes(first.seriesId);
    expect(episodes).toHaveLength(2);
    await removeFilm(second.id);
    expect(await listEpisodes(first.seriesId)).toHaveLength(1);
    expect(await readSaved(first.id)).toMatchObject({ title: "雨夜巷战" });
  });

  it("renames a series and ignores an empty name", async () => {
    const film = sampleFilm();
    const { saveFilm } = await import("./library");
    await saveFilm(film);
    await renameFilm(film.seriesId, "   ");
    expect((await readSaved(film.id))?.seriesTitle).toBe("雨夜巷战");
    await renameFilm(film.seriesId, "夜雨");
    expect((await readSaved(film.id))?.seriesTitle).toBe("夜雨");
  });

  it("migrates the legacy single film once", async () => {
    const film = sampleFilm();
    film.id = "film-local";
    film.seriesId = "film-local";
    writeFilm(window.localStorage, film);
    const rows = await listFilms();
    expect(rows[0]?.id).toBe("film_legacyseries000001");
    const saved = await readSaved("film_legacy000000000001");
    expect(saved?.title).toBe("雨夜巷战");
    expect(window.localStorage.getItem("aivora.film.active")).toBeNull();
  });

  it("uses the desktop bridge when it is present", async () => {
    const film = sampleFilm();
    window.aijian = {
      listFilmSeries: vi.fn(async () => [
        { id: film.seriesId, title: film.seriesTitle, savedAt: "", path: "/films" },
      ]),
      readFilmProject: vi.fn(async () => film),
      writeFilmProject: vi.fn(async () => film),
      deleteFilmProject: vi.fn(async () => undefined),
      renameFilmSeries: vi.fn(async () => undefined),
      listFilmEpisodes: vi.fn(async () => []),
    } as unknown as Window["aijian"];
    expect(await listFilms()).toHaveLength(1);
    const loaded = await readSaved(film.id);
    expect(loaded?.id).toBe(film.id);
    expect(loaded?.shots).toHaveLength(film.shots.length);
    expect(loaded?.audioClips).toEqual(film.audioClips);
    await removeFilm(film.id);
    await renameFilm(film.seriesId, "新名");
    expect(window.aijian?.deleteFilmProject).toHaveBeenCalledWith(film.id);
    expect(window.aijian?.renameFilmSeries).toHaveBeenCalledWith(film.seriesId, "新名");
  });
});

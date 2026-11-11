import { URL } from "node:url";

/** Runs inside the page. All data is synthetic; the video is a repository test fixture. */
export async function seedProProject({
  projectModuleUrl,
  aspect,
  versions,
  videoUrl,
  mode = "ready",
}) {
  const { sampleFilm, FILM_KEY } = await import(projectModuleUrl);
  let film = sampleFilm();
  film.title = "布局核验合成作品";
  film.seriesTitle = film.title;
  film.aspectRatio = aspect;
  film.backendProjectId = `prj_${"a".repeat(32)}`;
  film.scenes = [film.scenes[1], film.scenes[0], film.scenes[2]];
  film.audioClips = [];
  const image = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#24384e"/><text x="120" y="180" fill="white" font-size="28">SYNTHETIC LAYOUT</text></svg>')}`;
  film.shots = film.shots.map((shot) => ({
    ...shot,
    poster: image,
    line: "这是一句布局核验用的合成台词。",
    lines: [{ speaker: "", text: "这是一句布局核验用的合成台词。" }],
    takes: Array.from({ length: versions }, (_, index) => ({
      id: `${shot.id}-layout-${index + 1}`,
      shotId: shot.id,
      index: index + 1,
      status: "done",
      stillUrl: image,
      videoPath: `/synthetic/${shot.id}-${index + 1}.mp4`,
      videoUrl,
      prompt: "合成布局核验",
      createdAt: "",
      reason: "",
      ...(index > 0 ? { cleanVideoPath: `/synthetic/${shot.id}-${index + 1}-clean.mp4` } : {}),
    })),
    selectedTakeId: `${shot.id}-layout-1`,
  }));
  if (mode !== "ready")
    film.props = [{ id: "layout-prop", name: "合成核验用旧书", note: "布局夹具，不触发生成。" }];
  if (mode === "missing") {
    film.shots = film.shots.map((shot) => ({ ...shot, takes: [], selectedTakeId: "" }));
  }
  if (mode === "interrupted") {
    film.shots[0].takes[0].status = "running";
  }
  if (mode !== "missing") {
    const frame = "/synthetic/layout-frame.png";
    for (const shot of film.shots)
      shot.stills = [{ id: `layout-still-${shot.id}`, prompt: "合成布局核验", url: frame }];
    const { saveStillReview, stillChecklist } = await import(
      new URL("../pro/still-acceptance.ts", projectModuleUrl).href
    );
    for (const shot of [...film.shots]) {
      const verdicts = Object.fromEntries(
        stillChecklist(film, shot).map((item) => [item.id, "match"]),
      );
      const saved = saveStillReview(film, shot.id, verdicts, "2026-11-11T00:00:00.000Z");
      if (!saved.adopted) throw new Error(saved.error || "layout still was not adopted");
      film = saved.film;
    }
  }
  window.localStorage.clear();
  window.localStorage.setItem(FILM_KEY, JSON.stringify(film));
}

/** Rewrite adoption after a later seed changes the checklist. Data only; no clicks. */
export async function refreshSeedAdoption() {
  const id = window.localStorage.getItem("aivora.film.activeId");
  const key = `aivora.film.v1.${id}`;
  let film = JSON.parse(window.localStorage.getItem(key) || "null");
  if (!film?.shots?.length) throw new Error("refreshSeedAdoption: no saved film");
  const { saveStillReview, stillChecklist } = await import(
    new URL("/src/aivora/pro/still-acceptance.ts", window.location.origin).href,
  );
  let adopted = 0;
  for (const shot of [...film.shots]) {
    if (!shot.stills?.some((item) => item.url))
      throw new Error(`refreshSeedAdoption: 镜头 ${shot.no} 没有可采用的画面`);
    const verdicts = Object.fromEntries(
      stillChecklist(film, shot).map((item) => [item.id, "match"]),
    );
    const saved = saveStillReview(film, shot.id, verdicts, "2026-11-11T00:00:00.000Z");
    if (!saved.adopted)
      throw new Error(saved.error || `refreshSeedAdoption: 镜头 ${shot.no} 没有采用成功`);
    film = saved.film;
    adopted += 1;
  }
  if (!adopted) throw new Error("refreshSeedAdoption: 没有采用成功");
  const text = JSON.stringify(film);
  window.localStorage.setItem(key, text);
  window.localStorage.setItem("aivora.film.active", text);
}

/** Runs before any app code; no provider, account or native-file capability is supplied. */
export function installProAuditBridge() {
  window.__proLayoutCalls = [];
  const unexpected = (name) => {
    window.__proLayoutCalls.push(name);
    throw new Error(`Unexpected layout-audit dispatch: ${name}`);
  };
  window.aijian = {
    pickFilmFolder: async () => null,
    exportFilmCut: async () => unexpected("export"),
    prepareFilmExport: async () => unexpected("qc-prepare"),
    publishFilmExport: async () => unexpected("qc-publish"),
    discardFilmExport: async () => unexpected("qc-discard"),
    remakeStoryFilmCleanCopy: async () => unexpected("clean-copy"),
  };
}

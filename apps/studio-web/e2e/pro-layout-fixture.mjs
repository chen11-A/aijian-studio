/** Runs inside the page. All data is synthetic; the video is a repository test fixture. */
export async function seedProProject({ projectModuleUrl, aspect, versions, videoUrl }) {
  const { sampleFilm, FILM_KEY } = await import(projectModuleUrl);
  const film = sampleFilm();
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
  window.localStorage.clear();
  window.localStorage.setItem(FILM_KEY, JSON.stringify(film));
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
    remakeStoryFilmCleanCopy: async () => unexpected("clean-copy"),
  };
}

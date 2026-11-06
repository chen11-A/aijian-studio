/** Runs before the production app. This bridge never writes or generates real media. */
export function installExportQcBridge({ state, aspect }) {
  const audit = { prepare: [], publish: [], discard: [], forbidden: [] };
  window.__exportQcAudit = audit;
  const other = aspect === "16:9" ? "9:16" : "16:9";
  function report(ratio, block = false) {
    const count = block ? 1 : state === "warn-long" ? 18 : 0;
    return {
      schemaVersion: 1,
      media: {
        duration: 24,
        width: ratio === "16:9" ? 1920 : 1080,
        height: ratio === "16:9" ? 1080 : 1920,
      },
      audio: { present: true, integratedLufs: -16, truePeakDbtp: block ? 0 : -2 },
      assumptions: {},
      issues: Array.from({ length: count }, (_, index) => ({
        id: `synthetic-qc-${index}`,
        severity: block ? "block" : "warn",
        time: 0,
        timeLabel: "第 0 秒",
        end: 24,
        scope: "program",
        type: block ? "true_peak" : "loudness",
        message: block
          ? "合成报告：声音峰值需要先处理。"
          : `合成报告第 ${index + 1} 项：请核对对白和配乐的音量。这里的长句用于验证报告换行及滚动，并不代表实际听过声音。`,
        suggestion: "请完整播放和试听成片，核对后再决定是否接受。",
        action: "adjust_volume",
        detail: { integratedLufs: -16, truePeakDbtp: block ? 0 : -2 },
      })),
    };
  }
  const ready = () => ({
    kind: "READY",
    qcReceipt: "synthetic-opaque-receipt",
    outputs:
      state === "other-block"
        ? [
            { aspectRatio: aspect, report: report(aspect) },
            { aspectRatio: other, report: report(other, true) },
          ]
        : [{ aspectRatio: aspect, report: report(aspect, state === "block") }],
    shots: [],
    fileName: "合成审核核验作品-第1集.mp4",
    unverified: [
      "对白完整性需要人工核对。",
      "人物动作与口型需要完整观看。",
      "字幕仅检查时间和估算布局，不等于确认真实烧录字形。",
    ],
  });
  const forbidden = (name) => {
    audit.forbidden.push(name);
    throw new Error(`Prohibited QC-audit operation: ${name}`);
  };
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const saved = () => {
    const id = window.localStorage.getItem("aivora.film.activeId");
    const raw =
      window.localStorage.getItem(`aivora.film.v1.${id}`) ||
      window.localStorage.getItem("aivora.film.active");
    return raw ? JSON.parse(raw) : null;
  };
  window.aijian = {
    listFilmSeries: async () => {
      const film = saved();
      return film
        ? [
            {
              id: film.seriesId,
              title: film.seriesTitle,
              savedAt: film.savedAt,
              path: "synthetic-project",
            },
          ]
        : [];
    },
    listFilmEpisodes: async (seriesId) => {
      const film = saved();
      return film?.seriesId === seriesId
        ? [
            {
              id: film.id,
              seriesId,
              title: film.episodeTitle,
              no: film.episodeNo,
              shots: film.shots.length,
              done: film.shots.length,
              savedAt: film.savedAt,
            },
          ]
        : [];
    },
    readFilmProject: async (id) => {
      const raw = window.localStorage.getItem(`aivora.film.v1.${id}`);
      const film = raw ? JSON.parse(raw) : saved();
      return film && (film.id === id || film.seriesId === id) ? clone(film) : null;
    },
    writeFilmProject: async (film) => {
      const value = clone(film);
      window.localStorage.setItem("aivora.film.active", JSON.stringify(value));
      window.localStorage.setItem(`aivora.film.v1.${value.id}`, JSON.stringify(value));
      window.localStorage.setItem("aivora.film.activeId", value.id);
      return clone(value);
    },
    prepareFilmExport: async (input) => {
      audit.prepare.push(JSON.parse(JSON.stringify(input)));
      if (state === "prepare-busy")
        return new Promise((resolve) => {
          audit.resolvePrepare = () => resolve(ready());
        });
      if (state === "failed") return { kind: "FAILED", code: "CHECK_FAILED" };
      return ready();
    },
    publishFilmExport: async (input) => {
      audit.publish.push(JSON.parse(JSON.stringify(input)));
      if (state === "publish-busy")
        return new Promise((resolve) => {
          audit.resolvePublish = () => resolve({ kind: "CANCELLED" });
        });
      return { kind: "CANCELLED" };
    },
    discardFilmExport: async (receipt) => {
      audit.discard.push(receipt);
    },
    pickFilmFolder: async () => forbidden("directory-picker"),
    exportFilmCut: async () => forbidden("legacy-export"),
    generateFilmStill: async () => forbidden("generate-still"),
    generateFilmVideo: async () => forbidden("generate-video"),
    assembleFilm: async () => forbidden("assemble"),
    remakeStoryFilmCleanCopy: async () => forbidden("clean-copy"),
  };
}

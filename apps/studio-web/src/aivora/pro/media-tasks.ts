import type { FilmProject, FilmShot } from "../film/project";
import { dialogueTracks, filmFileName, shotVoiceId, spokenLine } from "../film/operations";
import { directedSpeech } from "../film/phase2";
import { runTask } from "../film/task-progress";
import { grokBridge } from "../grok-auth/transport";
import { fileMediaUrl } from "./workflow";

type MediaHost = {
  current: () => FilmProject | null;
  valid: () => boolean;
  apply: (film: FilmProject) => void;
};
function assertCurrent(base: FilmProject, host: MediaHost, signal: AbortSignal) {
  const live = host.current();
  if (signal.aborted || !host.valid() || live?.id !== base.id) throw new Error("WORK_STALE");
  return live;
}
export function revoiceFilmShot(
  base: FilmProject,
  shot: FilmShot,
  host: MediaHost & { billing: () => Promise<string> },
) {
  return runTask(
    {
      id: `voice:${shot.id}`,
      projectId: base.id,
      shotId: shot.id,
      kind: "voice",
      title: "重配这一句",
    },
    async (signal) => {
      const bridge = grokBridge();
      const projectId = await host.billing();
      assertCurrent(base, host, signal);
      if (!bridge?.speak || !projectId) throw new Error("配音需要 Grok 会员。画面不会重新生成。");
      const voiceId = shotVoiceId(shot, base);
      if (!voiceId) throw new Error("VOICE_TRAITS_REQUIRED");
      const directed = directedSpeech(spokenLine(shot), shot.delivery ?? "");
      const spoken = await bridge.speak({
        voiceId,
        text: directed.text,
        speed: directed.speed,
        projectId,
        idempotencyKey: crypto.randomUUID(),
      });
      const latest = assertCurrent(base, host, signal);
      if (spoken.kind !== "OK") throw new Error(spoken.detail || "配音没有生成，画面没有动。");
      host.apply({
        ...latest,
        audioClips: [
          ...latest.audioClips.filter((clip) => clip.id !== `voice-${shot.id}`),
          {
            id: `voice-${shot.id}`,
            lane: "dialogue",
            shotId: shot.id,
            takeId: shot.selectedTakeId,
            label: "配音",
            startSeconds: 0,
            durationSeconds: spoken.seconds && spoken.seconds > 0 ? spoken.seconds : shot.seconds,
            offsetSeconds: 0,
            gainDb: 0,
            path: `data:${spoken.mime || "audio/mpeg"};base64,${spoken.audioBase64}`,
          },
        ],
      });
    },
  );
}

export function exportFilmTask(
  base: FilmProject,
  paths: string[],
  directory: string,
  host: MediaHost,
) {
  return runTask(
    { id: `export:${base.id}`, projectId: base.id, kind: "export", title: "导出成片" },
    async (signal) => {
      const bridge = window.aijian;
      if (!bridge?.exportFilmCut || !bridge.pickFilmFolder) throw new Error("导出需要桌面版。");
      const music = base.audioClips.find((clip) => clip.lane === "score" && clip.path);
      const voices = dialogueTracks(base);
      let source = paths[0] ?? "";
      let assemblyPath = "";
      if (paths.length > 1 || (bridge.assembleFilm && (music?.path || voices.some(Boolean)))) {
        if (!bridge.assembleFilm) throw new Error("多镜头没有接上，没有导出。");
        const mixed = await bridge.assembleFilm(
          base.seriesId,
          paths,
          music?.path ?? "",
          music ? music.gainDb : -14,
          voices,
        );
        assertCurrent(base, host, signal);
        source = mixed.path;
        assemblyPath = mixed.path;
      }
      if (!source) throw new Error("没有导出成功，可以重试。");
      const target = directory || (await bridge.pickFilmFolder()) || "";
      assertCurrent(base, host, signal);
      if (!target) throw Object.assign(new Error("没有选择文件夹。"), { code: "EXPORT_CANCELLED" });
      const name = filmFileName(base.seriesTitle || base.title, base.episodeTitle || "第1集");
      const result = await bridge.exportFilmCut(source, target, name);
      const latest = assertCurrent(base, host, signal);
      if (!result.path) throw new Error("没有导出成功，可以重试。");
      host.apply({
        ...latest,
        ...(assemblyPath ? { assemblyPath, assemblyUrl: fileMediaUrl(assemblyPath) } : {}),
        exportPath: result.path,
      });
      return { path: result.path, directory: target };
    },
  );
}

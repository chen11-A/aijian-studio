import type { FilmProject, FilmShot } from "../film/project";
import {
  bakedSubtitleNotice,
  dialogueTracks,
  filmFileName,
  filmSubtitleCues,
  shotVoiceId,
  spokenLine,
  subtitleExportPlan,
  type ExportSubtitleMode,
} from "../film/operations";
import type { CoverInput, SubtitleStyleId } from "../film/contracts3j";
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
          ...latest.audioClips.map((clip) =>
            shot.selectedTakeId &&
            clip.shotId === shot.id &&
            clip.takeId === shot.selectedTakeId &&
            clip.lane === "dialogue" &&
            clip.label !== "原声" &&
            clip.path
              ? { ...clip, enabled: false }
              : clip,
          ),
          {
            id: `voice-${shot.id}-${crypto.randomUUID()}`,
            enabled: true,
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

/** 4B-B09: the export dialog's 清晰度, 字幕 and the work's subtitle look and cover. */
export type FilmExportSettings = {
  quality: "1080p" | "720p";
  subtitles: ExportSubtitleMode;
  style: SubtitleStyleId;
  cover: CoverInput;
};

export function exportFilmTask(
  base: FilmProject,
  paths: string[],
  directory: string,
  host: MediaHost,
  options?: { aspectRatio?: "16:9" | "9:16"; signal?: AbortSignal; settings?: FilmExportSettings },
) {
  return runTask(
    {
      id: `export:${base.id}${options?.aspectRatio ? `:${options.aspectRatio}` : ""}`,
      projectId: base.id,
      kind: "export",
      title: "导出成片",
    },
    async (signal) => {
      const bridge = window.aijian;
      if (!bridge?.exportFilmCut || !bridge.pickFilmFolder) throw new Error("导出需要桌面版。");
      const settings = options?.settings;
      // 4B-B09: takes without burned subtitles where there are any, and their subtitle times.
      const plan = settings ? subtitleExportPlan(base, settings.subtitles) : null;
      if (plan && settings!.subtitles !== "burn" && (plan.baked.length || plan.unclean.length))
        throw Object.assign(new Error(bakedSubtitleNotice(plan, true)), {
          code: "EXPORT_SUBTITLES_BAKED",
        });
      const sources = plan ? plan.paths : paths;
      const music = base.audioClips.find((clip) => clip.lane === "score" && clip.path);
      const voices = dialogueTracks(base);
      let source = sources[0] ?? "";
      let assemblyPath = "";
      let seconds = plan?.seconds ?? [];
      if (sources.length > 1 || (bridge.assembleFilm && (music?.path || voices.some(Boolean)))) {
        if (!bridge.assembleFilm) throw new Error("多镜头没有接上，没有导出。");
        const mixed = await bridge.assembleFilm(
          base.seriesId,
          sources,
          music?.path ?? "",
          music ? music.gainDb : -14,
          voices,
        );
        assertCurrent(base, host, signal);
        source = mixed.path;
        assemblyPath = mixed.path;
        if (mixed.durations?.length === sources.length) seconds = mixed.durations;
      }
      if (!source) throw new Error("没有导出成功，可以重试。");
      const target = directory || (await bridge.pickFilmFolder()) || "";
      assertCurrent(base, host, signal);
      if (!target) throw Object.assign(new Error("没有选择文件夹。"), { code: "EXPORT_CANCELLED" });
      const name = filmFileName(base.seriesTitle || base.title, base.episodeTitle || "第1集");
      const requestId = crypto.randomUUID();
      const cancel = () => {
        void bridge.cancelFilmExport?.(requestId).catch(() => undefined);
      };
      signal.addEventListener("abort", cancel, { once: true });
      let result: { ok: boolean; path: string; subtitlePath?: string; coverPath?: string };
      try {
        result = await bridge.exportFilmCut(source, target, name, {
          ...(options?.aspectRatio ? { aspectRatio: options.aspectRatio } : {}),
          requestId,
          ...(settings && plan
            ? {
                canvas: options?.aspectRatio ?? base.aspectRatio,
                quality: settings.quality,
                subtitles: {
                  mode: settings.subtitles,
                  style: settings.style,
                  cues: settings.subtitles === "none" ? [] : filmSubtitleCues(plan.cues, seconds),
                },
                cover: {
                  title: settings.cover.title,
                  subtitle: settings.cover.subtitle,
                  aiMark: settings.cover.aiMark,
                  ...(settings.cover.backgroundUrl ? { still: settings.cover.backgroundUrl } : {}),
                },
              }
            : {}),
        });
      } finally {
        signal.removeEventListener("abort", cancel);
      }
      const latest = assertCurrent(base, host, signal);
      if (result.ok === false || !result.path) throw new Error("没有导出成功，可以重试。");
      host.apply({
        ...latest,
        ...(assemblyPath ? { assemblyPath, assemblyUrl: fileMediaUrl(assemblyPath) } : {}),
        exportPath: result.path,
      });
      return {
        path: result.path,
        directory: target,
        ...(result.subtitlePath ? { subtitlePath: result.subtitlePath } : {}),
        ...(result.coverPath ? { coverPath: result.coverPath } : {}),
        // Older takes, and takes whose copy without subtitles failed, keep their subtitle.
        ...(plan && settings!.subtitles === "burn" && (plan.baked.length || plan.unclean.length)
          ? { note: bakedSubtitleNotice(plan, false) }
          : {}),
      };
    },
    { signal: options?.signal },
  );
}

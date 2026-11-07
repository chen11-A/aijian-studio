import { dialogueEvidenceContext } from "@aijian/contracts/film-dialogue-split-plan";
import { historyRecordHash } from "./persistent-history";
import type { StoryFilmLocalScope } from "@aijian/contracts/film-dialogue-split";
import { rememberDialogueLimit } from "./dialogue-limit-session";
import { generationVideoBody } from "./video-prompt-review";
import { shotLines } from "../../film/director-continuity";
import type { AijianDesktopBridge } from "../../../api/studio";
import type { FilmProject, FilmShot, FilmTake } from "../../film/project";
import type { UiNotice } from "../../film/contracts3j";
import {
  cancelVideoTask,
  setVideoTaskState,
  videoQueueInterruption,
  type prepareVideoQueue,
} from "../../film/generation-queue";
import { updateShot } from "../../film/operations";
import { ensureContinuityFrame } from "../continuity-frame";
import { ensureShotFrame } from "../still-workflow";
import { fileMediaUrl, isVoiceFile } from "../workflow";
import { NOTICE_TEXT, presentNotice } from "../../film/notices";
import { awaitVideoResult } from "../video-request";

import type { GenerationExecutionSession } from "./generation-execution";
import type { FilmGenerationVideoExecution } from "@aijian/contracts/film-generation-execution";

type CreateVideo = NonNullable<AijianDesktopBridge["createStoryFilm"]>;
type Queue = ReturnType<typeof prepareVideoQueue>;
export type GenerationRunHost = {
  current: () => FilmProject | null;
  valid: () => boolean;
  apply: (film: FilmProject) => Promise<void>;
  persist: (film: FilmProject) => Promise<void>;
  stopped: () => boolean;
  paused: () => boolean;
  cancelled: (jobId: string) => boolean;
  execution?: GenerationExecutionSession;
  request: (
    body: Parameters<CreateVideo>[1],
    scope?: StoryFilmLocalScope,
    execution?: FilmGenerationVideoExecution,
  ) => ReturnType<CreateVideo>;
  notice: (notice: UiNotice) => void;
  completed: (result: { shotId: string; done: boolean; message: string }) => void;
  continuity?: typeof ensureContinuityFrame;
  frame?: typeof ensureShotFrame;
};

/** Match the existing pipeline's local-video shape check. Filesystem trust and existence
 * remain enforced by desktop IPC; an image preview is never proof of a completed video. */
function videoOutput(value: string): boolean {
  let path = value.trim();
  if (path.startsWith("aivora-media:")) {
    try {
      const url = new URL(path);
      if (url.hostname !== "local") return false;
      path = url.searchParams.get("path") ?? "";
    } catch {
      return false;
    }
  }
  return (
    (/^\//.test(path) || /^[a-z]:[\\/]/i.test(path)) &&
    !path.includes("\0") &&
    /\.(mp4|webm|mov)$/i.test(path)
  );
}

/** Merge only this version into the latest film, preserving selected successful versions
 * and unrelated edits made while the provider was working. */
/**
 * 4B-B09: the take without burned subtitles and the times of its subtitles, as the service
 * reports them. Anything malformed is left out rather than guessed.
 */
export function exportMedia(
  data: Record<string, unknown>,
): Pick<FilmTake, "cleanVideoPath" | "subtitleCues" | "cleanCopyReason"> {
  const clean = typeof data.clean_output_path === "string" ? data.clean_output_path.trim() : "";
  const reason =
    typeof data.clean_copy_reason === "string" ? data.clean_copy_reason.trim().slice(0, 200) : "";
  const failed = typeof data.clean_copy_error === "string" && data.clean_copy_error.trim() !== "";
  const cues = Array.isArray(data.subtitle_cues)
    ? data.subtitle_cues.flatMap((raw) => {
        if (!raw || typeof raw !== "object") return [];
        const cue = raw as Record<string, unknown>;
        const text = typeof cue.text === "string" ? cue.text.trim() : "";
        const start = cue.start_seconds;
        const end = cue.end_seconds;
        return text &&
          typeof start === "number" &&
          typeof end === "number" &&
          Number.isFinite(start) &&
          Number.isFinite(end) &&
          end > start &&
          start >= 0
          ? [{ text, start, end }]
          : [];
      })
    : [];
  const cleanVideoPath = clean && /\.mp4$/i.test(clean) ? clean : "";
  return {
    ...(cleanVideoPath ? { cleanVideoPath } : {}),
    ...(cues.length ? { subtitleCues: cues } : {}),
    ...(!cleanVideoPath && (reason || failed)
      ? { cleanCopyReason: reason || "不带字幕的那份没有做出来" }
      : {}),
  };
}

/** A take's media from an earlier result never describes the new one (4B-B11). */
function withoutExportMedia(take: FilmTake): FilmTake {
  const copy = { ...take };
  delete copy.cleanVideoPath;
  delete copy.subtitleCues;
  delete copy.cleanCopyReason;
  return copy;
}

export function applyVideoResponse(
  latest: FilmProject,
  shot: FilmShot,
  take: FilmTake,
  data: Record<string, unknown>,
) {
  const jobId = `video:${take.id}`;
  const reportedNotice =
    data.user_message && typeof data.user_message === "object"
      ? (data.user_message as Record<string, unknown>)
      : null;
  const message =
    data.status !== "SUCCEEDED" &&
    reportedNotice &&
    typeof reportedNotice.code === "string" &&
    typeof reportedNotice.text === "string"
      ? presentNotice({
          code: reportedNotice.code,
          text: reportedNotice.text,
          ...(typeof reportedNotice.detail === "string" ? { detail: reportedNotice.detail } : {}),
        }).text
      : typeof data.message === "string"
        ? data.message
        : "";
  const output = typeof data.output_path === "string" ? data.output_path.trim() : "";
  const preview = typeof data.preview_image === "string" ? data.preview_image : "";
  const reportedRaw = data.duration_seconds;
  const reported =
    typeof reportedRaw === "number"
      ? reportedRaw
      : typeof reportedRaw === "string"
        ? Number(reportedRaw)
        : 0;
  const ok = data.status === "SUCCEEDED";
  const done = ok && videoOutput(output);
  const videoUrl = done ? fileMediaUrl(output) : "";
  const takes = (latest.shots.find((item) => item.id === shot.id)?.takes ?? []).map((item) =>
    item.id === take.id
      ? {
          ...withoutExportMedia(item),
          status: done ? ("done" as const) : ("failed" as const),
          videoPath: output,
          ...(done && Number.isFinite(reported) && reported >= 1
            ? { durationSeconds: reported }
            : {}),
          videoUrl,
          stillUrl: preview,
          reason: message,
          ...(done ? exportMedia(data) : {}),
        }
      : item,
  );
  const frame =
    preview.startsWith("data:") || preview.startsWith("blob:") || preview.startsWith("http")
      ? preview
      : "";
  const selectedId = latest.shots.find((item) => item.id === shot.id)?.selectedTakeId ?? "";
  const selectedDone = takes.some(
    (item) => item.id === selectedId && item.status === "done" && item.videoPath,
  );
  const selected = selectedDone
    ? selectedId
    : done
      ? take.id
      : selectedId === take.id
        ? ""
        : selectedId;
  let saved = {
    ...latest,
    shots: latest.shots.map((item) =>
      item.id === shot.id ? { ...item, takes, selectedTakeId: selected } : item,
    ),
  };
  if (done && frame) saved = updateShot(saved, shot.id, { poster: frame });
  const voicePath = typeof data.voice_path === "string" ? data.voice_path : "";
  if (done && isVoiceFile(voicePath) && shotLines(shot).length) {
    saved = {
      ...saved,
      shots: saved.shots.map((item) => {
        if (item.id !== shot.id) return item;
        const lines = shotLines(item);
        return {
          ...item,
          ...(!item.line.trim()
            ? {
                line: lines.map((line) => line.text).join("\n"),
                speaker:
                  new Set(lines.map((line) => line.speaker)).size === 1
                    ? (lines[0]?.speaker ?? "")
                    : "",
              }
            : {}),
          sound: { ...item.sound, source: "dub" as const },
        };
      }),
      audioClips: [
        ...saved.audioClips.filter((clip) => clip.id !== `voice-${shot.id}-${take.id}`),
        {
          id: `voice-${shot.id}-${take.id}`,
          lane: "dialogue",
          shotId: shot.id,
          takeId: take.id,
          label: "配音",
          startSeconds: 0,
          durationSeconds: Number.isFinite(reported) && reported >= 1 ? reported : shot.seconds,
          offsetSeconds: 0,
          gainDb: 0,
          path: voicePath,
        },
      ],
    };
  }
  if (done && Number.isFinite(reported) && reported > 0.4) {
    const shown = Math.max(1, reported);
    const chosen = saved.shots.find((item) => item.id === shot.id)?.seconds ?? 0;
    if (Math.abs(shown - chosen) >= 1) {
      saved = updateShot(saved, shot.id, { seconds: shown });
    }
  }
  saved = {
    ...saved,
    jobs: saved.jobs.map((job) =>
      job.id === jobId
        ? {
            ...job,
            status: done ? ("done" as const) : ("failed" as const),
            reason: message,
          }
        : job,
    ),
  };

  return { film: saved, done, message };
}

/** Runs a prepared queue; billing, permission gates and failure presentation belong to
 * the caller. Persistence is awaited before dispatch, including durable partial commits. */
export async function runPreparedGeneration(queue: Queue, host: GenerationRunHost): Promise<void> {
  const { film: next, groups } = queue;
  const queueStopped = async () => {
    const interruption = videoQueueInterruption(
      host.current() ?? next,
      host.stopped(),
      host.paused(),
    );
    if (!interruption) return false;
    await host.apply(interruption.film);
    host.notice(interruption.notice);
    return true;
  };
  await host.persist(next);
  if (!host.valid()) return;
  for (const group of groups) {
    for (let index = 0; index < group.takes.length; index += 1) {
      const take = group.takes[index]!;
      const jobId = `video:${take.id}`;
      if (!host.valid()) return;
      const current = host.current() ?? next;
      if (host.cancelled(jobId)) {
        await host.apply(cancelVideoTask(current, take.id).film);
        continue;
      }
      if (await queueStopped()) return;
      const targetShot = current.shots.find((item) => item.id === group.shot.id) ?? group.shot;
      const frameHost = {
        current: host.current,
        valid: host.valid,
        apply: host.apply,
        execution: host.execution,
      };
      const cached = host.execution?.preparation(group.shot.id) === "STORYFILM_CACHE";
      const connectedShot = cached
        ? targetShot
        : await (host.continuity ?? ensureContinuityFrame)(current, targetShot, frameHost);
      const shotNow = cached
        ? connectedShot
        : await (host.frame ?? ensureShotFrame)(
            host.current() ?? current,
            connectedShot,
            frameHost,
          );
      if (!host.valid()) return;
      const beforeSend = host.current() ?? current;
      if (host.cancelled(jobId)) {
        await host.apply(cancelVideoTask(beforeSend, take.id).film);
        continue;
      }
      if (await queueStopped()) return;
      const dispatched = setVideoTaskState(beforeSend, take.id, "running");
      await host.apply(dispatched);
      await host.persist(dispatched);
      if (!host.valid()) return;
      if (host.cancelled(jobId) || host.stopped()) {
        await host.apply(cancelVideoTask(host.current() ?? dispatched, take.id).film);
        if (await queueStopped()) return;
        continue;
      }
      if (host.paused()) {
        await host.apply(setVideoTaskState(host.current() ?? dispatched, take.id, "queued"));
        await queueStopped();
        return;
      }
      const body = generationVideoBody(
        dispatched,
        shotNow,
        group.shot,
        group.takes[0]?.id,
        current.draft,
      );
      const evidenceContext = dialogueEvidenceContext(dispatched, group.shot.id, take.id);
      const evidenceKey = JSON.stringify(evidenceContext);
      const inputFingerprint = await historyRecordHash(evidenceContext).catch(() => undefined);
      // This new await remains before the final existing cancellation/pause gate.
      if (!host.valid()) return;
      if (host.cancelled(jobId) || host.stopped()) {
        await host.apply(cancelVideoTask(host.current() ?? dispatched, take.id).film);
        if (await queueStopped()) return;
        continue;
      }
      if (host.paused()) {
        await host.apply(setVideoTaskState(host.current() ?? dispatched, take.id, "queued"));
        await queueStopped();
        return;
      }
      if (
        JSON.stringify(dialogueEvidenceContext(host.current(), group.shot.id, take.id)) !==
        evidenceKey
      ) {
        await host.apply(cancelVideoTask(host.current() ?? dispatched, take.id).film);
        host.notice({
          code: "GENERATION_SELECTION_STALE",
          text: NOTICE_TEXT.GENERATION_SELECTION_STALE,
        });
        return;
      }
      const response = await awaitVideoResult(
        () =>
          host.request(
            { ...body!, regenerate: index > 0 || group.hadTakes },
            inputFingerprint
              ? {
                  projectId: dispatched.id,
                  shotId: group.shot.id,
                  takeId: take.id,
                  inputFingerprint,
                }
              : undefined,
            host.execution?.video(group.shot.id, index, take.id),
          ),
        () => !host.valid() || host.stopped() || host.cancelled(jobId),
      );
      if (!host.valid()) return;
      if (host.cancelled(jobId)) {
        await host.apply(cancelVideoTask(host.current() ?? current, take.id).film);
        continue;
      }
      rememberDialogueLimit(dispatched.id, group.shot.id, take.id, response.data);
      const result = applyVideoResponse(
        host.current() ?? current,
        group.shot,
        take,
        response.data ?? {},
      );
      await host.apply(result.film);
      host.completed({ shotId: group.shot.id, done: result.done, message: result.message });
    }
  }
}

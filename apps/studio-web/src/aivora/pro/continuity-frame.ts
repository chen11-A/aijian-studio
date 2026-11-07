import { ProtectedGenerationFailure } from "../film/generation-execution-failure";
import {
  isGenerationExecutionFailureCode,
  protectedGenerationFailure,
} from "./actions/generation-execution";
import type { GenerationExecutionSession } from "./actions/generation-execution";
import type { FilmGenerationExtractionExecution } from "@aijian/contracts/film-generation-execution";
import type { FilmProject, FilmShot } from "../film/project";

export type ContinuityFrame = NonNullable<FilmShot["continuityFrame"]>;
export type ContinuityShot = FilmShot;
type ExtractionResult = {
  path: string;
  sourceVideoPath: string;
  code?: string;
  text?: string;
};
export type ContinuityFrameHost = {
  execution?: GenerationExecutionSession;
  current: () => FilmProject | null;
  valid: () => boolean;
  /** Await persistence before the caller submits the video. */
  apply: (film: FilmProject) => void | Promise<void>;
  extract?: (
    seriesId: string,
    videoPath: string,
    execution?: FilmGenerationExtractionExecution,
  ) => Promise<ExtractionResult>;
};
class ContinuityFrameError extends Error {
  constructor(
    readonly code: string,
    readonly text: string,
  ) {
    super(text);
  }
}
export const continuityFailureNotice = (error: unknown) =>
  error instanceof ContinuityFrameError ? { code: error.code, text: error.text } : null;
const fail = (code: string, text: string): never => {
  throw new ContinuityFrameError(code, text);
};
function localPath(value: string, extension: RegExp): string {
  let path = value;
  if (path.startsWith("aivora-media:")) {
    try {
      const url = new URL(path);
      if (url.hostname !== "local") return "";
      path = url.searchParams.get("path") ?? "";
    } catch {
      return "";
    }
  }
  return (/^\//.test(path) || /^[a-z]:[\\/]/i.test(path)) &&
    !path.includes("\0") &&
    extension.test(path)
    ? path
    : "";
}

/** Call immediately before video submission, never during preview-only still generation. */
export async function ensureContinuityFrame(
  film: FilmProject,
  shot: ContinuityShot,
  host: ContinuityFrameHost,
): Promise<ContinuityShot> {
  if (!shot.continuityFromShotId) return shot;
  const captured = host.current();
  if (!host.valid() || !captured || captured.id !== film.id)
    return fail("CONTINUITY_REQUEST_STALE", "镜头内容已变化，请重试。");
  const index = captured.shots.findIndex((item) => item.id === shot.id);
  const currentShot = captured.shots[index] as ContinuityShot | undefined;
  const source = captured.shots[index - 1];
  if (!currentShot || JSON.stringify(currentShot) !== JSON.stringify(shot))
    return fail("CONTINUITY_REQUEST_STALE", "镜头内容已变化，请重试。");
  if (!source || source.id !== shot.continuityFromShotId || source.sceneId !== shot.sceneId)
    return fail("CONTINUITY_SOURCE_INVALID", "只能衔接同场紧邻前镜的末帧。");
  const take = source.takes.find((item) => item.id === source.selectedTakeId);
  const sourcePath = take && localPath(take.videoPath, /\.mp4$/i);
  if (!take || take.status !== "done" || !sourcePath)
    return fail("CONTINUITY_SOURCE_NOT_READY", "前镜尚无已选定的本地视频，请先完成前镜。");
  const prior = currentShot.continuityFrame;
  if (
    !host.execution &&
    prior &&
    prior.sourceShotId === source.id &&
    prior.sourceTakeId === take.id &&
    prior.sourceVideoPath === sourcePath &&
    prior.path === currentShot.poster &&
    localPath(prior.path, /\.png$/i)
  )
    return currentShot;
  const extract = host.extract ?? window.aijian?.extractFilmLastFrame;
  if (!extract) return fail("CONTINUITY_DESKTOP_REQUIRED", "需要桌面端提取前镜末帧。");
  const snapshot = JSON.stringify(captured);
  const valid = () =>
    host.valid() && host.current() === captured && JSON.stringify(captured) === snapshot;
  let result: ExtractionResult;
  try {
    result = host.execution
      ? await extract(
          captured.seriesId,
          take.videoPath,
          host.execution.continuity(shot.id, source.id),
        )
      : await extract(captured.seriesId, take.videoPath);
  } catch (error) {
    if (error instanceof ProtectedGenerationFailure) throw error;
    if (host.execution) throw protectedGenerationFailure("WRITE_UNCONFIRMED");
    return fail(
      valid() ? "CONTINUITY_EXTRACTION_FAILED" : "CONTINUITY_REQUEST_STALE",
      "末帧提取未完成，请重试。",
    );
  }
  if (host.execution && isGenerationExecutionFailureCode(result.code))
    throw protectedGenerationFailure(result.code);
  if (!valid()) return fail("CONTINUITY_REQUEST_STALE", "镜头内容已变化，本次末帧未写入。");
  if (
    !localPath(result.path, /\.png$/i) ||
    localPath(result.sourceVideoPath, /\.mp4$/i) !== sourcePath
  )
    return fail(
      result.code?.startsWith("CONTINUITY_") ? result.code : "CONTINUITY_FRAME_INVALID",
      "前镜末帧未完成，请检查前镜视频。",
    );
  const next: ContinuityShot = {
    ...currentShot,
    poster: result.path,
    continuityFrame: {
      sourceShotId: source.id,
      sourceTakeId: take.id,
      sourceVideoPath: result.sourceVideoPath,
      path: result.path,
    },
  };
  await host.apply({
    ...captured,
    shots: captured.shots.map((item) => (item.id === shot.id ? next : item)),
  });
  return next;
}

import type {
  FilmRiskTrialDecision,
  FilmRiskTrialFailure,
  FilmRiskTrialInput,
  FilmRiskTrialReady,
} from "@aijian/contracts/film-risk-trial";
import {
  riskTrialCreative,
  riskTrialShots,
  riskTrialTarget,
  trialObject,
} from "@aijian/contracts/film-risk-trial-context";
import type { FilmProject } from "../../film/project";
import type { FilmSaveLease, createFilmPersistence } from "../film-persistence";
import { prepareCurrentFilmCheckpoint, type SplitScope } from "./dialogue-split-native";
import { historyRecordHash } from "./persistent-history";
export type ActualTrialScope = SplitScope;
export type ActualTrialHost = {
  current: () => FilmProject | null;
  selection: () => ActualTrialScope | null;
  apply: (film: FilmProject) => FilmProject;
  persistence: ReturnType<typeof createFilmPersistence>;
  onCanonicalPrepared?: (film: FilmProject) => void;
};
export type ActualTrialCapture = {
  ready: FilmRiskTrialReady;
  raw: Record<string, unknown>;
  key: string;
  scope: ActualTrialScope;
};
const sha = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const shortText = (v: unknown): v is string =>
  typeof v === "string" &&
  v.length > 0 &&
  v.length <= 8192 &&
  !Array.from(v).some((c) => c.charCodeAt(0) === 0);
export const TRIAL_FAILURE: Record<FilmRiskTrialFailure["code"], string> = {
  INVALID_INPUT: "本次记录内容或范围无法核验，请核对后重试。",
  PROJECT_CHANGED: "已保存的作品已变化，请重新核对实际素材。",
  SOURCE_UNVERIFIED: "实际素材暂时无法核验，请重新读取后核对。",
  TOOLS_UNAVAILABLE: "本机媒体工具暂时不可用，还不能核对实际素材。",
  BUSY: "本机还在处理这部作品，请稍后手动核对。",
  UNSUPPORTED_SCOPE: "当前作品或参考关系暂时不能完整核对，请先逐镜检查。",
  WRITE_FAILED: "人工决定没有保存上，当前编辑已保留。",
  WRITE_UNCONFIRMED: "人工决定保存结果尚未确认，请先核对，不要重复记录。",
  REVIEW_STALE: "素材、创作输入或当前会话已变化，请重新核对实际素材。",
};
/** Internal invalidation only. Never rendered, persisted or sent as authorization. */
export function actualTrialInputKey(
  film: FilmProject | null,
  scope: ActualTrialScope | null,
): string | null {
  if (!film || !scope || film.id !== scope.projectId) return null;
  try {
    const shots = riskTrialShots(film).filter((shot) => shot.id === scope.shotId);
    if (shots.length !== 1) return null;
    const shot = shots[0]!,
      takes = Array.isArray(shot.takes)
        ? shot.takes.filter((value) => trialObject(value)?.id === scope.takeId)
        : [];
    if (
      takes.length !== 1 ||
      shot.selectedTakeId !== scope.takeId ||
      trialObject(takes[0])?.status !== "done" ||
      typeof trialObject(takes[0])?.videoPath !== "string" ||
      !trialObject(takes[0])?.videoPath
    )
      return null;
    return JSON.stringify([scope, riskTrialCreative(film), riskTrialTarget(film, shot)]);
  } catch {
    return null;
  }
}
export function validTrialDecision(value: unknown): value is FilmRiskTrialDecision {
  const row = trialObject(value);
  return (
    !!row &&
    Object.keys(row).sort().join() ===
      "decision,id,inputFingerprint,note,projectId,recordedAt,schemaVersion,shotId,takeId" &&
    row.schemaVersion === 1 &&
    typeof row.id === "string" &&
    /^rtd_[a-f0-9]{32}$/.test(row.id) &&
    shortText(row.projectId) &&
    shortText(row.shotId) &&
    shortText(row.takeId) &&
    sha(row.inputFingerprint) &&
    ["accepted", "needs-changes"].includes(String(row.decision)) &&
    typeof row.note === "string" &&
    row.note.length <= 500 &&
    typeof row.recordedAt === "string" &&
    Number.isFinite(Date.parse(row.recordedAt))
  );
}
export function validTrialReady(
  value: unknown,
  input: FilmRiskTrialInput,
  raw: Record<string, unknown>,
): value is FilmRiskTrialReady {
  const row = trialObject(value),
    shots = Array.isArray(raw.shots) ? raw.shots : [];
  if (
    !row ||
    row.kind !== "READY" ||
    row.projectId !== input.projectId ||
    row.projectHash !== input.expectedHash ||
    row.shotId !== input.shotId ||
    row.takeId !== input.takeId ||
    typeof row.reviewId !== "string" ||
    !/^rtr_[a-f0-9]{32}$/.test(row.reviewId) ||
    !sha(row.inputFingerprint) ||
    !shortText(row.label) ||
    !shortText(row.versionLabel) ||
    typeof row.durationSeconds !== "number" ||
    !Number.isFinite(row.durationSeconds) ||
    row.durationSeconds <= 0 ||
    row.batchShotCount !== shots.length ||
    shots.length < 1 ||
    shots.length > 256 ||
    !Array.isArray(row.limitations) ||
    row.limitations.length > 256 ||
    !row.limitations.every(shortText)
  )
    return false;
  return (
    row.existingDecision === null ||
    (validTrialDecision(row.existingDecision) &&
      row.existingDecision.projectId === input.projectId &&
      row.existingDecision.shotId === input.shotId &&
      row.existingDecision.takeId === input.takeId &&
      row.existingDecision.inputFingerprint === row.inputFingerprint)
  );
}
export function actualTrialCurrent(
  host: ActualTrialHost,
  review: Pick<ActualTrialCapture, "key" | "scope">,
): boolean {
  return (
    JSON.stringify(host.selection()) === JSON.stringify(review.scope) &&
    actualTrialInputKey(host.current(), review.scope) === review.key
  );
}
const sameWithoutSaveTime = async (a: Record<string, unknown>, b: Record<string, unknown>) =>
  historyRecordHash({ ...a, savedAt: b.savedAt }).then((hash) =>
    historyRecordHash(b).then((expected) => hash === expected),
  );
export async function prepareActualTrial(
  host: ActualTrialHost,
  isCurrent: () => boolean,
): Promise<
  | { kind: "ready"; review: ActualTrialCapture }
  | { kind: "failed"; message: string }
  | { kind: "stale" }
  | { kind: "unsupported" }
> {
  const bridge = window.aijian,
    base = host.current(),
    scope = host.selection();
  let key = actualTrialInputKey(base, scope);
  if (
    !bridge?.readFilmProject ||
    !bridge.prepareFilmRiskTrial ||
    !bridge.readFilmRiskTrialMedia ||
    !bridge.recordFilmRiskTrialDecision ||
    !bridge.checkFilmRiskTrialDecision
  )
    return { kind: "unsupported" };
  if (!base || !scope || !key)
    return { kind: "failed", message: "请先明确选择一个已有画面素材的版本，再核对实际试片。" };
  const valid = () =>
    isCurrent() &&
    JSON.stringify(host.selection()) === JSON.stringify(scope) &&
    actualTrialInputKey(host.current(), scope) === key;
  let lease: FilmSaveLease | undefined,
    prepared: Awaited<ReturnType<typeof prepareCurrentFilmCheckpoint>> | undefined;
  try {
    lease = await host.persistence.acquire(base.id);
    if (!valid()) return { kind: "stale" };
    prepared = await prepareCurrentFilmCheckpoint(
      {
        ...host,
        onCanonicalPrepared: (canonical) => {
          key = actualTrialInputKey(canonical, scope);
          host.onCanonicalPrepared?.(canonical);
        },
      },
      base,
      scope,
      lease,
    );
  } catch {
    return valid()
      ? { kind: "failed", message: "当前编辑还没保存上，请先核对保存状态，再准备试片。" }
      : { kind: "stale" };
  } finally {
    try {
      await lease?.release();
    } catch {
      prepared = undefined;
    }
  }
  if (!valid()) return { kind: "stale" };
  if (!prepared)
    return { kind: "failed", message: "当前编辑还没保存上，请先核对保存状态，再准备试片。" };
  try {
    let raw = prepared.raw,
      expectedHash = prepared.expectedHash;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!valid()) return { kind: "stale" };
      const input = {
        projectId: base.id,
        expectedHash,
        shotId: scope.shotId,
        takeId: scope.takeId,
      };
      const result: unknown = await bridge.prepareFilmRiskTrial(input);
      if (!valid()) return { kind: "stale" };
      if (validTrialReady(result, input, raw))
        return {
          kind: "ready",
          review: {
            ready: structuredClone(result),
            raw: structuredClone(raw),
            key: key!,
            scope: { ...scope },
          },
        };
      const failure = trialObject(result);
      if (
        attempt === 0 &&
        failure?.kind === "FAILED" &&
        failure.code === "PROJECT_CHANGED" &&
        failure.unchanged === true
      ) {
        const fresh = trialObject(await bridge.readFilmProject(base.id));
        if (!valid()) return { kind: "stale" };
        if (fresh?.id === base.id && (await sameWithoutSaveTime(fresh, raw))) {
          const hash = await historyRecordHash(fresh);
          if (!valid()) return { kind: "stale" };
          if (hash !== expectedHash) {
            raw = fresh;
            expectedHash = hash;
            continue;
          }
        }
      }
      const code =
        failure?.kind === "FAILED" &&
        typeof failure.code === "string" &&
        Object.hasOwn(TRIAL_FAILURE, failure.code)
          ? (failure.code as FilmRiskTrialFailure["code"])
          : null;
      return {
        kind: "failed",
        message: code ? TRIAL_FAILURE[code] : "实际素材的核对结果没有完整读到，请重新准备试片。",
      };
    }
  } catch {
    return valid()
      ? { kind: "failed", message: "实际素材暂时没有读到，请稍后手动重新核对。" }
      : { kind: "stale" };
  }
  return { kind: "failed", message: "实际素材暂时没有核对完成，请手动重试。" };
}
export async function readActualTrialMedia(
  host: ActualTrialHost,
  review: ActualTrialCapture,
  isCurrent: () => boolean,
): Promise<
  { kind: "media"; bytes: Uint8Array } | { kind: "stale" } | { kind: "failed"; message: string }
> {
  const current = () => isCurrent() && actualTrialCurrent(host, review);
  if (!current()) return { kind: "stale" };
  try {
    const result = await window.aijian?.readFilmRiskTrialMedia?.(
      review.scope.projectId,
      review.ready.reviewId,
    );
    if (!current()) return { kind: "stale" };
    if (
      result?.kind === "MEDIA" &&
      result.bytes instanceof Uint8Array &&
      result.bytes.byteLength > 0 &&
      result.bytes.byteLength <= 80 * 1024 * 1024 &&
      result.bytes.buffer instanceof ArrayBuffer
    )
      return { kind: "media", bytes: result.bytes };
    return {
      kind: "failed",
      message:
        result?.kind === "FAILED" &&
        typeof result.code === "string" &&
        Object.hasOwn(TRIAL_FAILURE, result.code)
          ? TRIAL_FAILURE[result.code]
          : "实际素材没有完整读到，请重新核对；这不代表已经播放。",
    };
  } catch {
    return current()
      ? { kind: "failed", message: "实际素材暂时没有读到，请稍后手动重试。" }
      : { kind: "stale" };
  }
}

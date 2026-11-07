import type {
  FilmRiskTrialDecision,
  FilmRiskTrialFailure,
  FilmRiskTrialGateway,
  FilmRiskTrialRecordInput,
} from "@aijian/contracts/film-risk-trial";
import { trialObject } from "@aijian/contracts/film-risk-trial-context";
import type { FilmProject } from "../../film/project";
import type { FilmSaveLease } from "../film-persistence";
import { prepareCurrentFilmCheckpoint } from "./dialogue-split-native";
import { historyRecordHash } from "./persistent-history";
import {
  actualTrialCurrent,
  TRIAL_FAILURE,
  validTrialDecision,
  validTrialReady,
  type ActualTrialCapture,
  type ActualTrialHost,
} from "./actual-risk-trial";
export type PendingActualTrialWrite = {
  before: FilmProject;
  rawBefore: Record<string, unknown>;
  review: ActualTrialCapture;
  input: FilmRiskTrialRecordInput;
  ack?: Extract<
    Awaited<ReturnType<FilmRiskTrialGateway["recordFilmRiskTrialDecision"]>>,
    { kind: "RECORDED" }
  >;
  observedRaw?: Record<string, unknown>;
  localDraft?: FilmProject;
};
export type ActualTrialConflict = {
  raw: Record<string, unknown>;
  live: FilmProject | null;
  draft: FilmProject;
};
export type ActualTrialOutcome = {
  kind: "recorded" | "failed" | "stale" | "unknown";
  message: string;
  recorded?: { value: FilmRiskTrialDecision; verified: boolean };
  pending?: PendingActualTrialWrite;
};
const unknown = (
  pending: PendingActualTrialWrite,
  message = TRIAL_FAILURE.WRITE_UNCONFIRMED,
): ActualTrialOutcome => ({ kind: "unknown", message, pending });
function external(lease: FilmSaveLease) {
  if (!lease.beginExternalWrite || !lease.markExternalWriteUnknown || !lease.confirmExternalWrite)
    throw Error("EXTERNAL_UNSUPPORTED");
  return {
    begin: lease.beginExternalWrite,
    unknown: lease.markExternalWriteUnknown,
    confirm: lease.confirmExternalWrite,
  };
}
const exactKeys = (row: Record<string, unknown>, keys: string[]) =>
  Object.keys(row).sort().join() === [...keys].sort().join();
const sha = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
/** Stored binding is integrity metadata, never permission to continue a batch. */
async function publicStoredDecision(value: unknown): Promise<FilmRiskTrialDecision | null> {
  const row = trialObject(value),
    binding = trialObject(row?.binding);
  if (
    !row ||
    !binding ||
    !exactKeys(binding, ["global", "trial", "targets"]) ||
    !sha(binding.global) ||
    !sha(binding.trial) ||
    !Array.isArray(binding.targets) ||
    binding.targets.length > 256
  )
    return null;
  const ids = new Set<string>();
  for (const value of binding.targets) {
    const target = trialObject(value);
    if (
      !target ||
      !exactKeys(target, ["shotId", "fingerprint"]) ||
      typeof target.shotId !== "string" ||
      !target.shotId ||
      ids.has(target.shotId) ||
      !sha(target.fingerprint)
    )
      return null;
    ids.add(target.shotId);
  }
  const plain = Object.fromEntries(Object.entries(row).filter(([key]) => key !== "binding"));
  if (
    !validTrialDecision(plain) ||
    (await historyRecordHash({
      projectId: plain.projectId,
      shotId: plain.shotId,
      takeId: plain.takeId,
      binding,
    })) !== plain.inputFingerprint
  )
    return null;
  return plain;
}
async function appendedDecision(pending: PendingActualTrialWrite, raw: Record<string, unknown>) {
  const before =
    pending.rawBefore.riskTrialDecisions === undefined ? [] : pending.rawBefore.riskTrialDecisions;
  const rows = raw.riskTrialDecisions;
  if (
    !Array.isArray(before) ||
    !Array.isArray(rows) ||
    rows.length !== before.length + 1 ||
    rows.length > 64 ||
    typeof raw.savedAt !== "string" ||
    !Number.isFinite(Date.parse(raw.savedAt))
  )
    return null;
  const identifiers = rows.map((row) => trialObject(row)?.id);
  if (identifiers.some((id) => typeof id !== "string") || new Set(identifiers).size !== rows.length)
    return null;
  const candidate = await publicStoredDecision(rows.at(-1));
  if (
    !candidate ||
    candidate.projectId !== pending.input.projectId ||
    candidate.shotId !== pending.review.scope.shotId ||
    candidate.takeId !== pending.review.scope.takeId ||
    candidate.inputFingerprint !== pending.review.ready.inputFingerprint ||
    candidate.decision !== pending.input.decision ||
    candidate.note !== pending.input.note
  )
    return null;
  const expected = {
    ...pending.rawBefore,
    riskTrialDecisions: [...before, rows.at(-1)],
    savedAt: raw.savedAt,
  };
  if ((await historyRecordHash(raw)) !== (await historyRecordHash(expected))) return null;
  if (
    pending.ack &&
    ((await historyRecordHash(pending.ack.decision)) !== (await historyRecordHash(candidate)) ||
      (await historyRecordHash(pending.ack.project)) !== (await historyRecordHash(raw)))
  )
    return null;
  return candidate;
}
/** Only fixed refusals emitted after a legal prepare entered the same factory gate. */
const settledCodes = new Set<FilmRiskTrialFailure["code"]>([
  "PROJECT_CHANGED",
  "SOURCE_UNVERIFIED",
  "TOOLS_UNAVAILABLE",
  "UNSUPPORTED_SCOPE",
  "REVIEW_STALE",
]);
async function settleActualTrial(
  host: ActualTrialHost,
  pending: PendingActualTrialWrite,
  lease: FilmSaveLease,
  discard?: ActualTrialConflict,
): Promise<ActualTrialOutcome> {
  const ext = external(lease),
    bridge = window.aijian;
  const raw = trialObject(await bridge?.readFilmProject?.(pending.before.id));
  if (!raw || raw.id !== pending.before.id)
    return unknown(pending, "原作品暂时读不到，编辑副本已保留，请重新核对。");
  const rawHash = await historyRecordHash(raw),
    input = {
      projectId: pending.before.id,
      expectedHash: rawHash,
      shotId: pending.review.scope.shotId,
      takeId: pending.review.scope.takeId,
    };
  const reply = await bridge?.prepareFilmRiskTrial?.(input);
  const ready = validTrialReady(reply, input, raw) ? reply : null;
  const refusal = reply?.kind === "FAILED" && settledCodes.has(reply.code);
  if (!ready && !refusal)
    return unknown(
      pending,
      reply?.kind === "FAILED" && reply.code === "BUSY"
        ? "本机记录还在处理中，请稍后手动核对，不要重复记录。"
        : TRIAL_FAILURE.WRITE_UNCONFIRMED,
    );
  const unchanged = rawHash === (await historyRecordHash(pending.rawBefore));
  const decision = unchanged ? null : await appendedDecision(pending, raw);
  if (!unchanged && !decision)
    return unknown(pending, "人工记录与作品其他内容尚不能完整核对，编辑副本已保留，请勿重复记录。");
  const verified =
    !!decision &&
    !!ready &&
    ready.inputFingerprint === pending.review.ready.inputFingerprint &&
    !!ready.existingDecision &&
    (await historyRecordHash(ready.existingDecision)) === (await historyRecordHash(decision));
  const fresh = trialObject(await bridge?.readFilmProject?.(pending.before.id));
  if (!fresh || (await historyRecordHash(fresh)) !== rawHash)
    return unknown(pending, "原作品又有变化，请重新核对人工记录保存状态。");
  pending.observedRaw = raw;
  const current = host.current(),
    state = host.persistence.externalWriteState(pending.before.id),
    draft = state?.draft;
  if (!state || !draft) return unknown(pending);
  pending.localDraft = draft;
  const unchangedDraft =
    (await historyRecordHash(draft)) === (await historyRecordHash(pending.before));
  const approved =
    discard &&
    discard.live === current &&
    discard.draft === draft &&
    (await historyRecordHash(discard.raw)) === rawHash;
  // The complete delta originates from a typed, receipt-checked before record.
  // Do not normalize it again and silently change unrelated shots or media.
  const saved = raw as unknown as FilmProject;
  // All asynchronous proofs are complete. The final draft/current checks and apply/confirm
  // are one synchronous segment, including a foreign draft whose current object returned.
  if (
    !saved ||
    host.current() !== current ||
    host.persistence.externalWriteState(pending.before.id)?.draft !== draft
  )
    return unknown(pending, "当前作品或保留稿又有变化，请重新核对。");
  if (
    discard
      ? !approved
      : !unchangedDraft ||
        (current?.id === pending.before.id && !actualTrialCurrent(host, pending.review))
  )
    return unknown(pending, "保存版与后来的编辑不同，两份状态都已保留；请查看后明确选择。");
  const adopted =
    current?.id === pending.before.id
      ? unchanged && !discard
        ? current
        : host.apply(saved)
      : undefined;
  if (!ext.confirm(saved, adopted, () => host.current() === adopted)) {
    ext.unknown(saved);
    return unknown(pending);
  }
  if (unchanged)
    return {
      kind: "failed",
      message: "已核对：这次人工决定没有写入，当前编辑已保留；没有重复记录。",
    };
  return {
    kind: "recorded",
    recorded: { value: decision!, verified },
    message: verified
      ? "人工决定已记录。继续仍须重新确认生成范围、数量与费用。"
      : "人工决定已记录，试片需重新核对；还不能据此继续生成。",
  };
}
async function releaseActualTrial(
  host: ActualTrialHost,
  lease: FilmSaveLease | undefined,
  result: ActualTrialOutcome,
  pending?: PendingActualTrialWrite,
): Promise<ActualTrialOutcome> {
  try {
    await lease?.release();
    return result;
  } catch {
    if (pending && host.persistence.externalWriteState(pending.before.id)) return unknown(pending);
    return {
      ...result,
      kind: "failed",
      message: result.recorded
        ? "人工记录已核对，但后来的编辑尚未保存，请重试保存。"
        : "当前编辑尚未保存，请先核对保存状态。",
      pending: undefined,
    };
  }
}
export async function recordActualTrial(
  host: ActualTrialHost,
  review: ActualTrialCapture,
  decision: "accepted" | "needs-changes",
  note: string,
): Promise<ActualTrialOutcome> {
  let lease: FilmSaveLease | undefined,
    pending: PendingActualTrialWrite | undefined,
    result: ActualTrialOutcome;
  const base = host.current(),
    bridge = window.aijian;
  if (
    !base ||
    !actualTrialCurrent(host, review) ||
    !bridge?.recordFilmRiskTrialDecision ||
    !bridge.prepareFilmRiskTrial ||
    !["accepted", "needs-changes"].includes(decision) ||
    typeof note !== "string" ||
    note.length > 500
  )
    return { kind: "stale", message: "本次输入、版本或审核内容已变化，请重新核对后记录。" };
  try {
    lease = await host.persistence.acquire(base.id);
    if (!actualTrialCurrent(host, review)) throw Error("STALE");
    const prepared = await prepareCurrentFilmCheckpoint(host, base, review.scope, lease);
    if (!actualTrialCurrent(host, review) || host.current() !== prepared.film) throw Error("STALE");
    const input: FilmRiskTrialRecordInput = {
      projectId: base.id,
      expectedHash: prepared.expectedHash,
      reviewId: review.ready.reviewId,
      decision,
      note,
    };
    const ext = external(lease);
    ext.begin(() => host.current() === prepared.film && actualTrialCurrent(host, review));
    pending = { before: prepared.film, rawBefore: prepared.raw, review, input };
    const response = await bridge.recordFilmRiskTrialDecision(input);
    if (response.kind === "RECORDED") pending.ack = response;
    // No UI-generation checks here: every dispatched write is accounted for first.
    ext.unknown();
    result = await settleActualTrial(host, pending, lease);
  } catch {
    if (pending && lease) {
      external(lease).unknown();
      result = unknown(pending);
    } else
      result = {
        kind: "failed",
        message: "当前编辑未保存或已经变化，请核对后重新准备；尚未记录人工决定。",
      };
  }
  return releaseActualTrial(host, lease, result, pending);
}
export async function recoverActualTrial(
  host: ActualTrialHost,
  pending: PendingActualTrialWrite,
  discard?: ActualTrialConflict,
): Promise<ActualTrialOutcome> {
  let lease: FilmSaveLease | undefined, result: ActualTrialOutcome;
  try {
    lease = await host.persistence.acquireExternalRecovery(pending.before.id);
    result = await settleActualTrial(host, pending, lease, discard);
  } catch {
    result = unknown(pending);
  }
  return releaseActualTrial(host, lease, result, pending);
}

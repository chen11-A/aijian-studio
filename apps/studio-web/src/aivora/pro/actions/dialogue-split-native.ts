import type {
  FilmDialogueSplitReady,
  FilmDialogueSplitInput,
  FilmDialogueSplitApplyResult,
} from "@aijian/contracts/film-dialogue-split";
import {
  canonicalDialogueLines,
  projectDialogueSplitRecord,
} from "@aijian/contracts/film-dialogue-split-plan";
import { upgradeFilm, type FilmProject } from "../../film/project";
import type { FilmSaveLease, createFilmPersistence } from "../film-persistence";
import { historyRecordHash } from "./persistent-history";
import { nativeDialogueSplitInput } from "./dialogue-split";
export type SplitScope = { projectId: string; shotId: string; takeId: string; page: string };
export type SplitHost = {
  current: () => FilmProject | null;
  selection: () => SplitScope | null;
  versions: () => number;
  apply: (film: FilmProject) => FilmProject;
  persistence: ReturnType<typeof createFilmPersistence>;
  onApplied?: (message: string) => void;
  onCanonicalPrepared?: (film: FilmProject) => void;
};
export type NativeSplitReview = {
  ready: FilmDialogueSplitReady;
  raw: Record<string, unknown>;
  key: string;
  scope: SplitScope;
  versions: number;
};
export type PendingSplitWrite = {
  before: FilmProject;
  rawBefore: Record<string, unknown>;
  review: NativeSplitReview;
  input: FilmDialogueSplitInput;
  ack?: Extract<FilmDialogueSplitApplyResult, { kind: "APPLIED" }>;
  observedRaw?: Record<string, unknown>;
  localDraft?: FilmProject;
};
export type SplitOutcome = {
  kind: "applied" | "failed" | "stale" | "unknown";
  message: string;
  pending?: PendingSplitWrite;
};
const obj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const sha = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
const text = (v: unknown): v is string => typeof v === "string" && v.length <= 8192;
const metadata = (raw: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(raw).filter(([k]) => !["savedAt", "directory"].includes(k)));
export function splitInputKey(
  film: FilmProject | null,
  scope: SplitScope | null,
  versions: number,
): string | null {
  if (
    !film ||
    !scope ||
    film.id !== scope.projectId ||
    !Number.isInteger(versions) ||
    versions < 1 ||
    versions > 4
  )
    return null;
  const targets = film.shots.filter((s) => s.id === scope.shotId);
  if (targets.length !== 1 || targets[0]!.selectedTakeId !== scope.takeId) return null;
  return JSON.stringify({
    scope,
    versions,
    record: metadata(film as unknown as Record<string, unknown>),
  });
}
const failure: Record<string, string> = {
  INVALID_INPUT: "当前镜头的资料不完整，请核对后重新检查。",
  PROJECT_CHANGED: "作品、内容或版本已变化，请重新检查拆镜方案。",
  BUSY: "本机还在处理这部作品，请完成后再检查。",
  UNSUPPORTED_PLAN: "当前台词暂时不能按完整句安全拆镜，请先调整台词或核对镜头。",
  BACKUP_FAILED: "拆镜前的原版尚未完整保留，请核对本机保存状态后再试。",
  WRITE_FAILED: "本次拆镜没有保存上，请保留当前稿并重试保存。",
  WRITE_UNCONFIRMED: "拆镜保存结果尚未确认，编辑副本已保留，请先核对，不要重复接受。",
};
const unknown = (
  pending: PendingSplitWrite,
  message = failure.WRITE_UNCONFIRMED!,
): SplitOutcome => ({ kind: "unknown", message, pending });
function still(
  host: Pick<SplitHost, "current" | "selection">,
  base: FilmProject,
  scope: SplitScope,
) {
  return host.current() === base && JSON.stringify(host.selection()) === JSON.stringify(scope);
}
/** Validate complete source coverage without recomputing ICU sentence decisions in another runtime. */
export function validNativeSplitReview(
  value: unknown,
  raw: Record<string, unknown>,
  input: FilmDialogueSplitInput,
): value is FilmDialogueSplitReady {
  if (
    !obj(value) ||
    value.kind !== "READY" ||
    value.projectId !== input.projectId ||
    value.shotId !== input.shotId ||
    value.projectHash !== input.expectedHash ||
    !sha(value.reviewFingerprint) ||
    !obj(value.plan) ||
    !Array.isArray(value.notes) ||
    value.notes.length > 1024 ||
    !value.notes.every(text)
  )
    return false;
  const p = value.plan,
    target = Array.isArray(raw.shots)
      ? raw.shots.filter((s) => obj(s) && s.id === input.shotId)
      : [];
  if (target.length !== 1 || !obj(target[0])) return false;
  let lines;
  try {
    lines = canonicalDialogueLines(target[0] as { line: string });
  } catch {
    return false;
  }
  if (
    p.kind !== "READY" ||
    p.timing !== "estimate" ||
    p.requiresSplit !== true ||
    p.versions !== input.versions ||
    !Array.isArray(p.parts) ||
    p.parts.length < 2 ||
    p.parts.length > 128 ||
    p.newShotCount !== p.parts.length ||
    p.videoCount !== p.parts.length * input.versions ||
    ![10, 15].includes(Number(p.modelCapSeconds)) ||
    !Array.isArray(p.sourceLines) ||
    JSON.stringify(p.sourceLines) !== JSON.stringify(lines) ||
    !Array.isArray(p.limitations) ||
    p.limitations.length > 1024 ||
    !p.limitations.every(text)
  )
    return false;
  const ends = lines.map(() => 0);
  let previous = 0;
  for (const part of p.parts) {
    if (
      !obj(part) ||
      !Number.isInteger(part.sourceLineIndex) ||
      Number(part.sourceLineIndex) < previous ||
      Number(part.sourceLineIndex) >= lines.length ||
      !Number.isInteger(part.startOffset) ||
      !Number.isInteger(part.endOffset) ||
      !Number.isInteger(part.estimatedSeconds) ||
      Number(part.estimatedSeconds) < 1 ||
      Number(part.estimatedSeconds) > Number(p.modelCapSeconds)
    )
      return false;
    const i = Number(part.sourceLineIndex),
      line = lines[i]!;
    if (
      part.startOffset !== ends[i] ||
      Number(part.endOffset) <= Number(part.startOffset) ||
      Number(part.endOffset) > line.text.length ||
      part.text !== line.text.slice(Number(part.startOffset), Number(part.endOffset)) ||
      part.speaker !== line.speaker
    )
      return false;
    ends[i] = Number(part.endOffset);
    previous = i;
  }
  if (!lines.every((l, i) => ends[i] === l.text.length)) return false;
  if (value.actualLimit !== undefined) {
    const a = value.actualLimit;
    if (
      !obj(a) ||
      typeof a.requiredSeconds !== "number" ||
      !Number.isFinite(a.requiredSeconds) ||
      ![10, 15].includes(Number(a.maxSeconds)) ||
      a.requiredSeconds <= Number(a.maxSeconds) ||
      a.requiredSeconds > 36001 ||
      a.maxSeconds !== p.modelCapSeconds ||
      typeof a.rawAudioSaved !== "boolean" ||
      a.targetVideoSubmitted !== false
    )
      return false;
  }
  return true;
}
async function preflight(
  host: Pick<SplitHost, "current" | "selection" | "apply" | "onCanonicalPrepared">,
  base: FilmProject,
  scope: SplitScope,
  lease: FilmSaveLease,
) {
  const bridge = window.aijian;
  if (!bridge?.readFilmProject) throw Error("SAVE_FAILED");
  let accepted = base;
  let creativeBaseline = JSON.stringify(metadata(accepted as unknown as Record<string, unknown>));
  const guard = () =>
    still(host, accepted, scope) &&
    JSON.stringify(metadata(accepted as unknown as Record<string, unknown>)) === creativeBaseline;
  if (!guard()) throw Error("PROJECT_CHANGED");
  const written = await lease.save(accepted, guard);
  let raw = await bridge.readFilmProject(base.id);
  if (!guard() || !obj(raw) || raw.id !== base.id) throw Error("PROJECT_CHANGED");
  // The existing queue returns this completed native write. Never adopt arbitrary
  // same-ID readback: it must equal that actual receipt (saveFilm preserves only
  // the renderer's assembly URL when returning native stored data).
  if (!written) throw Error("SAVE_FAILED");
  const expectedAssemblyUrl = accepted.assemblyUrl.startsWith("blob:") ? "" : accepted.assemblyUrl;
  const writeBody = { ...written, assemblyUrl: expectedAssemblyUrl };
  if ((await historyRecordHash(writeBody)) !== (await historyRecordHash(raw)))
    throw Error("SAVE_FAILED");
  if (!guard()) throw Error("PROJECT_CHANGED");
  // This is the complete, just-written record from the current typed film, not
  // a general upgrade of an unrelated same-ID snapshot.
  const saved = raw as unknown as FilmProject;
  const same =
    (await historyRecordHash(metadata(saved as unknown as Record<string, unknown>))) ===
    (await historyRecordHash(metadata(accepted as unknown as Record<string, unknown>)));
  if (!guard()) throw Error("PROJECT_CHANGED");
  if (!same) {
    accepted = host.apply(saved);
    creativeBaseline = JSON.stringify(metadata(accepted as unknown as Record<string, unknown>));
    host.onCanonicalPrepared?.(accepted);
    if (!guard()) throw Error("PROJECT_CHANGED");
    const second = await lease.save(accepted, guard);
    raw = await bridge.readFilmProject(base.id);
    if (!guard() || !obj(raw) || raw.id !== base.id || !second) throw Error("PROJECT_CHANGED");
    const assemblyUrl = accepted.assemblyUrl.startsWith("blob:") ? "" : accepted.assemblyUrl;
    if ((await historyRecordHash({ ...second, assemblyUrl })) !== (await historyRecordHash(raw)))
      throw Error("SAVE_FAILED");
    if (!guard()) throw Error("PROJECT_CHANGED");
  }
  const expectedHash = await historyRecordHash(raw);
  if (!guard()) throw Error("PROJECT_CHANGED");
  return { film: accepted, raw, expectedHash };
}
export async function readNativeSplit(
  host: SplitHost,
  isCurrent: () => boolean,
): Promise<
  | { kind: "ready"; review: NativeSplitReview }
  | { kind: "failed"; message: string }
  | { kind: "stale" }
> {
  const base = host.current(),
    scope = host.selection(),
    versions = host.versions(),
    bridge = window.aijian;
  if (!base || !scope) return { kind: "failed", message: "先选择要检查台词的镜头。" };
  if (
    !bridge?.prepareFilmDialogueSplit ||
    !bridge.applyFilmDialogueSplit ||
    !bridge.verifyFilmDialogueSplitBackup
  )
    return { kind: "failed", message: "当前桌面版本还不能核对并保存拆镜，请更新后再试。" };
  const prepare = bridge.prepareFilmDialogueSplit;
  let lease: FilmSaveLease | undefined;
  const execute = async (): Promise<Awaited<ReturnType<typeof readNativeSplit>>> => {
    try {
      lease = await host.persistence.acquire(base.id);
      const prepared = await preflight(host, base, scope, lease);
      await lease.release();
      lease = undefined;
      const key = splitInputKey(host.current(), scope, versions);
      if (
        !key ||
        !isCurrent() ||
        !still(host, prepared.film, scope) ||
        host.versions() !== versions
      )
        return { kind: "stale" };
      let raw = prepared.raw,
        input = nativeDialogueSplitInput(
          prepared.film,
          scope.shotId,
          prepared.expectedHash,
          versions,
        ),
        result = await prepare(input);
      // One bounded metadata-only retry; each request still carries a fresh complete raw CAS.
      if (
        result.kind === "FAILED" &&
        result.code === "PROJECT_CHANGED" &&
        isCurrent() &&
        key === splitInputKey(host.current(), host.selection(), host.versions())
      ) {
        const fresh = await bridge.readFilmProject?.(base.id);
        if (
          obj(fresh) &&
          fresh.id === base.id &&
          (await historyRecordHash(metadata(fresh))) === (await historyRecordHash(metadata(raw)))
        ) {
          raw = fresh;
          input = { ...input, expectedHash: await historyRecordHash(raw) };
          if (
            isCurrent() &&
            key === splitInputKey(host.current(), host.selection(), host.versions())
          )
            result = await prepare(input);
        }
      }
      if (!isCurrent() || key !== splitInputKey(host.current(), host.selection(), host.versions()))
        return { kind: "stale" };
      if (result.kind === "FAILED")
        return {
          kind: "failed",
          message: failure[result.code] ?? "拆镜方案没有完整读到，请重新检查。",
        };
      if (!validNativeSplitReview(result, raw, input))
        return { kind: "failed", message: "拆镜方案没有完整读到，请重新检查。" };
      return { kind: "ready", review: { ready: result, raw, key, scope, versions } };
    } catch {
      return { kind: "failed", message: "当前编辑还没核对保存，请重试保存后再检查拆镜。" };
    }
  };
  const result = await execute();
  try {
    await lease?.release();
  } catch {
    return { kind: "failed", message: "当前编辑还没核对保存，请重试保存后再检查拆镜。" };
  }
  return result;
}

function external(lease: FilmSaveLease) {
  if (!lease.beginExternalWrite || !lease.markExternalWriteUnknown || !lease.confirmExternalWrite)
    throw Error("EXTERNAL_UNSUPPORTED");
  return {
    begin: lease.beginExternalWrite,
    unknown: lease.markExternalWriteUnknown,
    confirm: lease.confirmExternalWrite,
  };
}
const childrenOf = (raw: Record<string, unknown>, pending: PendingSplitWrite) => {
  if (!Array.isArray(raw.shots)) return null;
  const target = pending.rawBefore.shots as Record<string, unknown>[],
    at = target.findIndex((s) => s.id === pending.review.scope.shotId),
    count = pending.review.ready.plan.parts.length;
  const children = raw.shots.slice(at, at + count);
  if (
    at < 0 ||
    children.length !== count ||
    children.some((s) => !obj(s) || typeof s.id !== "string")
  )
    return null;
  return children as Record<string, unknown>[];
};
/** Validate entire raw structural delta, then separately prove actual original backup bytes. */
async function verifiedStoredSplit(pending: PendingSplitWrite, raw: Record<string, unknown>) {
  const children = childrenOf(raw, pending);
  if (!children) return null;
  const ids = children.map((s) => s.id as string),
    sources = children.map((s) => (obj(s.splitSource) ? s.splitSource : null)),
    historyId = sources[0]?.historyId;
  if (typeof historyId !== "string" || !sources.every((s) => s?.historyId === historyId))
    return null;
  const expected = projectDialogueSplitRecord(
    pending.rawBefore,
    pending.review.scope.shotId,
    pending.review.ready.plan,
    pending.review.ready.reviewFingerprint,
    historyId,
    ids,
  );
  // writeProject changes savedAt only; directory and every other raw field remain exact.
  if (
    !expected ||
    typeof raw.savedAt !== "string" ||
    !Number.isFinite(Date.parse(raw.savedAt)) ||
    (await historyRecordHash({ ...raw, savedAt: expected.savedAt })) !==
      (await historyRecordHash(expected))
  )
    return null;
  const proof = await window.aijian?.verifyFilmDialogueSplitBackup?.({
    projectId: pending.before.id,
    historyId,
    beforeHash: pending.input.expectedHash,
  });
  if (
    !proof ||
    proof.kind !== "VERIFIED" ||
    proof.projectId !== pending.before.id ||
    proof.historyId !== historyId ||
    proof.beforeHash !== pending.input.expectedHash ||
    proof.entry.id !== historyId ||
    proof.entry.reason !== "before-dialogue-split"
  )
    return null;
  return { ids, historyId };
}
async function settleUnchangedSplit(
  host: SplitHost,
  pending: PendingSplitWrite,
  lease: FilmSaveLease,
  raw: Record<string, unknown>,
  discard?: { raw: Record<string, unknown>; live: FilmProject | null; draft: FilmProject },
): Promise<SplitOutcome | null> {
  if (
    (await historyRecordHash(metadata(raw))) !==
    (await historyRecordHash(metadata(pending.rawBefore)))
  )
    return null;
  // A fresh READY necessarily passed the same native factory gate. A generic
  // failure (especially INVALID_INPUT) never proves the old operation ended.
  const expectedHash = await historyRecordHash(raw),
    input = { ...pending.input, expectedHash };
  const reply = await window.aijian?.prepareFilmDialogueSplit?.(input);
  const ready =
    !!reply &&
    validNativeSplitReview(reply, raw, input) &&
    reply.reviewFingerprint === pending.review.ready.reviewFingerprint;
  // parse can only return INVALID_INPUT before the active gate. PROJECT_CHANGED
  // is a fixed post-gate refusal, including expired session-only evidence. It is
  // sufficient ONLY with two exact complete before-record reads around this call.
  const settledRefusal =
    reply?.kind === "FAILED" &&
    reply.code === "PROJECT_CHANGED" &&
    expectedHash === pending.input.expectedHash;
  if (!ready && !settledRefusal) return null;
  const fresh = await window.aijian?.readFilmProject?.(pending.before.id);
  if (!obj(fresh) || (await historyRecordHash(fresh)) !== expectedHash) return null;
  const current = host.current(),
    draft = host.persistence.externalWriteState(pending.before.id)?.draft;
  if (!draft) return unknown(pending);
  const unchanged = (await historyRecordHash(draft)) === (await historyRecordHash(pending.before));
  const approved =
    discard &&
    discard.live === current &&
    discard.draft === draft &&
    (await historyRecordHash(discard.raw)) === expectedHash;
  if (
    host.current() !== current ||
    host.persistence.externalWriteState(pending.before.id)?.draft !== draft
  )
    return unknown(pending, "当前作品或保留稿又有变化，请重新核对。");
  pending.observedRaw = raw;
  pending.localDraft = draft;
  if (discard ? !approved : !unchanged)
    return unknown(pending, "本机仍是原结构，后来的编辑副本继续保留；请查看两份状态后选择。");
  const saved = upgradeFilm(raw as Partial<FilmProject>);
  if (!saved) return unknown(pending);
  const adopted =
    current?.id === pending.before.id ? (discard ? host.apply(saved) : current) : undefined;
  const ext = external(lease);
  if (!ext.confirm(saved, adopted, () => host.current() === adopted)) {
    ext.unknown(saved);
    return unknown(pending);
  }
  return {
    kind: "failed",
    message: discard
      ? "已采用未拆镜的保存版，尚未生成新媒体。"
      : "已核对：当前仍是原分镜结构，没有重复接受或生成。",
  };
}
async function settleSplit(
  host: SplitHost,
  pending: PendingSplitWrite,
  lease: FilmSaveLease,
  discard?: { raw: Record<string, unknown>; live: FilmProject | null; draft: FilmProject },
): Promise<SplitOutcome> {
  const ext = external(lease),
    bridge = window.aijian;
  const raw = await bridge?.readFilmProject?.(pending.before.id);
  if (!obj(raw) || raw.id !== pending.before.id) {
    ext.unknown();
    return unknown(pending, "暂时读不到原作品，编辑副本保留，请重新核对。");
  }
  const unchangedResult = await settleUnchangedSplit(host, pending, lease, raw, discard);
  if (unchangedResult) return unchangedResult;
  const proof = await verifiedStoredSplit(pending, raw);
  if (!proof) {
    ext.unknown();
    return unknown(pending, "拆镜结构或原版备份尚不能完整核对，请保留编辑副本，不要重复接受。");
  }
  const fresh = await bridge?.readFilmProject?.(pending.before.id);
  if (!obj(fresh) || (await historyRecordHash(fresh)) !== (await historyRecordHash(raw))) {
    ext.unknown();
    return unknown(pending, "原作品又有变化，请重新核对拆镜保存状态。");
  }
  pending.observedRaw = raw;
  const current = host.current(),
    state = host.persistence.externalWriteState(pending.before.id),
    draft = state?.draft;
  if (!state || !draft) return unknown(pending);
  pending.localDraft = draft;
  const currentSame = current?.id === pending.before.id;
  const unchanged = (await historyRecordHash(draft)) === (await historyRecordHash(pending.before));
  const ackMatches =
    !pending.ack ||
    (JSON.stringify(pending.ack.childIds) === JSON.stringify(proof.ids) &&
      pending.ack.backup.id === proof.historyId);
  const discardMatches =
    discard &&
    current === discard.live &&
    draft === discard.draft &&
    (await historyRecordHash(raw)) === (await historyRecordHash(discard.raw));
  // Every hash yields. Final current/draft checks, apply and confirm stay synchronous.
  if (
    host.current() !== current ||
    host.persistence.externalWriteState(pending.before.id)?.draft !== draft
  ) {
    ext.unknown();
    return unknown(pending, "当前作品或保留稿又有变化，请重新核对。");
  }
  if (
    discard
      ? !discardMatches
      : !unchanged ||
        !ackMatches ||
        (currentSame && JSON.stringify(host.selection()) !== JSON.stringify(pending.review.scope))
  ) {
    ext.unknown();
    return unknown(pending, "拆镜结果已保留，但与当前编辑不同；请查看两份状态后明确选择。");
  }
  const saved = upgradeFilm(raw as Partial<FilmProject>);
  if (!saved) {
    ext.unknown();
    return unknown(pending);
  }
  const adopted = currentSame ? host.apply(saved) : undefined;
  if (!ext.confirm(saved, adopted, () => host.current() === adopted)) {
    ext.unknown(saved);
    return unknown(pending);
  }
  return {
    kind: "applied",
    message: currentSame
      ? "拆镜结构已保存，原版已在本机历史完整核对。还没有生成新媒体，请逐镜核对并重新确认生成数量。"
      : "原作品的拆镜结果已核对保存，当前作品没有被覆盖。",
  };
}
async function releaseSplit(
  host: SplitHost,
  lease: FilmSaveLease | undefined,
  outcome: SplitOutcome,
  pending?: PendingSplitWrite,
): Promise<SplitOutcome> {
  try {
    await lease?.release();
    return outcome;
  } catch {
    if (pending && host.persistence.externalWriteState(pending.before.id))
      return unknown(pending, "拆镜保存还没核对完成，编辑副本已保留。");
    return { kind: "failed", message: "拆镜结果已核对，但后来的编辑尚未保存，请重试保存。" };
  }
}
export async function applyNativeSplit(
  host: SplitHost,
  review: NativeSplitReview,
): Promise<SplitOutcome> {
  let lease: FilmSaveLease | undefined,
    pending: PendingSplitWrite | undefined,
    outcome: SplitOutcome;
  try {
    const base = host.current(),
      scope = host.selection(),
      bridge = window.aijian;
    if (
      !base ||
      !scope ||
      review.key !== splitInputKey(base, scope, host.versions()) ||
      !bridge?.applyFilmDialogueSplit
    )
      return { kind: "stale", message: failure.PROJECT_CHANGED! };
    lease = await host.persistence.acquire(base.id);
    const prepared = await preflight(host, base, scope, lease);
    const same =
      (await historyRecordHash(metadata(prepared.raw))) ===
      (await historyRecordHash(metadata(review.raw)));
    if (!same || !still(host, prepared.film, scope) || host.versions() !== review.versions)
      throw Error("PROJECT_CHANGED");
    const input = nativeDialogueSplitInput(
      prepared.film,
      scope.shotId,
      prepared.expectedHash,
      review.versions,
    );
    const ext = external(lease);
    ext.begin(() => still(host, prepared.film, scope));
    pending = { before: prepared.film, rawBefore: prepared.raw, review, input };
    const result = await bridge.applyFilmDialogueSplit({
      ...input,
      reviewFingerprint: review.ready.reviewFingerprint,
    });
    if (result.kind === "FAILED" && result.unchanged === true) {
      // This settled native refusal proves no structural write; preserve late edits
      // as unknown rather than quietly discarding or saving a stale whole snapshot.
      const live = host.current(),
        state = host.persistence.externalWriteState(base.id);
      if (
        state?.draft === pending.before &&
        live === pending.before &&
        still(host, pending.before, scope) &&
        ext.confirm(pending.before, pending.before, () => host.current() === pending!.before)
      )
        outcome = { kind: "failed", message: failure[result.code] ?? "本次没有拆镜，请重新检查。" };
      else {
        ext.unknown();
        outcome = unknown(pending, failure[result.code] ?? failure.WRITE_UNCONFIRMED);
      }
    } else {
      if (result.kind === "APPLIED") pending.ack = result;
      ext.unknown();
      outcome = await settleSplit(host, pending, lease);
    }
  } catch {
    if (pending && lease) {
      external(lease).unknown();
      outcome = unknown(pending);
    } else
      outcome = {
        kind: "failed",
        message: "当前编辑还没保存或已变化，请核对后重新检查；尚未接受拆镜。",
      };
  }
  return releaseSplit(host, lease, outcome, pending);
}
export async function recoverNativeSplit(
  host: SplitHost,
  pending: PendingSplitWrite,
  discard?: { raw: Record<string, unknown>; live: FilmProject | null; draft: FilmProject },
): Promise<SplitOutcome> {
  let lease: FilmSaveLease | undefined, outcome: SplitOutcome;
  try {
    lease = await host.persistence.acquireExternalRecovery(pending.before.id);
    outcome = await settleSplit(host, pending, lease, discard);
  } catch {
    outcome = unknown(pending);
  }
  return releaseSplit(host, lease, outcome, pending);
}

/** Reuse the existing receipt-checked checkpoint without adding another save queue. */
export { preflight as prepareCurrentFilmCheckpoint };

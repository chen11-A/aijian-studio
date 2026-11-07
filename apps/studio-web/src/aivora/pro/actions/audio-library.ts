import { matchAudioGroupAppend, type GroupAppendIntent } from "./audio-suggestion-proof";
import type {
  AddBundledFilmAudioInput,
  BundledAudioAsset,
  InspectBundledFilmAudioTargetResult,
} from "@aijian/contracts/film-audio-library";
import { upgradeFilm, type FilmProject } from "../../film/project";
import { historyRecordHash } from "./persistent-history";
import type { createFilmPersistence, FilmSaveLease } from "../film-persistence";
export type LibrarySelection = { projectId: string; page: string; shotId: string; takeId: string };
export type LibraryHost = {
  current: () => FilmProject | null;
  selection: () => LibrarySelection | null;
  apply: (film: FilmProject) => FilmProject;
  persistence: ReturnType<typeof createFilmPersistence>;
};
export type LibraryTarget = {
  film: FilmProject;
  selection: LibrarySelection;
  seconds: number;
  hash: string;
};
type PendingAudioWriteBase = {
  before: FilmProject;
  canonicalBefore: FilmProject;
  rawBefore: Record<string, unknown>;
  hash: string;
  selection: LibrarySelection;
  settled: boolean;
  expectedClipId?: string;
  localDraft?: FilmProject;
  observedRaw?: Record<string, unknown>;
};
export type PendingSingleLibraryWrite = PendingAudioWriteBase & {
  kind?: "single";
  input: AddBundledFilmAudioInput;
  asset: BundledAudioAsset;
};
export type PendingGroupLibraryWrite = PendingAudioWriteBase &
  GroupAppendIntent & { kind: "group" };
export type PendingLibraryWrite = PendingSingleLibraryWrite | PendingGroupLibraryWrite;
export type LibraryOutcome = {
  kind: "added" | "removed" | "failed" | "stale" | "unknown";
  message: string;
  pending?: PendingLibraryWrite;
  clipId?: string;
};
const sameSelection = (a: LibrarySelection | null, b: LibrarySelection) =>
  !!a &&
  a.projectId === b.projectId &&
  a.page === b.page &&
  a.shotId === b.shotId &&
  a.takeId === b.takeId;
const current = (host: LibraryHost, film: FilmProject, selection: LibrarySelection) =>
  host.current() === film && sameSelection(host.selection(), selection);
const canonical = (raw: unknown, id: string) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || (raw as { id?: unknown }).id !== id)
    throw new Error("LIBRARY_CANONICAL_INVALID");
  const film = upgradeFilm(raw as Partial<FilmProject>);
  if (!film || film.id !== id) throw new Error("LIBRARY_CANONICAL_INVALID");
  return film;
};
export const LIBRARY_FAILURE: Record<string, string> = {
  INVALID_INPUT: "素材或加入位置无法确认，请重新选择。",
  LIBRARY_UNAVAILABLE: "本地素材目录暂时不可用，请重读目录。",
  ASSET_CHANGED: "素材目录或文件已变化，请重读目录后再选择。",
  PROJECT_CHANGED: "作品或所选版本已变化，请重新核对。",
  SOURCE_UNVERIFIED: "当前版本或素材来源暂时无法核验，尚不能加入。",
  PLACEMENT_UNSUPPORTED: "加入位置超出实际版本或素材时长，请重新核对。",
  BUSY: "本机正在处理这部作品，请完成后再试。",
  WRITE_FAILED: "本次素材没有加入作品，可以重试。",
  WRITE_UNCONFIRMED: "素材保存结果尚未确认，请先核对，不要重复加入。",
  TOOLS_UNAVAILABLE: "本机媒体工具暂时不可用，尚不能核对素材。",
};
function capabilities() {
  const b = window.aijian;
  if (!b?.readFilmProject || !b.inspectBundledFilmAudioTarget || !b.addBundledFilmAudio)
    throw new Error("LIBRARY_UNSUPPORTED");
  return b;
}
export async function prepareLibraryInput(
  base: FilmProject,
  selection: LibrarySelection,
  host: LibraryHost,
  lease: FilmSaveLease,
) {
  const bridge = capabilities();
  let accepted = base;
  const valid = () => current(host, accepted, selection);
  if (!valid()) throw new Error("LIBRARY_STALE");
  await lease.save(accepted, valid);
  const raw = await bridge.readFilmProject!(base.id);
  if (!valid()) throw new Error("LIBRARY_STALE");
  accepted = host.apply(canonical(raw, base.id));
  await lease.save(accepted, valid);
  const rawStored = await bridge.readFilmProject!(base.id);
  const stored = canonical(rawStored, base.id);
  if (!valid()) throw new Error("LIBRARY_STALE");
  const hash = await historyRecordHash(rawStored);
  if (!valid()) throw new Error("LIBRARY_STALE");
  return { accepted, stored, rawStored: rawStored as Record<string, unknown>, hash, valid };
}
export async function inspectLibraryTarget(
  base: FilmProject,
  selection: LibrarySelection,
  host: LibraryHost,
): Promise<{ target?: LibraryTarget; message: string }> {
  let lease: FilmSaveLease | undefined;
  try {
    lease = await host.persistence.acquire(base.id);
    const prepared = await prepareLibraryInput(base, selection, host, lease);
    const result = await capabilities().inspectBundledFilmAudioTarget!({
      projectId: base.id,
      expectedProjectHash: prepared.hash,
      shotId: selection.shotId,
      takeId: selection.takeId,
    });
    if (!prepared.valid()) return { message: "作品或所选版本已变化，请重新核对。" };
    if (result.kind !== "TARGET")
      return { message: LIBRARY_FAILURE[result.code] ?? "当前版本时长尚未确认。" };
    if (
      result.projectId !== base.id ||
      result.shotId !== selection.shotId ||
      result.takeId !== selection.takeId ||
      result.projectHash !== prepared.hash ||
      !Number.isFinite(result.durationSeconds) ||
      result.durationSeconds <= 0
    )
      return { message: "当前版本时长尚未确认，请重新核对。" };
    return {
      target: {
        film: prepared.accepted,
        selection,
        seconds: result.durationSeconds,
        hash: prepared.hash,
      },
      message: "",
    };
  } catch (error) {
    return {
      message:
        error instanceof Error && error.message === "LIBRARY_UNSUPPORTED"
          ? "当前桌面版本不支持本地素材时长核对，请更新后重试。"
          : "当前版本时长尚未核对，请检查保存状态后重试。",
    };
  } finally {
    await lease?.release();
  }
}
export function requireAudioExternal(lease: FilmSaveLease) {
  if (!lease.beginExternalWrite || !lease.confirmExternalWrite || !lease.markExternalWriteUnknown)
    throw new Error("LIBRARY_SAVE_UNSUPPORTED");
  return {
    begin: lease.beginExternalWrite,
    confirm: lease.confirmExternalWrite,
    unknown: lease.markExternalWriteUnknown,
  };
}
function withoutVolatile(film: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(film).filter(([key]) => !["savedAt", "directory", "audioClips"].includes(key)),
  );
}

async function onlyAddedClip(
  pending: PendingSingleLibraryWrite,
  saved: FilmProject,
  raw: Record<string, unknown>,
) {
  const before = pending.canonicalBefore;
  if (
    saved.id !== before.id ||
    new Set(saved.audioClips.map((c) => c.id)).size !== saved.audioClips.length ||
    saved.audioClips.length !== before.audioClips.length + 1
  )
    return null;
  if (
    (await historyRecordHash(withoutVolatile(pending.rawBefore))) !==
    (await historyRecordHash(withoutVolatile(raw)))
  )
    return null;
  const oldRawClips = Array.isArray(pending.rawBefore.audioClips)
    ? pending.rawBefore.audioClips
    : [];
  const newRawClips = Array.isArray(raw.audioClips) ? raw.audioClips : [];
  const rawId = (value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>).id
      : null;
  if (
    oldRawClips.length !== before.audioClips.length ||
    newRawClips.length !== saved.audioClips.length
  )
    return null;
  for (const old of oldRawClips)
    if (
      (await historyRecordHash(old)) !==
      (await historyRecordHash(newRawClips.find((row) => rawId(row) === rawId(old))))
    )
      return null;
  const clip = saved.audioClips.find((c) => !before.audioClips.some((old) => old.id === c.id));
  const input = pending.input;
  if (
    !clip ||
    clip.shotId !== input.shotId ||
    clip.takeId !== input.takeId ||
    clip.lane !== input.lane ||
    !clip.path ||
    clip.enabled === false ||
    clip.libraryAsset?.assetId !== pending.asset.id ||
    clip.libraryAsset.sha256 !== pending.asset.sha256 ||
    !Object.entries(input.placement).every(
      ([key, value]) => (clip as unknown as Record<string, unknown>)[key] === value,
    )
  )
    return null;
  return clip;
}
export async function settleLibraryWrite(
  host: LibraryHost,
  pending: PendingLibraryWrite,
  lease: FilmSaveLease,
  saved: FilmProject,
  raw: Record<string, unknown>,
): Promise<LibraryOutcome> {
  const external = requireAudioExternal(lease);
  pending.observedRaw = raw;
  const single = pending.kind !== "group" ? await onlyAddedClip(pending, saved, raw) : null;
  const additions =
    pending.kind === "group"
      ? await matchAudioGroupAppend(pending, saved, raw)
      : single
        ? [single]
        : null;
  const added = additions?.[0];
  const unchanged = (await historyRecordHash(raw)) === pending.hash;
  if (
    (pending.kind === "group" && pending.receiptClaimed && !additions) ||
    (pending.expectedClipId !== undefined && added?.id !== pending.expectedClipId) ||
    (!added && !unchanged)
  ) {
    external.unknown(saved);
    return {
      kind: "unknown",
      message: "已保存的作品与本次添加无法对应，保留当前编辑，请先核对。",
      pending,
    };
  }
  const heldDraft = host.persistence.externalWriteState(pending.selection.projectId)?.draft;
  if (heldDraft && heldDraft !== pending.before) pending.localDraft = heldDraft;
  const live = host.current();
  const foreign = live?.id !== saved.id;
  const editing = foreign ? pending.localDraft : live;
  const retainedDraft = editing ?? pending.before;
  let rebasingDraft: FilmProject | undefined;
  const retainedDraftMatches = () => {
    if (!foreign) return true;
    const state = host.persistence.externalWriteState(saved.id);
    // The only accepted transition is this lease's exact rebase snapshot.
    return !state || state.draft === retainedDraft || state.draft === rebasingDraft;
  };
  if (
    foreign &&
    (!editing || (await historyRecordHash(editing)) === (await historyRecordHash(pending.before)))
  ) {
    // Hashing yields: both current work and the retained original draft can change.
    // Final checks and confirmation must stay in one synchronous segment.
    if (host.current() !== live || !retainedDraftMatches() || !external.confirm(saved)) {
      external.unknown(saved);
      return {
        kind: "unknown",
        message: "原作品编辑副本或当前页面又有变化，请重新核对保存状态。",
        pending,
      };
    }
    return { kind: "stale", message: "结果已留在原作品，当前作品没有被覆盖。" };
  }
  if (!editing) {
    external.unknown(saved);
    return { kind: "unknown", message: LIBRARY_FAILURE.WRITE_UNCONFIRMED!, pending };
  }
  if (current(host, pending.before, pending.selection)) {
    const adopted = host.apply(saved);
    if (!external.confirm(saved, adopted, () => host.current() === adopted))
      return { kind: "unknown", message: LIBRARY_FAILURE.WRITE_UNCONFIRMED!, pending };
    return added
      ? {
          kind: "added",
          clipId: added.id,
          message:
            pending.kind === "group"
              ? `本次 ${additions!.length} 段声音已加入并保存；移除整组只移除本次引用，素材文件仍保留。`
              : "素材已加入并保存。要撤销本次添加，请在当前版本的素材列表点‘移除’；素材文件会保留。",
        }
      : { kind: "failed", message: "核对后没有找到本次添加的片段，可检查后重新选择。" };
  }
  // A late result may only append its uniquely owned clip; never restore a removed shot,
  // deleted old clip, replaced take source or any other creative field.
  const shot = editing.shots.find((s) => s.id === pending.selection.shotId),
    oldShot = pending.canonicalBefore.shots.find((s) => s.id === pending.selection.shotId);
  const take = shot?.takes.find((t) => t.id === pending.selection.takeId),
    oldTake = oldShot?.takes.find((t) => t.id === pending.selection.takeId);
  const existing = (additions ?? []).filter((clip) =>
    editing.audioClips.some((c) => c.id === clip.id),
  );
  const sameExisting = (
    await Promise.all(
      existing.map(
        async (clip) =>
          (await historyRecordHash(clip)) ===
          (await historyRecordHash(editing.audioClips.find((c) => c.id === clip.id))),
      ),
    )
  ).every(Boolean);
  if (host.current() !== live || !retainedDraftMatches()) {
    external.unknown(saved);
    return { kind: "unknown", message: "本页又有变化，请重新核对保存状态。", pending };
  }
  if (
    added &&
    (!shot ||
      !take ||
      !oldTake ||
      take.videoPath !== oldTake.videoPath ||
      take.cleanVideoPath !== oldTake.cleanVideoPath ||
      (existing.length > 0 && !sameExisting) ||
      !pending.canonicalBefore.audioClips.every((old) =>
        editing.audioClips.some((c) => c.id === old.id),
      ) ||
      new Set(editing.audioClips.map((c) => c.id)).size !== editing.audioClips.length)
  ) {
    external.unknown(saved);
    return {
      kind: "unknown",
      message: "本页后来改过，尚不能安全合并素材；两份状态已保留，请先核对。",
      pending,
    };
  }
  const merged =
    additions && additions.some((c) => !existing.some((e) => e.id === c.id))
      ? {
          ...editing,
          savedAt: saved.savedAt,
          directory: saved.directory,
          audioClips: [
            ...editing.audioClips,
            ...additions.filter((c) => !existing.some((e) => e.id === c.id)),
          ],
        }
      : editing;
  const needsSave = (await historyRecordHash(merged)) !== (await historyRecordHash(saved));
  if (host.current() !== live || !retainedDraftMatches()) {
    external.unknown(saved);
    return { kind: "unknown", message: "本页又有变化，请重新核对保存状态。", pending };
  }
  const fresh = await capabilities().readFilmProject!(saved.id);
  if (
    !fresh ||
    (await historyRecordHash(fresh)) !== (await historyRecordHash(raw)) ||
    host.current() !== live ||
    !retainedDraftMatches()
  ) {
    external.unknown(saved);
    return { kind: "unknown", message: "已保存的作品或本页又有变化，请重新核对。", pending };
  }
  const draft = pending.localDraft;
  const adopted = foreign ? merged : merged !== live ? host.apply(merged) : editing;
  const valid = () =>
    host.current() === (foreign ? live : adopted) &&
    (!foreign || (pending.localDraft === draft && retainedDraftMatches()));
  try {
    if (needsSave) {
      rebasingDraft = foreign ? adopted : undefined;
      if (!lease.rebaseExternalWrite || !(await lease.rebaseExternalWrite(saved, adopted, valid)))
        return { kind: "unknown", message: LIBRARY_FAILURE.WRITE_UNCONFIRMED!, pending };
    } else if (!external.confirm(saved, foreign ? undefined : adopted, valid))
      return { kind: "unknown", message: LIBRARY_FAILURE.WRITE_UNCONFIRMED!, pending };
  } catch {
    return {
      kind: "unknown",
      message: "素材结果与新编辑都已保留，新编辑还没保存上。请先核对保存状态。",
      pending,
    };
  }
  if (!valid()) return { kind: "stale", message: "素材结果已保留，当前编辑又有变化，请核对。" };
  return added
    ? {
        kind: "added",
        clipId: added.id,
        message: "素材已加入原版本，保留了本页后来的编辑；请核对当前版本的素材列表。",
      }
    : { kind: "failed", message: "没有找到本次添加，已保留并保存本页编辑。" };
}
export async function readBackLibraryWrite(
  host: LibraryHost,
  pending: PendingLibraryWrite,
  lease: FilmSaveLease,
): Promise<LibraryOutcome> {
  const external = requireAudioExternal(lease);
  try {
    // A valid non-BUSY inspect response proves prior add's factory lifecycle ended.
    // A transport failure, INVALID_INPUT or BUSY never proves that an old write stopped.
    const proof: InspectBundledFilmAudioTargetResult = await capabilities()
      .inspectBundledFilmAudioTarget!({
      projectId: pending.selection.projectId,
      expectedProjectHash: pending.hash,
      shotId: pending.selection.shotId,
      takeId: pending.selection.takeId,
    });
    const proved =
      proof.kind === "TARGET"
        ? proof.projectId === pending.selection.projectId &&
          proof.shotId === pending.selection.shotId &&
          proof.takeId === pending.selection.takeId &&
          proof.projectHash === pending.hash &&
          Number.isFinite(proof.durationSeconds) &&
          proof.durationSeconds > 0
        : proof.kind === "FAILED" &&
          Object.hasOwn(LIBRARY_FAILURE, proof.code) &&
          !["BUSY", "INVALID_INPUT"].includes(proof.code);
    if (!proved) {
      external.unknown();
      return {
        kind: "unknown",
        message: "本机写入尚未确认结束，保留当前编辑，请稍后再次核对，不要重复加入。",
        pending,
      };
    }
    pending.settled = true;
    const raw = await capabilities().readFilmProject!(pending.selection.projectId);
    if (!raw) {
      external.unknown();
      return {
        kind: "unknown",
        message: "暂时无法读取原作品，编辑副本仍保留。请检查作品保存位置后重新核对。",
        pending,
      };
    }
    const saved = canonical(raw, pending.selection.projectId);
    return await settleLibraryWrite(host, pending, lease, saved, raw as Record<string, unknown>);
  } catch {
    external.unknown();
    return { kind: "unknown", message: LIBRARY_FAILURE.WRITE_UNCONFIRMED!, pending };
  }
}
function libraryReleaseFailure(host: LibraryHost, pending?: PendingLibraryWrite): LibraryOutcome {
  if (pending && host.persistence.externalWriteState(pending.before.id))
    return { kind: "unknown", message: LIBRARY_FAILURE.WRITE_UNCONFIRMED!, pending };
  return {
    kind: "failed",
    message: pending
      ? "本地素材结果已核对，但后来的编辑还没保存上。请重试保存。"
      : "本页的编辑还没保存上，请重试保存。",
    ...(pending?.expectedClipId ? { clipId: pending.expectedClipId } : {}),
  };
}
export async function withAudioWriteCleanup(
  host: LibraryHost,
  run: () => Promise<LibraryOutcome>,
  getLease: () => FilmSaveLease | undefined,
  getPending: () => PendingLibraryWrite | undefined,
): Promise<LibraryOutcome> {
  let outcome: LibraryOutcome;
  try {
    outcome = await run();
  } catch {
    outcome = libraryReleaseFailure(host, getPending());
  }
  try {
    await getLease()?.release();
  } catch {
    return libraryReleaseFailure(host, getPending());
  }
  return outcome;
}
export async function addLibraryAsset(
  host: LibraryHost,
  target: LibraryTarget,
  asset: BundledAudioAsset,
  catalogSha256: string,
  choice: {
    assetId: string;
    lane: AddBundledFilmAudioInput["lane"];
    placement: AddBundledFilmAudioInput["placement"];
  },
): Promise<LibraryOutcome> {
  let lease: FilmSaveLease | undefined, pending: PendingSingleLibraryWrite | undefined;
  return await withAudioWriteCleanup(
    host,
    async () => {
      try {
        if (!current(host, target.film, target.selection) || choice.assetId !== asset.id)
          return { kind: "stale", message: "作品或所选版本已变化，请重新核对。" };
        lease = await host.persistence.acquire(target.film.id);
        const prepared = await prepareLibraryInput(target.film, target.selection, host, lease);
        const result = await capabilities().inspectBundledFilmAudioTarget!({
          projectId: target.film.id,
          expectedProjectHash: prepared.hash,
          shotId: target.selection.shotId,
          takeId: target.selection.takeId,
        });
        if (!prepared.valid())
          return { kind: "stale", message: "作品或所选版本已变化，请重新核对。" };
        if (result.kind !== "TARGET")
          return { kind: "failed", message: LIBRARY_FAILURE[result.code] ?? "当前版本尚未核对。" };
        if (
          result.projectHash !== prepared.hash ||
          result.projectId !== target.selection.projectId ||
          result.shotId !== target.selection.shotId ||
          result.takeId !== target.selection.takeId ||
          result.durationSeconds !== target.seconds
        )
          return { kind: "failed", message: "当前版本的实际时长已变化，请重新核对后再加入。" };
        const input: AddBundledFilmAudioInput = {
          projectId: target.selection.projectId,
          expectedProjectHash: prepared.hash,
          catalogSha256,
          assetId: asset.id,
          expectedAssetSha256: asset.sha256,
          shotId: target.selection.shotId,
          takeId: target.selection.takeId,
          lane: choice.lane,
          placement: choice.placement,
        };
        const external = requireAudioExternal(lease);
        pending = {
          before: prepared.accepted,
          canonicalBefore: prepared.stored,
          rawBefore: prepared.rawStored,
          hash: prepared.hash,
          selection: target.selection,
          input,
          asset,
          settled: false,
        };
        external.begin(prepared.valid);
        try {
          const outcome = await capabilities().addBundledFilmAudio!(input);
          pending.settled = true;
          if (outcome.kind === "ADDED") {
            pending.expectedClipId = outcome.clipId;
            return await settleLibraryWrite(
              host,
              pending,
              lease,
              canonical(outcome.project, input.projectId),
              outcome.project,
            );
          }
          pending.settled = false;
          pending.observedRaw = undefined;
          const checked = await readBackLibraryWrite(host, pending, lease);
          return checked.kind === "failed" && !["WRITE_UNCONFIRMED", "BUSY"].includes(outcome.code)
            ? { ...checked, message: LIBRARY_FAILURE[outcome.code] ?? checked.message }
            : checked;
        } catch {
          external.unknown();
          return await readBackLibraryWrite(host, pending, lease);
        }
      } catch {
        return pending
          ? { kind: "unknown", message: LIBRARY_FAILURE.WRITE_UNCONFIRMED!, pending }
          : { kind: "failed", message: "本次没有开始加入素材，请核对作品保存状态后再试。" };
      }
    },
    () => lease,
    () => pending,
  );
}
export async function recoverLibraryWrite(host: LibraryHost, pending: PendingLibraryWrite) {
  const lease = await host.persistence.acquireExternalRecovery(pending.selection.projectId);
  return await withAudioWriteCleanup(
    host,
    () => readBackLibraryWrite(host, pending, lease),
    () => lease,
    () => pending,
  );
}
export type LibraryConflictReview = {
  raw: Record<string, unknown>;
  draft: FilmProject;
  live: FilmProject | null;
};
export function libraryConflictReview(
  host: LibraryHost,
  pending: PendingLibraryWrite,
): LibraryConflictReview | null {
  const draft =
    host.current()?.id === pending.before.id
      ? host.current()
      : (pending.localDraft ?? pending.before);
  return pending.observedRaw && draft
    ? { raw: pending.observedRaw, draft, live: host.current() }
    : null;
}
export function libraryConflictSummary(review: LibraryConflictReview): string {
  const saved = canonical(review.raw, review.draft.id);
  const names: Record<string, string> = {
    title: "片名",
    seriesTitle: "作品名称",
    sourceText: "原文",
    styleZh: "画风",
    scenes: "剧本与场次",
    shots: "镜头、版本或描述",
    persons: "人物设定",
    places: "场景设定",
    props: "道具设定",
    audioClips: "声音片段",
    audioMix: "四轨设置",
  };
  const draft = review.draft as unknown as Record<string, unknown>;
  const stored = saved as unknown as Record<string, unknown>;
  const changed = [...new Set([...Object.keys(draft), ...Object.keys(stored)])].filter(
    (key) =>
      !["savedAt", "directory"].includes(key) &&
      JSON.stringify(draft[key]) !== JSON.stringify(stored[key]),
  );
  return (
    [...new Set(changed.map((key) => names[key] ?? "其他作品设置"))].join("、") ||
    "没有发现创作字段差异"
  );
}
export function libraryDraftMemo(draft: FilmProject): string {
  return [
    draft.title,
    draft.styleZh,
    draft.sourceText,
    ...draft.scenes.map((scene) => scene.text),
    ...draft.shots.map((shot) => [shot.picture, shot.action].filter(Boolean).join("\n")),
  ]
    .filter((value) => typeof value === "string" && value.length)
    .join("\n\n");
}
export async function adoptLibrarySavedVersion(
  host: LibraryHost,
  pending: PendingLibraryWrite,
  review: LibraryConflictReview,
): Promise<LibraryOutcome> {
  const lease = await host.persistence.acquireExternalRecovery(pending.before.id);
  return await withAudioWriteCleanup(
    host,
    async () => {
      const valid = () =>
        host.current() === review.live &&
        (review.live?.id === pending.before.id ||
          (pending.localDraft ?? pending.before) === review.draft);
      if (!valid())
        return { kind: "unknown", message: "编辑副本又有变化，请重新查看两份状态。", pending };
      pending.settled = false;
      pending.observedRaw = undefined;
      const checked = await readBackLibraryWrite(host, pending, lease);
      if (checked.kind !== "unknown") return checked;
      if (
        !pending.settled ||
        !valid() ||
        !pending.observedRaw ||
        (await historyRecordHash(pending.observedRaw)) !== (await historyRecordHash(review.raw))
      )
        return {
          kind: "unknown",
          message: "已保存的作品又有变化或仍在处理中，请重新核对。",
          pending,
        };
      const saved = canonical(pending.observedRaw, pending.before.id);
      if (!valid())
        return { kind: "unknown", message: "编辑副本又有变化，请重新查看两份状态。", pending };
      const adopted = review.live?.id === saved.id ? host.apply(saved) : undefined;
      if (
        !requireAudioExternal(lease).confirm(saved, adopted, () =>
          adopted ? host.current() === adopted : valid(),
        )
      )
        return { kind: "unknown", message: LIBRARY_FAILURE.WRITE_UNCONFIRMED!, pending };
      return {
        kind: "stale",
        message: "已采用本机保存的版本，这份未保存稿已放弃；当前其他作品没有改动。",
      };
    },
    () => lease,
    () => pending,
  );
}
export async function removeLibraryClip(
  host: LibraryHost,
  snapshot: FilmProject,
  clipId: string,
): Promise<LibraryOutcome> {
  let lease: FilmSaveLease | undefined;
  return await withAudioWriteCleanup(
    host,
    async () => {
      try {
        if (
          host.current() !== snapshot ||
          snapshot.audioClips.filter((c) => c.id === clipId).length !== 1 ||
          !snapshot.audioClips.find((c) => c.id === clipId)?.libraryAsset
        )
          return { kind: "stale", message: "片段或作品已变化，请核对后再移除。" };
        lease = await host.persistence.acquire(snapshot.id);
        if (host.current() !== snapshot)
          return { kind: "stale", message: "片段或作品已变化，请核对后再移除。" };
        const adopted = host.apply({
          ...snapshot,
          audioClips: snapshot.audioClips.filter((c) => c.id !== clipId),
        });
        await lease.save(adopted, () => host.current() === adopted);
        return { kind: "removed", message: "片段已移除并保存，素材文件仍保留。" };
      } catch {
        return { kind: "failed", message: "移除后的修改还没保存上，请核对本页后重试保存。" };
      }
    },
    () => lease,
    () => undefined,
  );
}

import { useEffect, useRef, useState } from "react";
import type { FilmAudioLibraryCatalog } from "@aijian/contracts/film-audio-library";
import type { FilmProject } from "../film/project";
import { AUDIO_LANE_LABEL } from "../film/audio";
import { BundledAudioDialog, type BundledAudioChoice } from "./BundledAudioDialog";
import {
  addLibraryAsset,
  adoptLibrarySavedVersion,
  libraryConflictReview,
  libraryConflictSummary,
  libraryDraftMemo,
  type LibraryConflictReview,
  inspectLibraryTarget,
  recoverLibraryWrite,
  removeLibraryClip,
  LIBRARY_FAILURE,
  type LibraryHost,
  type LibraryOutcome,
  type LibraryTarget,
  type PendingLibraryWrite,
} from "./actions/audio-library";
export function useBundledAudioLibrary(
  film: FilmProject | null,
  enabled: boolean,
  host: LibraryHost,
) {
  const hostRef = useRef(host);
  hostRef.current = host;
  const [open, setOpen] = useState(false),
    [catalog, setCatalog] = useState<FilmAudioLibraryCatalog | null>(null),
    [loading, setLoading] = useState(false);
  const [target, setTarget] = useState<LibraryTarget | null>(null),
    [targetBusy, setTargetBusy] = useState(false),
    [busy, setBusy] = useState(false),
    [recovering, setRecovering] = useState(false);
  const [catalogMessage, setCatalogMessage] = useState(""),
    [targetMessage, setTargetMessage] = useState("");
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [pendingOpen, setPendingOpen] = useState(false);
  const [reviews, setReviews] = useState<Record<string, LibraryConflictReview>>({});
  const [, tick] = useState(0);
  const generation = useRef(0),
    working = useRef(false),
    targetWorking = useRef(false);
  const pending = useRef(new Map<string, PendingLibraryWrite>());
  const selection = host.selection(),
    scopeKey = JSON.stringify(selection);
  useEffect(() => {
    generation.current++;
    setOpen(false);
    setTarget(null);
    setTargetBusy(false);
    setTargetMessage("");
  }, [film?.id, scopeKey, enabled]);
  const show = (id: string, text: string) => {
    setMessages((previous) => ({ ...previous, [id]: text }));
  };
  const finish = (id: string, outcome: LibraryOutcome) => {
    if (outcome.kind === "unknown" && outcome.pending) pending.current.set(id, outcome.pending);
    else pending.current.delete(id);
    show(id, outcome.message);
    tick((v) => v + 1);
  };
  async function loadCatalog(token: number) {
    setLoading(true);
    setCatalogMessage("");
    try {
      const result = await window.aijian?.listBundledFilmAudio?.();
      if (generation.current !== token) return;
      if (result?.kind === "CATALOG") {
        setCatalog(result);
      } else {
        setCatalog(null);
        setCatalogMessage(
          result?.kind === "FAILED"
            ? (LIBRARY_FAILURE[result.code] ?? "本地素材目录暂不可用。")
            : "当前版本尚不支持本地素材库。",
        );
      }
    } catch {
      if (generation.current === token) {
        setCatalog(null);
        setCatalogMessage("本地素材目录没有读到，请重试。");
      }
    } finally {
      if (generation.current === token) setLoading(false);
    }
  }
  async function inspect(token: number) {
    if (working.current) return;
    if (targetWorking.current) {
      setTargetBusy(false);
      setTargetMessage("上一轮时长核对还在结束，请稍后重新核对。");
      return;
    }
    const h = hostRef.current,
      base = h.current(),
      scope = h.selection();
    if (!base || !scope) {
      setTarget(null);
      setTargetMessage("先明确选用一个已经生成的视频版本，再加入声音。");
      return;
    }
    if (pending.current.has(base.id)) {
      setTarget(null);
      setTargetMessage("此前添加结果尚未确认，请先核对保存状态。");
      return;
    }
    targetWorking.current = true;
    setTargetBusy(true);
    setTarget(null);
    setTargetMessage("");
    try {
      const result = await inspectLibraryTarget(base, scope, h);
      if (generation.current === token) {
        setTarget(result.target ?? null);
        setTargetMessage(result.message);
      }
    } catch {
      if (generation.current === token)
        setTargetMessage("时长没有核对成功，请检查保存状态后再试。");
    } finally {
      targetWorking.current = false;
      if (generation.current === token) setTargetBusy(false);
    }
  }
  function openDialog() {
    if (working.current) return;
    const token = ++generation.current;
    setOpen(true);
    setTargetBusy(false);
    setTarget(null);
    void loadCatalog(token);
    void inspect(token);
  }
  async function add(choice: BundledAudioChoice) {
    if (working.current || targetBusy || !target || !catalog) return;
    const asset = catalog.assets.find((a) => a.id === choice.assetId);
    if (!asset) return;
    working.current = true;
    setBusy(true);
    const id = target.selection.projectId;
    try {
      finish(
        id,
        await addLibraryAsset(hostRef.current, target, asset, catalog.manifestSha256, choice),
      );
    } catch {
      show(id, "素材保存状态尚未确认，请先核对，不要重复加入。");
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  async function recover(projectId?: string) {
    const h = hostRef.current,
      id = projectId ?? h.current()?.id,
      p = id ? pending.current.get(id) : null;
    if (!id || !p || working.current) return;
    working.current = true;
    setBusy(true);
    setRecovering(true);
    try {
      finish(id, await recoverLibraryWrite(h, p));
    } catch {
      show(id, "保存状态还没有核对清楚，当前编辑已保留，请重试核对。");
    } finally {
      working.current = false;
      setBusy(false);
      setRecovering(false);
    }
  }
  async function adoptSaved(id: string, review: LibraryConflictReview) {
    const context = pending.current.get(id);
    if (!context || working.current) return;
    working.current = true;
    setBusy(true);
    try {
      finish(id, await adoptLibrarySavedVersion(hostRef.current, context, review));
    } catch {
      show(id, "保存状态仍未确认，编辑副本继续保留，请重新核对。");
    } finally {
      working.current = false;
      setBusy(false);
      setReviews((previous) => {
        const next = { ...previous };
        delete next[id];
        return next;
      });
    }
  }
  async function remove(snapshot: FilmProject, clipId: string) {
    if (working.current || pending.current.has(snapshot.id)) return;
    working.current = true;
    setBusy(true);
    try {
      show(snapshot.id, (await removeLibraryClip(hostRef.current, snapshot, clipId)).message);
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  const externalState = film ? host.persistence.externalWriteState(film.id) : null;
  const uncertain = !!film && (pending.current.has(film.id) || externalState?.status === "unknown");
  const validTarget =
    target && host.current() === target.film && JSON.stringify(target.selection) === scopeKey
      ? target
      : null;
  const shot = film?.shots.find((s) => s.id === selection?.shotId),
    take = shot?.takes.find((t) => t.id === selection?.takeId);
  const used =
    film?.audioClips.filter(
      (c) => c.libraryAsset && c.shotId === shot?.id && c.takeId === take?.id,
    ) ?? [];
  const feedback = film ? (messages[film.id] ?? "") : "";
  const tools = (
    <section className="field bundled-audio-used" aria-label="本地声音素材">
      <button className="btn" disabled={busy || !enabled} onClick={openDialog}>
        选用本地音效/配乐
      </button>
      <p role="status" className="role-desc">
        {uncertain ? "此前添加的保存结果尚未核对；当前编辑保留，请勿重复加入。" : feedback}
      </p>
      {uncertain ? (
        <button className="btn" disabled={busy} onClick={() => void recover()}>
          {recovering ? "正在核对保存状态…" : "核对本地素材保存状态"}
        </button>
      ) : null}
      {used.length ? (
        <>
          <h4>当前版本已用的本地素材</h4>
          <p className="role-desc">
            撤销添加请移除对应片段，素材文件仍保留；Ctrl+Z沿用原来的字段修改历史。
          </p>
        </>
      ) : null}
      {used.map((clip) => (
        <div className="bundled-audio-used-row" key={clip.id}>
          <span>
            {clip.label} · {AUDIO_LANE_LABEL[clip.lane]} · {clip.durationSeconds.toFixed(2)} 秒
          </span>
          <button
            className="btn sm"
            disabled={busy || uncertain}
            aria-label={`移除${clip.label}`}
            onClick={() => {
              if (film) void remove(film, clip.id);
            }}
          >
            移除这段素材
          </button>
        </div>
      ))}
    </section>
  );
  const dialog = open ? (
    <BundledAudioDialog
      assets={catalog?.assets ?? null}
      loading={loading}
      target={validTarget ? { key: validTarget.hash, durationSeconds: validTarget.seconds } : null}
      targetBusy={targetBusy}
      busy={busy}
      recovering={recovering}
      locked={uncertain}
      message={[catalogMessage, targetMessage, feedback].filter(Boolean).join(" ")}
      versionLabel={take ? `第${take.index}版` : "未选版本"}
      onRefreshTarget={() => void inspect(generation.current)}
      onRetryCatalog={() => void loadCatalog(generation.current)}
      onAdd={(choice) => void add(choice)}
      onRecover={uncertain ? () => void recover() : undefined}
      onClose={() => {
        if (!working.current) {
          generation.current++;
          setOpen(false);
        }
      }}
    />
  ) : null;
  const pendingEntries = [...pending.current.entries()];
  const pendingButton = pendingEntries.length ? (
    <button className="btn sm" onClick={() => setPendingOpen(true)}>
      本地素材保存待核对（{pendingEntries.length}）
    </button>
  ) : null;
  const pendingPanel = pendingOpen ? (
    <div className="dialog-back">
      <section
        className="dialog bundled-audio-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="本地素材保存状态"
      >
        <h2>本地素材保存状态</h2>
        <p>下列原作品的保存结果尚未确认，当前编辑副本仍保留。核对只读取本机状态，不会重复添加。</p>
        {pendingEntries.length ? (
          pendingEntries.map(([id, context]) => (
            <section key={id}>
              <h3>{context.before.seriesTitle || context.before.title || "未命名作品"}</h3>
              <p role="status">{messages[id] || "保存状态待核对。"}</p>
              <button className="btn" disabled={busy} onClick={() => void recover(id)}>
                核对这部作品
              </button>
              <button
                className="btn"
                disabled={busy || !context.observedRaw}
                onClick={() => {
                  const review = libraryConflictReview(hostRef.current, context);
                  if (review) setReviews((previous) => ({ ...previous, [id]: review }));
                }}
              >
                查看冲突处理
              </button>
              {reviews[id] ? (
                <section aria-label="保存冲突选择">
                  <p>
                    未保存稿：{reviews[id]!.draft.title || "未命名作品"}，
                    {reviews[id]!.draft.shots.length} 个镜头、{reviews[id]!.draft.audioClips.length}{" "}
                    段声音。
                  </p>
                  <p>
                    已保存版本：
                    {Array.isArray(reviews[id]!.raw.shots) ? reviews[id]!.raw.shots.length : 0}{" "}
                    个镜头、
                    {Array.isArray(reviews[id]!.raw.audioClips)
                      ? reviews[id]!.raw.audioClips.length
                      : 0}{" "}
                    段声音。采用后将放弃这份未保存稿中的修改；不会改动其他作品或删除素材文件。
                  </p>
                  <p>两份内容的差异：{libraryConflictSummary(reviews[id]!)}。</p>
                  <details>
                    <summary>查看并复制未保存稿的文字备忘</summary>
                    <p>这份文字备忘不包含媒体和全部设置，不能替代工程包。</p>
                    <textarea
                      aria-label="未保存稿文字备忘"
                      readOnly
                      value={libraryDraftMemo(reviews[id]!.draft)}
                      rows={6}
                    />
                  </details>
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() => void adoptSaved(id, reviews[id]!)}
                  >
                    采用已保存版本并放弃这份未保存稿
                  </button>
                </section>
              ) : null}
            </section>
          ))
        ) : (
          <p role="status">本地素材保存状态已核对。</p>
        )}
        <p>
          原作品暂时读不到时会继续保留未确认状态，不会用旧内容写回；可修复本机保存位置后再次核对。
        </p>
        <div className="acts">
          <button className="btn" disabled={busy} onClick={() => setPendingOpen(false)}>
            关闭
          </button>
        </div>
      </section>
    </div>
  ) : null;
  async function runGroupOperation(id: string, operation: () => Promise<LibraryOutcome>) {
    if (working.current || pending.current.has(id))
      return { kind: "failed" as const, message: "请先核对上一轮素材保存结果，尚未开始本次操作。" };
    working.current = true;
    setBusy(true);
    try {
      const result = await operation();
      finish(id, result);
      return result;
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  return {
    tools,
    dialog,
    pendingButton,
    pendingPanel,
    runGroupOperation,
    pendingFor: (id: string) => pending.current.has(id),
    busy,
  };
}

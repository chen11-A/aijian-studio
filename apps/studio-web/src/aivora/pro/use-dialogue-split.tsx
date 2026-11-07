import { useEffect, useRef, useState } from "react";
import type { FilmProject } from "../film/project";
import { DialogueSplitDialog } from "./DialogueSplitDialog";
import { libraryDraftMemo } from "./actions/audio-library";
import {
  applyNativeSplit,
  readNativeSplit,
  recoverNativeSplit,
  splitInputKey,
  type SplitHost,
  type SplitOutcome,
  type NativeSplitReview,
  type PendingSplitWrite,
} from "./actions/dialogue-split-native";
export function useDialogueSplit(film: FilmProject | null, enabled: boolean, host: SplitHost) {
  const h = useRef(host);
  h.current = host;
  const generation = useRef(0),
    working = useRef(false),
    applyingRef = useRef(false),
    pending = useRef(new Map<string, PendingSplitWrite>());
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [applying, setApplying] = useState(false),
    [accepted, setAccepted] = useState(false),
    [review, setReview] = useState<NativeSplitReview | null>(null),
    [message, setMessage] = useState("");
  const [pendingOpen, setPendingOpen] = useState(false),
    [pendingBusy, setPendingBusy] = useState(false),
    [tick, setTick] = useState(0),
    [messages, setMessages] = useState<Record<string, string>>({}),
    [lastResolved, setLastResolved] = useState("");
  type Conflict = { raw: Record<string, unknown>; live: FilmProject | null; draft: FilmProject };
  const [conflicts, setConflicts] = useState<Record<string, Conflict>>({});
  const scope = JSON.stringify(host.selection()),
    key = splitInputKey(film, host.selection(), host.versions()),
    previous = useRef({ scope, key, enabled });
  useEffect(() => {
    const last = previous.current;
    previous.current = { scope, key, enabled };
    if (last.scope === scope && last.key === key && last.enabled === enabled) return;
    generation.current++;
    setAccepted(false);
    setReview(null);
    setBusy(false);
    if (last.scope !== scope || !enabled) setOpen(false);
    else setMessage("本次输入已变化，请重新检查拆镜方案。");
  }, [scope, key, enabled]);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  function finish(id: string, result: SplitOutcome) {
    if (result.pending) pending.current.set(id, result.pending);
    else if (!h.current.persistence.externalWriteState(id)) {
      pending.current.delete(id);
      setLastResolved(result.message);
    }
    if (result.kind === "applied" && h.current.current()?.id === id)
      h.current.onApplied?.(result.message);
    setMessages((v) => ({ ...v, [id]: result.message }));
    setTick((v) => v + 1);
  }
  async function read() {
    if (working.current) return;
    const id = h.current.current()?.id;
    if (!id) return;
    if (h.current.persistence.externalWriteState(id)) {
      setReview(null);
      setMessage("这部作品还有保存结果待核对，请先完成页脚的保存核对，不要重复接受。");
      return;
    }
    working.current = true;
    const token = ++generation.current;
    setReview(null);
    setAccepted(false);
    setBusy(true);
    setMessage("");
    try {
      const result = await readNativeSplit(
        {
          ...h.current,
          onCanonicalPrepared: (canonical) => {
            if (generation.current === token)
              previous.current = {
                scope: JSON.stringify(h.current.selection()),
                key: splitInputKey(canonical, h.current.selection(), h.current.versions()),
                enabled,
              };
          },
        },
        () => generation.current === token,
      );
      if (generation.current !== token) return;
      if (result.kind === "ready") setReview(result.review);
      else
        setMessage(
          result.kind === "stale" ? "本次输入已变化，请重新检查拆镜方案。" : result.message,
        );
    } catch {
      if (generation.current === token) setMessage("拆镜方案没有完整读到，请重新检查。");
    } finally {
      working.current = false;
      if (generation.current === token) setBusy(false);
    }
  }
  async function apply() {
    if (
      !review ||
      !accepted ||
      working.current ||
      applyingRef.current ||
      review.key !== splitInputKey(h.current.current(), h.current.selection(), h.current.versions())
    )
      return;
    working.current = true;
    applyingRef.current = true;
    setApplying(true);
    const token = generation.current,
      id = review.scope.projectId;
    try {
      const result = await applyNativeSplit(h.current, review);
      finish(id, result);
      if (generation.current === token) {
        setMessage(result.message);
        setAccepted(false);
        if (result.kind !== "failed") setReview(null);
      }
    } finally {
      working.current = false;
      applyingRef.current = false;
      setApplying(false);
    }
  }
  async function recover(id: string, discard?: Conflict) {
    const context = pending.current.get(id);
    if (!context || working.current) return;
    working.current = true;
    setPendingBusy(true);
    try {
      finish(id, await recoverNativeSplit(h.current, context, discard));
    } finally {
      working.current = false;
      setPendingBusy(false);
      setConflicts((v) => {
        const next = { ...v };
        delete next[id];
        return next;
      });
    }
  }
  const entries = [...pending.current.entries()];
  void tick;
  return {
    tools: enabled ? (
      <button
        className="btn"
        disabled={applying || pendingBusy}
        onClick={() => {
          setOpen(true);
          void read();
        }}
      >
        查看完整句拆镜方案
      </button>
    ) : null,
    dialog: open ? (
      <DialogueSplitDialog
        review={
          review
            ? {
                ...review.ready.plan,
                notes: review.ready.notes,
                actualLimit: review.ready.actualLimit,
              }
            : null
        }
        busy={busy}
        applying={applying}
        stale={!!review && review.key !== key}
        accepted={accepted}
        message={message}
        onAccepted={setAccepted}
        onRefresh={() => void read()}
        onApply={() => void apply()}
        onClose={() => {
          if (!applyingRef.current) {
            generation.current++;
            setOpen(false);
            setReview(null);
            setAccepted(false);
          }
        }}
      />
    ) : null,
    pendingButton: entries.length ? (
      <button className="btn sm" onClick={() => setPendingOpen(true)}>
        拆镜保存待核对（{entries.length}）
      </button>
    ) : null,
    pendingPanel: pendingOpen ? (
      <div className="dialog-back">
        <section
          className="dialog dialogue-split-dialog"
          role="dialog"
          aria-modal="true"
          aria-label="拆镜保存状态"
        >
          <h2>拆镜保存状态</h2>
          <p>未确认的编辑副本仍保留。核对只读取原作品与拆镜前备份，不会再次接受或生成媒体。</p>
          {entries.map(([id, context]) => {
            const draft =
              h.current.persistence.externalWriteState(id)?.draft ??
              context.localDraft ??
              context.before;
            return (
              <section key={id}>
                <h3>{context.before.seriesTitle || context.before.title || "未命名作品"}</h3>
                <p role="status">{messages[id] || "保存结果待核对。"}</p>
                <button
                  className="btn"
                  disabled={pendingBusy || applying}
                  onClick={() => void recover(id)}
                >
                  核对拆镜保存结果
                </button>
                <button
                  className="btn"
                  disabled={pendingBusy || applying || !context.observedRaw}
                  onClick={() => {
                    if (context.observedRaw)
                      setConflicts((v) => ({
                        ...v,
                        [id]: { raw: context.observedRaw!, live: h.current.current(), draft },
                      }));
                  }}
                >
                  查看两份状态
                </button>
                {conflicts[id] ? (
                  <section aria-label="拆镜保存冲突选择">
                    <p>
                      保留稿：{conflicts[id]!.draft.title || "未命名作品"}，
                      {conflicts[id]!.draft.shots.length} 镜、
                      {conflicts[id]!.draft.audioClips.length} 段声音。
                    </p>
                    <p>
                      已核对保存版：
                      {Array.isArray(conflicts[id]!.raw.shots)
                        ? conflicts[id]!.raw.shots.length
                        : 0}{" "}
                      镜。原音轨引用保留原绑定，尚未重新排时；不会改动当前其他作品。
                    </p>
                    <details>
                      <summary>查看并复制保留稿的文字备忘</summary>
                      <p>文字备忘不包含媒体和全部设置，不能替代工程包或本机历史。</p>
                      <textarea
                        readOnly
                        aria-label="拆镜保留稿文字备忘"
                        rows={6}
                        value={libraryDraftMemo(conflicts[id]!.draft)}
                      />
                    </details>
                    <button
                      className="btn"
                      disabled={pendingBusy || applying}
                      onClick={() => void recover(id, conflicts[id])}
                    >
                      采用已核对的拆镜版并放弃这份保留稿
                    </button>
                  </section>
                ) : null}
              </section>
            );
          })}
          {!entries.length ? (
            <p role="status">{lastResolved || "拆镜保存结果已核对，保留状态已解除。"}</p>
          ) : null}
          <button className="btn" disabled={pendingBusy} onClick={() => setPendingOpen(false)}>
            关闭
          </button>
        </section>
      </div>
    ) : null,
  };
}

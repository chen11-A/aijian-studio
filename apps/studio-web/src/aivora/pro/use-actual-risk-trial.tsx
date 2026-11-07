import { useEffect, useRef, useState, type ReactNode } from "react";
import type { FilmProject } from "../film/project";
import { ActualRiskTrialReview, type ActualTrialViewState } from "./ActualRiskTrialReview";
import { libraryDraftMemo } from "./actions/audio-library";
import {
  actualTrialInputKey,
  prepareActualTrial,
  readActualTrialMedia,
  type ActualTrialCapture,
  type ActualTrialHost,
} from "./actions/actual-risk-trial";
import {
  recordActualTrial,
  recoverActualTrial,
  type ActualTrialConflict,
  type ActualTrialOutcome,
  type PendingActualTrialWrite,
} from "./actions/actual-risk-trial-record";
export function useActualRiskTrial(
  film: FilmProject | null,
  enabled: boolean,
  host: ActualTrialHost & {
    continuation?: (decisionId: string) => ReactNode;
  },
) {
  const h = useRef(host);
  h.current = host;
  const generation = useRef(0),
    preparing = useRef(false),
    recording = useRef(false),
    recovering = useRef(false),
    url = useRef<string | null>(null),
    pending = useRef(new Map<string, PendingActualTrialWrite>());
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [state, setState] = useState<ActualTrialViewState>({ kind: "preparing" }),
    [review, setReview] = useState<ActualTrialCapture | null>(null),
    [pendingOpen, setPendingOpen] = useState(false),
    [pendingBusy, setPendingBusy] = useState(false),
    [tick, setTick] = useState(0),
    [messages, setMessages] = useState<Record<string, string>>({}),
    [conflicts, setConflicts] = useState<Record<string, ActualTrialConflict>>({});
  const scope = JSON.stringify(host.selection()),
    key = actualTrialInputKey(film, host.selection()),
    previous = useRef({ scope, key, enabled });
  function revoke() {
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = null;
  }
  useEffect(() => {
    const last = previous.current;
    previous.current = { scope, key, enabled };
    if (last.scope === scope && last.key === key && last.enabled === enabled) return;
    generation.current++;
    revoke();
    setReview(null);
    setBusy(false);
    if (last.scope !== scope || !enabled) setOpen(false);
    else setState({ kind: "failed", message: "创作输入或选版已变化，请重新核对实际试片。" });
  }, [scope, key, enabled]);
  useEffect(
    () => () => {
      generation.current++;
      revoke();
    },
    [],
  );
  async function read() {
    if (preparing.current || recording.current || recovering.current) return;
    const id = h.current.current()?.id;
    if (!id) return;
    if (h.current.persistence.externalWriteState(id)) {
      setState({
        kind: "failed",
        message: "这部作品还有保存结果待核对，请先完成页脚核对，不要重复记录。",
      });
      return;
    }
    preparing.current = true;
    const token = ++generation.current;
    revoke();
    setReview(null);
    setState({ kind: "preparing" });
    setBusy(true);
    try {
      const result = await prepareActualTrial(
        {
          ...h.current,
          onCanonicalPrepared: (canonical) => {
            if (generation.current === token)
              previous.current = {
                scope: JSON.stringify(h.current.selection()),
                key: actualTrialInputKey(canonical, h.current.selection()),
                enabled,
              };
          },
        },
        () => generation.current === token,
      );
      if (generation.current !== token) return;
      if (result.kind === "unsupported") {
        setState({ kind: "unsupported" });
        return;
      }
      if (result.kind !== "ready") {
        setState({
          kind: "failed",
          message:
            result.kind === "stale" ? "创作输入或选版已变化，请重新核对实际试片。" : result.message,
        });
        return;
      }
      setState({ kind: "loading-media" });
      const media = await readActualTrialMedia(
        h.current,
        result.review,
        () => generation.current === token,
      );
      if (generation.current !== token) return;
      if (media.kind !== "media") {
        setState({
          kind: "failed",
          message: media.kind === "stale" ? "素材或当前会话已变化，请重新核对。" : media.message,
        });
        return;
      }
      // Bytes are this owner's bounded native response. The URL is local and is never persisted.
      const bytes = new Uint8Array(media.bytes.byteLength);
      bytes.set(media.bytes);
      url.current = URL.createObjectURL(new Blob([bytes.buffer]));
      setReview(result.review);
      setState({
        kind: "ready",
        ready: result.review.ready,
        mediaSrc: url.current,
        mediaFailed: false,
      });
    } catch {
      if (generation.current === token)
        setState({
          kind: "failed",
          message: "实际素材没有完整载入，请重新核对；这不代表已经播放。",
        });
    } finally {
      preparing.current = false;
      if (generation.current === token) setBusy(false);
    }
  }
  function finish(id: string, result: ActualTrialOutcome) {
    if (result.pending) pending.current.set(id, result.pending);
    else if (!h.current.persistence.externalWriteState(id)) pending.current.delete(id);
    setMessages((before) => ({ ...before, [id]: result.message }));
    setTick((value) => value + 1);
  }
  async function record(decision: "accepted" | "needs-changes", note: string) {
    if (!review || recording.current || preparing.current || recovering.current) return;
    recording.current = true;
    setBusy(true);
    const token = generation.current,
      captured = review;
    try {
      const result = await recordActualTrial(h.current, captured, decision, note);
      finish(captured.scope.projectId, result); // Accounting precedes discarding any late view.
      if (generation.current !== token) return;
      setState((before) =>
        before.kind === "ready"
          ? {
              ...before,
              message: result.message,
              reviewExpired: true,
              ...(result.recorded ? { recorded: result.recorded } : {}),
            }
          : before,
      );
    } finally {
      recording.current = false;
      if (generation.current === token) setBusy(false);
    }
  }
  async function recover(id: string, discard?: ActualTrialConflict) {
    const context = pending.current.get(id);
    if (!context || recovering.current || recording.current || preparing.current) return;
    recovering.current = true;
    setPendingBusy(true);
    try {
      finish(id, await recoverActualTrial(h.current, context, discard));
    } finally {
      recovering.current = false;
      setPendingBusy(false);
      setConflicts((before) => {
        const next = { ...before };
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
        disabled={recording.current || pendingBusy}
        onClick={() => {
          setOpen(true);
          void read();
        }}
      >
        审核实际版本试片
      </button>
    ) : null,
    dialog: open ? (
      <ActualRiskTrialReview
        state={state}
        busy={busy}
        stale={!!review && review.key !== key}
        pending={!!film && pending.current.has(film.id)}
        onClose={() => {
          generation.current++;
          revoke();
          setOpen(false);
          setReview(null);
          setBusy(false);
        }}
        onRefresh={() => void read()}
        onRecord={(decision, note) => void record(decision, note)}
        onMediaError={() =>
          setState((before) =>
            before.kind === "ready" ? { ...before, mediaFailed: true } : before,
          )
        }
        onCheckPending={() => setPendingOpen(true)}
        continuation={
          state.kind === "ready" && state.recorded
            ? h.current.continuation?.(state.recorded.value.id)
            : null
        }
      />
    ) : null,
    pendingButton: entries.length ? (
      <button className="btn sm" onClick={() => setPendingOpen(true)}>
        试片记录待核对（{entries.length}）
      </button>
    ) : null,
    pendingPanel: pendingOpen ? (
      <div className="dialog-back">
        <section
          className="dialog actual-risk-trial"
          role="dialog"
          aria-modal="true"
          aria-label="试片记录保存状态"
        >
          <h2>试片记录保存状态</h2>
          <p>未确认时保留编辑副本。核对只读取原作品及实际素材，不会重复记录或继续生成。</p>
          {entries.map(([id, context]) => {
            const draft =
              h.current.persistence.externalWriteState(id)?.draft ??
              context.localDraft ??
              context.before;
            return (
              <section key={id}>
                <h3>{context.before.seriesTitle || context.before.title || "未命名作品"}</h3>
                <p role="status">{messages[id] || "保存结果待核对。"}</p>
                <p>本次人工说明：{context.input.note || "没有附加说明。"}</p>
                <button
                  className="btn"
                  disabled={pendingBusy || busy}
                  onClick={() => void recover(id)}
                >
                  核对试片保存结果
                </button>
                <button
                  className="btn"
                  disabled={pendingBusy || busy || !context.observedRaw}
                  onClick={() => {
                    if (context.observedRaw)
                      setConflicts((before) => ({
                        ...before,
                        [id]: { raw: context.observedRaw!, live: h.current.current(), draft },
                      }));
                  }}
                >
                  查看两份状态
                </button>
                {conflicts[id] ? (
                  <section aria-label="试片记录保存冲突选择">
                    <p>
                      保留稿：{conflicts[id]!.draft.title || "未命名作品"}，
                      {conflicts[id]!.draft.shots.length} 镜。
                    </p>
                    <p>保存版已完成完整记录核对；采用会放弃这份未保存稿，不会覆盖当前其他作品。</p>
                    <details>
                      <summary>查看并复制保留稿的文字备忘</summary>
                      <p>备忘不包含媒体与全部设置，不能代替工程包或历史。</p>
                      <textarea
                        readOnly
                        aria-label="试片保留稿文字备忘"
                        rows={6}
                        value={libraryDraftMemo(conflicts[id]!.draft)}
                      />
                    </details>
                    <button
                      className="btn"
                      disabled={pendingBusy || busy}
                      onClick={() => void recover(id, conflicts[id])}
                    >
                      采用已核对保存版并放弃这份保留稿
                    </button>
                  </section>
                ) : null}
              </section>
            );
          })}
          <button className="btn" onClick={() => setPendingOpen(false)}>
            关闭
          </button>
        </section>
      </div>
    ) : null,
  };
}

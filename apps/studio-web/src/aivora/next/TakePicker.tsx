import { useId, type KeyboardEvent } from "react";
import "./next.css";
import "./TakePicker.css";

export type TakeVerdict = "可用" | "建议重做" | "必须重做";

export type TakeNote = { tone: "ok" | "warn" | "bad"; text: string };

export type TakeOption = {
  id: string;
  /** For example 「A 版」. */
  label: string;
  /** Defaults to ready. A take that is not ready cannot be picked. */
  status?: "ready" | "generating" | "failed";
  verdict?: TakeVerdict;
  notes?: readonly TakeNote[];
  /** A still from the take. Without one, a plain stand-in is drawn. */
  imageUrl?: string;
  /** What is going on with a take that is not ready, for example 「正在生成 · 已等 48 秒」. */
  statusText?: string;
};

export type TakePickerProps = {
  /** For example 「第 2 场第 17 个镜头」. */
  shotLabel: string;
  shotCode?: string;
  description?: string;
  /** The versions of one shot. The first three are shown side by side. */
  takes: readonly TakeOption[];
  /** The version the AI picked. It gets 「AI 选的，可换」 and is in use while selectedId is left out. */
  aiChoiceId?: string | null;
  /** The version in use. When left out, the AI's pick is in use. */
  selectedId?: string | null;
  aspect?: "9:16" | "16:9";
  onSelect: (takeId: string) => void;
};

const VERDICT_TONE: Record<TakeVerdict, string> = {
  可用: "nx-ok",
  建议重做: "nx-warn",
  必须重做: "nx-err",
};

const NOTE_MARK: Record<TakeNote["tone"], string> = { ok: "✓", warn: "!", bad: "✕" };

export const MAX_TAKES = 3;

/** Several versions of one shot side by side. The AI's pick is marked and can be changed. */
export function TakePicker({
  shotLabel,
  shotCode,
  description,
  takes,
  aiChoiceId = null,
  selectedId,
  aspect = "9:16",
  onSelect,
}: TakePickerProps) {
  const id = useId();
  const shown = takes.slice(0, MAX_TAKES);
  const inUse = selectedId === undefined ? aiChoiceId : selectedId;
  const ready = (take: TakeOption) => (take.status ?? "ready") === "ready";

  const onKeyDown = (event: KeyboardEvent) => {
    const index = ["1", "2", "3"].indexOf(event.key);
    const take = shown[index];
    if (!take || !ready(take) || take.id === inUse) return;
    event.preventDefault();
    onSelect(take.id);
  };

  return (
    <section className="nx-root nx-takes" aria-labelledby={`${id}-title`} onKeyDown={onKeyDown}>
      <header className="nx-takes-head">
        <p className="nx-row">
          <strong id={`${id}-title`} className="nx-one-line">
            {shotLabel}
          </strong>
          {shotCode ? <span className="nx-code">{shotCode}</span> : null}
          <span className="nx-faint">· {shown.length} 个版本</span>
        </p>
        {description ? <p className="nx-muted nx-one-line">{description}</p> : null}
      </header>
      <ul className={`nx-takes-grid nx-count-${shown.length}`}>
        {shown.map((take, index) => {
          const using = take.id === inUse;
          const status = take.status ?? "ready";
          return (
            <li
              key={take.id}
              className={`nx-take${using ? " nx-in-use" : ""}`}
              aria-label={take.label}
            >
              <div className="nx-take-head">
                <strong>{take.label}</strong>
                {take.id === aiChoiceId ? (
                  <span className="nx-tag nx-info">AI 选的，可换</span>
                ) : null}
                <span className="nx-spacer" />
                {take.verdict ? (
                  <span className={`nx-tag ${VERDICT_TONE[take.verdict]}`}>{take.verdict}</span>
                ) : null}
              </div>
              <div className="nx-take-media">
                <div className={`nx-frame ${aspect === "16:9" ? "nx-wide" : "nx-tall"}`}>
                  {take.imageUrl ? <img src={take.imageUrl} alt={`${take.label}的画面`} /> : null}
                  {status !== "ready" ? (
                    <span className="nx-take-state">
                      {take.statusText ?? (status === "generating" ? "正在生成" : "没有做成")}
                    </span>
                  ) : null}
                </div>
              </div>
              {take.notes && take.notes.length > 0 ? (
                <ul className="nx-take-notes">
                  {take.notes.map((note) => (
                    <li key={note.text} className={`nx-note-${note.tone}`}>
                      <span aria-hidden="true">{NOTE_MARK[note.tone]}</span>
                      {note.text}
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="nx-take-use">
                {using ? (
                  <span className="nx-tag nx-ok" role="status">
                    正在用这一版
                  </span>
                ) : (
                  <button
                    type="button"
                    className="nx-btn"
                    disabled={!ready(take)}
                    title={ready(take) ? undefined : "这一版还不能用"}
                    aria-label={`用${take.label}`}
                    onClick={() => onSelect(take.id)}
                  >
                    用这一版
                  </button>
                )}
                {shown.length > 1 ? (
                  <span className="nx-key" aria-hidden="true">
                    {index + 1}
                  </span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="nx-faint nx-takes-foot">
        {takes.length > MAX_TAKES ? `这里只放前 ${MAX_TAKES} 个版本。` : ""}
        {shown.length > 1 ? `按 ${shown.map((_, index) => index + 1).join("、")} 也能选。` : ""}
        旧版本都留着，可以随时换回来。
      </p>
    </section>
  );
}

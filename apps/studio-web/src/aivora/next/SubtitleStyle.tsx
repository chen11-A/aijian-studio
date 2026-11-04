import { useId, useRef, type KeyboardEvent } from "react";
import "./next.css";
import "./SubtitleStyle.css";
import { stepChoice } from "./radio";

export type SubtitleStyleOption = { id: string; name: string; description: string };

/** The four built-in looks. Each id has its own CSS in SubtitleStyle.css. */
export const SUBTITLE_STYLES: readonly SubtitleStyleOption[] = [
  { id: "white", name: "清楚白字", description: "白字加深色边，哪种画面都看得清。" },
  { id: "bar", name: "底条字幕", description: "白字垫一条半透明深色底，亮的画面也清楚。" },
  { id: "film", name: "电影字幕", description: "小一号的字，柔和阴影，更像电影。" },
  { id: "yellow", name: "醒目黄字", description: "大号黄字加深色粗边，短视频里最常见。" },
];

const LOOKS = new Set(SUBTITLE_STYLES.map((style) => style.id));

export type SubtitleStyleProps = {
  /** The chosen style id. An id that is not among styles means none is chosen yet. */
  value: string;
  /** A line from the script to preview, for example 「你来晚了。这家店，下个月就没了。」. */
  sampleLine: string;
  /** Where the line is, for example 「第 1 场第 16 个镜头」. */
  sampleSource?: string;
  styles?: readonly SubtitleStyleOption[];
  /** Most characters per line in the portrait preview, 12 by default. See wrapLine. */
  tallLineLength?: number;
  onChange: (styleId: string) => void;
  /** 「用这个样式」: use it for every subtitle in the project. */
  onApply?: (styleId: string) => void;
};

/**
 * Splits a line after 。！？，；、 so no line is longer than max characters (at least 1). A piece
 * longer than max is cut every max characters.
 */
export function wrapLine(text: string, max: number): string[] {
  const limit = Math.max(1, Math.floor(max));
  const lines: string[] = [];
  let current = "";
  for (const piece of text.split(/(?<=[。！？，；、])/u)) {
    if ([...current].length + [...piece].length <= limit) {
      current += piece;
      continue;
    }
    if (current) lines.push(current);
    const chars = [...piece];
    while (chars.length > limit) lines.push(chars.splice(0, limit).join(""));
    current = chars.join("");
  }
  if (current) lines.push(current);
  return lines;
}

const lookOf = (styleId: string) => (LOOKS.has(styleId) ? styleId : "white");

/** Pick a subtitle style and see it on a landscape and a portrait frame at the same time. */
export function SubtitleStyle({
  value,
  sampleLine,
  sampleSource,
  styles = SUBTITLE_STYLES,
  tallLineLength = 12,
  onChange,
  onApply,
}: SubtitleStyleProps) {
  const id = useId();
  const cards = useRef(new Map<string, HTMLButtonElement>());
  const look = lookOf(value);
  const ids = styles.map((style) => style.id);
  const chosen = ids.includes(value);
  const tallLines = wrapLine(sampleLine, tallLineLength);

  const onKeyDown = (event: KeyboardEvent) => {
    const next = stepChoice(ids, value, event.key);
    if (!next) return;
    event.preventDefault();
    onChange(next);
    cards.current.get(next)?.focus();
  };

  return (
    <section className="nx-root nx-subs" aria-labelledby={`${id}-title`}>
      <div className="nx-subs-cols">
        <div className="nx-panel nx-subs-list">
          <div className="nx-panel-head">
            <h2 id={`${id}-title`}>字幕样式</h2>
            <span className="nx-faint">{styles.length} 套</span>
          </div>
          <div
            className="nx-scroll nx-panel-body nx-subs-options"
            role="radiogroup"
            aria-labelledby={`${id}-title`}
            onKeyDown={onKeyDown}
          >
            {styles.map((style) => (
              <button
                key={style.id}
                ref={(node) => {
                  if (node) cards.current.set(style.id, node);
                  else cards.current.delete(style.id);
                }}
                type="button"
                role="radio"
                aria-checked={style.id === value}
                tabIndex={style.id === value || (!chosen && style.id === ids[0]) ? 0 : -1}
                className="nx-sub-card"
                onClick={() => onChange(style.id)}
              >
                <span className="nx-frame nx-sub-thumb" aria-hidden="true">
                  <span className={`nx-sub-text nx-look-${lookOf(style.id)}`}>
                    <span>字幕在这里</span>
                  </span>
                </span>
                <span className="nx-sub-name">{style.name}</span>
                <span className="nx-sub-desc">{style.description}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="nx-panel nx-subs-preview">
          <div className="nx-panel-head">
            <h3>预览这一句</h3>
            <span className="nx-one-line">{sampleLine}</span>
            {sampleSource ? <span className="nx-faint nx-sub-source">{sampleSource}</span> : null}
          </div>
          <div className="nx-subs-stage">
            <figure className="nx-subs-shot">
              <div className="nx-frame nx-subs-wide">
                <p className={`nx-sub-text nx-look-${look}`} data-testid="wide-line">
                  <span>{sampleLine}</span>
                </p>
              </div>
              <figcaption className="nx-faint">横屏 16:9</figcaption>
            </figure>
            <figure className="nx-subs-shot">
              <div className="nx-frame nx-subs-tall">
                <p className={`nx-sub-text nx-look-${look}`} data-testid="tall-line">
                  {tallLines.map((line, index) => (
                    <span key={`${index}-${line}`}>{line}</span>
                  ))}
                </p>
                <span className="nx-safe">平台的按钮和标题会挡住这里</span>
              </div>
              <figcaption className="nx-faint">
                竖屏 9:16 · 一行最多 {tallLineLength} 个字
              </figcaption>
            </figure>
          </div>
          {onApply ? (
            <div className="nx-subs-foot">
              <span className="nx-faint">
                {chosen ? "整部作品的字幕一起换，可以撤销。" : "先在左边选一套样式。"}
              </span>
              <button
                type="button"
                className="nx-btn nx-primary"
                disabled={!chosen}
                onClick={() => onApply(value)}
              >
                用这个样式
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

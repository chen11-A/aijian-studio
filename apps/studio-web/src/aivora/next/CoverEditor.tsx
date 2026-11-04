import { useId, useState } from "react";
import "./next.css";
import "./CoverEditor.css";

export type CoverEditorProps = {
  title: string;
  /** For example 「第 1 集」. */
  subtitle?: string;
  /** Show 「AI 生成」 on the cover. When left out, the switch keeps its own state. */
  aiMark?: boolean;
  /** Where the switch starts when aiMark is left out. On, unless set otherwise. */
  defaultAiMark?: boolean;
  /** A still to put behind the title. Without one, a plain dark frame is used. */
  backgroundUrl?: string;
  onTitleChange: (title: string) => void;
  onSubtitleChange?: (subtitle: string) => void;
  onAiMarkChange?: (on: boolean) => void;
  /** 「用这个封面」. */
  onSave?: () => void;
};

export const TITLE_MAX_LENGTH = 20;

function Cover({
  shape,
  title,
  subtitle,
  aiMark,
  backgroundUrl,
}: {
  shape: "tall" | "wide";
  title: string;
  subtitle?: string;
  aiMark: boolean;
  backgroundUrl?: string;
}) {
  return (
    <div className={`nx-frame nx-cover nx-cover-${shape}`} data-testid={`cover-${shape}`}>
      {backgroundUrl ? <img src={backgroundUrl} alt="" /> : null}
      <span className="nx-cover-words">
        <span className={`nx-cover-title${title.trim() ? "" : " nx-cover-empty"}`}>
          {title.trim() || "片名"}
        </span>
        {subtitle ? <span className="nx-cover-sub">{subtitle}</span> : null}
      </span>
      {aiMark ? <span className="nx-ai-mark">AI 生成</span> : null}
    </div>
  );
}

/** Cover title and the 「AI 生成」 mark, with portrait and landscape previews. */
export function CoverEditor({
  title,
  subtitle,
  aiMark,
  defaultAiMark = true,
  backgroundUrl,
  onTitleChange,
  onSubtitleChange,
  onAiMarkChange,
  onSave,
}: CoverEditorProps) {
  const id = useId();
  const [ownAiMark, setOwnAiMark] = useState(defaultAiMark);
  const markOn = aiMark ?? ownAiMark;
  const missingTitle = title.trim() === "";

  const toggleMark = () => {
    const next = !markOn;
    if (aiMark === undefined) setOwnAiMark(next);
    onAiMarkChange?.(next);
  };

  return (
    <section className="nx-root nx-cover-editor" aria-labelledby={`${id}-title`}>
      <div className="nx-cover-cols">
        <div className="nx-panel nx-cover-preview">
          <div className="nx-panel-head">
            <h2 id={`${id}-title`}>封面</h2>
            <span className="nx-faint">竖屏和横屏一起出</span>
          </div>
          <div className="nx-cover-stage">
            <figure className="nx-cover-shot nx-cover-shot-tall">
              <Cover
                shape="tall"
                title={title}
                subtitle={subtitle}
                aiMark={markOn}
                backgroundUrl={backgroundUrl}
              />
              <figcaption className="nx-faint">竖屏封面</figcaption>
            </figure>
            <figure className="nx-cover-shot nx-cover-shot-wide">
              <Cover
                shape="wide"
                title={title}
                subtitle={subtitle}
                aiMark={markOn}
                backgroundUrl={backgroundUrl}
              />
              <figcaption className="nx-faint">横屏封面</figcaption>
            </figure>
          </div>
        </div>
        <aside className="nx-panel nx-cover-settings" aria-label="封面设置">
          <div className="nx-panel-head">
            <h3>设置</h3>
          </div>
          <div className="nx-panel-body nx-cover-form">
            <div className="nx-cover-field">
              <label htmlFor={`${id}-name`}>片名</label>
              <input
                id={`${id}-name`}
                className="nx-input"
                value={title}
                maxLength={TITLE_MAX_LENGTH}
                onChange={(event) => onTitleChange(event.target.value)}
              />
            </div>
            {onSubtitleChange ? (
              <div className="nx-cover-field">
                <label htmlFor={`${id}-sub`}>副标题</label>
                <input
                  id={`${id}-sub`}
                  className="nx-input"
                  value={subtitle ?? ""}
                  maxLength={TITLE_MAX_LENGTH}
                  onChange={(event) => onSubtitleChange(event.target.value)}
                />
              </div>
            ) : null}
            <div className="nx-ai-box">
              <div className="nx-row">
                <strong id={`${id}-mark`}>「AI 生成」标识</strong>
                <span className="nx-spacer" />
                <button
                  type="button"
                  className="nx-switch"
                  role="switch"
                  aria-checked={markOn}
                  aria-labelledby={`${id}-mark`}
                  onClick={toggleMark}
                />
              </div>
              <p className="nx-faint">
                打开时，封面右上角写「AI 生成」。很多平台要求标明，建议一直打开。
              </p>
              {markOn ? null : (
                <p className="nx-cover-warn" role="status">
                  关掉以后，封面上不写「AI 生成」。发布前请确认平台的要求。
                </p>
              )}
            </div>
          </div>
          {onSave ? (
            <div className="nx-cover-foot">
              <button
                type="button"
                className="nx-btn nx-primary"
                disabled={missingTitle}
                title={missingTitle ? "先写片名" : undefined}
                onClick={onSave}
              >
                用这个封面
              </button>
              {missingTitle ? <p className="nx-faint">先写片名。</p> : null}
            </div>
          ) : null}
        </aside>
      </div>
    </section>
  );
}

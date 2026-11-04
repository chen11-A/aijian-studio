import { useId, useState } from "react";
import "./next.css";
import "./HomeStart.css";

export type Aspect = "16:9" | "9:16";

export type HomeStartProps = {
  /** Signed in with a Grok membership. One-click needs it; a blank work does not. */
  connected: boolean;
  /** Saved works, newest first. `savedAt` is an ISO time or empty. */
  recent: readonly { id: string; title: string; savedAt: string }[];
  /** 「开始一键成片」 with the sentence the person wrote. */
  onOneClick: (idea: string, aspect: Aspect) => void;
  /** 「导入小说…」: a new work, then the file picker. */
  onImport: (aspect: Aspect) => void;
  /** 「新建作品」: a blank work. */
  onBlank: (aspect: Aspect) => void;
  onOpen: (id: string) => void;
  onSignIn: () => void;
  /** Only when the app really ships an example work; leave it out otherwise. */
  onSample?: () => void;
};

function savedLabel(savedAt: string): string {
  const time = new Date(savedAt);
  if (!savedAt || Number.isNaN(time.getTime())) return "";
  return time.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * The home page (3J-U13): two large ways in, 「一键成片」 and 「从空白开始」, one shared
 * aspect choice (横屏 by default, 4A-U07), then the saved works. The only primary button is
 * 「开始一键成片」; before sign-in it reads 「用 Grok 会员登录」 and signs in instead.
 */
export function HomeStart(props: HomeStartProps) {
  const [idea, setIdea] = useState("");
  const [aspect, setAspect] = useState<Aspect>("16:9");
  const ideaId = useId();
  const aspectName = useId();
  const start = () => {
    if (!props.connected) props.onSignIn();
    else if (idea.trim()) props.onOneClick(idea.trim(), aspect);
  };
  return (
    <div className="nx-root nx-home">
      <div className="nx-home-inner">
        <h2 className="nx-home-title">把故事做成短剧</h2>
        <div className="nx-home-ways">
          <section className="nx-home-way" aria-labelledby={`${ideaId}-h`}>
            <h3 id={`${ideaId}-h`}>一键成片</h3>
            <p className="nx-muted">
              写一句话的想法，或者导入小说。AI
              写剧本、定角色、拆镜头，停在分镜等你看，确认后才出视频。
            </p>
            <label className="nx-faint" htmlFor={ideaId}>
              一句话的想法
            </label>
            <textarea
              id={ideaId}
              className="nx-home-idea"
              rows={3}
              placeholder="比如：雨夜，旧书店的老板娘等来了讨债的人。"
              value={idea}
              onChange={(event) => setIdea(event.target.value)}
            />
            <div className="nx-home-acts">
              <button
                type="button"
                className="nx-btn nx-primary"
                disabled={props.connected && !idea.trim()}
                onClick={start}
              >
                {props.connected ? "开始一键成片" : "用 Grok 会员登录"}
              </button>
              <button type="button" className="nx-btn" onClick={() => props.onImport(aspect)}>
                导入小说…
              </button>
            </div>
            {!props.connected && (
              <p className="nx-faint">一键成片要用 Grok 会员。登录后回到这里接着写。</p>
            )}
          </section>
          <section className="nx-home-way" aria-labelledby={`${ideaId}-b`}>
            <h3 id={`${ideaId}-b`}>从空白开始</h3>
            <p className="nx-muted">自己写剧本、定角色、拆镜头，每一步都能改，AI 在右边帮忙。</p>
            <div className="nx-home-acts">
              <button type="button" className="nx-btn" onClick={() => props.onBlank(aspect)}>
                新建作品
              </button>
            </div>
          </section>
        </div>
        <fieldset className="nx-home-aspect">
          <legend className="nx-faint">画幅</legend>
          {(
            [
              ["16:9", "横屏 16:9"],
              ["9:16", "竖屏 9:16"],
            ] as const
          ).map(([value, label]) => (
            <label key={value}>
              <input
                type="radio"
                name={aspectName}
                value={value}
                checked={aspect === value}
                onChange={() => setAspect(value)}
              />
              {label}
            </label>
          ))}
          <span className="nx-faint">之后出图、视频和预览都按这个比例；导出时还能另出一版。</span>
        </fieldset>
        <section className="nx-home-recent" aria-label="最近的作品">
          <h3>最近的作品</h3>
          {props.recent.length === 0 ? (
            <p className="nx-faint">还没有保存的作品。</p>
          ) : (
            <ul>
              {props.recent.map((item) => (
                <li key={item.id}>
                  <button type="button" onClick={() => props.onOpen(item.id)}>
                    <span className="nx-home-recent-title" title={item.title}>
                      {item.title || "还没起名"}
                    </span>
                    <span className="nx-faint">{savedLabel(item.savedAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {props.onSample && (
            <p className="nx-faint">
              <button type="button" className="nx-link" onClick={props.onSample}>
                打开示例
              </button>
              ：内置的「雨夜巷战」，只有剧本和分镜，没有画面。
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

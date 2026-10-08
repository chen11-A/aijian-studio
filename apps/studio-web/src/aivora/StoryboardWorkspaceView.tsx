import { useRef, useState } from "react";
import { Button } from "./Common";
import { CreativeWorkspaceFrame } from "./CreativeWorkspaceFrame";
import { StoryboardReferences } from "./StoryboardReferences";
import { StoryboardTextPreview } from "./StoryboardTextPreview";
import { useEpisodeStoryboard } from "./useEpisodeStoryboard";
import {
  newStoryboardShot,
  reorderStoryboardShots,
  type StoryboardShot,
} from "./adapters/episodeStoryboard";
import "./episode-storyboard.css";

export function StoryboardWorkspaceView({
  projectId,
  episodeId,
  setNavigationGuard,
}: {
  projectId: string;
  episodeId: string;
  setNavigationGuard: (guard: (() => boolean) | null) => void;
}) {
  const state = useEpisodeStoryboard(projectId, episodeId, setNavigationGuard);
  const { content, version, locked, busy, dirty } = state;
  const selectionKey = `aivora.storyboard.selection.v1.${projectId}.${episodeId}`;
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    try {
      return window.sessionStorage.getItem(selectionKey);
    } catch {
      return null;
    }
  });
  const [preview, setPreview] = useState(false);
  const titleInput = useRef<HTMLInputElement>(null);
  const shot = content.shots.find((item) => item.shot_id === selectedId) ?? content.shots[0];
  const index = shot ? content.shots.indexOf(shot) : -1;
  const totalFrames = content.shots.reduce((sum, item) => sum + item.duration_frames, 0);
  function select(id: string | null) {
    setSelectedId(id);
    try {
      if (id) window.sessionStorage.setItem(selectionKey, id);
      else window.sessionStorage.removeItem(selectionKey);
    } catch {
      /* Selection is optional view metadata. */
    }
  }
  function add() {
    if (locked || content.shots.length >= 1000) return;
    const next = newStoryboardShot(content.shots.length + 1, content.fps);
    if (!next) {
      state.setNotice("无法生成可靠的镜头标识，请重新打开软件。");
      return;
    }
    state.edit((value) => ({ ...value, shots: [...value.shots, next] }));
    select(next.shot_id);
    setPreview(false);
    window.setTimeout(() => {
      titleInput.current?.focus();
      titleInput.current?.select();
    }, 0);
  }
  function updateShot(patch: Partial<StoryboardShot>) {
    if (!shot) return;
    state.edit((value) => ({
      ...value,
      shots: value.shots.map((item) =>
        item.shot_id === shot.shot_id ? { ...item, ...patch } : item,
      ),
    }));
  }
  function remove() {
    if (
      locked ||
      !shot ||
      !window.confirm(
        `从当前分镜删除“${shot.title || "未命名镜头"}”？保存会创建新版本，历史镜头仍保留。`,
      )
    )
      return;
    state.edit((value) => ({
      ...value,
      shots: value.shots
        .filter((item) => item.shot_id !== shot.shot_id)
        .map((item, ordinal) => ({ ...item, ordinal: ordinal + 1 })),
    }));
    select(content.shots[index + 1]?.shot_id ?? content.shots[index - 1]?.shot_id ?? null);
  }
  const stateLabel = busy
    ? "正在处理…"
    : dirty
      ? "有未保存修改"
      : version
        ? `分镜草稿 v${version.version_number} · 已保存`
        : "尚未保存版本";
  return (
    <CreativeWorkspaceFrame
      outlineTitle={`镜头 · ${content.shots.length}`}
      outlineAction={
        <Button disabled={locked || content.shots.length >= 1000} onClick={add}>
          添加镜头
        </Button>
      }
      outline={
        <div className="cw-shot-list">
          {content.shots.map((item) => (
            <button
              key={item.shot_id}
              aria-pressed={item.shot_id === shot?.shot_id}
              onClick={() => {
                select(item.shot_id);
                setPreview(false);
              }}
            >
              <span>{String(item.ordinal).padStart(2, "0")}</span>
              <div>
                <strong>{item.title || "未命名镜头"}</strong>
                <small>
                  {item.duration_frames} 帧 ·{" "}
                  {content.fps ? (item.duration_frames / content.fps).toFixed(2) : "—"} 秒
                </small>
              </div>
            </button>
          ))}
          {!content.shots.length && (
            <p>{state.readState === "loading" ? "正在读取分镜…" : "本集还没有镜头。"}</p>
          )}
        </div>
      }
      tools={
        <>
          <span>
            {preview
              ? "按镜头时长预演文字"
              : shot
                ? `镜头 ${String(shot.ordinal).padStart(2, "0")}`
                : "分集分镜"}
          </span>
          <Button aria-pressed={preview} onClick={() => setPreview(!preview)}>
            {preview ? "返回镜头编辑" : "文字预演"}
          </Button>
        </>
      }
      properties={
        <>
          <section className="cw-property-section">
            <h2>镜头属性</h2>
            {shot ? (
              <>
                <label>
                  镜头标题
                  <input
                    ref={titleInput}
                    maxLength={240}
                    value={shot.title}
                    disabled={locked}
                    onChange={(event) => updateShot({ title: event.target.value })}
                  />
                </label>
                <label>
                  镜头时长（帧）
                  <input
                    type="number"
                    min={1}
                    max={864000}
                    step={1}
                    value={shot.duration_frames || ""}
                    disabled={locked}
                    onChange={(event) =>
                      updateShot({ duration_frames: Number(event.target.value) })
                    }
                  />
                  <small>
                    {content.fps ? (shot.duration_frames / content.fps).toFixed(2) : "—"} 秒
                  </small>
                </label>
                <label>
                  景别与机位
                  <input
                    value={shot.camera}
                    maxLength={240}
                    disabled={locked}
                    placeholder="景别、视角、运动意图"
                    onChange={(event) => updateShot({ camera: event.target.value })}
                  />
                </label>
                <div className="cw-property-actions">
                  {([-1, 1] as const).map((offset) => (
                    <Button
                      key={offset}
                      disabled={
                        locked || index + offset < 0 || index + offset >= content.shots.length
                      }
                      onClick={() =>
                        state.edit((value) => ({
                          ...value,
                          shots: reorderStoryboardShots(value.shots, index, offset),
                        }))
                      }
                    >
                      {offset < 0 ? "上移" : "下移"}
                    </Button>
                  ))}
                  <Button disabled={locked} onClick={remove}>
                    删除镜头
                  </Button>
                </div>
              </>
            ) : (
              <p>选择镜头后可编辑属性。</p>
            )}
          </section>
          <section className="cw-property-section">
            <h3>时间基准</h3>
            <label>
              分镜帧率
              <input
                type="number"
                min={1}
                max={120}
                step={1}
                value={content.fps || ""}
                disabled={locked}
                onChange={(event) =>
                  state.edit((value) => ({ ...value, fps: Number(event.target.value) }))
                }
              />
            </label>
            <small>修改帧率保留整数帧数。</small>
          </section>
          {shot && (
            <details className="cw-property-section">
              <summary>剧本与设定引用</summary>
              <StoryboardReferences
                content={content}
                shot={shot}
                locked={locked}
                edit={state.edit}
                updateShot={updateShot}
              />
            </details>
          )}
          <details className="cw-property-section">
            <summary>版本与恢复</summary>
            <p>
              {version
                ? `已保存版本 ${version.version_id} · 回读核验通过`
                : "保存后可重开本集继续编辑。"}
            </p>
            {shot && <p>镜头身份：{shot.shot_id}</p>}
            <Button disabled={busy} onClick={() => void state.reload()}>
              重新读取
            </Button>
          </details>
        </>
      }
      notice={
        state.notice || state.journal.kind === "PENDING" ? (
          <>
            <p>{state.notice}</p>
            {state.journal.kind === "PENDING" && (
              <Button disabled={!state.canRecover} onClick={() => void state.save(true)}>
                核对原提交
              </Button>
            )}
          </>
        ) : null
      }
      status={
        <>
          <strong>{stateLabel}</strong>
          <span>
            {" "}
            · {content.shots.length} 镜 · {totalFrames} 帧
          </span>
        </>
      }
      actions={
        <Button
          primary
          disabled={locked || (!dirty && version !== null)}
          onClick={() => void state.save()}
        >
          {busy ? "正在处理…" : "保存分镜草稿"}
        </Button>
      }
    >
      {preview ? (
        <StoryboardTextPreview content={content} />
      ) : shot ? (
        <article className="cw-shot-document">
          <header>
            <small>SHOT {String(shot.ordinal).padStart(2, "0")} / 分镜计划</small>
            <h1>{shot.title || "未命名镜头"}</h1>
          </header>
          <fieldset disabled={locked}>
            <label>
              画面描述
              <textarea
                rows={5}
                maxLength={20000}
                value={shot.description}
                placeholder="写下构图、环境和这一镜的叙事重点…"
                onChange={(event) => updateShot({ description: event.target.value })}
              />
            </label>
            <label>
              动作
              <textarea
                rows={4}
                maxLength={20000}
                value={shot.action}
                placeholder="角色的动作与表演…"
                onChange={(event) => updateShot({ action: event.target.value })}
              />
            </label>
            <label>
              对白
              <textarea
                rows={3}
                maxLength={20000}
                value={shot.dialogue}
                placeholder="发言角色、对白或画外音…"
                onChange={(event) => updateShot({ dialogue: event.target.value })}
              />
            </label>
          </fieldset>
        </article>
      ) : (
        <div className="cw-document-empty">
          <h1>从第一镜开始</h1>
          <p>写下画面、机位、动作和对白。可以关联已保存的剧本与设定。</p>
          <Button primary disabled={locked} onClick={add}>
            创建第一个镜头
          </Button>
        </div>
      )}
    </CreativeWorkspaceFrame>
  );
}

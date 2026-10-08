import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ShotPlanGateway } from "@aijian/contracts/shot-plan";
import { ShotPlanProposalReview } from "./ShotPlanProposalReview";
import { readScriptJournal, readConfirmationJournal } from "./adapters/episodeScript";
import { readPendingProductionBriefCommand } from "./adapters/productionBriefWorkspace";
import "./storyboard-director-host.css";
import { Button, PageTitle } from "./Common";
import { useEpisodeStoryboard } from "./useEpisodeStoryboard";
import {
  newStoryboardShot,
  reorderStoryboardShots,
  type StoryboardShot,
} from "./adapters/episodeStoryboard";
import { StoryboardReferences } from "./StoryboardReferences";
import { StoryboardTextPreview } from "./StoryboardTextPreview";
import "./episode-storyboard.css";

export function EpisodeStoryboardPanel({
  projectId,
  episodeId,
  setNavigationGuard,
}: {
  projectId: string;
  episodeId: string;
  setNavigationGuard: (guard: (() => boolean) | null) => void;
}) {
  // Both views keep the same authoritative storyboard controller. Switching views
  // never discards edits; route/project/episode changes still use one combined guard.
  const storyboardGuard = useRef<(() => boolean) | null>(null);
  const captureStoryboardGuard = useCallback((guard: (() => boolean) | null) => {
    storyboardGuard.current = guard;
  }, []);
  const state = useEpisodeStoryboard(projectId, episodeId, captureStoryboardGuard);
  const [directorOpen, setDirectorOpen] = useState(false);
  const [directorVisited, setDirectorVisited] = useState(false);
  const [directorWork, setDirectorWork] = useState({ dirty: false, pending: false, busy: false });
  const directorWorkRef = useRef(directorWork);
  directorWorkRef.current = directorWork;
  const onDirectorWork = useCallback((work: typeof directorWork) => setDirectorWork(work), []);
  const directorGateway = useMemo(() => {
    const bridge = (window as Window & { aijianShotPlan?: ShotPlanGateway }).aijianShotPlan;
    const methods: (keyof ShotPlanGateway)[] = [
      "prepareHumanShotPlan",
      "getShotPlanProposal",
      "getShotPlanProposalVersion",
      "getHumanShotPlanWriteStatus",
      "getShotPlanAdoptionStatus",
      "createHumanShotPlanProposal",
      "adoptHumanShotPlanProposal",
    ];
    return bridge && methods.every((method) => typeof bridge[method] === "function")
      ? bridge
      : null;
  }, []);
  const [, refreshRecoveryState] = useState(0);
  useEffect(() => {
    const refresh = () => refreshRecoveryState((value) => value + 1);
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  let upstreamPending = true;
  try {
    const brief = readPendingProductionBriefCommand(projectId);
    upstreamPending =
      readScriptJournal(window.localStorage, projectId, episodeId).kind !== "EMPTY" ||
      readConfirmationJournal(window.localStorage, projectId, episodeId).kind !== "EMPTY" ||
      brief.kind !== "READY" ||
      brief.command !== null;
  } catch {
    /* Unreadable recovery state must block new adoption. */
  }
  useEffect(() => {
    setNavigationGuard(() => {
      const work = directorWorkRef.current;
      if (work.busy) return false;
      if (
        work.dirty &&
        !window.confirm(
          work.pending
            ? "人工导演提案有保存结果待核对，原提交恢复记录会保留。离开此页吗？"
            : "人工导演提案有未保存修改。放弃修改并离开吗？",
        )
      )
        return false;
      return storyboardGuard.current?.() ?? true;
    });
    const beforeUnload = (event: BeforeUnloadEvent) => {
      const work = directorWorkRef.current;
      if (!work.dirty && !work.busy) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      setNavigationGuard(null);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [setNavigationGuard]);
  const showDirector = () => {
    if (state.busy || directorWork.busy) return;
    setDirectorVisited(true);
    setDirectorOpen((current) => !current);
  };
  const { content, version, dirty, busy } = state;
  const locked = state.locked || directorWork.busy || directorWork.pending;
  const selectionKey = `aivora.storyboard.selection.v1.${projectId}.${episodeId}`;
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    try {
      return window.sessionStorage.getItem(selectionKey);
    } catch {
      return null;
    }
  });
  function select(id: string | null) {
    setSelectedId(id);
    try {
      if (id) window.sessionStorage.setItem(selectionKey, id);
      else window.sessionStorage.removeItem(selectionKey);
    } catch {
      /* Optional view metadata only. */
    }
  }
  const titleInput = useRef<HTMLInputElement>(null);
  const shot = content.shots.find((item) => item.shot_id === selectedId) ?? content.shots[0];
  const index = shot ? content.shots.indexOf(shot) : -1;
  const totalFrames = content.shots.reduce((sum, item) => sum + item.duration_frames, 0);
  function add() {
    if (locked || content.shots.length >= 1000) return;
    const next = newStoryboardShot(content.shots.length + 1, content.fps);
    if (!next) {
      state.setNotice("无法生成可靠的镜头标识，请重新打开软件。");
      return;
    }
    state.edit((value) => ({ ...value, shots: [...value.shots, next] }));
    select(next.shot_id);
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
        .map((item, i) => ({ ...item, ordinal: i + 1 })),
    }));
    select(content.shots[index + 1]?.shot_id ?? content.shots[index - 1]?.shot_id ?? null);
  }
  const stateLabel = busy
    ? "正在处理…"
    : dirty
      ? "有未保存修改"
      : version
        ? `分镜草稿 v${version.version_number}`
        : "尚未保存版本";
  return (
    <>
      <PageTitle
        actions={
          <>
            <Button
              aria-pressed={directorOpen}
              disabled={busy || directorWork.busy}
              onClick={showDirector}
            >
              {directorOpen ? "返回手写分镜" : "导演提案"}
            </Button>
            <Button
              disabled={busy || directorWork.busy || directorOpen}
              onClick={() => void state.reload()}
            >
              重新读取
            </Button>
            <Button
              primary
              icon="plus"
              disabled={locked || directorOpen || content.shots.length >= 1000}
              onClick={add}
            >
              添加镜头
            </Button>
          </>
        }
      />
      {directorVisited && (
        <div className="storyboard-director-host" hidden={!directorOpen}>
          <ShotPlanProposalReview
            projectId={projectId}
            episodeId={episodeId}
            gateway={directorGateway}
            // The route guard has already dealt with the unmounted script editor's
            // dirty draft. Its durable write/confirmation journals are checked above.
            scriptDirty={false}
            storyboardDirty={dirty}
            pendingOperations={
              upstreamPending ||
              state.journal.kind !== "EMPTY" ||
              state.busy ||
              state.readState === "loading" ||
              state.readState === "error"
            }
            onWorkStateChange={onDirectorWork}
            onAdopted={async () => {
              await state.reload();
              select(null);
            }}
            initiallyOpen
            workspace
          />
        </div>
      )}
      <section
        className="episode-storyboard storyboard-manual-host"
        hidden={directorOpen}
        aria-label="分集手写分镜"
      >
        <div className="storyboard-status">
          <span>
            {stateLabel} · {content.shots.length} 个镜头 · {totalFrames} 帧
          </span>
          <span>本集独立保存 · 手工分镜草稿</span>
        </div>
        {state.notice && (
          <div className="storyboard-notice" role="status">
            {state.notice}
          </div>
        )}
        {state.journal.kind === "PENDING" && (
          <div className="storyboard-recovery">
            <span>有一笔保存结果待核对。核对完成前暂不接受新修改。</span>
            <Button disabled={!state.canRecover} onClick={() => void state.save(true)}>
              核对原提交
            </Button>
          </div>
        )}
        <div className="storyboard-layout">
          <aside className="storyboard-shot-list">
            <header>
              <h2>镜头列表</h2>
              <span>{content.shots.length} / 1000</span>
            </header>
            {content.shots.length ? (
              <ol>
                {content.shots.map((item) => (
                  <li key={item.shot_id}>
                    <button
                      type="button"
                      aria-pressed={item.shot_id === shot?.shot_id}
                      onClick={() => select(item.shot_id)}
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
                  </li>
                ))}
              </ol>
            ) : (
              <div className="storyboard-empty-list">
                <p>
                  {state.readState === "loading"
                    ? "正在读取分镜…"
                    : state.readState === "error"
                      ? "读取尚未完成，请重新读取。"
                      : "本集还没有镜头。"}
                </p>
              </div>
            )}
          </aside>
          <div className="storyboard-detail-scroll">
            <div className="storyboard-timebase">
              <label>
                分镜帧率
                <input
                  type="number"
                  min={1}
                  max={120}
                  step={1}
                  value={content.fps || ""}
                  disabled={locked}
                  onChange={(event) => {
                    const fps = Number(event.currentTarget.value);
                    state.edit((value) => ({ ...value, fps }));
                  }}
                />
              </label>
              <p>时长以整数帧保存。修改帧率保留帧数，文字预演时长随之变化。</p>
            </div>
            {!shot ? (
              <div className="storyboard-empty-detail">
                <h2>从第一镜开始</h2>
                <p>
                  写下画面、机位、动作和对白。不需要 AI
                  服务或图片素材，也可以关联已保存的剧本和共享设定。
                </p>
                <Button primary disabled={locked} onClick={add}>
                  创建第一个镜头
                </Button>
              </div>
            ) : (
              <>
                <header className="storyboard-editor-heading">
                  <h2>镜头 {shot.ordinal}</h2>
                  <div>
                    <Button
                      disabled={locked || index <= 0}
                      onClick={() =>
                        state.edit((value) => ({
                          ...value,
                          shots: reorderStoryboardShots(value.shots, index, -1),
                        }))
                      }
                    >
                      上移
                    </Button>
                    <Button
                      disabled={locked || index >= content.shots.length - 1}
                      onClick={() =>
                        state.edit((value) => ({
                          ...value,
                          shots: reorderStoryboardShots(value.shots, index, 1),
                        }))
                      }
                    >
                      下移
                    </Button>
                    <Button disabled={locked} onClick={remove}>
                      删除镜头
                    </Button>
                  </div>
                </header>
                <fieldset className="storyboard-fields" disabled={locked}>
                  <div className="storyboard-field-row">
                    <label>
                      镜头标题
                      <input
                        ref={titleInput}
                        maxLength={240}
                        value={shot.title}
                        onChange={(event) => updateShot({ title: event.target.value })}
                      />
                    </label>
                    <label>
                      镜头时长（帧）
                      <input
                        type="number"
                        min={1}
                        aria-label="镜头时长（帧）"
                        max={864000}
                        step={1}
                        value={shot.duration_frames || ""}
                        onChange={(event) =>
                          updateShot({ duration_frames: Number(event.target.value) })
                        }
                      />
                      <small>
                        {content.fps ? (shot.duration_frames / content.fps).toFixed(2) : "—"} 秒
                      </small>
                    </label>
                  </div>
                  <label>
                    画面描述
                    <textarea
                      rows={3}
                      maxLength={20000}
                      value={shot.description}
                      placeholder="画面构图与叙事重点"
                      onChange={(event) => updateShot({ description: event.target.value })}
                    />
                  </label>
                  <label>
                    景别与机位
                    <input
                      maxLength={240}
                      value={shot.camera}
                      placeholder="景别、视角、镜头运动意图"
                      onChange={(event) => updateShot({ camera: event.target.value })}
                    />
                  </label>
                  <label>
                    动作
                    <textarea
                      rows={3}
                      maxLength={20000}
                      value={shot.action}
                      placeholder="角色在这一镜中做什么"
                      onChange={(event) => updateShot({ action: event.target.value })}
                    />
                  </label>
                  <label>
                    对白
                    <textarea
                      rows={3}
                      maxLength={20000}
                      value={shot.dialogue}
                      placeholder="发言角色、对白或画外音文字"
                      onChange={(event) => updateShot({ dialogue: event.target.value })}
                    />
                  </label>
                </fieldset>
                <StoryboardReferences
                  content={content}
                  shot={shot}
                  locked={locked}
                  edit={state.edit}
                  updateShot={updateShot}
                />
                <small className="storyboard-stable-id">镜头身份 {shot.shot_id}</small>
              </>
            )}
            <StoryboardTextPreview content={content} />
          </div>
        </div>
        <footer className="storyboard-save-footer">
          <div>
            <strong>{stateLabel}</strong>
            <span>
              {version
                ? `已保存版本 ${version.version_id.slice(-8)} · 回读校验通过`
                : "保存后可关闭、重开并继续编辑本集"}
            </span>
          </div>
          <Button
            primary
            disabled={locked || (!dirty && version !== null)}
            onClick={() => void state.save()}
          >
            {busy ? "正在处理…" : "保存分镜草稿"}
          </Button>
        </footer>
      </section>
    </>
  );
}

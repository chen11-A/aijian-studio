import type { MediaInputLeave } from "./MediaInputLeave";
import { impactEnvelope } from "@aijian/contracts/script-confirmation-impact";
import { useEffect, useRef, useState } from "react";
import {
  mediaInput,
  mediaPage,
  verifiedMediaVersion,
  type MediaPreparationCommand,
  type MediaPreparationGateway,
  type MediaPreparationInput,
  type MediaPreparationPage,
  type MediaPreparationVersion,
} from "@aijian/contracts/media-preparation";
import {
  type StoryboardGateway,
  type StoryboardVersion,
  readStoryboard,
} from "./adapters/episodeStoryboard";
import {
  preservePreparationJournal,
  readPreparationJournal,
  recoverPreparation,
  savePreparation,
  type PreparationJournal,
} from "./adapters/mediaPreparation";
import { Button } from "./Common";

type Gateway = Partial<MediaPreparationGateway & StoryboardGateway>;
// Session anchor survives page/episode remounts; SQLite remains the content truth.
const SESSION_INTENTS = new Map<string, MediaPreparationCommand>();
// Navigation markers only. Reopening always reads and verifies the exact SQLite version.
export const MEDIA_PREPARATION_SELECTIONS = new Map<string, { versionId: string; hash: string }>();
type Props = {
  sessionIntents?: Map<string, MediaPreparationCommand>;
  registerLeaveCheck?: (check: MediaInputLeave | null) => void;
  onSelected?: (version: MediaPreparationVersion | null) => void;
  projectId: string;
  episodeId: string;
  gateway: Gateway;
  setNavigationGuard?: (g: (() => boolean) | null) => void;
  go?: (page: "storyboard" | "assets" | "assembly" | "services") => void;
};

/** Production preparation inputs. Saving has no remote execution authority. */
export function MediaPreparationPanel({
  sessionIntents,
  registerLeaveCheck,
  onSelected,
  projectId: p,
  episodeId: e,
  gateway: api,
  setNavigationGuard,
  go,
}: Props) {
  const scope = `${p}/${e}`,
    epoch = useRef(0),
    activeScope = useRef(scope),
    inFlight = useRef(false);
  activeScope.current = scope;
  const owned = useRef(sessionIntents ?? SESSION_INTENTS);
  const [board, setBoard] = useState<StoryboardVersion | null>(null),
    [page, setPage] = useState<MediaPreparationPage | null>(null);
  const [input, setInput] = useState<MediaPreparationInput | null>(null),
    [detail, setDetail] = useState<MediaPreparationVersion | null>(null);
  const [journal, setJournal] = useState<PreparationJournal>({ kind: "EMPTY" }),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  let storage: Storage | null = null;
  try {
    storage = typeof window === "undefined" ? null : window.localStorage;
  } catch {
    /* Keep unavailable storage blocked. */
  }
  const ready =
    api.listMediaPreparations &&
    api.getMediaPreparation &&
    api.saveMediaPreparation &&
    api.getMediaPreparationOperation &&
    api.getEpisodeStoryboard &&
    api.getEpisodeStoryboardVersion;
  const leave = useRef({ dirty, busy, journal, scope, storage });
  leave.current = { dirty, busy, journal, scope, storage };
  useEffect(() => {
    const preserve = () => {
      const state = leave.current,
        c = owned.current.get(state.scope);
      if (
        state.busy ||
        inFlight.current ||
        state.journal.kind === "BLOCKED" ||
        (c && (!state.storage || !preservePreparationJournal(state.storage, c)))
      ) {
        setNotice("请先准确核对本次制作请求；原输入日志必须完整保留。");
        return false;
      }
      return true;
    };
    registerLeaveCheck?.({ preserve, dirty: () => leave.current.dirty });
    const guard = () =>
      preserve() &&
      (!leave.current.dirty || window.confirm("制作请求有未保存输入。放弃输入并离开吗？"));
    setNavigationGuard?.(guard);
    const warn = (event: BeforeUnloadEvent) => {
      const s = leave.current,
        c = owned.current.get(s.scope);
      if (
        s.dirty ||
        s.busy ||
        s.journal.kind === "BLOCKED" ||
        (c && (!s.storage || !preservePreparationJournal(s.storage, c)))
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      setNavigationGuard?.(null);
      registerLeaveCheck?.(null);
      window.removeEventListener("beforeunload", warn);
    };
  }, [setNavigationGuard, registerLeaveCheck]);
  useEffect(() => {
    onSelected?.(
      detail?.content.input.project_id === p && detail.content.input.episode_id === e
        ? detail
        : null,
    );
  }, [detail, onSelected, p, e]);
  function selectDetail(next: MediaPreparationVersion) {
    MEDIA_PREPARATION_SELECTIONS.set(scope, {
      versionId: next.version_id,
      hash: next.content_hash,
    });
    setDetail(next);
  }
  function refreshJournal() {
    const original = owned.current.get(scope);
    if (!storage || (original && !preservePreparationJournal(storage, original))) {
      setJournal({ kind: "BLOCKED" });
      return;
    }
    setJournal(readPreparationJournal(storage, p, e));
  }
  function initial(b: StoryboardVersion): MediaPreparationInput | null {
    const shot = b.content.shots[0];
    if (!shot) return null;
    return {
      schema_version: "1.0.0",
      project_id: p,
      episode_id: e,
      capability_intent: "IMAGE",
      storyboard_version_id: b.version_id,
      storyboard_content_hash: b.content_hash,
      shot_id: shot.shot_id,
      prompt: "",
      negative_prompt: "",
      width: 1920,
      height: 1080,
      requested_frames: 1,
    };
  }
  async function load(cursor?: string) {
    if (!ready || !storage) return;
    const token = ++epoch.current,
      requestedScope = scope;
    setBusy(true);
    inFlight.current = true;
    try {
      const [history, source] = await Promise.all([
        api.listMediaPreparations!(p, e, cursor),
        cursor ? Promise.resolve(null) : readStoryboard(api as StoryboardGateway, p, e),
      ]);
      const valid =
        history.kind === "FOUND" &&
        impactEnvelope(history.receipt, history.receipt.request_id) &&
        (await mediaPage(history.receipt.data, p, e));
      if (token !== epoch.current || requestedScope !== activeScope.current) return;
      if (!valid) {
        setNotice("制作请求历史无法完整核对，请保留输入。");
        return;
      }
      const next = history.kind === "FOUND" ? history.receipt.data : null;
      if (!next) return;
      if (
        cursor &&
        next.items.some((i) => page?.items.some((old) => old.version_id === i.version_id))
      ) {
        setNotice("历史分页重复，停止读取。");
        return;
      }
      setPage((old) => (cursor && old ? { ...next, items: [...old.items, ...next.items] } : next));
      if (source?.kind === "FOUND") {
        setBoard(source.version);
        setInput((old) => old ?? initial(source.version));
      } else if (!cursor) setNotice("请先保存本分集的真实分镜；旧请求历史仍可读取。");
      const selected = !cursor && MEDIA_PREPARATION_SELECTIONS.get(requestedScope);
      if (selected) {
        // The selected older version may be beyond the first history page.
        const exact = await api.getMediaPreparation!(p, e, selected.versionId);
        const verified =
          exact.kind === "FOUND" &&
          impactEnvelope(exact.receipt, exact.receipt.request_id) &&
          (await verifiedMediaVersion(exact.receipt.data, p, e));
        if (token !== epoch.current || requestedScope !== activeScope.current) return;
        if (
          verified &&
          exact.kind === "FOUND" &&
          exact.receipt.data.version_id === selected.versionId &&
          exact.receipt.data.content_hash === selected.hash
        )
          selectDetail(exact.receipt.data);
        else {
          setDetail(null);
          setNotice("原选制作请求版本或哈希无法核对；未替换为最新请求，请重新准确核对。");
        }
      }
    } catch {
      if (token === epoch.current) setNotice("读取结果未知，请保留输入。");
    } finally {
      if (token === epoch.current) {
        setBusy(false);
        inFlight.current = false;
        refreshJournal();
      }
    }
  }
  useEffect(() => {
    ++epoch.current;
    inFlight.current = false;
    setBusy(false);
    setBoard(null);
    setPage(null);
    setInput(null);
    setDetail(null);
    setDirty(false);
    setNotice("");
    const original = owned.current.get(scope);
    let j: PreparationJournal = storage
      ? readPreparationJournal(storage, p, e)
      : { kind: "BLOCKED" };
    if (original) {
      if (storage && preservePreparationJournal(storage, original))
        j = readPreparationJournal(storage, p, e);
      else j = { kind: "BLOCKED" };
      setInput(original.payload.input);
    } else if (j.kind === "PENDING") {
      owned.current.set(scope, j.command);
      setInput(j.command.payload.input);
    }
    setJournal(j);
    void load();
    return () => {
      ++epoch.current;
      inFlight.current = false;
    };
    // Exact scope plus transport defines a new generation, including A → B → A.
  }, [scope, api]);
  const patch = (value: Partial<MediaPreparationInput>) => {
    if (input) {
      setInput({ ...input, ...value });
      setDirty(true);
    }
  };
  async function inspect(id: string) {
    if (!api.getMediaPreparation) return;
    const token = ++epoch.current;
    setBusy(true);
    inFlight.current = true;
    try {
      const r = await api.getMediaPreparation(p, e, id);
      const valid =
        r.kind === "FOUND" &&
        impactEnvelope(r.receipt, r.receipt.request_id) &&
        (await verifiedMediaVersion(r.receipt.data, p, e));
      if (token !== epoch.current || scope !== activeScope.current) return;
      if (
        valid &&
        r.kind === "FOUND" &&
        r.receipt.data.version_id === id &&
        page?.items.some(
          (v) => v.version_id === id && v.content_hash === r.receipt.data.content_hash,
        )
      )
        selectDetail(r.receipt.data);
      else setNotice("精确请求回执或哈希无法核对。");
    } catch {
      if (token === epoch.current) setNotice("精确请求读取未知。");
    } finally {
      if (token === epoch.current) {
        setBusy(false);
        inFlight.current = false;
      }
    }
  }
  async function mutate(recovery: boolean) {
    if (!ready || !storage || inFlight.current) return;
    let command = owned.current.get(scope);
    if (!recovery) {
      if (journal.kind !== "EMPTY" || !input || !mediaInput(input, p, e) || !page) return;
      command = {
        operation_id: crypto.randomUUID(),
        payload: {
          input,
          parent_version_id: page.head_version_id,
          expected_revision: page.head_revision,
        },
      };
      owned.current.set(scope, command);
    } else if (!command && journal.kind === "PENDING") command = journal.command;
    if (!command) {
      setNotice("缺少完整原输入，不能推断未提交或重新发送。");
      return;
    }
    const token = ++epoch.current;
    setBusy(true);
    inFlight.current = true;
    const result = await (recovery ? recoverPreparation : savePreparation)(
      api as MediaPreparationGateway,
      storage,
      command,
      () => token === epoch.current && scope === activeScope.current,
    );
    if (token !== epoch.current || scope !== activeScope.current) return;
    refreshJournal();
    setBusy(false);
    inFlight.current = false;
    if (result.kind === "SAVED") {
      owned.current.delete(scope);
      setDirty(false);
      selectDetail(result.version);
      setNotice("完整制作请求已保存；尚未批准或派发生成。");
      void load();
    } else if (result.kind === "REJECTED") {
      owned.current.delete(scope);
      setNotice(`本次输入明确未保存：${result.code}。请重新读取历史并检查输入。`);
    } else setNotice("写入结果未知；保留原输入，只读核对原操作，不会重发。");
  }
  if (!ready)
    return (
      <section aria-label="媒体请求准备">
        <p>当前桌面版本缺少媒体请求准备接口。请使用桌面候选版本。</p>
      </section>
    );
  const blocked = busy || journal.kind !== "EMPTY" || owned.current.has(scope);
  return (
    <section className="v2-media-body media-preparation-scroll" aria-label="媒体请求准备">
      <div className="v2-visual-card" style={{ padding: 24 }}>
        <h2>镜头制作请求</h2>
        <p>完整保存画面输入。真实生成仍需验证服务、逐次内容授权和费用批准。</p>
        <p>
          作品 {p} · 分集 {e}
        </p>
        {input && (
          <fieldset disabled={blocked}>
            <legend>新请求输入</legend>
            <label>
              已保存镜头
              <select
                aria-label="已保存镜头"
                value={input.shot_id}
                onChange={(ev) => {
                  if (board)
                    patch({
                      shot_id: ev.target.value,
                      storyboard_version_id: board.version_id,
                      storyboard_content_hash: board.content_hash,
                    });
                }}
              >
                {board?.content.shots.map((s) => (
                  <option key={s.shot_id} value={s.shot_id}>
                    {s.ordinal}. {s.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              画面意图
              <select
                aria-label="画面意图"
                value={input.capability_intent}
                onChange={(ev) =>
                  patch({
                    capability_intent: ev.target.value as "IMAGE" | "VIDEO",
                    requested_frames:
                      ev.target.value === "IMAGE"
                        ? 1
                        : (board?.content.shots.find((s) => s.shot_id === input.shot_id)
                            ?.duration_frames ?? 24),
                  })
                }
              >
                <option value="IMAGE">图片</option>
                <option value="VIDEO">视频</option>
              </select>
            </label>
            <label>
              完整提示词
              <textarea
                aria-label="完整提示词"
                maxLength={20_000}
                value={input.prompt}
                onChange={(ev) => patch({ prompt: ev.target.value })}
              />
            </label>
            <label>
              负面提示词
              <textarea
                aria-label="负面提示词"
                maxLength={20_000}
                value={input.negative_prompt}
                onChange={(ev) => patch({ negative_prompt: ev.target.value })}
              />
            </label>
            <label>
              期望宽度
              <input
                aria-label="期望宽度"
                type="number"
                min={16}
                max={8192}
                value={input.width}
                onChange={(ev) => patch({ width: Number(ev.target.value) })}
              />
            </label>
            <label>
              期望高度
              <input
                aria-label="期望高度"
                type="number"
                min={16}
                max={8192}
                value={input.height}
                onChange={(ev) => patch({ height: Number(ev.target.value) })}
              />
            </label>
            <label>
              期望帧数
              <input
                aria-label="期望帧数"
                type="number"
                min={1}
                max={864_000}
                disabled={input.capability_intent === "IMAGE"}
                value={input.requested_frames}
                onChange={(ev) => patch({ requested_frames: Number(ev.target.value) })}
              />
            </label>
            <p>
              分镜 {input.storyboard_version_id} · {input.storyboard_content_hash}
            </p>
          </fieldset>
        )}
        <div className="actions">
          <Button
            primary
            disabled={blocked || !input || !mediaInput(input, p, e) || !page}
            onClick={() => void mutate(false)}
          >
            另存制作请求
          </Button>
          <Button disabled={busy || journal.kind !== "EMPTY"} onClick={() => void load()}>
            重新读取保存历史
          </Button>
          <Button
            disabled={busy || (journal.kind !== "PENDING" && !owned.current.has(scope))}
            onClick={() => void mutate(true)}
          >
            只读核对原操作
          </Button>
        </div>
        {journal.kind === "BLOCKED" && (
          <p role="alert">原输入日志无法核对；请保留日志，不能重新发送。</p>
        )}
        {notice && <p role="status">{notice}</p>}
        <h3>本分集请求历史</h3>
        {page?.items.map((v) => (
          <div key={v.version_id}>
            <span>
              {v.version_number} · {v.content.snapshot.shot.title} ·{" "}
              {v.content.input.capability_intent} · {v.created_at}
            </span>
            <Button disabled={busy} onClick={() => void inspect(v.version_id)}>
              核对请求 {v.version_number}
            </Button>
          </div>
        ))}
        {page?.next_cursor && (
          <Button disabled={busy} onClick={() => void load(page.next_cursor!)}>
            读取更多请求
          </Button>
        )}
        {detail && (
          <article aria-label="精确请求详情">
            <h3>已保存输入 {detail.version_id}</h3>
            <p>{detail.content_hash}</p>
            <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(detail.content, null, 2)}</pre>
            <Button
              disabled={
                blocked ||
                dirty ||
                !board ||
                !board.content.shots.some((s) => s.shot_id === detail.content.input.shot_id)
              }
              onClick={() => {
                if (board) {
                  setInput({
                    ...detail.content.input,
                    storyboard_version_id: board.version_id,
                    storyboard_content_hash: board.content_hash,
                  });
                  setDirty(true);
                }
              }}
            >
              用当前已保存分镜另编输入
            </Button>
          </article>
        )}
        <div className="actions">
          <Button onClick={() => go?.("storyboard")}>分镜编排</Button>
          <Button onClick={() => go?.("assets")}>导入和管理素材</Button>
          <Button onClick={() => go?.("assembly")}>成片组装</Button>
          <Button onClick={() => go?.("services")}>AI 服务配置</Button>
        </div>
      </div>
    </section>
  );
}

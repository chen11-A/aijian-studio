import { useState } from "react";
import "./next.css";
import "./TaskCenter.css";
import { shotLabel } from "./shot";

export type TaskKind = "video" | "image" | "voice";

/** blocked: never sent, for example because nobody was signed in. It needs the user, like failed. */
export type TaskStatus =
  "queued" | "running" | "uncertain" | "requeued" | "blocked" | "failed" | "done";

export type TaskItem = {
  /** Job id, shown as small text, for example scene-2-shot-22-take-1. */
  id: string;
  /** The shot the job belongs to. Without a title it is shown as 「第 2 场第 22 个镜头」. */
  shotId?: string;
  /** What the job is called, for example 「第 2 场第 22 个镜头」 or a costume portrait. */
  title?: string;
  /** Version name, for example 「A 版」. */
  version?: string;
  kind: TaskKind;
  status: TaskStatus;
  /** Which attempt this is, counting from 1. */
  attempt: number;
  /** What happened, in plain words, for example why Grok refused it. */
  reason?: string;
  /** A rewrite worth trying after a failure. */
  suggestion?: string;
  /** Seconds since the request was sent, for a running job. */
  waitedSeconds?: number;
};

export type TaskRecovery = {
  /**
   * needs-check: the app closed while jobs were running and nobody knows how they ended.
   * checking: those jobs are being looked up. checked: the lookup finished.
   */
  phase: "needs-check" | "checking" | "checked";
  /** After the lookup: jobs found finished, and jobs Grok has no record of. */
  found?: number;
  lost?: number;
};

export type TaskCenterProps = {
  title: string;
  tasks: readonly TaskItem[];
  recovery?: TaskRecovery | null;
  /** Shows the queue as paused and offers 「接着做 N 段」. A recovery counts as paused too. */
  paused?: boolean;
  loading?: boolean;
  /** The task record could not be read. Finished files are not affected. */
  error?: string | null;
  /** 「查一下，再接着做」: look up the uncertain jobs without sending them again. */
  onCheck?: () => void;
  /** 「接着做 N 段」: send the queue, including the jobs that were never sent. */
  onResume?: () => void;
  onPause?: () => void;
  onRetry?: (taskId: string, wording: "same" | "suggestion") => void;
  onRetryFailed?: () => void;
  onRemove?: (taskId: string) => void;
  onReload?: () => void;
  onOpenStoryboard?: () => void;
};

type StatusFilter = "all" | "attention" | "running" | "queued" | "done";
type KindFilter = "all" | TaskKind;

const KIND_LABEL: Record<TaskKind, string> = { video: "视频", image: "图片", voice: "配音" };
const KIND_UNIT: Record<TaskKind, string> = { video: "段", image: "张", voice: "句" };
const KIND_MARK: Record<TaskKind, string> = { video: "视", image: "图", voice: "音" };

const STATUS_TAG: Record<TaskStatus, { text: string; tone: string }> = {
  queued: { text: "排队", tone: "" },
  running: { text: "正在生成", tone: "nx-info" },
  uncertain: { text: "不确定", tone: "nx-warn" },
  requeued: { text: "重新排队", tone: "" },
  blocked: { text: "没发出去", tone: "nx-warn" },
  failed: { text: "失败", tone: "nx-err" },
  done: { text: "做好了", tone: "nx-ok" },
};

const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "attention", label: "要你处理" },
  { id: "running", label: "正在生成" },
  { id: "queued", label: "排队" },
  { id: "done", label: "做好了" },
];

const KIND_FILTERS: { id: KindFilter; label: string }[] = [
  { id: "all", label: "全部种类" },
  { id: "video", label: "视频" },
  { id: "image", label: "图片" },
  { id: "voice", label: "配音" },
];

const isAttention = (task: TaskItem) =>
  task.status === "uncertain" || task.status === "blocked" || task.status === "failed";
const isPending = (task: TaskItem) => task.status === "queued" || task.status === "requeued";

function matchesStatus(task: TaskItem, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "attention") return isAttention(task);
  if (filter === "queued") return isPending(task);
  return task.status === filter;
}

/** The unit for a set of jobs: 段 for videos, 张 for pictures, 句 for voice, 个 when mixed. */
export function unitFor(tasks: readonly TaskItem[]): string {
  const kinds = new Set(tasks.map((task) => task.kind));
  const [only] = [...kinds];
  return kinds.size === 1 && only ? KIND_UNIT[only] : "个";
}

export function taskLabel(task: TaskItem): string {
  const name = task.title ?? (task.shotId ? shotLabel(task.shotId) : task.id);
  return task.version ? `${name} · ${task.version}` : name;
}

function rowNote(task: TaskItem): string {
  const attempt = `第 ${task.attempt} 次`;
  switch (task.status) {
    case "uncertain":
      return `${task.reason ?? "软件关闭时正在生成，不知道 Grok 有没有做完"} · ${attempt}`;
    case "running":
      return task.waitedSeconds === undefined
        ? `已经发给 Grok · ${attempt}`
        : `已经等了 ${task.waitedSeconds} 秒 · ${attempt}`;
    case "requeued":
      return task.reason ?? "Grok 那边没有这次的记录，接着做时会重新生成";
    case "queued":
      return task.reason ?? "还没发给 Grok";
    case "blocked":
      return task.reason ?? "没有发给 Grok";
    case "failed":
      return `${task.reason ?? "没有做成"} · ${attempt}`;
    default:
      return task.reason ?? "已经存进作品";
  }
}

type Primary = { label: string; onClick?: () => void; disabled?: boolean };

/** The one blue button on this screen, or none. */
export function primaryAction(
  props: Pick<
    TaskCenterProps,
    "tasks" | "recovery" | "paused" | "error" | "onCheck" | "onResume" | "onReload" | "loading"
  >,
): Primary | null {
  if (props.loading) return null;
  if (props.error) return { label: "重新读取", onClick: props.onReload };
  const pending = props.tasks.filter(isPending);
  const phase = props.recovery?.phase;
  if (phase === "needs-check") return { label: "查一下，再接着做", onClick: props.onCheck };
  if (phase === "checking") return { label: "正在查…", disabled: true };
  if ((phase === "checked" || props.paused) && pending.length > 0) {
    return { label: `接着做 ${pending.length} ${unitFor(pending)}`, onClick: props.onResume };
  }
  return null;
}

function PrimaryButton({ action }: { action: Primary }) {
  return (
    <button
      type="button"
      className="nx-btn nx-primary"
      disabled={action.disabled || !action.onClick}
      onClick={action.onClick}
    >
      {action.label}
    </button>
  );
}

function RecoveryBanner({
  recovery,
  tasks,
  action,
}: {
  recovery: TaskRecovery;
  tasks: readonly TaskItem[];
  action: Primary | null;
}) {
  const doneVideos = tasks.filter((task) => task.kind === "video" && task.status === "done");
  const uncertain = tasks.filter((task) => task.status === "uncertain").length;
  const pending = tasks.filter(isPending);
  const failed = tasks.filter((task) => task.status === "failed").length;
  let tone = "nx-warn";
  let head: string;
  let body: string;
  if (recovery.phase === "checked") {
    tone = "nx-ok";
    const found = recovery.found ?? 0;
    const lost = recovery.lost ?? 0;
    head = `查完了：找回 ${found} 段，${lost} 段没发出去。`;
    body = [
      lost > 0 ? `没发出去的会重新排进队里，用 ${lost} 段视频额度。` : "",
      failed > 0 ? `另外 ${failed} 段失败的在下面，等你处理。` : "",
    ]
      .filter(Boolean)
      .join("");
  } else if (recovery.phase === "checking") {
    head = `正在查关闭时没做完的 ${uncertain} 段…`;
    body = "只查不重发，不会重复用额度。";
  } else {
    head = `软件上次没有正常关闭。做好的 ${doneVideos.length} 段视频都在，没有丢。`;
    body = `关闭时有 ${uncertain} 段正在生成，不知道有没有做完。先查一下再接着做，免得重复用掉额度；排队的 ${pending.length} 段还没发出去。`;
  }
  return (
    <section
      className={`nx-banner ${tone}`}
      role={recovery.phase === "checked" ? "status" : "alert"}
      aria-label="意外关闭后接着做"
    >
      <div className="nx-banner-text">
        <strong>{head}</strong>
        {body ? <span className="nx-muted">{body}</span> : null}
      </div>
      {action ? <PrimaryButton action={action} /> : null}
    </section>
  );
}

function Summary({
  title,
  tasks,
  paused,
  action,
  onRetryFailed,
  onPause,
}: {
  title: string;
  tasks: readonly TaskItem[];
  paused: boolean;
  action: Primary | null;
  onRetryFailed?: () => void;
  onPause?: () => void;
}) {
  const videos = tasks.filter((task) => task.kind === "video");
  const scope = videos.length > 0 ? videos : tasks;
  const done = scope.filter((task) => task.status === "done").length;
  const attention = scope.filter(isAttention).length;
  const running = scope.filter((task) => task.status === "running").length;
  const pending = scope.filter(isPending).length;
  const total = scope.length;
  const share = (count: number) => `${total === 0 ? 0 : (count / total) * 100}%`;
  const unit = unitFor(scope);
  const failed = tasks.filter((task) => task.status === "failed").length;
  const runningAll = tasks.filter((task) => task.status === "running").length;
  const others = (["image", "voice"] as const)
    .map((kind) => {
      const rows = tasks.filter((task) => task.kind === kind);
      const finished = rows.filter((task) => task.status === "done").length;
      return rows.length > 0 && videos.length > 0
        ? `${KIND_LABEL[kind]} ${finished}/${rows.length}`
        : "";
    })
    .filter(Boolean);
  let tag = <span className="nx-tag">等着开始</span>;
  if (paused) tag = <span className="nx-tag nx-warn">排队已暂停，等你确认</span>;
  else if (runningAll > 0) tag = <span className="nx-tag nx-info">正在生成 {runningAll} 个</span>;
  else if (total > 0 && done === total) tag = <span className="nx-tag nx-ok">全部做好了</span>;
  return (
    <section className="nx-panel nx-tasks-summary" aria-labelledby="nx-tasks-title">
      <div className="nx-tasks-meter">
        <div className="nx-row">
          <h1 id="nx-tasks-title" className="nx-one-line">
            {title}
          </h1>
          {tag}
        </div>
        <div className="nx-bar" role="img" aria-label={`做好 ${done}，共 ${total}`}>
          <i style={{ width: share(done), background: "var(--ok)" }} />
          <i style={{ width: share(running), background: "var(--accent)" }} />
          <i style={{ width: share(attention), background: "var(--warn)" }} />
        </div>
        <p className="nx-legend">
          <span>
            <i style={{ background: "var(--ok)" }} />
            做好 {done} {unit}
          </span>
          {running > 0 ? (
            <span>
              <i style={{ background: "var(--accent)" }} />
              正在生成 {running} {unit}
            </span>
          ) : null}
          <span>
            <i style={{ background: "var(--warn)" }} />
            要你处理 {attention} {unit}
          </span>
          <span>
            <i style={{ background: "var(--line-2)" }} />
            排队 {pending} {unit}
          </span>
          <span>
            {videos.length > 0 ? "视频" : ""}一共 {total} {unit}
          </span>
        </p>
      </div>
      <div className="nx-row">
        {others.length > 0 ? <span className="nx-faint">{others.join(" · ")}</span> : null}
        {failed > 0 && onRetryFailed ? (
          <button type="button" className="nx-btn" onClick={onRetryFailed}>
            失败的全部重试（{failed}）
          </button>
        ) : null}
        {runningAll > 0 && onPause ? (
          <button type="button" className="nx-btn" onClick={onPause}>
            全部暂停
          </button>
        ) : null}
        {action ? <PrimaryButton action={action} /> : null}
      </div>
    </section>
  );
}

function rowAction(
  task: TaskItem,
  props: Pick<TaskCenterProps, "onRetry" | "onRemove">,
): { label: string; ghost?: boolean; run: () => void } | null {
  if (task.status === "blocked" && props.onRetry) {
    const { onRetry } = props;
    return { label: "再试一次", run: () => onRetry(task.id, "same") };
  }
  if (task.status === "failed" && props.onRetry) {
    const { onRetry } = props;
    return task.suggestion
      ? { label: "改描述再试", run: () => onRetry(task.id, "suggestion") }
      : { label: "再试一次", run: () => onRetry(task.id, "same") };
  }
  if (isPending(task) && props.onRemove) {
    const { onRemove } = props;
    return { label: "移出队列", ghost: true, run: () => onRemove(task.id) };
  }
  return null;
}

function TaskRow({
  task,
  selected,
  onSelect,
  action,
}: {
  task: TaskItem;
  selected: boolean;
  onSelect: () => void;
  action: ReturnType<typeof rowAction>;
}) {
  const tag = STATUS_TAG[task.status];
  return (
    <li className={`nx-job${selected ? " nx-selected" : ""}`}>
      <button type="button" className="nx-job-main" aria-pressed={selected} onClick={onSelect}>
        <span className={`nx-job-kind nx-kind-${task.kind}`} aria-hidden="true">
          {KIND_MARK[task.kind]}
        </span>
        <span className="nx-job-text">
          <span className="nx-job-title">
            <span className="nx-one-line">{taskLabel(task)}</span>
            <span className={`nx-tag ${tag.tone}`}>{tag.text}</span>
            <span className="nx-code nx-one-line">{task.id}</span>
          </span>
          <span className="nx-job-sub nx-one-line">{rowNote(task)}</span>
        </span>
      </button>
      {action ? (
        <button
          type="button"
          className={`nx-btn nx-sm${action.ghost ? " nx-ghost" : ""}`}
          onClick={action.run}
        >
          {action.label}
        </button>
      ) : null}
    </li>
  );
}

function TaskDetail({
  task,
  onRetry,
  onRemove,
}: {
  task: TaskItem | undefined;
  onRetry?: TaskCenterProps["onRetry"];
  onRemove?: TaskCenterProps["onRemove"];
}) {
  if (!task) {
    return (
      <aside className="nx-panel nx-task-detail" aria-label="任务详情">
        <div className="nx-panel-head">
          <h2>任务详情</h2>
        </div>
        <p className="nx-panel-body nx-faint">点左边的一条，看它的详情。</p>
      </aside>
    );
  }
  const tag = STATUS_TAG[task.status];
  return (
    <aside className="nx-panel nx-task-detail" aria-label="任务详情">
      <div className="nx-panel-head">
        <h2 className="nx-one-line">{taskLabel(task)}</h2>
        <span className="nx-spacer" />
        <span className={`nx-tag ${tag.tone}`}>{tag.text}</span>
      </div>
      <div className="nx-panel-body nx-detail-body">
        <p className="nx-muted">
          {KIND_LABEL[task.kind]} ·{" "}
          {task.status === "blocked" ? "没有发出去" : `第 ${task.attempt} 次`}
          {task.waitedSeconds === undefined ? "" : ` · 已经等了 ${task.waitedSeconds} 秒`}
        </p>
        <p className="nx-code">{task.id}</p>
        <div className="nx-detail-box">
          <p className="nx-section-title">现在的情况</p>
          <p>{rowNote(task)}</p>
        </div>
        {task.status === "failed" && task.suggestion ? (
          <div className="nx-detail-box nx-suggest">
            <p className="nx-section-title">可以这样改</p>
            <p>{task.suggestion}</p>
          </div>
        ) : null}
        {task.status === "blocked" && onRetry ? (
          <div className="nx-detail-acts">
            <button type="button" className="nx-btn" onClick={() => onRetry(task.id, "same")}>
              按原样再试
            </button>
          </div>
        ) : null}
        {task.status === "failed" && onRetry ? (
          <div className="nx-detail-acts">
            {task.suggestion ? (
              <button
                type="button"
                className="nx-btn"
                onClick={() => onRetry(task.id, "suggestion")}
              >
                用这句描述再试
              </button>
            ) : null}
            <button type="button" className="nx-btn" onClick={() => onRetry(task.id, "same")}>
              按原样再试
            </button>
          </div>
        ) : null}
        {isPending(task) && onRemove ? (
          <div className="nx-detail-acts">
            <button type="button" className="nx-btn" onClick={() => onRemove(task.id)}>
              移出队列
            </button>
          </div>
        ) : null}
        {task.status === "failed" ? (
          <p className="nx-faint">
            再试会用 1 {KIND_UNIT[task.kind]}
            {KIND_LABEL[task.kind]}额度。被拒的这一次算没算，软件看不到。
          </p>
        ) : null}
        {task.status === "blocked" ? (
          <p className="nx-faint">这一次没有发给 Grok，没有用额度。</p>
        ) : null}
      </div>
    </aside>
  );
}

function Loading() {
  return (
    <div className="nx-panel nx-tasks-loading" aria-busy="true">
      {[0, 1, 2].map((row) => (
        <div key={row} className="nx-skeleton-row">
          <span className="nx-skeleton nx-skeleton-thumb" />
          <span className="nx-skeleton nx-skeleton-line" />
        </div>
      ))}
      <p className="nx-panel-body nx-faint">正在读取任务记录…</p>
    </div>
  );
}

/** Task center: progress, failed jobs, and picking up after the app closed unexpectedly. */
export function TaskCenter(props: TaskCenterProps) {
  const { title, tasks, recovery = null, loading = false, error = null } = props;
  const paused = Boolean(props.paused) || recovery !== null;
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const action = primaryAction({ ...props, paused });
  const visible = tasks.filter(
    (task) =>
      matchesStatus(task, statusFilter) && (kindFilter === "all" || task.kind === kindFilter),
  );
  const selected =
    tasks.find((task) => task.id === selectedId) ?? visible.find(isAttention) ?? visible[0];
  const groups: { id: string; title: string; rows: TaskItem[] }[] = [
    { id: "attention", title: "要你处理", rows: visible.filter(isAttention) },
    {
      id: "running",
      title: "正在生成",
      rows: visible.filter((task) => task.status === "running"),
    },
    { id: "queued", title: paused ? "排队 · 已暂停" : "排队", rows: visible.filter(isPending) },
    { id: "done", title: "做好了", rows: visible.filter((task) => task.status === "done") },
  ];
  const doneCollapsed = statusFilter === "all";

  if (error) {
    return (
      <div className="nx-root nx-tasks">
        <section className="nx-banner nx-err" role="alert">
          <div className="nx-banner-text">
            <strong>任务记录读不出来</strong>
            <span className="nx-muted">{error} 已经做好的视频文件不受影响。</span>
          </div>
          {action ? <PrimaryButton action={action} /> : null}
        </section>
        <section className="nx-panel nx-tasks-empty">
          <h2>列表暂时空着</h2>
          <p className="nx-muted">读出任务记录以后，这里会按镜头列出做好的、排队的和要你处理的。</p>
        </section>
      </div>
    );
  }

  if (!loading && tasks.length === 0) {
    return (
      <div className="nx-root nx-tasks">
        <section className="nx-panel nx-tasks-empty">
          <h2>现在没有任务</h2>
          <p className="nx-muted">
            在首页点「一键出片」，或者在分镜里点「生成」，要做的画面、视频和配音会排在这里。
          </p>
          <p className="nx-faint">关掉软件也不会丢：重新打开后，没做完的会接着排在这里。</p>
          {props.onOpenStoryboard ? (
            <button type="button" className="nx-btn nx-primary" onClick={props.onOpenStoryboard}>
              去分镜
            </button>
          ) : null}
        </section>
      </div>
    );
  }

  return (
    <div className="nx-root nx-tasks">
      {recovery ? <RecoveryBanner recovery={recovery} tasks={tasks} action={action} /> : null}
      <Summary
        title={title}
        tasks={tasks}
        paused={paused}
        action={recovery ? null : action}
        onRetryFailed={props.onRetryFailed}
        onPause={props.onPause}
      />
      <div className="nx-tasks-body">
        <nav className="nx-panel nx-filters" aria-label="筛选任务">
          <p className="nx-filter-group">状态</p>
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter.id}
              type="button"
              className="nx-filter"
              aria-pressed={statusFilter === filter.id}
              onClick={() => setStatusFilter(filter.id)}
            >
              <span>{filter.label}</span>
              <span className="nx-filter-num">
                {tasks.filter((task) => matchesStatus(task, filter.id)).length}
              </span>
            </button>
          ))}
          <p className="nx-filter-group">种类</p>
          {KIND_FILTERS.map((filter) => (
            <button
              key={filter.id}
              type="button"
              className="nx-filter"
              aria-pressed={kindFilter === filter.id}
              onClick={() => setKindFilter(filter.id)}
            >
              <span>{filter.label}</span>
              <span className="nx-filter-num">
                {filter.id === "all"
                  ? tasks.length
                  : tasks.filter((task) => task.kind === filter.id).length}
              </span>
            </button>
          ))}
        </nav>
        {loading ? (
          <Loading />
        ) : (
          <section className="nx-panel nx-tasks-list" aria-label="任务列表">
            <div className="nx-scroll nx-tasks-rows">
              {visible.length === 0 ? (
                <p className="nx-panel-body nx-faint">这个筛选下没有任务。</p>
              ) : null}
              {groups.map((group) =>
                group.rows.length === 0 ? null : (
                  <section key={group.id} aria-label={group.title}>
                    <h3 className="nx-group-head">
                      {group.title} · {group.rows.length} {unitFor(group.rows)}
                    </h3>
                    {group.id === "done" && doneCollapsed ? (
                      <p className="nx-more-row">点左边的「做好了」看全部。</p>
                    ) : (
                      <ul>
                        {group.rows.map((task) => (
                          <TaskRow
                            key={task.id}
                            task={task}
                            selected={selected?.id === task.id}
                            onSelect={() => setSelectedId(task.id)}
                            action={rowAction(task, props)}
                          />
                        ))}
                      </ul>
                    )}
                  </section>
                ),
              )}
            </div>
          </section>
        )}
        <TaskDetail
          task={loading ? undefined : selected}
          onRetry={props.onRetry}
          onRemove={props.onRemove}
        />
      </div>
    </div>
  );
}

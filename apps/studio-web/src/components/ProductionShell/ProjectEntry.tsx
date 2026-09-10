import { useEffect, useRef, useState, type FormEvent } from "react";

import type { CreateProjectInput, ProjectData } from "../../api/studio";
import "./project-entry.css";

export type ProjectEntryCreateOutcome =
  | { kind: "SUCCEEDED"; project: ProjectData }
  | { kind: "REMOTE_UNKNOWN" }
  | { kind: "DEFINITE_SERVER_ERROR"; message: string };

interface ProjectEntryProps {
  projects: readonly ProjectData[];
  selectedProjectId: string | null;
  onSelectProject(projectId: string): void;
  onCreateProject(input: CreateProjectInput): Promise<ProjectEntryCreateOutcome>;
  onDismiss?(): void;
}

type PendingAction = { kind: "dismiss" } | { kind: "select"; projectId: string };

function dateLabel(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? "更新时间未知" : parsed.toLocaleDateString("zh-CN");
}

export function ProjectEntry({
  projects,
  selectedProjectId,
  onSelectProject,
  onCreateProject,
  onDismiss,
}: ProjectEntryProps) {
  const [name, setName] = useState("");
  const [duration, setDuration] = useState(90);
  const [state, setState] = useState<"idle" | "submitting" | "unknown">("idle");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<ProjectData | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [hasUnreconciledResult, setHasUnreconciledResult] = useState(false);
  const [confirmNewRequest, setConfirmNewRequest] = useState(false);
  const [allowNewRequest, setAllowNewRequest] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLButtonElement | null>(null);
  const hasDraft = name.trim().length > 0 || duration !== 90;
  const hasValidDuration = Number.isInteger(duration) && duration >= 30 && duration <= 180;

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  useEffect(() => {
    if (pendingAction || confirmNewRequest) confirmRef.current?.focus();
  }, [confirmNewRequest, pendingAction]);

  const restoreFocus = () => {
    (returnFocusRef.current ?? nameRef.current)?.focus();
    returnFocusRef.current = null;
  };

  const clearDraft = () => {
    setName("");
    setDuration(90);
    setError(null);
    setCreated(null);
    setState("idle");
    setHasUnreconciledResult(false);
    setAllowNewRequest(false);
    setConfirmNewRequest(false);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || state === "submitting") return;
      if (confirmNewRequest) {
        setConfirmNewRequest(false);
        restoreFocus();
      } else if (pendingAction) {
        setPendingAction(null);
        restoreFocus();
      } else if (hasDraft) {
        setPendingAction({ kind: "dismiss" });
      } else {
        onDismiss?.();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirmNewRequest, hasDraft, onDismiss, pendingAction, state]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (
      !trimmedName ||
      !hasValidDuration ||
      state !== "idle" ||
      pendingAction ||
      confirmNewRequest ||
      (hasUnreconciledResult && !allowNewRequest)
    )
      return;
    setState("submitting");
    setAllowNewRequest(false);
    setError(null);
    setCreated(null);
    try {
      const result = await onCreateProject({
        name: trimmedName,
        aspect_ratio: "9:16",
        target_duration_seconds: duration,
        source_language: "zh-CN",
      });
      if (result.kind === "SUCCEEDED") {
        setCreated(result.project);
        setName("");
        setDuration(90);
        setState("idle");
      } else if (result.kind === "REMOTE_UNKNOWN") {
        setState("unknown");
        setHasUnreconciledResult(true);
      } else {
        setError(result.message);
        setState("idle");
      }
    } catch {
      setState("unknown");
      setHasUnreconciledResult(true);
    }
  };

  const requestProjectSelection = (projectId: string, trigger: HTMLButtonElement) => {
    if (state === "submitting" || pendingAction || confirmNewRequest) return;
    if (!hasDraft) {
      onSelectProject(projectId);
      return;
    }
    returnFocusRef.current = trigger;
    setPendingAction({ kind: "select", projectId });
  };

  const confirmPendingAction = () => {
    if (!pendingAction || state === "submitting") return;
    const action = pendingAction;
    setPendingAction(null);
    clearDraft();
    if (action.kind === "select") onSelectProject(action.projectId);
    else onDismiss?.();
  };

  return (
    <section className="project-entry" aria-labelledby="project-entry-title">
      <header>
        <div>
          <span className="eyebrow">PROJECTS</span>
          <h2 id="project-entry-title">近期作品</h2>
        </div>
        <span>{projects.length} 个作品</span>
      </header>

      <div className="project-entry-layout">
        <section className="project-entry-recent" aria-label="近期作品列表">
          {projects.length === 0 ? (
            <p className="project-entry-empty" role="status">
              还没有作品。创建完成后会显示在这里。
            </p>
          ) : (
            <ul>
              {projects.map((project) => (
                <li key={project.id}>
                  <button
                    type="button"
                    aria-pressed={project.id === selectedProjectId}
                    onClick={(event) => requestProjectSelection(project.id, event.currentTarget)}
                  >
                    <span>
                      <strong>{project.name}</strong>
                      <small>
                        {project.aspect_ratio} · {project.target_duration_seconds} 秒 · REV{" "}
                        {project.revision}
                      </small>
                    </span>
                    <time dateTime={project.updated_at}>{dateLabel(project.updated_at)}</time>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="project-entry-create" aria-labelledby="project-create-title">
          <span>NEW PROJECT</span>
          <h3 id="project-create-title">新建作品</h3>
          <p>设置作品名称与目标时长后再创建。完成前会保留你正在编辑的内容。</p>
          <form onSubmit={(event) => void submit(event)}>
            <label>
              <span>作品名称</span>
              <input
                ref={nameRef}
                value={name}
                maxLength={80}
                disabled={state === "submitting"}
                placeholder="例如：雾城来信"
                onChange={(event) => {
                  setName(event.target.value);
                  setError(null);
                }}
              />
            </label>
            <label>
              <span>作品默认目标时长</span>
              <input
                type="number"
                value={duration}
                min={30}
                max={180}
                step={1}
                disabled={state === "submitting"}
                onChange={(event) => setDuration(Number(event.target.value))}
              />
            </label>
            <p className="project-entry-contract">30–180 秒 · 9:16 竖屏 · 中文</p>
            {error && <p role="alert">{error}</p>}
            {hasUnreconciledResult && (
              <div className="project-entry-unknown" role="status">
                <p>前一次创建结果待核对。草稿已保留，系统不会自动重试。</p>
                {confirmNewRequest ? (
                  <div className="project-entry-discard" role="alert">
                    <p>前一次结果仍未核对。新的创建请求可能生成重复作品。</p>
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmNewRequest(false);
                        restoreFocus();
                      }}
                    >
                      返回草稿
                    </button>
                    <button
                      ref={confirmRef}
                      type="button"
                      onClick={() => {
                        setConfirmNewRequest(false);
                        setState("idle");
                        setAllowNewRequest(true);
                      }}
                    >
                      仍然创建新请求
                    </button>
                  </div>
                ) : (
                  <div className="project-entry-actions">
                    <button type="button" onClick={() => nameRef.current?.focus()}>
                      继续编辑草稿
                    </button>
                    <button
                      type="button"
                      disabled={state === "submitting"}
                      onClick={() => setConfirmNewRequest(true)}
                    >
                      创建新的请求
                    </button>
                  </div>
                )}
              </div>
            )}
            {created && (
              <div className="project-entry-created" role="status">
                <p>已创建“{created.name}”。</p>
                <button
                  type="button"
                  onClick={(event) => requestProjectSelection(created.id, event.currentTarget)}
                >
                  打开新作品
                </button>
              </div>
            )}
            {pendingAction ? (
              <div className="project-entry-discard" role="alert">
                <p>
                  {pendingAction.kind === "select"
                    ? "放弃未提交的草稿并切换作品？"
                    : "放弃未提交的草稿？"}
                </p>
                <button
                  type="button"
                  disabled={state === "submitting"}
                  onClick={() => {
                    if (state === "submitting") return;
                    setPendingAction(null);
                    restoreFocus();
                  }}
                >
                  继续编辑
                </button>
                <button
                  ref={confirmRef}
                  type="button"
                  disabled={state === "submitting"}
                  onClick={confirmPendingAction}
                >
                  {pendingAction.kind === "select" ? "放弃并切换" : "放弃草稿"}
                </button>
              </div>
            ) : (
              <div className="project-entry-actions">
                <button
                  type="button"
                  disabled={state === "submitting"}
                  onClick={(event) => {
                    if (hasDraft) {
                      returnFocusRef.current = event.currentTarget;
                      setPendingAction({ kind: "dismiss" });
                    } else onDismiss?.();
                  }}
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={
                    state !== "idle" ||
                    !name.trim() ||
                    !hasValidDuration ||
                    pendingAction !== null ||
                    confirmNewRequest ||
                    (hasUnreconciledResult && !allowNewRequest)
                  }
                >
                  {state === "submitting"
                    ? "正在创建…"
                    : hasUnreconciledResult
                      ? "创建新请求"
                      : "创建作品"}
                </button>
              </div>
            )}
          </form>
        </section>
      </div>
    </section>
  );
}

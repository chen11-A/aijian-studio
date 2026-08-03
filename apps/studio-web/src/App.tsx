import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, FormEvent } from "react";

import {
  createStudioTransport,
  type HealthResponse,
  type ProjectData,
  type SourceDocumentResponse,
  type StudioTransport,
} from "./api/studio";

const MAX_SOURCE_BYTES = 5 * 1024 * 1024;

type ConnectionState =
  { kind: "loading" } | { kind: "connected"; health: HealthResponse } | { kind: "error" };
type ImportState =
  | { kind: "idle" }
  | { kind: "restoring" }
  | { kind: "loading"; filename: string }
  | { kind: "success"; response: SourceDocumentResponse }
  | { kind: "error"; message: string };

interface AppProps {
  transport?: StudioTransport;
}

const navigation = [
  ["项目", "01", true],
  ["故事工坊", "02", false],
  ["分镜导演", "03", false],
  ["素材中心", "04", false],
  ["剪辑台", "05", false],
  ["任务队列", "06", false],
] as const;

function fileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("无法读取文件"));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("无法读取文件"));
        return;
      }
      const separator = reader.result.indexOf(",");
      if (separator < 0) {
        reject(new Error("无法读取文件"));
        return;
      }
      resolve(reader.result.slice(separator + 1));
    };
    reader.readAsDataURL(file);
  });
}

function formatProjectDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "刚刚更新"
    : new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(date);
}

function EngineBadge({ connection }: { connection: ConnectionState }) {
  return (
    <div className={`engine-badge ${connection.kind}`} aria-live="polite">
      <span className="signal" aria-hidden="true" />
      <div>
        {connection.kind === "loading" && <strong>正在连接创作引擎…</strong>}
        {connection.kind === "connected" && (
          <>
            <strong>创作引擎已连接</strong>
            <small>v{connection.health.data.version}</small>
          </>
        )}
        {connection.kind === "error" && <strong>创作引擎未连接</strong>}
      </div>
    </div>
  );
}

interface CreateProjectDialogProps {
  busy: boolean;
  error: string | null;
  onClose(): void;
  onCreate(name: string, duration: number): Promise<void>;
}

function CreateProjectDialog({ busy, error, onClose, onCreate }: CreateProjectDialogProps) {
  const [name, setName] = useState("");
  const [duration, setDuration] = useState(90);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [busy, onClose]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim()) void onCreate(name.trim(), duration);
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={busy ? undefined : onClose}>
      <section
        className="project-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-project-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog-kicker">NEW PRODUCTION</div>
        <h2 id="new-project-title">建立制作项目</h2>
        <p>先确定一个清晰的制作容器，原文、剧本、分镜和素材都会在这里保留版本。</p>
        <form onSubmit={submit}>
          <label>
            <span>项目名称</span>
            <input
              autoFocus
              value={name}
              maxLength={80}
              placeholder="例如：雾城来信"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <div className="form-grid">
            <label>
              <span>单集目标时长</span>
              <select
                value={duration}
                onChange={(event) => setDuration(Number(event.target.value))}
              >
                <option value={60}>60 秒</option>
                <option value={90}>90 秒</option>
                <option value={120}>120 秒</option>
              </select>
            </label>
            <div className="locked-field">
              <span>首发画幅</span>
              <strong>9:16 · 竖屏</strong>
            </div>
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>
              取消
            </button>
            <button type="submit" className="accent-button" disabled={busy || !name.trim()}>
              {busy ? "正在创建…" : "创建项目"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function EmptyWorkspace({ onCreate }: { onCreate(): void }) {
  return (
    <section className="empty-workspace">
      <div className="empty-visual" aria-hidden="true">
        <span>原文</span>
        <i>01</i>
        <b>→</b>
        <span>成片</span>
      </div>
      <div>
        <span className="eyebrow">YOUR FIRST PRODUCTION</span>
        <h2>还没有制作项目</h2>
        <p>创建项目后导入 UTF-8 TXT 小说。系统会保留原文件指纹，并把章节与段落变成可追溯来源。</p>
        <button className="accent-button" onClick={onCreate}>
          创建第一个项目
        </button>
      </div>
    </section>
  );
}

interface ProjectRailProps {
  projects: ProjectData[];
  selectedId: string | null;
  onSelect(projectId: string): void;
}

function ProjectRail({ projects, selectedId, onSelect }: ProjectRailProps) {
  return (
    <aside className="project-rail" aria-label="制作项目">
      <div className="rail-heading">
        <span>制作项目</span>
        <b>{String(projects.length).padStart(2, "0")}</b>
      </div>
      <div className="project-list">
        {projects.map((project, index) => (
          <button
            key={project.id}
            className={project.id === selectedId ? "project-card selected" : "project-card"}
            onClick={() => onSelect(project.id)}
            aria-pressed={project.id === selectedId}
          >
            <span className="project-number">{String(index + 1).padStart(2, "0")}</span>
            <span className="project-card-copy">
              <strong>{project.name}</strong>
              <small>
                {project.aspect_ratio} · {project.target_duration_seconds} 秒
              </small>
            </span>
            <time dateTime={project.updated_at}>{formatProjectDate(project.updated_at)}</time>
          </button>
        ))}
      </div>
    </aside>
  );
}

interface SourcePanelProps {
  project: ProjectData;
  state: ImportState;
  onFile(file: File): Promise<void>;
}

function SourcePanel({ project, state, onFile }: SourcePanelProps) {
  const acceptDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) void onFile(file);
  };
  const document = state.kind === "success" ? state.response.data : null;

  return (
    <div className="source-layout">
      <section className="source-uploader" aria-labelledby="source-title">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">G1 · SOURCE INGEST</span>
            <h3 id="source-title">导入小说原文</h3>
          </div>
          <span className="step-state">当前步骤</span>
        </div>
        <p className="panel-description">
          当前仅支持严格 UTF-8 TXT，最大 5 MiB。文件路径不会保存或发送。
        </p>
        <label
          className={
            state.kind === "loading" || state.kind === "restoring"
              ? "drop-zone loading"
              : "drop-zone"
          }
          onDragOver={(event) => event.preventDefault()}
          onDrop={acceptDrop}
        >
          <input
            type="file"
            accept=".txt,text/plain"
            aria-label="选择 TXT 文件"
            disabled={state.kind === "loading" || state.kind === "restoring"}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void onFile(file);
              event.target.value = "";
            }}
          />
          <span className="upload-glyph" aria-hidden="true">
            ↥
          </span>
          {state.kind === "restoring" ? (
            <>
              <strong>正在恢复已保存的原文</strong>
              <small>读取章节与来源坐标…</small>
            </>
          ) : state.kind === "loading" ? (
            <>
              <strong>正在解析 {state.filename}</strong>
              <small>计算原文指纹并识别章节…</small>
            </>
          ) : (
            <>
              <strong>拖入 TXT，或点击选择</strong>
              <small>UTF-8 · TXT · 不超过 5 MiB</small>
            </>
          )}
        </label>
        {state.kind === "error" && (
          <p className="import-error" role="alert">
            {state.message}
          </p>
        )}
        <div className="source-rules">
          <span>原始 SHA-256</span>
          <span>UTF-8 字节坐标</span>
          <span>事务化写入</span>
        </div>
      </section>

      <section className="source-preview" aria-label="来源预览">
        {document ? (
          <>
            <div className="document-summary">
              <span className="document-icon" aria-hidden="true">
                TXT
              </span>
              <div>
                <strong>{document.filename}</strong>
                <p>
                  已解析 {document.chapter_count} 章 · {document.block_count} 个文本块
                </p>
              </div>
              <code>{document.raw_sha256.slice(0, 10)}…</code>
            </div>
            <div className="block-list">
              {document.blocks.slice(0, 12).map((block) => (
                <article className={`source-block ${block.kind}`} key={block.id}>
                  <span>
                    {block.kind === "chapter_heading" ? `章 ${block.chapter_index}` : block.ordinal}
                  </span>
                  <p>{block.text}</p>
                </article>
              ))}
            </div>
          </>
        ) : (
          <div className="preview-placeholder">
            <span aria-hidden="true">⌁</span>
            <h3>{project.name} 的来源台账</h3>
            <p>导入后将在这里核对章节和段落。AI 拆解必须引用这些来源，不能把推断伪装成原著事实。</p>
          </div>
        )}
      </section>
    </div>
  );
}

export function App({ transport }: AppProps) {
  const studio = useMemo(() => transport ?? createStudioTransport(), [transport]);
  const [connection, setConnection] = useState<ConnectionState>({ kind: "loading" });
  const [projects, setProjects] = useState<ProjectData[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [importState, setImportState] = useState<ImportState>({ kind: "idle" });
  const sourceRequestGeneration = useRef(0);
  const selectedProject = projects.find((project) => project.id === selectedId) ?? null;

  const restoreLatestSource = useCallback(
    async (projectId: string) => {
      const generation = ++sourceRequestGeneration.current;
      setImportState({ kind: "restoring" });
      try {
        const sources = await studio.listSources(projectId);
        if (generation !== sourceRequestGeneration.current) return;
        const latest = sources.data[0];
        if (!latest) {
          setImportState({ kind: "idle" });
          return;
        }
        const response = await studio.getSource(projectId, latest.id);
        if (generation !== sourceRequestGeneration.current) return;
        setImportState({ kind: "success", response });
      } catch {
        if (generation !== sourceRequestGeneration.current) return;
        setImportState({
          kind: "error",
          message: "已打开项目，但暂时无法恢复原文预览。请重新连接后再试。",
        });
      }
    },
    [studio],
  );

  const connect = useCallback(async () => {
    setConnection({ kind: "loading" });
    setWorkspaceReady(false);
    try {
      const health = await studio.getHealth();
      setConnection({ kind: "connected", health });
      const projectResponse = await studio.listProjects();
      setProjects(projectResponse.data);
      const nextProjectId = projectResponse.data[0]?.id ?? null;
      setSelectedId(nextProjectId);
      setWorkspaceReady(true);
      if (nextProjectId) await restoreLatestSource(nextProjectId);
    } catch {
      setConnection({ kind: "error" });
    }
  }, [restoreLatestSource, studio]);

  useEffect(() => {
    void connect();
  }, [connect]);

  const createProject = async (name: string, duration: number) => {
    sourceRequestGeneration.current += 1;
    setCreateBusy(true);
    setCreateError(null);
    try {
      const response = await studio.createProject({
        name,
        aspect_ratio: "9:16",
        target_duration_seconds: duration,
        source_language: "zh-CN",
      });
      setProjects((current) => [response.data, ...current]);
      setSelectedId(response.data.id);
      setImportState({ kind: "idle" });
      setDialogOpen(false);
    } catch {
      setCreateError("项目创建失败，请检查名称后重试。已输入内容不会丢失。");
    } finally {
      setCreateBusy(false);
    }
  };

  const importFile = async (file: File) => {
    if (!selectedProject) return;
    const generation = ++sourceRequestGeneration.current;
    if (!file.name.toLowerCase().endsWith(".txt")) {
      setImportState({ kind: "error", message: "请选择扩展名为 .txt 的 UTF-8 文本。" });
      return;
    }
    if (file.size > MAX_SOURCE_BYTES) {
      setImportState({ kind: "error", message: "文件超过 5 MiB，请拆分后再导入。" });
      return;
    }
    setImportState({ kind: "loading", filename: file.name });
    try {
      const content = await fileAsBase64(file);
      if (generation !== sourceRequestGeneration.current) return;
      const response = await studio.importTextSource(selectedProject.id, {
        filename: file.name,
        media_type: "text/plain",
        content_base64: content,
      });
      if (generation !== sourceRequestGeneration.current) return;
      setImportState({ kind: "success", response });
      const refreshed = await studio.getProject(selectedProject.id);
      if (generation !== sourceRequestGeneration.current) return;
      setProjects((current) =>
        current.map((project) => (project.id === refreshed.data.id ? refreshed.data : project)),
      );
    } catch {
      if (generation !== sourceRequestGeneration.current) return;
      setImportState({
        kind: "error",
        message: "导入失败。请确认文件是 UTF-8 文本且尚未导入，然后重试。",
      });
    }
  };

  return (
    <div className="studio-shell">
      <aside className="sidebar">
        <a className="brand" href="#top" aria-label="Aijian Studio 首页">
          <span className="brand-mark" aria-hidden="true">
            剪
          </span>
          <span>
            <strong>AIJIAN</strong>
            <small>STUDIO</small>
          </span>
        </a>
        <nav className="primary-nav" aria-label="创作模块">
          <p className="nav-label">工作区</p>
          {navigation.map(([label, index, active]) => (
            <button
              className={active ? "nav-item active" : "nav-item"}
              key={label}
              disabled={!active}
            >
              <span>{index}</span>
              {label}
              {!active && <i>即将推出</i>}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="phase-dot" />
          <div>
            <strong>LOCAL WORKSPACE</strong>
            <small>自动保存 · 版本可追溯</small>
          </div>
        </div>
      </aside>

      <main id="top" className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">CREATOR WORKSPACE</span>
            <h1>项目与原文</h1>
          </div>
          <div className="topbar-actions">
            <EngineBadge connection={connection} />
            <button
              className="accent-button compact"
              onClick={() => setDialogOpen(true)}
              disabled={connection.kind !== "connected"}
            >
              <span aria-hidden="true">＋</span> 新建项目
            </button>
          </div>
        </header>

        {connection.kind === "error" && (
          <section className="connection-error">
            <div>
              <span className="eyebrow">ENGINE OFFLINE</span>
              <h2>创作引擎未连接</h2>
              <p>本地项目没有被修改。重新连接后可以继续。</p>
            </div>
            <button className="secondary-button" onClick={() => void connect()}>
              重新连接
            </button>
          </section>
        )}

        {connection.kind !== "error" && !workspaceReady && (
          <section className="workspace-loading" aria-label="正在载入项目">
            <span />
            <span />
            <span />
          </section>
        )}

        {workspaceReady && projects.length === 0 && (
          <EmptyWorkspace onCreate={() => setDialogOpen(true)} />
        )}

        {workspaceReady && projects.length > 0 && (
          <div className="project-workspace">
            <ProjectRail
              projects={projects}
              selectedId={selectedId}
              onSelect={(projectId) => {
                setSelectedId(projectId);
                void restoreLatestSource(projectId);
              }}
            />
            {selectedProject && (
              <section className="project-stage">
                <header className="project-hero">
                  <div>
                    <span className="project-status">制作中 · REV {selectedProject.revision}</span>
                    <h2>{selectedProject.name}</h2>
                    <p>先冻结可靠来源，再让编剧、导演和提示词工具共同工作。</p>
                  </div>
                  <dl>
                    <div>
                      <dt>画幅</dt>
                      <dd>{selectedProject.aspect_ratio}</dd>
                    </div>
                    <div>
                      <dt>单集</dt>
                      <dd>{selectedProject.target_duration_seconds}s</dd>
                    </div>
                    <div>
                      <dt>语言</dt>
                      <dd>简体中文</dd>
                    </div>
                  </dl>
                </header>
                <SourcePanel project={selectedProject} state={importState} onFile={importFile} />
              </section>
            )}
          </div>
        )}
      </main>

      {dialogOpen && (
        <CreateProjectDialog
          busy={createBusy}
          error={createError}
          onClose={() => {
            if (!createBusy) {
              setDialogOpen(false);
              setCreateError(null);
            }
          }}
          onCreate={createProject}
        />
      )}
    </div>
  );
}

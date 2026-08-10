import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, FormEvent } from "react";

import {
  createStudioTransport,
  type HealthResponse,
  type ProjectData,
  type SourceDocumentResponse,
  type SourceManifestResponse,
  type StoryBibleIndexResponse,
  type StoryBibleVersionResponse,
  type StudioTransport,
} from "./api/studio";
import { FakeWorkflowPanel } from "./components/FakeWorkflow/FakeWorkflowPanel";
import { ProviderSettingsWorkspace } from "./components/ProviderSettings/ProviderSettingsWorkspace";
import { TaskQueueWorkspace } from "./components/TaskQueue/TaskQueueWorkspace";
import { TimelineWorkspace } from "./components/Timeline/TimelineWorkspace";
import { cacheRecentVersion, touchRecentVersion } from "./story-version-cache";

const MAX_SOURCE_BYTES = 5 * 1024 * 1024;

type ConnectionState =
  { kind: "loading" } | { kind: "connected"; health: HealthResponse } | { kind: "error" };
type ImportState =
  | { kind: "idle" }
  | { kind: "restoring" }
  | { kind: "loading"; filename: string }
  | { kind: "success"; response: SourceDocumentResponse }
  | { kind: "error"; message: string };
type WorkspaceView = "project" | "story" | "edit" | "queue" | "settings";
type StoryWorkspaceState =
  | { kind: "idle" }
  | { kind: "loading" }
  | {
      kind: "ready";
      manifest: SourceManifestResponse | null;
      storyBibleIndex: StoryBibleIndexResponse | null;
      storyBibleVersion: StoryBibleVersionResponse | null;
    }
  | { kind: "error" };
type StoryContent = StoryBibleVersionResponse["data"]["version"]["content"];
type StoryFact = StoryContent["facts"][number];
type StorySourceSpan = StoryBibleVersionResponse["data"]["version"]["source_spans"][number];
type StoryVersion = StoryBibleVersionResponse["data"]["version"];
type StoryVersionRole = "latest" | "review" | "accepted";
type SourceDocumentData = SourceDocumentResponse["data"];
type StoryStateValue = NonNullable<
  NonNullable<Extract<StoryFact, { kind: "event_fact" }>["state_changes"]>[number]["before"]
>;

interface AppProps {
  transport?: StudioTransport;
}

const navigation = [
  { id: "project", label: "项目", index: "01", available: true },
  { id: "story", label: "故事工坊", index: "02", available: true },
  { id: "director", label: "分镜导演", index: "03", available: false },
  { id: "assets", label: "素材中心", index: "04", available: false },
  { id: "edit", label: "剪辑台", index: "05", available: true },
  { id: "queue", label: "任务队列", index: "06", available: true },
  { id: "settings", label: "模型与 API", index: "07", available: true },
] as const;

const entityKindLabels = {
  character: "角色",
  location: "场景",
  organization: "组织",
  prop: "道具",
  costume: "服装",
} as const;

const factStatusLabels = {
  proposed: "候选",
  confirmed: "已确认",
  contested: "有争议",
  rejected: "已拒绝",
} as const;

const sourceSpanRoleLabels = {
  supports: "支持",
  contradicts: "矛盾",
  context: "上下文",
} as const;

function shortId(value: string | null | undefined): string {
  return value ? `${value.slice(0, 12)}…` : "—";
}

function storyEntityName(entityNames: Map<string, string>, entityId: string | null | undefined) {
  if (!entityId) return "未指定";
  return entityNames.get(entityId) ?? shortId(entityId);
}

function stateValueLabel(
  value: StoryStateValue | null | undefined,
  entityNames: Map<string, string>,
): string {
  if (value == null) return "无";
  if (value.kind === "entity_ref") return storyEntityName(entityNames, value.entity_id);
  if (value.kind === "boolean") return value.value ? "是" : "否";
  return String(value.value);
}

function storyFactReferenceIds(fact: StoryFact): Array<[string, string]> {
  const references: Array<[string, string]> = [];
  fact.supersedes_fact_ids?.forEach((id) => references.push(["取代", id]));
  fact.derived_from_fact_ids?.forEach((id) => references.push(["派生自", id]));
  if (fact.kind === "event_fact") {
    fact.caused_by_fact_ids?.forEach((id) => references.push(["因果来源", id]));
    fact.temporal_relations?.forEach((relation) =>
      references.push([`时间·${relation.relation}`, relation.other_event_fact_id]),
    );
  } else if (fact.kind !== "world_rule_fact") {
    if (fact.validity?.starts_after_event_fact_id) {
      references.push(["生效于", fact.validity.starts_after_event_fact_id]);
    }
    if (fact.validity?.ends_after_event_fact_id) {
      references.push(["失效于", fact.validity.ends_after_event_fact_id]);
    }
  }
  return references;
}

function storyFactDescription(fact: StoryFact, entityNames: Map<string, string>): string {
  switch (fact.kind) {
    case "character_fact":
      return `${storyEntityName(entityNames, fact.character_id)} · ${fact.attribute}：${fact.value}`;
    case "location_fact":
      return `${storyEntityName(entityNames, fact.location_id)} · ${fact.attribute}：${fact.value}`;
    case "organization_fact":
      return `${storyEntityName(entityNames, fact.organization_id)} · ${fact.attribute}：${fact.value}`;
    case "relationship_fact":
      return `${storyEntityName(entityNames, fact.subject_entity_id)} → ${fact.predicate} → ${storyEntityName(entityNames, fact.object_entity_id)}`;
    case "event_fact": {
      const participants = fact.participants
        .map((participant) => storyEntityName(entityNames, participant))
        .join("、");
      return `故事时序 ${fact.story_time_order} · ${participants || "无参与者"} · ${storyEntityName(entityNames, fact.location_id)}`;
    }
    case "world_rule_fact":
      return `${fact.rule_scope} · ${fact.rule}`;
    case "prop_fact":
      return `${storyEntityName(entityNames, fact.prop_id)} · ${fact.property_key}：${stateValueLabel(fact.value, entityNames)}`;
    case "costume_fact":
      return `${storyEntityName(entityNames, fact.costume_id)} · ${fact.property_key}：${stateValueLabel(fact.value, entityNames)}`;
  }
}

function sourceSpanQuote(
  span: StorySourceSpan,
  sourceDocuments: Map<string, SourceDocumentData>,
): string | null {
  const sourceDocument = sourceDocuments.get(span.source_document_id);
  if (!sourceDocument) return null;
  const block = sourceDocument.blocks.find((candidate) => candidate.id === span.source_block_id);
  if (!block) return null;
  const relativeStart = span.start_byte - block.normalized_start_byte;
  const relativeEnd = span.end_byte - block.normalized_start_byte;
  const bytes = new TextEncoder().encode(block.text);
  if (relativeStart < 0 || relativeEnd > bytes.length || relativeStart >= relativeEnd) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.slice(relativeStart, relativeEnd),
    );
  } catch {
    return null;
  }
}

function validityLabel(
  validity: Extract<
    StoryFact,
    {
      kind:
        | "character_fact"
        | "location_fact"
        | "organization_fact"
        | "relationship_fact"
        | "prop_fact"
        | "costume_fact";
    }
  >["validity"],
): string {
  if (!validity) return "全程有效";
  const parts = [
    validity.starts_after_event_fact_id
      ? `始于 ${shortId(validity.starts_after_event_fact_id)} 之后`
      : null,
    validity.ends_after_event_fact_id
      ? `止于 ${shortId(validity.ends_after_event_fact_id)} 之后`
      : null,
  ].filter(Boolean);
  return parts.join("；") || "全程有效";
}

function storyFactDetailRows(
  fact: StoryFact,
  entityNames: Map<string, string>,
): Array<[string, string]> {
  const rows: Array<[string, string]> = [
    ["重要性", fact.importance],
    ["来源类型", fact.origin],
    ["正典确定性", fact.canon_certainty],
    ["来源可靠性", fact.source_reliability],
    [
      "提取置信度",
      fact.extraction_confidence_bps == null
        ? "不适用"
        : `${(fact.extraction_confidence_bps / 100).toFixed(2)}%`,
    ],
    ["视点", storyEntityName(entityNames, fact.viewpoint_entity_id)],
    ["决策理由", fact.decision_reason || "无"],
    ["影响范围", fact.impact_scope?.join("、") || "无"],
    ["取代事实", fact.supersedes_fact_ids?.map(shortId).join("、") || "无"],
    ["派生自", fact.derived_from_fact_ids?.map(shortId).join("、") || "无"],
  ];
  switch (fact.kind) {
    case "character_fact":
    case "location_fact":
    case "organization_fact":
    case "relationship_fact":
      rows.push(["有效期", validityLabel(fact.validity)]);
      break;
    case "event_fact":
      rows.push(
        ["原文叙事序", String(fact.source_narrative_order)],
        ["故事时间序", String(fact.story_time_order)],
        ["参与者", fact.participants.map((id) => storyEntityName(entityNames, id)).join("、")],
        ["地点", storyEntityName(entityNames, fact.location_id)],
        ["因果来源", fact.caused_by_fact_ids?.map(shortId).join("、") || "无"],
        [
          "时间关系",
          fact.temporal_relations
            ?.map((item) => `${item.relation} ${shortId(item.other_event_fact_id)}`)
            .join("；") || "无",
        ],
        [
          "状态变化",
          fact.state_changes
            ?.map(
              (change) =>
                `${storyEntityName(entityNames, change.entity_id)}.${change.property_key}: ${stateValueLabel(change.before, entityNames)} → ${stateValueLabel(change.after, entityNames)}`,
            )
            .join("；") || "无",
        ],
      );
      break;
    case "world_rule_fact":
      rows.push(["规则范围", fact.rule_scope], ["例外", fact.exceptions?.join("；") || "无"]);
      break;
    case "prop_fact":
    case "costume_fact":
      rows.push(
        ["属性", fact.property_key],
        ["属性值", stateValueLabel(fact.value, entityNames)],
        ["有效期", validityLabel(fact.validity)],
      );
      break;
  }
  return rows;
}

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
            <strong>本地工作区服务已连接</strong>
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

interface StoryWorkshopProps {
  project: ProjectData;
  sourceState: ImportState;
  state: StoryWorkspaceState;
  getSource: StudioTransport["getSource"];
  getStoryBibleVersion: StudioTransport["getStoryBibleVersion"];
  onRetry(): void;
}

function StoryWorkshop({
  project,
  sourceState,
  state,
  getSource,
  getStoryBibleVersion,
  onRetry,
}: StoryWorkshopProps) {
  const [selectedFactId, setSelectedFactId] = useState<string | null>(null);
  const [selectedVersionRole, setSelectedVersionRole] = useState<StoryVersionRole | null>(null);
  const [selectedSourceRole, setSelectedSourceRole] = useState<StoryVersionRole | null>(null);
  const [factQuery, setFactQuery] = useState("");
  const [factLimit, setFactLimit] = useState(20);
  const [entityQuery, setEntityQuery] = useState("");
  const [entityLimit, setEntityLimit] = useState(20);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [selectedSourceDocumentId, setSelectedSourceDocumentId] = useState<string | null>(null);
  const [selectedSourceBlockId, setSelectedSourceBlockId] = useState<string | null>(null);
  const [factNavigationTargetId, setFactNavigationTargetId] = useState<string | null>(null);
  const [questionLimit, setQuestionLimit] = useState(20);
  const [conflictLimit, setConflictLimit] = useState(20);
  const [loadedSourceDocuments, setLoadedSourceDocuments] = useState(
    () => new Map<string, SourceDocumentData>(),
  );
  const [sourceLoadFailures, setSourceLoadFailures] = useState(() => new Set<string>());
  const [loadedStoryVersions, setLoadedStoryVersions] = useState(
    () => new Map<string, StoryVersion>(),
  );
  const [storyVersionLoadFailures, setStoryVersionLoadFailures] = useState(() => new Set<string>());
  const sourcePreviewRef = useRef<HTMLDivElement | null>(null);
  const sourceBlockRefs = useRef(new Map<string, HTMLElement>());
  const factCardRefs = useRef(new Map<string, HTMLElement>());
  const latestSourceDocument = sourceState.kind === "success" ? sourceState.response.data : null;
  const manifest = state.kind === "ready" ? state.manifest : null;
  const storyBible = state.kind === "ready" ? state.storyBibleIndex : null;
  const initialStoryVersion = state.kind === "ready" ? state.storyBibleVersion?.data.version : null;
  useEffect(() => {
    if (!initialStoryVersion) return;
    setLoadedStoryVersions((current) => {
      if (current.has(initialStoryVersion.id)) return current;
      return cacheRecentVersion(current, initialStoryVersion);
    });
  }, [initialStoryVersion]);
  const sourceAccepted = Boolean(manifest?.data.head.accepted_version_id);
  const defaultVersionRole: StoryVersionRole = storyBible?.data.review_version
    ? "review"
    : storyBible?.data.accepted_version
      ? "accepted"
      : "latest";
  const versionSummaries: Record<
    StoryVersionRole,
    StoryBibleIndexResponse["data"]["latest_version"] | null | undefined
  > = {
    latest: storyBible?.data.latest_version,
    review: storyBible?.data.review_version,
    accepted: storyBible?.data.accepted_version,
  };
  const activeVersionRole =
    selectedVersionRole && versionSummaries[selectedVersionRole]
      ? selectedVersionRole
      : defaultVersionRole;
  const activeVersionSummary = versionSummaries[activeVersionRole];
  const activeVersionId = activeVersionSummary?.id;
  useEffect(() => {
    if (!activeVersionId) return;
    setLoadedStoryVersions((current) => touchRecentVersion(current, activeVersionId));
  }, [activeVersionId]);
  const story = activeVersionSummary
    ? (loadedStoryVersions.get(activeVersionSummary.id) ??
      (initialStoryVersion?.id === activeVersionSummary.id ? initialStoryVersion : undefined))
    : undefined;
  useEffect(() => {
    if (
      !activeVersionSummary ||
      initialStoryVersion?.id === activeVersionSummary.id ||
      loadedStoryVersions.has(activeVersionSummary.id) ||
      storyVersionLoadFailures.has(activeVersionSummary.id)
    ) {
      return;
    }
    let cancelled = false;
    void getStoryBibleVersion(project.id, activeVersionSummary.id)
      .then((response) => {
        if (cancelled || response.data.version.id !== activeVersionSummary.id) return;
        setLoadedStoryVersions((current) => cacheRecentVersion(current, response.data.version));
      })
      .catch(() => {
        if (!cancelled) {
          setStoryVersionLoadFailures((current) => new Set(current).add(activeVersionSummary.id));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    activeVersionSummary,
    getStoryBibleVersion,
    initialStoryVersion,
    loadedStoryVersions,
    project.id,
    storyVersionLoadFailures,
  ]);
  const sourceVersions: Record<
    StoryVersionRole,
    SourceManifestResponse["data"]["latest_version"] | null | undefined
  > = {
    latest: manifest?.data.latest_version,
    review: manifest?.data.review_version,
    accepted: manifest?.data.accepted_version,
  };
  const storySourceVersionId = story?.content.source_scope.source_manifest_version_id;
  const defaultSourceRole: StoryVersionRole =
    sourceVersions.accepted?.id === storySourceVersionId
      ? "accepted"
      : sourceVersions.review?.id === storySourceVersionId
        ? "review"
        : "latest";
  const activeSourceRole =
    selectedSourceRole && sourceVersions[selectedSourceRole]
      ? selectedSourceRole
      : defaultSourceRole;
  const sourceManifestVersion = sourceVersions[activeSourceRole] ?? manifest?.data.latest_version;
  const sourceLatestIsAccepted = Boolean(
    manifest && manifest.data.head.accepted_version_id === manifest.data.latest_version.id,
  );
  const storySelectedIsAccepted = Boolean(
    storyBible && storyBible.data.head.accepted_version_id === story?.id,
  );
  const storyDependencyCurrent = Boolean(
    story &&
    manifest?.data.head.accepted_version_id &&
    story.content.source_scope.source_manifest_version_id ===
      manifest.data.head.accepted_version_id,
  );
  const storyStale = Boolean(story && sourceAccepted && !storyDependencyCurrent);
  const openQuestions =
    story?.content.questions?.filter((question) => question.status === "open") ?? [];
  const allConflicts = story?.content.conflicts ?? [];
  const unresolvedConflicts = allConflicts.filter((conflict) => conflict.status === "unresolved");
  const entityNames = useMemo(
    () => new Map(story?.content.entities.map((entity) => [entity.entity_id, entity.name]) ?? []),
    [story],
  );
  const factById = useMemo(
    () => new Map(story?.content.facts.map((fact) => [fact.fact_id, fact]) ?? []),
    [story],
  );
  const effectiveCanonFacts = useMemo(() => {
    const ambiguousFactIds = new Set(
      story?.content.conflicts
        ?.filter((conflict) => conflict.status === "resolved_as_source_ambiguity")
        .flatMap((conflict) => conflict.fact_ids) ?? [],
    );
    return (
      story?.content.facts.filter(
        (fact) =>
          fact.canon_status === "confirmed" &&
          fact.canon_certainty !== "intentionally_unreliable" &&
          fact.source_reliability !== "unreliable" &&
          !ambiguousFactIds.has(fact.fact_id),
      ) ?? []
    );
  }, [story]);
  const effectiveCanonFactIds = useMemo(
    () => new Set(effectiveCanonFacts.map((fact) => fact.fact_id)),
    [effectiveCanonFacts],
  );
  const reviewFacts = useMemo(
    () => story?.content.facts.filter((fact) => !effectiveCanonFactIds.has(fact.fact_id)) ?? [],
    [effectiveCanonFactIds, story],
  );
  const sourceDocumentNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const version of [
      manifest?.data.latest_version,
      manifest?.data.review_version,
      manifest?.data.accepted_version,
    ]) {
      for (const document of version?.content.documents ?? []) {
        names.set(document.source_document_id, document.filename);
      }
    }
    return names;
  }, [manifest]);
  const factSearchText = useMemo(
    () =>
      new Map(
        (story?.content.facts ?? []).map((fact) => [
          fact.fact_id,
          [
            fact.fact_id,
            fact.kind,
            storyFactDescription(fact, entityNames),
            ...storyFactDetailRows(fact, entityNames).flat(),
          ]
            .join("\u0000")
            .toLocaleLowerCase("zh-CN"),
        ]),
      ),
    [entityNames, story],
  );
  const normalizedFactQuery = factQuery.trim().toLocaleLowerCase("zh-CN");
  const factMatchesQuery = (fact: StoryFact) =>
    !normalizedFactQuery || factSearchText.get(fact.fact_id)?.includes(normalizedFactQuery);
  const visibleEffectiveFacts = effectiveCanonFacts.filter(factMatchesQuery);
  const visibleReviewFacts = reviewFacts.filter(factMatchesQuery);
  const normalizedEntityQuery = entityQuery.trim().toLocaleLowerCase("zh-CN");
  const visibleEntities =
    story?.content.entities.filter((entity) => {
      if (!normalizedEntityQuery) return true;
      return [entity.entity_id, entity.kind, entity.name, ...(entity.aliases ?? [])].some((value) =>
        value.toLocaleLowerCase("zh-CN").includes(normalizedEntityQuery),
      );
    }) ?? [];
  const sourceSpansByFact = useMemo(() => {
    const spansByFact = new Map<string, StorySourceSpan[]>();
    for (const span of story?.source_spans ?? []) {
      const spans = spansByFact.get(span.fact_id) ?? [];
      spans.push(span);
      spansByFact.set(span.fact_id, spans);
    }
    return spansByFact;
  }, [story]);
  const fallbackEvidenceFact = story?.content.facts.find((fact) =>
    sourceSpansByFact.has(fact.fact_id),
  );
  const activeEvidenceFact =
    story?.content.facts.find((fact) => fact.fact_id === selectedFactId) ?? fallbackEvidenceFact;
  const activeEvidenceSpans = activeEvidenceFact
    ? (sourceSpansByFact.get(activeEvidenceFact.fact_id) ?? [])
    : [];
  const requestedSourceIds = new Set(activeEvidenceSpans.map((span) => span.source_document_id));
  const previewSourceId =
    selectedSourceDocumentId ?? sourceManifestVersion?.content.documents[0]?.source_document_id;
  if (previewSourceId) requestedSourceIds.add(previewSourceId);
  const requestedSourceKey = [...requestedSourceIds].sort().join(":");
  useEffect(() => {
    const missing = (requestedSourceKey ? requestedSourceKey.split(":") : []).filter(
      (sourceId) =>
        sourceId !== latestSourceDocument?.id &&
        !loadedSourceDocuments.has(sourceId) &&
        !sourceLoadFailures.has(sourceId),
    );
    if (missing.length === 0) return;
    let cancelled = false;
    let nextIndex = 0;
    const loaded = new Map<string, SourceDocumentData>();
    const failed = new Set<string>();
    const worker = async () => {
      while (nextIndex < missing.length) {
        const sourceId = missing[nextIndex++]!;
        try {
          const response = await getSource(project.id, sourceId);
          if (response.data.id === sourceId) loaded.set(sourceId, response.data);
          else failed.add(sourceId);
        } catch {
          failed.add(sourceId);
        }
      }
    };
    void Promise.all(Array.from({ length: Math.min(4, missing.length) }, worker)).then(() => {
      if (cancelled) return;
      if (loaded.size > 0) {
        setLoadedSourceDocuments((current) => new Map([...current, ...loaded]));
      }
      if (failed.size > 0) {
        setSourceLoadFailures((current) => new Set([...current, ...failed]));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    getSource,
    latestSourceDocument,
    loadedSourceDocuments,
    project.id,
    requestedSourceKey,
    sourceLoadFailures,
  ]);
  const availableSourceDocuments = new Map(loadedSourceDocuments);
  if (latestSourceDocument) {
    availableSourceDocuments.set(latestSourceDocument.id, latestSourceDocument);
  }
  const previewSourceDocument = previewSourceId
    ? (availableSourceDocuments.get(previewSourceId) ?? null)
    : null;
  const targetSourceBlockIndex =
    previewSourceDocument && selectedSourceBlockId
      ? previewSourceDocument.blocks.findIndex((block) => block.id === selectedSourceBlockId)
      : -1;
  const previewBlockStart =
    previewSourceDocument && targetSourceBlockIndex >= 0
      ? Math.max(0, Math.min(targetSourceBlockIndex - 3, previewSourceDocument.blocks.length - 7))
      : 0;
  const previewBlocks =
    previewSourceDocument?.blocks.slice(previewBlockStart, previewBlockStart + 7) ?? [];
  useEffect(() => {
    if (!selectedSourceDocumentId || !previewSourceDocument) return;
    const target = selectedSourceBlockId
      ? sourceBlockRefs.current.get(selectedSourceBlockId)
      : sourcePreviewRef.current;
    if (!target) return;
    target.scrollIntoView?.({ block: "center", behavior: "auto" });
    target.focus({ preventScroll: true });
  }, [previewSourceDocument, selectedSourceBlockId, selectedSourceDocumentId]);
  const activeEvidenceFailures = activeEvidenceSpans.filter((span) =>
    sourceLoadFailures.has(span.source_document_id),
  );
  const sourceGateLabel = sourceLatestIsAccepted
    ? "G1 来源已验收"
    : sourceAccepted
      ? "G1 最新草稿未验收"
      : "G1 待验收";
  const reviewLabel = storyStale
    ? "G2 来源已过期"
    : storySelectedIsAccepted
      ? activeVersionRole === "latest"
        ? "G2 最新版已验收"
        : "G2 已验收基线"
      : storyBible?.data.head.review_version_id === story?.id
        ? "G2 审阅中"
        : storyBible?.data.head.accepted_version_id
          ? "G2 最新草稿未验收"
          : "等待 G2 审阅";

  const navigateToFact = (factId: string) => {
    const target = factById.get(factId);
    if (!target) return;
    setFactQuery("");
    const group = effectiveCanonFacts.includes(target) ? effectiveCanonFacts : reviewFacts;
    const index = group.findIndex((fact) => fact.fact_id === factId);
    if (index >= 0) setFactLimit((current) => Math.max(current, index + 1));
    setSelectedFactId(factId);
    setFactNavigationTargetId(factId);
  };
  useEffect(() => {
    if (!factNavigationTargetId) return;
    const target = factCardRefs.current.get(factNavigationTargetId);
    if (!target) return;
    target.scrollIntoView?.({ block: "center", behavior: "auto" });
    target.focus({ preventScroll: true });
    setFactNavigationTargetId(null);
  }, [factLimit, factNavigationTargetId, factQuery]);

  const renderFactCard = (fact: StoryFact) => (
    <article
      className={activeEvidenceFact?.fact_id === fact.fact_id ? "active" : undefined}
      key={fact.fact_id}
      tabIndex={-1}
      ref={(node) => {
        if (node) factCardRefs.current.set(fact.fact_id, node);
        else factCardRefs.current.delete(fact.fact_id);
      }}
    >
      <header>
        <span>{fact.kind.replace("_fact", "").toUpperCase()}</span>
        <div className="fact-actions">
          <strong>{factStatusLabels[fact.canon_status]}</strong>
          <button
            type="button"
            aria-label={`查看 ${storyFactDescription(fact, entityNames)} 的来源证据`}
            aria-pressed={activeEvidenceFact?.fact_id === fact.fact_id}
            disabled={!sourceSpansByFact.has(fact.fact_id)}
            onClick={() => setSelectedFactId(fact.fact_id)}
          >
            证据 {sourceSpansByFact.get(fact.fact_id)?.length ?? 0}
          </button>
        </div>
      </header>
      <p>{storyFactDescription(fact, entityNames)}</p>
      <code className="fact-id">{fact.fact_id}</code>
      {storyFactReferenceIds(fact).length > 0 && (
        <div className="fact-reference-list" aria-label="关联事实">
          {storyFactReferenceIds(fact).map(([relation, factId]) => {
            const target = factById.get(factId);
            return (
              <button
                type="button"
                key={`${relation}:${factId}`}
                disabled={!target}
                onClick={() => navigateToFact(factId)}
              >
                <span>{relation}</span>
                <strong>
                  {target ? storyFactDescription(target, entityNames) : "缺失的关联事实"}
                </strong>
                <code>{factId}</code>
              </button>
            );
          })}
        </div>
      )}
      <details className="fact-details">
        <summary>完整字段</summary>
        <dl>
          {storyFactDetailRows(fact, entityNames).map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </details>
    </article>
  );

  return (
    <section className="story-workshop" aria-labelledby="story-workshop-title">
      <header className="story-workshop-header">
        <div>
          <span className="eyebrow">G2 · STORY BIBLE</span>
          <h2 id="story-workshop-title">故事圣经</h2>
          <p>{project.name} · 区分最新草稿、审阅版本与下游已验收基线</p>
        </div>
        <div className="artifact-version" aria-label="当前故事圣经版本">
          {storyBible ? (
            <>
              <button
                type="button"
                className={activeVersionRole === "latest" ? "active" : undefined}
                aria-pressed={activeVersionRole === "latest"}
                onClick={() => setSelectedVersionRole("latest")}
              >
                <span>LATEST</span>
                <strong>
                  V{String(storyBible?.data.latest_version.version_number).padStart(2, "0")}
                </strong>
                <code>{shortId(storyBible?.data.latest_version.id)}</code>
              </button>
              <button
                type="button"
                className={activeVersionRole === "review" ? "active" : undefined}
                aria-pressed={activeVersionRole === "review"}
                disabled={!storyBible?.data.review_version}
                onClick={() => setSelectedVersionRole("review")}
              >
                <span>REVIEW</span>
                <strong>
                  {storyBible?.data.review_version
                    ? `V${String(storyBible.data.review_version.version_number).padStart(2, "0")}`
                    : "—"}
                </strong>
                <code>{shortId(storyBible?.data.review_version?.id)}</code>
              </button>
              <button
                type="button"
                className={activeVersionRole === "accepted" ? "active" : undefined}
                aria-pressed={activeVersionRole === "accepted"}
                disabled={!storyBible?.data.accepted_version}
                onClick={() => setSelectedVersionRole("accepted")}
              >
                <span>ACCEPTED</span>
                <strong>
                  {storyBible?.data.accepted_version
                    ? `V${String(storyBible.data.accepted_version.version_number).padStart(2, "0")}`
                    : "—"}
                </strong>
                <code>{shortId(storyBible?.data.accepted_version?.id)}</code>
              </button>
              <span className="version-role-note">正在查看 {activeVersionRole.toUpperCase()}</span>
              <p>{activeVersionSummary?.change_summary}</p>
              <code>{activeVersionSummary?.content_hash.slice(0, 17)}…</code>
              {activeVersionSummary && storyVersionLoadFailures.has(activeVersionSummary.id) && (
                <small className="version-load-error">版本正文读取失败，请重新读取工作台。</small>
              )}
            </>
          ) : (
            <>
              <span>VERSION —</span>
              <strong>尚未建立版本</strong>
            </>
          )}
        </div>
      </header>

      <div className="story-columns">
        <section className="story-column evidence-column" aria-labelledby="evidence-title">
          <div className="story-column-heading">
            <div>
              <span className="column-index">01</span>
              <h3 id="evidence-title">来源预览</h3>
            </div>
            <span className={sourceLatestIsAccepted ? "gate-chip accepted" : "gate-chip pending"}>
              {sourceGateLabel}
            </span>
          </div>

          {state.kind === "loading" && (
            <div className="column-skeleton" aria-label="正在读取来源" />
          )}
          {manifest && (
            <div className="manifest-summary">
              <strong>{sourceManifestVersion?.content.documents.length ?? 0} 份来源文档</strong>
              <span>
                REV {manifest.data.head.revision} · V{sourceManifestVersion?.version_number ?? "—"}
              </span>
              <p>{sourceManifestVersion?.change_summary}</p>
              <div className="source-version-selector" aria-label="来源清单版本">
                {(["latest", "review", "accepted"] as const).map((role) => {
                  const version = sourceVersions[role];
                  return (
                    <button
                      type="button"
                      key={role}
                      className={activeSourceRole === role ? "active" : undefined}
                      aria-pressed={activeSourceRole === role}
                      disabled={!version}
                      onClick={() => {
                        setSelectedSourceRole(role);
                        setSelectedSourceDocumentId(null);
                        setSelectedSourceBlockId(null);
                      }}
                    >
                      <span>{role.toUpperCase()}</span>
                      <strong>{version ? `V${version.version_number}` : "—"}</strong>
                      <code>{shortId(version?.id)}</code>
                    </button>
                  );
                })}
              </div>
              <small>正在查看 {activeSourceRole.toUpperCase()} 来源清单</small>
              {!sourceLatestIsAccepted && manifest.data.head.accepted_version_id && (
                <small>下游仍使用 {shortId(manifest.data.head.accepted_version_id)}</small>
              )}
              <div className="manifest-document-list" aria-label="来源文档列表">
                {sourceManifestVersion?.content.documents.map((document) => (
                  <button
                    type="button"
                    key={document.source_document_id}
                    className={
                      previewSourceId === document.source_document_id ? "active" : undefined
                    }
                    aria-pressed={previewSourceId === document.source_document_id}
                    onClick={() => {
                      setSelectedSourceDocumentId(document.source_document_id);
                      setSelectedSourceBlockId(null);
                    }}
                  >
                    <span>#{document.import_order}</span>
                    <strong>{document.filename}</strong>
                    <small>{document.chapter_count} 章</small>
                    <code>{document.source_document_id}</code>
                  </button>
                ))}
              </div>
            </div>
          )}

          {story && (
            <section className="fact-evidence" aria-labelledby="fact-evidence-title">
              <header>
                <span>FACT EVIDENCE</span>
                <h4 id="fact-evidence-title">逐事实证据</h4>
              </header>
              {activeEvidenceFact && activeEvidenceSpans.length > 0 ? (
                <>
                  <p className="evidence-fact-name">
                    {storyFactDescription(activeEvidenceFact, entityNames)}
                  </p>
                  <div className="source-span-list">
                    {activeEvidenceSpans.map((span) => {
                      const quote = sourceSpanQuote(span, availableSourceDocuments);
                      const evidenceDocument = availableSourceDocuments.get(
                        span.source_document_id,
                      );
                      const evidenceBlock = evidenceDocument?.blocks.find(
                        (block) => block.id === span.source_block_id,
                      );
                      const evidenceFilename =
                        evidenceDocument?.filename ??
                        sourceDocumentNames.get(span.source_document_id) ??
                        "未知来源文档";
                      const sourcePending =
                        !availableSourceDocuments.has(span.source_document_id) &&
                        !sourceLoadFailures.has(span.source_document_id);
                      return (
                        <article key={span.id}>
                          <header>
                            <strong>{sourceSpanRoleLabels[span.role]}</strong>
                            <code>
                              字节 {span.start_byte}–{span.end_byte}
                            </code>
                          </header>
                          <div className="evidence-source-identity">
                            <strong>{evidenceFilename}</strong>
                            <span>
                              {evidenceBlock
                                ? `第 ${evidenceBlock.chapter_index} 章`
                                : "章节读取中"}
                            </span>
                            <code>{span.source_document_id}</code>
                          </div>
                          {quote ? (
                            <blockquote>“{quote}”</blockquote>
                          ) : sourcePending ? (
                            <p className="evidence-pending" aria-live="polite">
                              正在读取绑定的来源文档…
                            </p>
                          ) : (
                            <p className="evidence-warning" role="alert">
                              无法从绑定的来源文档恢复该引文，请核对文档、文本块与 UTF-8 字节坐标。
                            </p>
                          )}
                          <p>{span.claim}</p>
                          <footer>
                            <span>{shortId(span.source_block_id)}</span>
                            <code>{span.quote_hash.slice(0, 17)}…</code>
                          </footer>
                          <button
                            type="button"
                            className="open-source-context"
                            onClick={() => {
                              setSelectedSourceDocumentId(span.source_document_id);
                              setSelectedSourceBlockId(span.source_block_id);
                            }}
                          >
                            打开《{evidenceFilename}》上下文
                          </button>
                        </article>
                      );
                    })}
                  </div>
                  {activeEvidenceFailures.length > 0 && (
                    <p className="evidence-load-warning">
                      {activeEvidenceFailures.length}{" "}
                      份证据文档读取失败；对应引文已明确标记，未使用其他文档替代。
                    </p>
                  )}
                </>
              ) : (
                <p className="evidence-empty">当前事实没有绑定可核对的精确引文。</p>
              )}
            </section>
          )}

          {previewSourceDocument ? (
            <div className="evidence-excerpts" ref={sourcePreviewRef} tabIndex={-1}>
              <div className="evidence-document">
                <span>TXT</span>
                <div>
                  <strong>{previewSourceDocument.filename}</strong>
                  <small>
                    {previewSourceDocument.chapter_count} 章 · {previewSourceDocument.block_count}{" "}
                    块
                  </small>
                </div>
              </div>
              {previewBlocks.map((block) => (
                <article
                  key={block.id}
                  className={`evidence-block${selectedSourceBlockId === block.id ? " active" : ""}`}
                  tabIndex={-1}
                  ref={(node) => {
                    if (node) sourceBlockRefs.current.set(block.id, node);
                    else sourceBlockRefs.current.delete(block.id);
                  }}
                >
                  <span>
                    {block.kind === "chapter_heading" ? `章 ${block.chapter_index}` : block.ordinal}
                  </span>
                  <p>{block.text}</p>
                </article>
              ))}
              <p className="preview-disclaimer">
                下方是当前选择的来源文档上下文；正式审阅以上方逐事实精确引文、字节坐标和引文哈希为准。
              </p>
            </div>
          ) : (
            state.kind !== "loading" && (
              <div className="story-mini-empty">
                <span aria-hidden="true">⌁</span>
                <p>返回“项目”导入原文后，这里会显示可追溯摘录。</p>
              </div>
            )
          )}
        </section>

        <section className="story-column canon-column" aria-labelledby="canon-title">
          <div className="story-column-heading">
            <div>
              <span className="column-index">02</span>
              <h3 id="canon-title">结构化正典</h3>
            </div>
            {story && <span className="record-count">{story.content.entities.length} 个实体</span>}
          </div>

          {state.kind === "loading" && (
            <div className="column-skeleton tall" aria-label="正在读取故事圣经" />
          )}
          {state.kind === "error" && (
            <div className="story-empty-state" role="alert">
              <span className="empty-code">READ ERROR</span>
              <h3>故事工坊暂时无法读取</h3>
              <p>本地内容没有被修改。重新读取即可继续。</p>
              <button className="secondary-button" onClick={onRetry}>
                重新读取
              </button>
            </div>
          )}
          {state.kind === "ready" && !sourceAccepted && (
            <div className="story-empty-state dependency-state">
              <span className="empty-code">G1 REQUIRED</span>
              <h3>来源尚未验收</h3>
              <p>故事圣经必须绑定已验收的来源版本，避免 AI 把推断混入原著事实。</p>
              <button className="secondary-button" disabled>
                等待 G1 验收
              </button>
            </div>
          )}
          {state.kind === "ready" && sourceAccepted && !storyBible && (
            <div className="story-empty-state">
              <span className="empty-code">READY TO BREAK DOWN</span>
              <h3>可以开始拆解小说</h3>
              <p>
                G1 已通过。下一纵切会接入模型配置和生成任务，在后台产出人物、关系、事件与未决问题。
              </p>
              <button className="secondary-button" disabled>
                生成能力开发中
              </button>
            </div>
          )}
          {state.kind === "ready" && storyBible && !story && (
            <div className="column-skeleton tall" aria-label="正在按需读取故事版本" />
          )}
          {story && (
            <div className="canon-content">
              {storyStale && (
                <div className="stale-warning" role="alert">
                  <strong>故事圣经来源已过期</strong>
                  <p>
                    本版本基于 {shortId(story.content.source_scope.source_manifest_version_id)}，
                    当前 G1 accepted 为 {shortId(manifest?.data.head.accepted_version_id)}。
                    在重基底并重新审阅前，不能把本页内容当作下游正典。
                  </p>
                </div>
              )}
              <div className="story-logline">
                <span>LOGLINE</span>
                <h3>{story.content.title}</h3>
                <p>{story.content.logline}</p>
              </div>
              <div className="canon-metrics" aria-label="故事圣经统计">
                <div>
                  <strong>{story.content.entities.length}</strong>
                  <span>实体</span>
                </div>
                <div>
                  <strong>{story.content.facts.length}</strong>
                  <span>事实</span>
                </div>
                <div>
                  <strong>{openQuestions.length}</strong>
                  <span>未决</span>
                </div>
              </div>
              <div className="entity-toolbar">
                <label htmlFor="entity-search">搜索实体</label>
                <input
                  id="entity-search"
                  type="search"
                  value={entityQuery}
                  placeholder="名称、别名、类型或完整 ID…"
                  onChange={(event) => {
                    setEntityQuery(event.target.value);
                    setEntityLimit(20);
                  }}
                />
                <span>
                  {visibleEntities.length} / {story.content.entities.length}
                </span>
              </div>
              <div className="entity-grid">
                {visibleEntities.slice(0, entityLimit).map((entity) => (
                  <article
                    id={`entity-${entity.entity_id}`}
                    className={`entity-card${selectedEntityId === entity.entity_id ? " active" : ""}`}
                    key={entity.entity_id}
                    tabIndex={-1}
                    ref={(node) => {
                      if (node && selectedEntityId === entity.entity_id) {
                        node.scrollIntoView?.({ block: "center", behavior: "smooth" });
                        node.focus({ preventScroll: true });
                      }
                    }}
                  >
                    <span>{entityKindLabels[entity.kind]}</span>
                    <strong>{entity.name}</strong>
                    <small>{entity.aliases?.join(" / ") || "无别名"}</small>
                    <code>{entity.entity_id}</code>
                  </article>
                ))}
              </div>
              {visibleEntities.length > entityLimit && (
                <button
                  type="button"
                  className="show-more-button"
                  onClick={() => setEntityLimit((current) => current + 20)}
                >
                  再显示 20 个实体
                </button>
              )}
              <div className="fact-toolbar">
                <label htmlFor="fact-search">搜索事实</label>
                <input
                  id="fact-search"
                  type="search"
                  value={factQuery}
                  placeholder="角色、事件、类型…"
                  onChange={(event) => {
                    setFactQuery(event.target.value);
                    setFactLimit(20);
                  }}
                />
                <span>
                  {visibleEffectiveFacts.length + visibleReviewFacts.length} /{" "}
                  {story.content.facts.length}
                </span>
              </div>
              {effectiveCanonFacts.length > 0 && (
                <div className="fact-list canon-facts">
                  <span className="section-caption">有效正典</span>
                  {visibleEffectiveFacts.slice(0, factLimit).map(renderFactCard)}
                </div>
              )}
              {reviewFacts.length > 0 && (
                <div className="fact-list review-facts">
                  <span className="section-caption">候选 / 争议 / 已拒绝</span>
                  {visibleReviewFacts.slice(0, factLimit).map(renderFactCard)}
                </div>
              )}
              {visibleEffectiveFacts.length + visibleReviewFacts.length > factLimit && (
                <button
                  type="button"
                  className="show-more-button"
                  onClick={() => setFactLimit((current) => current + 20)}
                >
                  再显示 20 条事实
                </button>
              )}
            </div>
          )}
        </section>

        <section className="story-column review-column" aria-labelledby="review-title">
          <div className="story-column-heading">
            <div>
              <span className="column-index">03</span>
              <h3 id="review-title">编剧审阅</h3>
            </div>
            <span
              className={
                storySelectedIsAccepted && !storyStale ? "gate-chip accepted" : "gate-chip pending"
              }
            >
              {reviewLabel}
            </span>
          </div>

          <div className="review-scorecard">
            <div>
              <span>开放问题</span>
              <strong>{openQuestions.length}</strong>
            </div>
            <div>
              <span>未解冲突</span>
              <strong>{unresolvedConflicts.length}</strong>
            </div>
          </div>

          {story ? (
            <>
              <div className="review-list">
                <span className="section-caption">OPEN QUESTIONS</span>
                {openQuestions.length > 0 ? (
                  openQuestions.slice(0, questionLimit).map((question) => (
                    <article key={question.question_id}>
                      <div className="review-record-meta">
                        <span className={`severity ${question.severity}`}>{question.severity}</span>
                        {question.blocking && <strong className="blocking-chip">BLOCKING</strong>}
                      </div>
                      <p>{question.question}</p>
                      <div className="question-scope">
                        <span>{question.scope_type}</span>
                        {question.scope_id && question.scope_type !== "artifact" ? (
                          <button
                            type="button"
                            disabled={
                              question.scope_type === "fact"
                                ? !factById.has(question.scope_id)
                                : question.scope_type === "entity"
                                  ? !entityNames.has(question.scope_id)
                                  : !sourceDocumentNames.has(question.scope_id)
                            }
                            onClick={() => {
                              if (!question.scope_id) return;
                              if (question.scope_type === "fact") {
                                navigateToFact(question.scope_id);
                              } else if (question.scope_type === "entity") {
                                setEntityQuery(question.scope_id);
                                setEntityLimit(20);
                                setSelectedEntityId(question.scope_id);
                              } else if (question.scope_type === "source_document") {
                                setSelectedSourceDocumentId(question.scope_id);
                                setSelectedSourceBlockId(null);
                              }
                            }}
                          >
                            {question.scope_type === "fact" && factById.has(question.scope_id)
                              ? storyFactDescription(factById.get(question.scope_id)!, entityNames)
                              : question.scope_type === "entity"
                                ? storyEntityName(entityNames, question.scope_id)
                                : (sourceDocumentNames.get(question.scope_id) ?? question.scope_id)}
                          </button>
                        ) : (
                          <strong>
                            {question.scope_id
                              ? question.scope_type === "entity"
                                ? storyEntityName(entityNames, question.scope_id)
                                : question.scope_type === "source_document"
                                  ? (sourceDocumentNames.get(question.scope_id) ??
                                    question.scope_id)
                                  : question.scope_id
                              : "整个制品"}
                          </strong>
                        )}
                      </div>
                      <small>责任角色 · {question.responsible_role}</small>
                    </article>
                  ))
                ) : (
                  <p className="review-clear">当前版本没有前端可见的开放问题。</p>
                )}
                {openQuestions.length > questionLimit && (
                  <button
                    type="button"
                    className="show-more-button"
                    onClick={() => setQuestionLimit((current) => current + 20)}
                  >
                    再显示 20 个问题
                  </button>
                )}
              </div>
              <div className="review-list conflict-list">
                <span className="section-caption">CONFLICT AUDIT</span>
                {allConflicts.length > 0 ? (
                  allConflicts.slice(0, conflictLimit).map((conflict) => (
                    <article key={conflict.conflict_id}>
                      <div className="review-record-meta">
                        <span className={`severity ${conflict.severity}`}>{conflict.severity}</span>
                        <strong className={`conflict-status ${conflict.status}`}>
                          {conflict.status}
                        </strong>
                      </div>
                      <p>
                        {conflict.conflict_type} · {conflict.fact_ids.length} 条关联事实
                      </p>
                      <div className="conflict-facts">
                        {conflict.fact_ids.map((factId) => {
                          const fact = story.content.facts.find(
                            (candidate) => candidate.fact_id === factId,
                          );
                          return (
                            <button
                              type="button"
                              key={factId}
                              disabled={!fact}
                              onClick={() => navigateToFact(factId)}
                            >
                              {fact ? storyFactDescription(fact, entityNames) : shortId(factId)} ·
                              证据 {sourceSpansByFact.get(factId)?.length ?? 0}
                            </button>
                          );
                        })}
                      </div>
                      {conflict.resolution_reason && (
                        <p className="resolution-reason">决议依据：{conflict.resolution_reason}</p>
                      )}
                      {conflict.resolution_fact_id && (
                        <button
                          type="button"
                          className="resolution-fact"
                          disabled={!factById.has(conflict.resolution_fact_id)}
                          onClick={() => {
                            if (conflict.resolution_fact_id) {
                              navigateToFact(conflict.resolution_fact_id);
                            }
                          }}
                        >
                          决议事实 ·{" "}
                          {factById.has(conflict.resolution_fact_id)
                            ? storyFactDescription(
                                factById.get(conflict.resolution_fact_id)!,
                                entityNames,
                              )
                            : conflict.resolution_fact_id}
                        </button>
                      )}
                      <small>责任角色 · {conflict.responsible_role}</small>
                    </article>
                  ))
                ) : (
                  <p className="review-clear">当前版本没有冲突审计记录。</p>
                )}
                {allConflicts.length > conflictLimit && (
                  <button
                    type="button"
                    className="show-more-button"
                    onClick={() => setConflictLimit((current) => current + 20)}
                  >
                    再显示 20 个冲突
                  </button>
                )}
              </div>
              <p className="readiness-disclaimer">
                本页不根据计数推断“可批准”。正式就绪状态必须来自服务端 G2 Readiness Report， 并包含
                findings、waivers 与必需签署。
              </p>
              <div className="review-action-note">
                <span aria-hidden="true">i</span>
                <p>审批令牌不会暴露给界面。提交与签署能力将在独立受信任流程中接入。</p>
              </div>
              <button className="accent-button review-submit" disabled>
                提交 G2 审阅尚未开放
              </button>
            </>
          ) : (
            <div className="story-mini-empty review-waiting">
              <span aria-hidden="true">03</span>
              <p>
                {storyBible
                  ? "正在按需读取所选版本的审阅记录。"
                  : "故事圣经生成后，编剧、导演与连续性审阅结果会汇总在这里。"}
              </p>
            </div>
          )}
        </section>
      </div>
    </section>
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
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceView>("project");
  const [storyState, setStoryState] = useState<StoryWorkspaceState>({ kind: "idle" });
  const sourceRequestGeneration = useRef(0);
  const storyRequestGeneration = useRef(0);
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

  const loadStoryWorkspace = useCallback(
    async (projectId: string) => {
      const generation = ++storyRequestGeneration.current;
      setStoryState({ kind: "loading" });
      try {
        const manifest = await studio.getSourceManifest(projectId);
        if (generation !== storyRequestGeneration.current) return;
        if (!manifest?.data.head.accepted_version_id) {
          setStoryState({
            kind: "ready",
            manifest,
            storyBibleIndex: null,
            storyBibleVersion: null,
          });
          return;
        }
        const storyBibleIndex = await studio.getStoryBibleIndex(projectId);
        if (generation !== storyRequestGeneration.current) return;
        const preferredVersion = storyBibleIndex
          ? (storyBibleIndex.data.review_version ??
            storyBibleIndex.data.accepted_version ??
            storyBibleIndex.data.latest_version)
          : null;
        const storyBibleVersion = preferredVersion
          ? await studio.getStoryBibleVersion(projectId, preferredVersion.id)
          : null;
        if (generation !== storyRequestGeneration.current) return;
        setStoryState({
          kind: "ready",
          manifest,
          storyBibleIndex,
          storyBibleVersion,
        });
      } catch {
        if (generation !== storyRequestGeneration.current) return;
        setStoryState({ kind: "error" });
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
      setActiveWorkspace("project");
      setStoryState({ kind: "idle" });
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
      setActiveWorkspace("project");
      setStoryState({ kind: "idle" });
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
          {navigation.map((item) => {
            const isWorkspace =
              item.id === "project" ||
              item.id === "story" ||
              item.id === "edit" ||
              item.id === "queue" ||
              item.id === "settings";
            const active = isWorkspace && activeWorkspace === item.id;
            const enabled =
              item.available &&
              ((item.id !== "story" && item.id !== "edit" && item.id !== "queue") ||
                selectedProject !== null);
            return (
              <button
                className={`nav-item${active ? " active" : ""}${!item.available ? " unavailable" : ""}`}
                key={item.id}
                disabled={!enabled}
                aria-current={active ? "page" : undefined}
                onClick={
                  !enabled || !isWorkspace
                    ? undefined
                    : () => {
                        setActiveWorkspace(item.id);
                        if (item.id === "story" && selectedProject) {
                          void loadStoryWorkspace(selectedProject.id);
                        }
                      }
                }
              >
                <span>{item.index}</span>
                {item.label}
                {!item.available && <i>即将推出</i>}
              </button>
            );
          })}
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
            <h1>
              {activeWorkspace === "project"
                ? "项目与原文"
                : activeWorkspace === "story"
                  ? "故事工坊"
                  : activeWorkspace === "edit"
                    ? "剪辑台"
                    : activeWorkspace === "queue"
                      ? "任务队列"
                      : "模型与 API"}
            </h1>
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

        {workspaceReady && activeWorkspace === "settings" && (
          <ProviderSettingsWorkspace
            listConnections={studio.listProviderConnections}
            createConnection={studio.createProviderConnection}
            deleteConnection={studio.deleteProviderConnection}
          />
        )}

        {workspaceReady && activeWorkspace !== "settings" && projects.length === 0 && (
          <EmptyWorkspace onCreate={() => setDialogOpen(true)} />
        )}

        {workspaceReady && activeWorkspace !== "settings" && projects.length > 0 && (
          <div className="project-workspace">
            <ProjectRail
              projects={projects}
              selectedId={selectedId}
              onSelect={(projectId) => {
                setSelectedId(projectId);
                void restoreLatestSource(projectId);
                if (activeWorkspace === "story") void loadStoryWorkspace(projectId);
              }}
            />
            {selectedProject && (
              <section className="project-stage">
                {activeWorkspace === "project" ? (
                  <>
                    <header className="project-hero">
                      <div>
                        <span className="project-status">
                          制作中 · REV {selectedProject.revision}
                        </span>
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
                    <SourcePanel
                      project={selectedProject}
                      state={importState}
                      onFile={importFile}
                    />
                    {importState.kind === "success" && (
                      <FakeWorkflowPanel
                        project={selectedProject}
                        sourceFilename={importState.response.data.filename}
                        startWorkflow={studio.startFakeTimelineWorkflow}
                        onOpenQueue={() => setActiveWorkspace("queue")}
                        onOpenTimeline={() => setActiveWorkspace("edit")}
                      />
                    )}
                  </>
                ) : activeWorkspace === "story" ? (
                  <StoryWorkshop
                    key={selectedProject.id}
                    project={selectedProject}
                    sourceState={importState}
                    state={storyState}
                    getSource={studio.getSource}
                    getStoryBibleVersion={studio.getStoryBibleVersion}
                    onRetry={() => void loadStoryWorkspace(selectedProject.id)}
                  />
                ) : activeWorkspace === "edit" ? (
                  <TimelineWorkspace
                    key={selectedProject.id}
                    project={selectedProject}
                    loadTimeline={studio.getProjectTimeline}
                    trimClip={studio.trimTimelineClip}
                    reorderClip={studio.reorderTimelineClip}
                    replaceClip={studio.replaceTimelineClip}
                  />
                ) : (
                  <TaskQueueWorkspace
                    key={selectedProject.id}
                    project={selectedProject}
                    loadTasks={studio.listProjectTasks}
                  />
                )}
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

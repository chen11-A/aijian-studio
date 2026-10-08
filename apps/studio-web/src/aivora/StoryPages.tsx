import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createStudioTransport } from "../api/studio";
import type { ProjectData } from "../api/studio";
import { art, sourceText } from "./data";
import { useDemo } from "./model";
import { Button, FlowFooter, PageTitle, Pill } from "./Common";
import { SourceExtractionPanel } from "./SourceExtractionPanel";
import { EpisodeScriptEditor } from "./EpisodeScriptEditor";
import { Icon } from "./Icon";
import { selectProductionSourceStage } from "./adapters/productionSourceStage";
import { sourceReviewIdentity } from "./adapters/sourceManifest";
import {
  closePendingProjectUpdate,
  readPendingProjectUpdate,
  readProjectUpdateJournal,
  updateManagedProject,
} from "./adapters/projectManagement";
import type { ProjectJournalState } from "./adapters/projectManagement";
import type { SourceManifestReviewIdentity } from "../api/studio";
import type { ProductionBriefCreateCommand } from "../api/studio";
import "./v2-story.css";

function Card({
  title,
  icon = "book",
  children,
  className = "",
}: {
  title: string;
  icon?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`v2-story-card ${className}`}>
      <h2>
        <Icon name={icon} size={19} />
        {title}
      </h2>
      {children}
    </section>
  );
}

function ProjectNameEditor({ projectId }: { projectId: string }) {
  const d = useDemo();
  const live = useRef(d);
  live.current = d;
  const transport = useMemo(createStudioTransport, []);
  const storage = useMemo(() => {
    try { return window.localStorage; } catch { return null; }
  }, []);
  const project = d.projects.find((item) => item.backendId === projectId);
  const [draft, setDraft] = useState(project?.name ?? "");
  const [loadedRevision, setLoadedRevision] = useState(project?.revision ?? null);
  const [journal, setJournal] = useState<ProjectJournalState>(() => storage
    ? readProjectUpdateJournal(storage, projectId) : { kind: "BLOCKED" });
  const [busy, setBusy] = useState(false);
  const [mustRead, setMustRead] = useState(false);
  const [notice, setNotice] = useState("");
  const epoch = useRef(0);
  const inFlight = useRef(false);
  const revision = project?.revision;
  const dirty = !!project && draft !== project.name;
  useEffect(() => () => { epoch.current += 1; }, []);
  useEffect(() => {
    if (project && loadedRevision === null) {
      setDraft(project.name);
      setLoadedRevision(project.revision ?? null);
    }
  }, [project?.backendId, project?.revision, loadedRevision]);

  function showProject(value: ProjectData) {
    const current = live.current;
    if (current.backendProjectId !== value.id) return;
    const card = current.projects.find((item) => item.backendId === value.id);
    if (!card || (card.revision ?? 0) > value.revision) return;
    current.setProjects((old) => old.map((item) =>
      item.backendId === value.id && (item.revision ?? 0) <= value.revision
        ? { ...item, name: value.name, revision: value.revision,
            status: value.status === "archived" ? "已归档" : "进行中",
            updated: value.updated_at, episode: `REV ${value.revision}` }
        : item));
    current.put("title", value.name);
  }

  async function save() {
    if (!storage || !transport.updateProject || !project ||
      !Number.isSafeInteger(revision) || (revision ?? 0) < 1 ||
      loadedRevision !== revision || !dirty || busy || mustRead ||
      journal.kind !== "EMPTY" || inFlight.current) return;
    const name = draft.trim();
    if (!name || [...name].length > 80 || /[\u0000-\u001f\u007f]/.test(name)) {
      setNotice("项目名称需为 1 至 80 个字符，且不能含控制字符。");
      return;
    }
    if (name === project.name) { setDraft(name); return; }
    const request = ++epoch.current;
    inFlight.current = true;
    setBusy(true);
    setNotice("正在保存项目名称并从工作区读回…");
    const result = await updateManagedProject(transport, storage, projectId, {
      expectedRevision: revision!, name,
    });
    inFlight.current = false;
    if (epoch.current !== request) return;
    setBusy(false);
    setJournal(readProjectUpdateJournal(storage, projectId));
    if (result.kind === "APPLIED") {
      showProject(result.project);
      setDraft(result.project.name);
      setLoadedRevision(result.project.revision);
      setNotice("项目名称已保存并从本地工作区读回。");
    } else if (result.kind === "REJECTED") {
      if (result.project) showProject(result.project);
      setMustRead(true);
      setNotice(`项目更新被拒绝（${result.status} / ${result.code}）；草稿保留，请重新读取。`);
    } else if (result.kind === "UNKNOWN") {
      if (result.current) showProject(result.current);
      setNotice("更新结果未知；原操作已锁定，草稿保留。请只读核对，不能重复提交。");
    } else if (result.kind === "TRACKED") {
      setNotice("已有结果待核对的项目更新；未重复提交。");
    } else setNotice(result.message);
  }

  async function readCurrent(closePending: boolean) {
    if (!storage || inFlight.current) return;
    const request = ++epoch.current;
    inFlight.current = true;
    setBusy(true);
    const pending = readProjectUpdateJournal(storage, projectId);
    const result = pending.kind === "PENDING"
      ? closePending
        ? await closePendingProjectUpdate(transport, storage, projectId)
        : await readPendingProjectUpdate(transport, storage, projectId)
      : await (async () => {
        try {
          const response = await transport.getProject(projectId);
          const value = response.data;
          return value.id === projectId && Number.isSafeInteger(value.revision) &&
            value.revision > 0 && typeof value.name === "string"
            ? { kind: "CURRENT" as const, project: value, targetReached: false }
            : { kind: "UNKNOWN" as const };
        } catch { return { kind: "UNKNOWN" as const }; }
      })();
    inFlight.current = false;
    if (epoch.current !== request) return;
    setBusy(false);
    setJournal(readProjectUpdateJournal(storage, projectId));
    if (result.kind === "CURRENT") {
      showProject(result.project);
      if ((pending.kind === "EMPTY" && !dirty) ||
          (closePending && result.targetReached)) setDraft(result.project.name);
      setLoadedRevision(result.project.revision);
      setMustRead(false);
      setNotice(pending.kind === "PENDING"
        ? closePending
          ? "未知记录已结束；已读当前项目，无法归因原 PATCH。"
          : "已只读核对当前项目；原更新仍锁定，无法归因。"
        : dirty ? "已读到最新项目，未保存草稿仍保留；请核对后再提交。"
          : "已从本地工作区重新读取项目名称。");
    } else setNotice(result.kind === "UNAVAILABLE"
      ? result.message : "项目当前状态无法核实，仍阻止提交。");
  }

  return <div className="v2-source-name">
    <label>项目名称
      <input value={draft} disabled={!project || busy || journal.kind !== "EMPTY"}
        onChange={(event) => setDraft(event.target.value)} />
    </label>
    <div className="actions">
      <Button disabled={!dirty || busy || mustRead || loadedRevision !== revision ||
        journal.kind !== "EMPTY" ||
        !transport.updateProject || !storage || !Number.isSafeInteger(revision)}
        onClick={() => void save()}>保存项目名称</Button>
      <Button disabled={!dirty || busy} onClick={() => {
        if (project) setDraft(project.name);
        setNotice("已取消未保存的项目名称草稿。");
      }}>取消</Button>
      <Button disabled={busy || !storage} onClick={() => void readCurrent(false)}>
        重新读取
      </Button>
      {journal.kind === "PENDING" && <Button disabled={busy} onClick={() =>
        void readCurrent(true)}>核对并结束未知记录</Button>}
    </div>
    {!project && <p role="alert">当前项目记录尚未读取，不能修改名称。</p>}
    {!transport.updateProject &&
      <p role="alert">当前桌面版本缺少项目更新接口，不能保存名称。</p>}
    {!storage && <p role="alert">本地更新记录不可用，不能安全提交。</p>}
    {project && (!Number.isSafeInteger(revision) || (revision ?? 0) < 1) &&
      <p role="alert">项目修订号不可用，请重新读取项目。</p>}
    {project && loadedRevision !== revision &&
      <p role="alert">项目修订已变化，请先重新读取后核对草稿。</p>}
    {journal.kind === "BLOCKED" && <p role="alert">本地项目更新记录不可读取，已阻止保存。</p>}
    {journal.kind === "PENDING" && <p role="alert">已有结果未知的项目更新，不会自动重试。</p>}
    {notice && <p role="status">{notice}</p>}
  </div>;
}
function formatMicros(amount: number) {
  const text = String(Math.abs(amount)).padStart(7, "0");
  const whole = text.slice(0, -6);
  const fraction = text.slice(-6).replace(/0+$/, "");
  return `${amount < 0 ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}
function optionalText(value: string | undefined) {
  const text = value?.trim() ?? "";
  return text || null;
}
function uniqueLines(value: string | undefined, maximum = 32) {
  const entries = (value ?? "")
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return entries.length <= maximum &&
    entries.every((entry) => entry.length <= 240) &&
    new Set(entries).size === entries.length
    ? entries
    : null;
}
function EmotionCurve() {
  const plot = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 213, height: 110 });
  useLayoutEffect(() => {
    const element = plot.current;
    if (!element) return;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      if (width > 0 && height > 0)
        setSize((previous) =>
          previous.width === width && previous.height === height ? previous : { width, height },
        );
    };
    measure();
    const observer =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  const points = [0.8, 0.58, 0.68, 0.15, 0.47].map((value, index) => [
    2 + (index * (size.width - 4)) / 4,
    value * size.height,
  ]);
  return (
    <svg
      ref={plot}
      className="v2-emotion"
      viewBox={`0 0 ${size.width} ${size.height}`}
      aria-label="示例情绪曲线"
    >
      {[0, 0.5, 1].map((value) => (
        <line
          key={value}
          x1="0"
          y1={value * size.height}
          x2={size.width}
          y2={value * size.height}
          stroke="#173c59"
        />
      ))}
      <polyline
        points={points.map((point) => point.join(",")).join(" ")}
        stroke="#a685ff"
        strokeWidth="2.2"
        fill="none"
      />
      {points.map(([x, y]) => (
        <circle key={x} cx={x} cy={y} r="3.5" fill="#68d8ff" />
      ))}
    </svg>
  );
}
const checks = [
  "保留记忆交易的设定",
  "人物动机是否清楚",
  "是否采用开放结尾",
  "整体基调保持克制",
  "原文与推断分开标识",
];
const beats = [
  "发现异常记忆",
  "追查记忆黑市",
  "自己的过去被改写",
  "决定公开城市真相",
  "保留一段开放的未来",
];
const scriptLabels = ["场景描述", "苏晚", "动作", "程野", "剪辑意图"];
const scriptLines = [
  "雨水沿着屋檐落下。路面倒映着城市霓虹。苏晚在街角停住脚步。",
  "“这段记忆，从来不属于我。”",
  "她回头看向人群。程野站在光影交界处，迟迟没有开口。",
  "“记忆可以被修改，选择不能。”",
  "保留一拍停顿，再切城市反应空镜。",
];
export function StoryPages() {
  const d = useDemo();
  if (d.page === "script" && !d.isFixture) {
    const projectId = d.backendProjectId;
    const episodeId = d.selectedEpisodeId;
    const brief = d.productionBrief?.data;
    const briefVersionId = d.productionBriefState === "ready" &&
      brief?.project_id === projectId &&
      brief.head.latest_version_id === brief.version.id
        ? brief.version.id : null;
    return <EpisodeScriptEditor key={`${projectId ?? "none"}:${episodeId ?? "none"}`}
      projectId={projectId} episodeId={episodeId} briefVersionId={briefVersionId} />;
  }
  return <LegacyStoryPages />;
}

function LegacyStoryPages() {
  const d = useDemo();
  const live = useRef(d);
  live.current = d;
  const file = useRef<HTMLInputElement>(null);
  const [paste, setPaste] = useState(false);
  const [pastedText, setPastedText] = useState("");
  const pastedTextRef = useRef(pastedText);
  pastedTextRef.current = pastedText;
  useEffect(() => {
    if (d.page === "story" && !d.isFixture && d.backendProjectId)
      void d.readRealStoryWorkspace();
  }, [d.page, d.backendProjectId, d.isFixture]);
  const sourceVersion = d.value("sourceVersion", "1");
  const sourceNavigation = selectProductionSourceStage(d.sourceStage);
  const realSourcePage = d.page === "source" && !d.isFixture;
  const latestSource = d.sourceManifest?.data.project_id === d.backendProjectId
    ? d.sourceManifest.data.latest_version : null;
  const sourceDocumentInLatest = !!d.sourceDocument && !!latestSource?.content.documents.some(
    (document) => document.source_document_id === d.sourceDocument?.data.id,
  );
  const showSourceStage = () => {
    if (sourceNavigation.target === "story") d.go("story");
    else if (sourceNavigation.target) d.go("source");
  };
  const scene = Number(d.value("scriptScene", "8"));
  const previewStory = () =>
    d.setEditor({
      title: "星夜之城 · 故事插画",
      image: art.hero,
      images: [
        { src: art.hero, title: "星夜之城 · 故事插画" },
        { src: art.portraitFull, title: "苏晚 · 肖像原图" },
      ],
    });
  const viewEvidence = () =>
    d.setEditor({
      title: "原文依据 · 第一章",
      description: d.value("source"),
      presentation: "drawer",
    });
  function replaceSource(text: string) {
    d.put("source", text);
    d.put("sourceVersion", String(Number(sourceVersion) + 1));
    d.put("sourceApproved", "false");
    d.put("storyConfirmed", "false");
    checks.forEach((_, i) => d.put(`storyCheck${i}`, "false"));
  }
  async function importFile(file: File | undefined) {
    if (file) await d.importRealSource(file);
  }
  function reviewSource() {
    const reviewedSource = d.value("source");
    const reviewedProjectId = d.backendProjectId;
    const reviewedSourceId = d.sourceDocument?.data.id;
    const reviewedIdentity = reviewedProjectId
      ? sourceReviewIdentity(d.sourceManifest, reviewedProjectId) : null;
    d.setEditor({
      title: d.isFixture ? `来源审核 · v${sourceVersion}` :
        `来源审核 · V${latestSource?.version_number ?? "待核实"}`,
      description: reviewedSource,
      presentation: "drawer",
      confirm: "提交真实来源审核",
      validate: () => {
        const current = live.current;
        if (current.page !== "source" || current.scenario !== "normal")
          return "当前来源尚不可核对，请返回正常来源状态。";
        if (!current.value("source").trim()) return "请先选择或粘贴来源文本。";
        if (
          current.value("sourceVersion", "1") !== sourceVersion ||
          current.value("source") !== reviewedSource
        )
          return "来源已变化，请关闭抽屉并重新核对。";
        if (!current.isFixture) {
          const identity = current.backendProjectId
            ? sourceReviewIdentity(current.sourceManifest, current.backendProjectId) : null;
          if (!reviewedProjectId || !reviewedSourceId || !reviewedIdentity ||
              current.backendProjectId !== reviewedProjectId ||
              current.sourceStage.kind !== "draft" ||
              current.sourceDocument?.data.id !== reviewedSourceId ||
              !identity || identity.version_id !== reviewedIdentity.version_id ||
              identity.content_hash !== reviewedIdentity.content_hash ||
              identity.expected_revision !== reviewedIdentity.expected_revision)
            return "项目或待审核来源已变化；请关闭抽屉并重新核对。";
        }
      },
      save: () => {
        void d.reviewRealSource(reviewedIdentity ?? undefined, reviewedSourceId).then((submitted) => {
          if (submitted && d.isFixture) d.go("story");
        });
      },
    });
  }
  function confirmSourceBaseline() {
    const manifest = d.sourceManifest;
    const latest = manifest?.data.latest_version;
    const head = manifest?.data.head;
    const capturedIdentity: SourceManifestReviewIdentity | null =
      manifest &&
      latest &&
      head &&
      manifest.data.project_id === d.backendProjectId &&
      head.latest_version_id === latest.id &&
      head.review_version_id === latest.id
        ? {
            project_id: manifest.data.project_id,
            version_id: latest.id,
            content_hash: latest.content_hash,
            expected_revision: head.revision,
          }
        : null;
    if (!capturedIdentity || d.sourceStage.kind !== "review") {
      d.notify("当前来源审核目标已变化；请刷新来源状态后重新确认。");
      return;
    }
    d.setEditor({
      title: "确认来源审核基线",
      description: `将确认项目 ${capturedIdentity.project_id} 的版本 ${capturedIdentity.version_id}。内容哈希：${capturedIdentity.content_hash}；清单修订：${capturedIdentity.expected_revision}。`,
      presentation: "drawer",
      confirm: "确认来源审核基线",
      fields: [
        {
          key: "rationale",
          label: "确认理由（1 至 1000 个字符）",
          type: "textarea",
          value: "",
          required: true,
        },
      ],
      validate: () => {
        const current = live.current;
        const currentLatest = current.sourceManifest?.data.latest_version;
        const currentHead = current.sourceManifest?.data.head;
        if (
          current.page !== "source" ||
          current.backendProjectId !== capturedIdentity.project_id ||
          current.sourceStage.kind !== "review" ||
          !currentLatest ||
          !currentHead ||
          currentHead.latest_version_id !== capturedIdentity.version_id ||
          currentHead.review_version_id !== capturedIdentity.version_id ||
          currentLatest.content_hash !== capturedIdentity.content_hash ||
          currentHead.revision !== capturedIdentity.expected_revision
        )
          return "来源审核目标已变化；请关闭抽屉并重新核对。";
      },
      save: (data) => {
        const rationale = (data.rationale ?? "").trim();
        const rationaleLength = [...rationale].length;
        if (!rationaleLength || rationaleLength > 1000) {
          d.notify("确认理由需要是 1 至 1000 个字符。");
          return false;
        }
        void d.confirmRealSourceBaseline(capturedIdentity, rationale).then((confirmed) => {
          const current = live.current;
          if (current.backendProjectId !== capturedIdentity.project_id || current.page !== "source")
            return;
          d.notify(
            confirmed ? "来源审核基线已读回确认。" : "来源审核基线尚未确认；请刷新来源状态。",
          );
        });
      },
    });
  }
  function createOriginalBrief() {
    const openedProjectId = d.backendProjectId;
    d.setEditor({
      title: "保存原创灵感草稿",
      description:
        "这是创作简报草稿，不创建来源，也不表示故事已经完成。所有必填创作与交付信息都需由你确认。",
      confirm: "保存草稿",
      fields: [
        {
          key: "origin",
          label: "原创来源说明",
          type: "textarea",
          value: d.value("input"),
          required: true,
          max: 4000,
        },
        { key: "premise", label: "核心设定", type: "textarea", value: "", required: true },
        { key: "intent", label: "创作意图", type: "textarea", value: "", required: true },
        { key: "audience", label: "目标受众（可选）", value: "" },
        { key: "genre", label: "类型（可选）", value: "" },
        { key: "style", label: "风格（可选）", value: "" },
        { key: "constraints", label: "创作约束（每行一项，可选）", type: "textarea", value: "" },
        {
          key: "referenceKind",
          label: "参考类型（可选）",
          value: "",
          options: ["", "灵感", "研究", "其他"],
        },
        { key: "referenceDescription", label: "参考说明（可选）", type: "textarea", value: "" },
        { key: "width", label: "交付宽度", type: "number", value: "1080", required: true, min: 1 },
        { key: "height", label: "交付高度", type: "number", value: "1920", required: true, min: 1 },
        { key: "language", label: "交付语言", value: "zh-CN", required: true },
        {
          key: "frameRateNum",
          label: "帧率分子",
          type: "number",
          value: "24",
          required: true,
          min: 1,
        },
        {
          key: "frameRateDen",
          label: "帧率分母",
          type: "number",
          value: "1",
          required: true,
          min: 1,
        },
        {
          key: "seconds",
          label: "整部时长（秒，可选）",
          type: "number",
          value: "",
          min: 1,
        },
        {
          key: "episodeMode",
          label: "单集时长模式",
          value: "未指定",
          required: true,
          options: ["未指定", "按单集"],
        },
        { key: "episodeSeconds", label: "单集时长（秒）", type: "number", value: "", min: 1 },
        {
          key: "budgetState",
          label: "预算状态",
          value: "未知",
          required: true,
          options: ["未知", "已声明"],
        },
        { key: "budgetAmount", label: "预算金额", type: "number", value: "" },
        { key: "budgetCurrency", label: "预算币种", value: "" },
        {
          key: "rightsState",
          label: "权利状态",
          value: "尚未确认",
          required: true,
          options: ["尚未确认", "用户声明"],
        },
        { key: "rights", label: "权利声明", type: "textarea", value: "" },
      ],
      save: (data) => {
        if (openedProjectId && live.current.backendProjectId !== openedProjectId) {
          d.notify("项目已变化；请重新打开原创灵感草稿。");
          return false;
        }
        const width = Number(data.width);
        const height = Number(data.height);
        const workSeconds = data.seconds?.trim() ? Number(data.seconds) : null;
        const perEpisode = data.episodeMode === "按单集";
        const episodeSeconds = data.episodeSeconds?.trim() ? Number(data.episodeSeconds) : null;
        const language = data.language ?? "";
        const frameRateNum = Number(data.frameRateNum);
        const frameRateDen = Number(data.frameRateDen);
        const budgetDeclared = data.budgetState === "已声明";
        const budgetText = (data.budgetAmount ?? "").trim();
        const budgetMatch = /^(\d+)(?:\.(\d{1,6}))?$/.exec(budgetText);
        const budgetAmountMicros = budgetMatch
          ? Number(`${budgetMatch[1]}${(budgetMatch[2] ?? "").padEnd(6, "0")}`)
          : NaN;
        const budgetCurrency = data.budgetCurrency ?? "";
        const rightsDeclared = data.rightsState === "用户声明";
        const rights = data.rights ?? "";
        const constraints = uniqueLines(data.constraints);
        const referenceKind =
          ({ 灵感: "inspiration", 研究: "research", 其他: "other" } as const)[
            data.referenceKind ?? ""
          ] ?? "";
        const referenceDescription = optionalText(data.referenceDescription);
        const optionalCreative = [data.audience, data.genre, data.style].every(
          (value) => optionalText(value) === null || optionalText(value)!.length <= 240,
        );
        if (
          !Number.isSafeInteger(width) ||
          !Number.isSafeInteger(height) ||
          width < 1 ||
          height < 1 ||
          (workSeconds !== null && (!Number.isSafeInteger(workSeconds) || workSeconds < 1)) ||
          (perEpisode &&
            (episodeSeconds === null ||
              !Number.isSafeInteger(episodeSeconds) ||
              episodeSeconds < 1)) ||
          (!perEpisode && episodeSeconds !== null) ||
          !language.trim() ||
          !Number.isSafeInteger(frameRateNum) ||
          !Number.isSafeInteger(frameRateDen) ||
          frameRateNum < 1 ||
          frameRateDen < 1 ||
          frameRateDen > 2_147_483_647 ||
          (budgetDeclared &&
            (!Number.isSafeInteger(budgetAmountMicros) ||
              !/^[A-Z]{3}$/.test(budgetCurrency.trim()))) ||
          (rightsDeclared && !rights.trim()) ||
          constraints === null ||
          !optionalCreative ||
          !!referenceKind !== !!referenceDescription ||
          (referenceDescription !== null && referenceDescription.length > 4_000) ||
          (referenceKind !== "" && !["inspiration", "research", "other"].includes(referenceKind))
        ) {
          d.notify("请填写有效的交付信息；已声明预算还需要金额和币种。");
          return false;
        }
        const divisor = (left: number, right: number): number =>
          right === 0 ? left : divisor(right, left % right);
        const aspectDivisor = divisor(width, height);
        const frameRateDivisor = divisor(frameRateNum, frameRateDen);
        if (d.pendingProductionBrief) {
          d.notify("上次草稿保存结果待确认；请先显式恢复原操作。");
          return false;
        }
        const version = d.productionBrief?.data.version;
        const command = {
          operation_id: crypto.randomUUID(),
          input: {
            parent_version_id: version?.id ?? null,
            expected_revision: d.productionBrief?.data.head.revision ?? null,
            change_summary: "保存原创灵感草稿",
            content: {
              schema_version: "1.0.0",
              creative_entry: {
                kind: "original_idea",
                origin_statement: data.origin,
                references: referenceKind
                  ? [{ reference_kind: referenceKind, description: referenceDescription }]
                  : [],
              },
              creative: {
                premise: data.premise,
                intent: data.intent,
                audience: optionalText(data.audience),
                genre: optionalText(data.genre),
                style: optionalText(data.style),
                constraints,
              },
              delivery: {
                width_px: width,
                height_px: height,
                language: language.trim(),
                display_aspect_ratio: { num: width / aspectDivisor, den: height / aspectDivisor },
                frame_rate: {
                  num: frameRateNum / frameRateDivisor,
                  den: frameRateDen / frameRateDivisor,
                },
              },
              duration_intent: {
                episode_mode: perEpisode ? "per_episode" : "unspecified",
                work_seconds: workSeconds,
                episode_seconds: perEpisode ? episodeSeconds : null,
              },
              budget_intent: budgetDeclared
                ? {
                    state: "declared",
                    amount_micros: budgetAmountMicros,
                    currency: budgetCurrency.trim(),
                  }
                : { state: "unknown", amount_micros: null, currency: null },
              rights_declaration: rightsDeclared
                ? { state: "user_declared", statement: rights.trim() }
                : { state: "unknown", statement: null },
            },
          },
        } as ProductionBriefCreateCommand;
        void d.saveProductionBrief(command).then((outcome) => {
          if (outcome.kind === "SUCCEEDED")
            d.notify("原创灵感已保存为创作简报草稿；尚未完成故事。");
          else if (outcome.kind === "REMOTE_UNKNOWN")
            d.notify("草稿保存结果待确认；请显式恢复原操作。");
          else d.notify("草稿未保存，请核对输入后重试。");
        });
      },
    });
  }
  function createAdaptationBrief() {
    const openedProjectId = d.backendProjectId;
    const accepted = d.sourceManifest?.data.accepted_version;
    const document = accepted?.content.documents.find(
      (item) => item.source_document_id === d.sourceDocument?.data.id,
    );
    if (d.sourceStage.kind !== "approved" || !accepted || !document) {
      d.notify("请先选择当前已批准来源及其清单区块。");
      return;
    }
    d.setEditor({
      title: "保存来源改编草稿",
      description: `仅可选用当前已批准清单中的区块；可选焦点序号：${document.blocks
        .map((block) => block.ordinal)
        .join("、")}。保存草稿不会确认来源审核或故事。`,
      confirm: "保存草稿",
      fields: [
        { key: "adaptation", label: "改编说明", type: "textarea", value: "", required: true },
        {
          key: "blocks",
          label: "焦点区块序号（逗号分隔，1 至 100 个）",
          type: "textarea",
          value: "",
          required: true,
        },
        { key: "premise", label: "核心设定", type: "textarea", value: "", required: true },
        { key: "intent", label: "创作意图", type: "textarea", value: "", required: true },
        { key: "audience", label: "目标受众（可选）", value: "" },
        { key: "genre", label: "类型（可选）", value: "" },
        { key: "style", label: "风格（可选）", value: "" },
        { key: "constraints", label: "创作约束（每行一项，可选）", type: "textarea", value: "" },
        { key: "width", label: "交付宽度", type: "number", value: "1080", required: true, min: 1 },
        { key: "height", label: "交付高度", type: "number", value: "1920", required: true, min: 1 },
        { key: "language", label: "交付语言", value: "zh-CN", required: true },
        {
          key: "frameRateNum",
          label: "帧率分子",
          type: "number",
          value: "24",
          required: true,
          min: 1,
        },
        {
          key: "frameRateDen",
          label: "帧率分母",
          type: "number",
          value: "1",
          required: true,
          min: 1,
        },
        {
          key: "seconds",
          label: "整部时长（秒，可选）",
          type: "number",
          value: "",
          min: 1,
        },
        {
          key: "episodeMode",
          label: "单集时长模式",
          value: "未指定",
          required: true,
          options: ["未指定", "按单集"],
        },
        { key: "episodeSeconds", label: "单集时长（秒）", type: "number", value: "", min: 1 },
        {
          key: "budgetState",
          label: "预算状态",
          value: "尚未确认",
          required: true,
          options: ["尚未确认", "已声明"],
        },
        { key: "budgetAmount", label: "预算金额（最多 6 位小数）", type: "number", value: "" },
        { key: "budgetCurrency", label: "预算币种（ISO 3 位大写）", value: "" },
        {
          key: "rightsState",
          label: "权利状态",
          value: "尚未确认",
          required: true,
          options: ["尚未确认", "用户声明"],
        },
        { key: "rights", label: "权利声明", type: "textarea", value: "" },
      ],
      save: (data) => {
        const currentAccepted = live.current.sourceManifest?.data.accepted_version;
        if (
          (openedProjectId && live.current.backendProjectId !== openedProjectId) ||
          live.current.sourceStage.kind !== "approved" ||
          currentAccepted?.id !== accepted.id ||
          live.current.sourceDocument?.data.id !== document.source_document_id
        ) {
          d.notify("来源或审核清单已变化；请重新选择改编焦点。");
          return false;
        }
        const blocks = data.blocks ?? "";
        const adaptation = data.adaptation ?? "";
        const premise = data.premise ?? "";
        const intent = data.intent ?? "";
        const language = data.language ?? "";
        const rights = data.rights ?? "";
        const constraints = uniqueLines(data.constraints);
        const optionalCreative = [data.audience, data.genre, data.style].every(
          (value) => optionalText(value) === null || optionalText(value)!.length <= 240,
        );
        const rightsDeclared = data.rightsState === "用户声明";
        const budgetDeclared = data.budgetState === "已声明";
        const budgetMatch = /^(\d+)(?:\.(\d{1,6}))?$/.exec((data.budgetAmount ?? "").trim());
        const budgetMicros = budgetMatch
          ? Number(`${budgetMatch[1]}${(budgetMatch[2] ?? "").padEnd(6, "0")}`)
          : NaN;
        const budgetCurrency = (data.budgetCurrency ?? "").trim();
        const ordinals = blocks
          .split(",")
          .map((item) => Number(item.trim()))
          .filter(Number.isInteger);
        const selected = ordinals.map((ordinal) =>
          document.blocks.find((block) => block.ordinal === ordinal),
        );
        const unique = new Set(ordinals);
        const width = Number(data.width);
        const height = Number(data.height);
        const workSeconds = data.seconds?.trim() ? Number(data.seconds) : null;
        const perEpisode = data.episodeMode === "按单集";
        const episodeSeconds = data.episodeSeconds?.trim() ? Number(data.episodeSeconds) : null;
        const frameRateNum = Number(data.frameRateNum);
        const frameRateDen = Number(data.frameRateDen);
        if (
          ordinals.length < 1 ||
          ordinals.length > 100 ||
          unique.size !== ordinals.length ||
          selected.some((block) => !block) ||
          !Number.isSafeInteger(width) ||
          !Number.isSafeInteger(height) ||
          width < 1 ||
          height < 1 ||
          (workSeconds !== null && (!Number.isSafeInteger(workSeconds) || workSeconds < 1)) ||
          (perEpisode &&
            (episodeSeconds === null ||
              !Number.isSafeInteger(episodeSeconds) ||
              episodeSeconds < 1)) ||
          (!perEpisode && episodeSeconds !== null) ||
          !language.trim() ||
          !Number.isSafeInteger(frameRateNum) ||
          !Number.isSafeInteger(frameRateDen) ||
          frameRateNum < 1 ||
          frameRateDen < 1 ||
          frameRateDen > 2_147_483_647 ||
          !adaptation.trim() ||
          !premise.trim() ||
          !intent.trim() ||
          (rightsDeclared && !rights.trim()) ||
          constraints === null ||
          !optionalCreative ||
          (budgetDeclared &&
            (!Number.isSafeInteger(budgetMicros) || !/^[A-Z]{3}$/.test(budgetCurrency)))
        ) {
          d.notify("请只选择当前已批准清单中的 1 至 100 个不重复区块，并填写有效交付信息。");
          return false;
        }
        const gcd = (left: number, right: number): number =>
          right ? gcd(right, left % right) : left;
        const divisor = gcd(width, height);
        const frameRateDivisor = gcd(frameRateNum, frameRateDen);
        const version = d.productionBrief?.data.version;
        const command = {
          operation_id: crypto.randomUUID(),
          input: {
            parent_version_id: version?.id ?? null,
            expected_revision: d.productionBrief?.data.head.revision ?? null,
            change_summary: "保存来源改编草稿",
            content: {
              schema_version: "1.0.0",
              creative_entry: {
                kind: "source_adaptation",
                adaptation_statement: adaptation,
                source_document_id: document.source_document_id,
                source_manifest_version_id: accepted.id,
                source_block_ids: selected.map((block) => block!.source_block_id),
              },
              creative: {
                premise,
                intent,
                audience: optionalText(data.audience),
                genre: optionalText(data.genre),
                style: optionalText(data.style),
                constraints,
              },
              delivery: {
                width_px: width,
                height_px: height,
                language: language.trim(),
                display_aspect_ratio: { num: width / divisor, den: height / divisor },
                frame_rate: {
                  num: frameRateNum / frameRateDivisor,
                  den: frameRateDen / frameRateDivisor,
                },
              },
              duration_intent: {
                episode_mode: perEpisode ? "per_episode" : "unspecified",
                work_seconds: workSeconds,
                episode_seconds: perEpisode ? episodeSeconds : null,
              },
              budget_intent: budgetDeclared
                ? { state: "declared", amount_micros: budgetMicros, currency: budgetCurrency }
                : { state: "unknown", amount_micros: null, currency: null },
              rights_declaration: rightsDeclared
                ? { state: "user_declared", statement: rights.trim() }
                : { state: "unknown", statement: null },
            },
          },
        } satisfies ProductionBriefCreateCommand;
        void d
          .saveProductionBrief(command)
          .then((outcome) =>
            d.notify(
              outcome.kind === "SUCCEEDED"
                ? "来源改编已保存为创作简报草稿。"
                : "草稿保存结果待确认；请显式恢复原操作。",
            ),
          );
      },
    });
  }
  useEffect(() => {
    if (d.page !== "source" || d.value("c3DraftIntent") !== "original") return;
    d.put("c3DraftIntent", "");
    createOriginalBrief();
  }, [d.page]);
  function confirmStory() {
    const snapshot = (current: typeof d) =>
      JSON.stringify(
        [
          "source",
          "sourceVersion",
          "summary",
          "conflict",
          ...checks.map((_, i) => `storyCheck${i}`),
          ...beats.map((_, i) => `event-${i}`),
        ].map((key) => current.value(key)),
      );
    const reviewedContent = snapshot(d);
    d.setEditor({
      title: "确认故事理解",
      description: "核对当前来源和五项故事设定。确认后进入角色与世界；仅改变本次演示状态。",
      presentation: "drawer",
      confirm: "确认并进入角色",
      validate: () => {
        const current = live.current;
        if (current.page !== "story" || current.scenario !== "normal")
          return "当前故事尚不可核对，请返回正常故事状态。";
        if (
          current.value("sourceApproved") !== "true" ||
          current.value("storySourceVersion") !== current.value("sourceVersion", "1")
        )
          return "请先回到来源页审核当前版本。";
        const missing = checks.filter(
          (_, i) => current.value(`storyCheck${i}`, i === 0 ? "true" : "false") !== "true",
        );
        if (missing.length) return `请先核对以下设定：${missing.join("、")}。`;
        if (snapshot(current) !== reviewedContent) return "故事内容已变化，请关闭抽屉并重新核对。";
      },
      save: () => {
        d.put("storyConfirmed", "true");
        d.go("characters");
      },
    });
  }
  const summary = d.value(
    "summary",
    "在记忆可以交易的未来城市，苏晚追查一段不属于自己的记忆，逐渐发现整座城市的秘密。",
  );
  const conflict = d.value(
    "conflict",
    "真实记忆与人造记忆之间：追寻真相，是否意味着放弃被编造的幸福？",
  );
  const briefContent = d.productionBrief?.data.version.content;
  const adaptationNeedsRecheck =
    briefContent?.creative_entry.kind === "source_adaptation" &&
    (d.sourceStage.kind !== "approved" ||
      d.sourceManifest?.data.accepted_version?.id !==
        briefContent.creative_entry.source_manifest_version_id ||
      d.sourceDocument?.data.id !== briefContent.creative_entry.source_document_id);
  return (
    <>
      <PageTitle
        actions={
          <>
            {d.page === "story" && (
              <Button icon="expand" data-preview="true" onClick={previewStory}>
                大屏预览
              </Button>
            )}
            <Button onClick={viewEvidence}>查看原文</Button>
          </>
        }
      />
      {d.page === "story" && (
        <p className="v2-source-support" role="status">
          来源状态：{sourceNavigation.status}。
          {sourceNavigation.baselineNote ?? "当前状态来自本地工作区。"}
          {!d.isFixture && " 下方故事卡片为演示内容，尚无真实故事设定确认接口。"}
          {d.storyWorkspaceState === "loading"
            ? " 正在读取故事工作区。"
            : d.storyWorkspaceState === "error"
              ? " 当前状态读取失败，请稍后重试。"
              : ""}
          {sourceNavigation.target && (
            <Button onClick={showSourceStage}>
              {sourceNavigation.target === "source-review"
                ? "返回来源审核"
                : sourceNavigation.label}
            </Button>
          )}
        </p>
      )}
      {d.page === "story" && (
        <SourceExtractionPanel
          projectId={d.backendProjectId}
          sourceManifest={d.sourceManifest}
          sourceDocumentId={d.sourceDocument?.data.id ?? null}
          sourceApproved={d.sourceStage.kind === "approved" && !d.isFixture}
        />
      )}
      {d.page === "source" ? (
        <div className="v2-source-body">
          <Card title="外部原文或原创灵感" className="v2-source-entry">
            <div className="v2-source-tabs">
              <Button aria-pressed={!paste} onClick={() => setPaste(false)}>
                导入文本
              </Button>
              <Button aria-pressed={paste} onClick={() => setPaste(true)}>
                粘贴故事
              </Button>
            </div>
            {paste ? (
              <textarea
                className="v2-source-drop v2-source-editor"
                aria-label="外部原文正文"
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
              />
            ) : (
              <div
                className="v2-source-drop"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  void importFile(e.dataTransfer.files[0]);
                }}
              >
                <Icon name="export" size={40} />
                <h3>将小说或剧本拖到这里</h3>
                <p>仅支持 UTF-8 TXT；通过本地工作区导入，来源审核前不会推进故事。</p>
                <Button onClick={() => file.current?.click()}>
                  {d.isFixture ? "选择样例文本" : "选择本地文本"}
                </Button>
              </div>
            )}
            {paste && (
              <div className="actions">
                <Button
                  disabled={d.sourceImportState.kind === "pending"}
                  onClick={() => {
                    const submittedText = pastedText;
                    void d.importPastedSource(submittedText).then((result) => {
                      if (
                        result.kind === "SUCCEEDED" &&
                        pastedTextRef.current === submittedText &&
                        live.current.sourceDocument?.data.id === result.response.data.id
                      )
                        setPastedText("");
                    });
                  }}
                >
                  作为外部原文导入
                </Button>
                <Button onClick={createOriginalBrief}>原创灵感</Button>
              </div>
            )}
            <p className="v2-source-support" role="status" aria-live="polite">
              {d.sourceImportState.kind === "pending"
                ? "正在保存来源，并等待项目工作区读回确认。"
                : d.sourceImportState.kind === "saved"
                  ? `来源已保存并读回确认：${d.sourceImportState.filename}`
                  : d.sourceImportState.kind === "invalid"
                    ? `来源未保存：${d.sourceImportState.message}`
                    : d.sourceImportState.kind === "unknown"
                      ? `来源保存结果未知：${d.sourceImportState.message}`
                      : "来源导入只负责保存原文；来源审核和故事生成是后续独立步骤。"}
            </p>
            <div className="actions">
              <Button onClick={createAdaptationBrief}>基于已批准来源改编</Button>
            </div>
            <input
              ref={file}
              type="file"
              className="sr-only"
              aria-label="替换原文文件"
              accept=".txt,text/plain"
              onChange={(e) => void importFile(e.target.files?.[0])}
            />
            {d.isFixture ? <label className="v2-source-name">
              项目名称（样例）
              <input value={d.value("title")} onChange={(e) => d.put("title", e.target.value)} />
            </label> : d.backendProjectId &&
              <ProjectNameEditor key={d.backendProjectId} projectId={d.backendProjectId} />}
            <p className="v2-source-support">
              外部原文会由本地工作区摄取；原创灵感不创建来源。审核结果未知时不会自动重试。
            </p>
            {d.productionBrief && (
              <details className="v2-source-support" open>
                <summary>
                  已读取创作简报 V{d.productionBrief.data.version.version_number}：
                  {d.productionBrief.data.version.content.creative_entry.kind ===
                  "source_adaptation"
                    ? "来源改编"
                    : "原创灵感"}
                </summary>
                <dl>
                  <dt>创作说明</dt>
                  <dd>
                    {briefContent?.creative_entry.kind === "original_idea"
                      ? briefContent.creative_entry.origin_statement
                      : briefContent?.creative_entry.adaptation_statement}
                  </dd>
                  <dt>核心设定与意图</dt>
                  <dd>
                    {briefContent?.creative.premise}；{briefContent?.creative.intent}
                  </dd>
                  <dt>创作信息</dt>
                  <dd>
                    受众：{briefContent?.creative.audience ?? "未指定"}；类型：
                    {briefContent?.creative.genre ?? "未指定"}；风格：
                    {briefContent?.creative.style ?? "未指定"}
                    {briefContent?.creative.constraints?.length
                      ? `；约束：${briefContent.creative.constraints.join("、")}`
                      : "；约束：无"}
                  </dd>
                  {briefContent?.creative_entry.kind === "original_idea" && (
                    <>
                      <dt>参考资料</dt>
                      <dd>
                        {briefContent.creative_entry.references.length
                          ? briefContent.creative_entry.references
                              .map((reference) => {
                                const kind =
                                  reference.reference_kind === "inspiration"
                                    ? "灵感"
                                    : reference.reference_kind === "research"
                                      ? "研究"
                                      : "其他";
                                return `${kind}：${reference.description}`;
                              })
                              .join("；")
                          : "无"}
                      </dd>
                    </>
                  )}
                  <dt>交付</dt>
                  <dd>
                    {briefContent?.delivery.width_px} × {briefContent?.delivery.height_px}，
                    {briefContent?.delivery.language}，画幅{" "}
                    {briefContent?.delivery.display_aspect_ratio.num}/
                    {briefContent?.delivery.display_aspect_ratio.den}，帧率{" "}
                    {briefContent?.delivery.frame_rate.num}/{briefContent?.delivery.frame_rate.den}{" "}
                    fps
                  </dd>
                  <dt>时长</dt>
                  <dd>
                    整部：{briefContent?.duration_intent.work_seconds ?? "尚未确认"} 秒；
                    {briefContent?.duration_intent.episode_mode === "per_episode"
                      ? `按单集：${briefContent.duration_intent.episode_seconds} 秒`
                      : "单集时长未指定"}
                  </dd>
                  <dt>预算与权利</dt>
                  <dd>
                    {briefContent?.budget_intent.state === "declared" &&
                    typeof briefContent.budget_intent.amount_micros === "number" &&
                    briefContent.budget_intent.currency
                      ? `${briefContent.budget_intent.currency} ${formatMicros(briefContent.budget_intent.amount_micros)}（已声明）`
                      : briefContent?.budget_intent.state === "declared"
                        ? "预算声明不完整"
                        : "预算尚未确认"}
                    ；
                    {briefContent?.rights_declaration.state === "user_declared"
                      ? briefContent.rights_declaration.statement
                      : "权利尚未确认"}
                  </dd>
                  {briefContent?.creative_entry.kind === "source_adaptation" && (
                    <>
                      <dt>来源焦点</dt>
                      <dd>
                        <span>
                          来源清单版本：{briefContent.creative_entry.source_manifest_version_id}
                        </span>
                        <br />
                        <span>来源文档：{briefContent.creative_entry.source_document_id}</span>
                        <br />
                        <span>
                          焦点区块：{briefContent.creative_entry.source_block_ids.join("、")}
                        </span>
                      </dd>
                    </>
                  )}
                </dl>
                <p role="status">
                  {adaptationNeedsRecheck
                    ? "当前来源已变化，改编草稿需要重新核对焦点后才能保存新版本。"
                    : "当前来源与改编焦点一致。"}
                </p>
              </details>
            )}
            {d.pendingProductionBrief && (
              <div className="actions">
                <Button
                  onClick={() =>
                    void d
                      .recoverProductionBrief()
                      .then((outcome) =>
                        d.notify(
                          outcome.kind === "SUCCEEDED"
                            ? "原草稿操作已确认。"
                            : "原草稿操作仍待确认；未创建新操作。",
                        ),
                      )
                  }
                >
                  恢复原草稿操作
                </Button>
              </div>
            )}
          </Card>
          <div className="v2-source-side">
            <Card title="来源预览" className="v2-source-preview">
              <div className="v2-source-excerpt">
                {d.scenario === "empty" ? "尚未选择文本。" : d.value("source")}
              </div>
              <Pill tone={d.value("importedName") || !d.isFixture ? "" : "v2-source-built-in"}>
                {d.value("importedName", d.isFixture ? "内置文本 · 样例" : "尚未导入真实来源")}
              </Pill>
              <p className="v2-source-support" role="status">
                来源状态：{sourceNavigation.status}。
                {sourceNavigation.baselineNote ?? "尚未收到可用来源版本。"}
              </p>
              <div className="actions">
                <Button onClick={() => void d.refreshRealSourceStage()}>刷新来源状态</Button>
                {d.sourceStage.kind === "review" && (
                  <Button onClick={confirmSourceBaseline}>确认来源审核基线</Button>
                )}
                {sourceNavigation.target && (d.isFixture || sourceNavigation.target === "story") && (
                  <Button onClick={showSourceStage}>{sourceNavigation.label}</Button>
                )}
              </div>
            </Card>
            <Card title="隐私边界" icon="review">
              <p>提交后会由本地工作区核对来源；尚未接受的版本会保持待审状态。</p>
              <button
                className="text-button v2-source-reset"
                onClick={() => {
                  if (d.backendProjectId && !d.isFixture) {
                    d.notify("真实项目来源不能恢复内置样例；请使用导入或粘贴保存新来源。");
                    return;
                  }
                  replaceSource(sourceText);
                  d.put("importedName", "");
                }}
              >
                恢复内置样例
              </button>
            </Card>
          </div>
        </div>
      ) : d.page === "story" ? (
        <div className="v2-story-body">
          <div className="v2-story-top">
            <button className="v2-story-hero" aria-label="预览故事插画" onClick={previewStory}>
              {d.scenario === "empty" ? (
                <span>尚无故事插画</span>
              ) : (
                <img src={art.hero} alt="星夜之城：雨夜中相遇的苏晚与程野" />
              )}
            </button>
            <div className="v2-story-keys">
              <Card title="故事一句话" icon="spark">
                <button
                  className="v2-story-copy"
                  onClick={() =>
                    d.edit("编辑故事一句话", [
                      {
                        key: "summary",
                        label: "故事一句话",
                        type: "textarea",
                        value: summary,
                        required: true,
                      },
                    ])
                  }
                >
                  {summary}
                </button>
                <div className="v2-story-tags">
                  <Pill>近未来</Pill>
                  <Pill>记忆交易</Pill>
                  <Pill>人物成长</Pill>
                </div>
              </Card>
              <Card title="核心冲突" icon="globe">
                <button
                  className="v2-story-copy"
                  onClick={() =>
                    d.edit("编辑核心冲突", [
                      {
                        key: "conflict",
                        label: "核心冲突",
                        type: "textarea",
                        value: conflict,
                        required: true,
                      },
                    ])
                  }
                >
                  {conflict}
                </button>
                <div className="v2-story-tags">
                  <Pill>身份认同</Pill>
                  <Pill>真实与选择</Pill>
                </div>
              </Card>
            </div>
          </div>
          <div className="v2-story-bottom">
            <Card title="主要人物" icon="users">
              <div className="v2-story-people">
                {d.characters.slice(0, 3).map((person, i) => (
                  <button
                    key={person.id}
                    onClick={() => {
                      d.setSelectedCharacter(person.id);
                      d.go("character");
                    }}
                  >
                    <img src={person.image} alt="" />
                    <span>
                      <strong>{person.name}</strong>
                      <small>
                        {
                          [
                            "记忆修复师 · 追寻真相",
                            "神经工程师 · 隐藏过去",
                            "记忆集团顾问 · 关键对手",
                          ][i]
                        }
                      </small>
                    </span>
                  </button>
                ))}
              </div>
              <button className="v2-card-bottom-link" onClick={() => d.go("characters")}>
                {"查看角色关系　›"}
              </button>
            </Card>
            <Card title="剧情结构" icon="book">
              <ol className="v2-story-beats">
                {beats.map((line, i) => (
                  <li key={line}>
                    <b>{i + 1}</b>
                    <span>{["开端", "发展", "转折", "高潮", "结局"][i]}</span>
                    <button
                      onClick={() =>
                        d.edit("修改剧情事件", [
                          {
                            key: `event-${i}`,
                            label: "事件内容",
                            value: d.value(`event-${i}`, line),
                            required: true,
                          },
                        ])
                      }
                    >
                      {d.value(`event-${i}`, line)}
                    </button>
                  </li>
                ))}
              </ol>
            </Card>
            <Card title="情绪曲线" icon="spark">
              <EmotionCurve />
              <small className="v2-card-bottom-link">示例节奏 · 非质量评分</small>
            </Card>
            <Card title="待你确认" icon="review">
              <div className="v2-story-checks">
                {checks.map((label, i) => (
                  <label key={label}>
                    <input
                      type="checkbox"
                      checked={d.value(`storyCheck${i}`, i === 0 ? "true" : "false") === "true"}
                      onChange={(e) => {
                        d.put(`storyCheck${i}`, String(e.target.checked));
                        d.put("storyConfirmed", "false");
                      }}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </Card>
          </div>
        </div>
      ) : (
        <div className="v2-script-body">
          <Card title="场次" className="v2-script-index">
            <div className="v2-script-scene-list">
              {[
                1,
                2,
                3,
                8,
                ...Array.from({ length: Number(d.value("extraScenes", "0")) }, (_, i) => 9 + i),
              ].map((id) => (
                <Button
                  key={id}
                  aria-pressed={scene === id}
                  onClick={() => d.put("scriptScene", String(id))}
                >
                  {String(id).padStart(2, "0")} ·{" "}
                  {(
                    {
                      1: "记忆修复中心",
                      2: "城市街口",
                      3: "地下记忆市场",
                      8: "雨夜街道",
                    } as Record<number, string>
                  )[id] ?? "新场次"}
                </Button>
              ))}
            </div>
            <button
              className="v2-extra-scene text-button"
              onClick={() => {
                const count = Number(d.value("extraScenes", "0")) + 1;
                d.put("extraScenes", String(count));
                d.put("scriptScene", String(count + 8));
              }}
            >
              新增场次
            </button>
          </Card>
          <Card
            title={`场次 ${String(scene).padStart(2, "0")} · ${scene === 8 ? "雨夜街道 · 夜 / 外" : "故事场景"}`}
            icon="film"
            className="v2-script-paper"
          >
            <p className="v2-script-provenance">演示剧本 · 所有对白与场次均为样例</p>
            <div className="v2-script-lines">
              {scriptLabels.map((label, i) => (
                <label key={label}>
                  {label}
                  <textarea
                    aria-label={i === 0 ? "场次动作" : i === 1 ? "对白编辑" : label}
                    value={d.value(`script-${scene}-${i}`, scriptLines[i])}
                    onChange={(e) => {
                      d.put(`script-${scene}-${i}`, e.target.value);
                      d.put("scriptSaved", "false");
                    }}
                  />
                </label>
              ))}
            </div>
          </Card>
        </div>
      )}
      <FlowFooter
        secondaryLabel="哪里不对？"
        secondaryAction={() =>
          d.focusAssistant(
            `修改当前${d.page === "source" ? "来源" : d.page === "story" ? "故事理解" : "剧本"}：`,
          )
        }
        label={
          d.page === "source"
            ? !realSourcePage ? "开始理解故事"
              : d.sourceStage.kind === "draft" ? "提交来源审核"
              : d.sourceStage.kind === "review" ? "确认来源审核基线"
              : d.sourceStage.kind === "approved" ? "查看故事工作区"
              : "来源暂不可推进"
            : d.page === "story"
              ? d.isFixture ? "确认故事理解" : "故事设定确认未接入"
              : "确认样例剧本"
        }
        reason={
          d.page === "source"
            ? !realSourcePage ? "当前选择：内置故事样例"
              : d.sourceStage.kind === "draft" && !sourceDocumentInLatest
                ? "尚未核实当前来源文档与最新清单一致"
                : `真实来源状态：${sourceNavigation.status}；审核与批准以本地清单读回为准`
            : d.page === "story"
              ? d.isFixture ? "样例初稿 · 确认仅改变演示状态"
                : "故事卡片为演示内容；来源批准状态以本地清单读回为准"
              : "剧本文本可局部滚动 · 画布与操作栏固定"
        }
        disabled={(d.page === "story" && !d.isFixture) ||
          d.page === "source" && (realSourcePage
          ? d.sourceStage.kind === "draft"
            ? !sourceDocumentInLatest || !d.value("source").trim() ||
              d.sourceImportState.kind === "pending" || d.sourceImportState.kind === "unknown"
            : d.sourceStage.kind !== "review" && d.sourceStage.kind !== "approved"
          : !d.value("source").trim())}
        action={
          d.page === "source"
            ? !realSourcePage || d.sourceStage.kind === "draft" ? reviewSource
              : d.sourceStage.kind === "review" ? confirmSourceBaseline
              : d.sourceStage.kind === "approved" ? () => d.go("story") : () => {}
            : d.page === "story"
              ? d.isFixture ? confirmStory : () => {}
              : () => {
                  d.put("scriptSaved", "true");
                  d.notify("剧本演示版本已确认");
                }
        }
      />
    </>
  );
}

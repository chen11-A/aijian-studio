import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { App } from "./App";
import type {
  HealthResponse,
  ProjectData,
  SourceDocumentListResponse,
  SourceDocumentResponse,
  SourceManifestResponse,
  StoryBibleIndexResponse,
  StoryBibleVersionResponse,
  StudioTransport,
  TaskQueueResponse,
  TimelineResponse,
} from "./api/studio";

type StoryBibleResponse = StoryBibleVersionResponse;

const requestId = "9e049ad6-2b22-4e2d-8d48-e5bd78ee0e11";
const healthyResponse: HealthResponse = {
  data: { status: "ok", service: "aijian-api", version: "0.1.0" },
  request_id: requestId,
};
const project: ProjectData = {
  id: `prj_${"a".repeat(32)}`,
  name: "雾城来信",
  aspect_ratio: "9:16",
  target_duration_seconds: 90,
  source_language: "zh-CN",
  status: "active",
  revision: 1,
  created_at: "2026-08-03T03:00:00Z",
  updated_at: "2026-08-03T03:00:00Z",
};
const sourceResponse: SourceDocumentResponse = {
  data: {
    id: `src_${"b".repeat(32)}`,
    project_id: project.id,
    filename: "雾城来信.txt",
    media_type: "text/plain",
    encoding: "utf-8",
    byte_size: 28,
    raw_sha256: "c".repeat(64),
    imported_at: "2026-08-03T03:10:00Z",
    chapter_count: 1,
    block_count: 2,
    blocks: [
      {
        id: `srcb_${"d".repeat(32)}`,
        ordinal: 0,
        kind: "chapter_heading",
        chapter_index: 1,
        text: "第一章 初见",
        normalized_start_byte: 0,
        normalized_end_byte: 16,
        content_sha256: "e".repeat(64),
      },
      {
        id: `srcb_${"f".repeat(32)}`,
        ordinal: 1,
        kind: "paragraph",
        chapter_index: 1,
        text: "雨落在霓虹灯下。",
        normalized_start_byte: 17,
        normalized_end_byte: 41,
        content_sha256: "1".repeat(64),
      },
    ],
  },
  request_id: requestId,
};
const sourceSummary: SourceDocumentListResponse["data"][number] = {
  id: sourceResponse.data.id,
  project_id: sourceResponse.data.project_id,
  filename: sourceResponse.data.filename,
  media_type: sourceResponse.data.media_type,
  encoding: sourceResponse.data.encoding,
  byte_size: sourceResponse.data.byte_size,
  raw_sha256: sourceResponse.data.raw_sha256,
  imported_at: sourceResponse.data.imported_at,
  chapter_count: sourceResponse.data.chapter_count,
  block_count: sourceResponse.data.block_count,
};
const fakeTimelineResponse = {
  data: {
    project_id: project.id,
    version_id: `ver_${"0".repeat(32)}`,
    content_hash: `sha256:${"1".repeat(64)}`,
    created_at: "2026-08-10T09:00:00Z",
    total_duration_frames: 50,
    timeline: {
      schema_version: 1,
      timeline_id: "preview-golden",
      revision: 1,
      sequence_timebase: {
        frame_rate: { num: 25, den: 1 },
        timecode_mode: "NON_DROP_FRAME",
      },
      width: 1080,
      height: 1920,
      assets: [
        {
          schema_version: 1,
          asset_id: "fake-asset-01",
          source_asset_sha256: `sha256:${"2".repeat(64)}`,
          source_frame_count: 100,
          proxy: null,
        },
      ],
      clips: [
        {
          schema_version: 1,
          clip_id: "fake-shot-01",
          asset_id: "fake-asset-01",
          source_in_frame: 0,
          duration_frames: 50,
        },
      ],
    },
  },
  request_id: requestId,
} satisfies TimelineResponse;
const sourceManifestVersion: SourceManifestResponse["data"]["latest_version"] = {
  artifact_id: `art_${"1".repeat(32)}`,
  id: `ver_${"2".repeat(32)}`,
  parent_version_id: null,
  version_number: 1,
  schema_version: "1.0.0",
  content_hash: `sha256:${"4".repeat(64)}`,
  change_summary: "冻结小说来源",
  created_at: "2026-08-03T04:00:00Z",
  content: {
    scope_type: "full_work",
    documents: [
      {
        source_document_id: sourceResponse.data.id,
        filename: sourceResponse.data.filename,
        media_type: "text/plain",
        encoding: "utf-8",
        byte_size: sourceResponse.data.byte_size,
        chapter_count: sourceResponse.data.chapter_count,
        raw_sha256: sourceResponse.data.raw_sha256,
        normalized_sha256: "5".repeat(64),
        import_order: 1,
        blocks: [],
      },
    ],
  },
};
const sourceManifestResponse: SourceManifestResponse = {
  data: {
    project_id: project.id,
    head: {
      artifact_id: sourceManifestVersion.artifact_id,
      latest_version_id: sourceManifestVersion.id,
      review_version_id: sourceManifestVersion.id,
      review_submission_id: `sub_${"3".repeat(32)}`,
      accepted_version_id: sourceManifestVersion.id,
      revision: 3,
      review_evidence_revision: 1,
      updated_at: "2026-08-03T04:00:00Z",
    },
    latest_version: sourceManifestVersion,
    review_version: sourceManifestVersion,
    accepted_version: sourceManifestVersion,
  },
  request_id: requestId,
};
const storyBibleResponse: StoryBibleResponse = {
  data: {
    project_id: project.id,
    head: {
      ...sourceManifestResponse.data.head,
      artifact_id: `art_${"6".repeat(32)}`,
      latest_version_id: `ver_${"7".repeat(32)}`,
      review_version_id: null,
      review_submission_id: null,
      accepted_version_id: null,
    },
    version: {
      artifact_id: `art_${"6".repeat(32)}`,
      id: `ver_${"7".repeat(32)}`,
      parent_version_id: null,
      version_number: 2,
      schema_version: "1.0.0",
      content_hash: `sha256:${"8".repeat(64)}`,
      change_summary: "补充人物关系",
      created_at: "2026-08-03T04:10:00Z",
      content: {
        title: "雾城来信",
        logline: "失忆记者循着一封旧信追查雾城真相。",
        source_scope: {
          scope_type: "full_work",
          source_manifest_version_id: sourceManifestResponse.data.latest_version.id,
          documents: [],
        },
        entities: [
          { entity_id: `ent_${"9".repeat(32)}`, kind: "character", name: "林见" },
          { entity_id: `ent_${"a".repeat(32)}`, kind: "location", name: "雾城" },
          { entity_id: `ent_${"c".repeat(32)}`, kind: "character", name: "周野" },
          {
            entity_id: `ent_${"b".repeat(32)}`,
            kind: "organization",
            name: "雾城档案馆",
          },
          { entity_id: `ent_${"d".repeat(32)}`, kind: "prop", name: "旧信" },
          { entity_id: `ent_${"e".repeat(32)}`, kind: "costume", name: "灰色风衣" },
        ],
        facts: [
          {
            fact_id: `fact_${"d".repeat(32)}`,
            kind: "character_fact",
            character_id: `ent_${"9".repeat(32)}`,
            attribute: "职业",
            value: "记者",
            importance: "core",
            canon_status: "confirmed",
            canon_certainty: "certain",
            origin: "source_explicit_assertion",
            source_reliability: "reliable",
          },
          {
            fact_id: `fact_${"e".repeat(32)}`,
            kind: "relationship_fact",
            subject_entity_id: `ent_${"9".repeat(32)}`,
            object_entity_id: `ent_${"c".repeat(32)}`,
            predicate: "曾是搭档",
            importance: "core",
            canon_status: "contested",
            canon_certainty: "ambiguous",
            origin: "source_interpretation",
            source_reliability: "uncertain",
          },
          {
            fact_id: `fact_${"1".repeat(32)}`,
            kind: "location_fact",
            location_id: `ent_${"a".repeat(32)}`,
            attribute: "天气",
            value: "常年多雾",
            importance: "supporting",
            canon_status: "confirmed",
            canon_certainty: "certain",
            origin: "source_explicit_assertion",
            source_reliability: "reliable",
          },
          {
            fact_id: `fact_${"2".repeat(32)}`,
            kind: "organization_fact",
            organization_id: `ent_${"b".repeat(32)}`,
            attribute: "职责",
            value: "保存城市档案",
            importance: "supporting",
            canon_status: "confirmed",
            canon_certainty: "likely",
            origin: "source_explicit_assertion",
            source_reliability: "reliable",
          },
          {
            fact_id: `fact_${"3".repeat(32)}`,
            kind: "event_fact",
            participants: [`ent_${"9".repeat(32)}`, `ent_${"c".repeat(32)}`],
            source_narrative_order: 1,
            story_time_order: 1,
            location_id: `ent_${"a".repeat(32)}`,
            importance: "core",
            canon_status: "confirmed",
            canon_certainty: "certain",
            origin: "source_explicit_assertion",
            source_reliability: "reliable",
          },
          {
            fact_id: `fact_${"4".repeat(32)}`,
            kind: "world_rule_fact",
            rule: "雾会干扰电子记录",
            rule_scope: "雾城区",
            importance: "core",
            canon_status: "proposed",
            canon_certainty: "ambiguous",
            origin: "source_interpretation",
            source_reliability: "uncertain",
          },
          {
            fact_id: `fact_${"5".repeat(32)}`,
            kind: "prop_fact",
            prop_id: `ent_${"d".repeat(32)}`,
            property_key: "holder",
            value: { kind: "entity_ref", entity_id: `ent_${"9".repeat(32)}` },
            importance: "supporting",
            canon_status: "confirmed",
            canon_certainty: "certain",
            origin: "source_explicit_assertion",
            source_reliability: "reliable",
          },
          {
            fact_id: `fact_${"0".repeat(32)}`,
            kind: "costume_fact",
            costume_id: `ent_${"e".repeat(32)}`,
            property_key: "appearance",
            value: { kind: "text", value: "灰色、长及膝部" },
            importance: "detail",
            canon_status: "confirmed",
            canon_certainty: "certain",
            origin: "source_explicit_assertion",
            source_reliability: "reliable",
          },
        ],
        questions: [
          {
            question_id: `qst_${"b".repeat(32)}`,
            question: "旧信是谁寄出的？",
            blocking: true,
            responsible_role: "编剧",
            scope_type: "artifact",
            severity: "blocking",
            status: "open",
          },
        ],
        conflicts: [
          {
            conflict_id: `cfl_${"f".repeat(32)}`,
            conflict_type: "relationship",
            fact_ids: [`fact_${"e".repeat(32)}`],
            responsible_role: "编剧",
            severity: "major",
            status: "unresolved",
          },
        ],
      },
      source_spans: [
        {
          id: `spn_${"1".repeat(32)}`,
          fact_id: `fact_${"d".repeat(32)}`,
          source_document_id: sourceResponse.data.id,
          source_block_id: sourceResponse.data.blocks[1]!.id,
          role: "supports",
          start_byte: sourceResponse.data.blocks[1]!.normalized_start_byte,
          end_byte: sourceResponse.data.blocks[1]!.normalized_end_byte,
          claim: "林见的职业是记者",
          quote_hash: `sha256:${"2".repeat(64)}`,
        },
        {
          id: `spn_${"3".repeat(32)}`,
          fact_id: `fact_${"e".repeat(32)}`,
          source_document_id: sourceResponse.data.id,
          source_block_id: sourceResponse.data.blocks[1]!.id,
          role: "context",
          start_byte: sourceResponse.data.blocks[1]!.normalized_start_byte,
          end_byte: sourceResponse.data.blocks[1]!.normalized_end_byte,
          claim: "两人曾经共同行动",
          quote_hash: `sha256:${"4".repeat(64)}`,
        },
      ],
    },
  },
  request_id: requestId,
};

function storySummary(version: StoryBibleVersionResponse["data"]["version"]) {
  return {
    artifact_id: version.artifact_id,
    id: version.id,
    parent_version_id: version.parent_version_id,
    version_number: version.version_number,
    schema_version: version.schema_version,
    content_hash: version.content_hash,
    change_summary: version.change_summary,
    created_at: version.created_at,
  };
}

type StoryVersion = StoryBibleVersionResponse["data"]["version"];

function mockStoryBible(
  transport: StudioTransport,
  options: {
    latest?: StoryVersion;
    review?: StoryVersion | null;
    accepted?: StoryVersion | null;
    head?: StoryBibleIndexResponse["data"]["head"];
  } = {},
) {
  const latest = options.latest ?? storyBibleResponse.data.version;
  const review = options.review ?? null;
  const accepted = options.accepted ?? null;
  const head =
    options.head ??
    ({
      ...storyBibleResponse.data.head,
      latest_version_id: latest.id,
      review_version_id: review?.id ?? null,
      review_submission_id: review ? `sub_${"a".repeat(32)}` : null,
      accepted_version_id: accepted?.id ?? null,
    } satisfies StoryBibleIndexResponse["data"]["head"]);
  const index: StoryBibleIndexResponse = {
    data: {
      project_id: project.id,
      head,
      latest_version: storySummary(latest),
      review_version: review ? storySummary(review) : null,
      accepted_version: accepted ? storySummary(accepted) : null,
    },
    request_id: requestId,
  };
  const versions = new Map(
    [latest, review, accepted]
      .filter((version): version is StoryVersion => version !== null)
      .map((version) => [version.id, version]),
  );
  vi.mocked(transport.getStoryBibleIndex).mockResolvedValue(index);
  vi.mocked(transport.getStoryBibleVersion).mockImplementation(async (_projectId, versionId) => {
    const version = versions.get(versionId);
    if (!version) throw new Error("version missing from test fixture");
    return { data: { project_id: project.id, head, version }, request_id: requestId };
  });
  return index;
}

function studioTransport(projects: ProjectData[] = []): StudioTransport {
  return {
    getHealth: vi.fn().mockResolvedValue(healthyResponse),
    listProjects: vi.fn().mockResolvedValue({ data: projects, request_id: requestId }),
    createProject: vi.fn().mockResolvedValue({ data: project, request_id: requestId }),
    getProject: vi
      .fn()
      .mockResolvedValue({ data: { ...project, revision: 2 }, request_id: requestId }),
    listSources: vi.fn().mockResolvedValue({ data: [], request_id: requestId }),
    getSource: vi.fn().mockResolvedValue(sourceResponse),
    importTextSource: vi.fn().mockResolvedValue(sourceResponse),
    getSourceManifest: vi.fn().mockResolvedValue(null),
    getStoryBibleIndex: vi.fn().mockResolvedValue(null),
    getStoryBibleVersion: vi.fn().mockResolvedValue(storyBibleResponse),
    listProjectTasks: vi.fn().mockResolvedValue({
      data: {
        project_id: project.id,
        summary: { total: 0, attention: 0, active: 0, completed: 0 },
        tasks: [],
      },
      request_id: requestId,
    } satisfies TaskQueueResponse),
    startFakeTimelineWorkflow: vi.fn().mockResolvedValue(fakeTimelineResponse),
    getProjectTimeline: vi.fn().mockResolvedValue(null),
    trimTimelineClip: vi.fn(),
    reorderTimelineClip: vi.fn(),
    replaceTimelineClip: vi.fn(),
    listProviderConnections: vi.fn().mockResolvedValue({ data: [], request_id: requestId }),
    createProviderConnection: vi.fn(),
    deleteProviderConnection: vi.fn(),
  };
}

test("opens the project-scoped production task queue", async () => {
  const transport = studioTransport([project]);
  render(<App transport={transport} />);
  await screen.findByRole("heading", { name: "雾城来信" });

  fireEvent.click(screen.getByRole("button", { name: /任务队列/ }));

  expect(await screen.findByRole("heading", { name: "制作任务总览" })).toBeInTheDocument();
  expect(await screen.findByText("还没有制作任务")).toBeInTheDocument();
  expect(transport.listProjectTasks).toHaveBeenCalledWith(project.id);
});

test("presents the seven production areas and G0-G8 as the desktop shell", async () => {
  render(<App transport={studioTransport([project])} />);
  await screen.findByRole("heading", { name: "雾城来信" });

  const navigation = screen.getByRole("navigation", { name: "制作流程" });
  for (const label of ["项目", "故事", "导演", "资产", "生成", "剪辑", "发布"]) {
    expect(within(navigation).getByRole("button", { name: new RegExp(label) })).toBeInTheDocument();
  }
  expect(within(navigation).queryByRole("button", { name: /任务/ })).not.toBeInTheDocument();
  expect(within(navigation).queryByRole("button", { name: /模型与 API/ })).not.toBeInTheDocument();

  const stages = screen.getByLabelText("G0 至 G8 生产阶段");
  for (let index = 0; index <= 8; index += 1) {
    expect(within(stages).getByText(`G${index}`, { exact: true })).toBeInTheDocument();
  }
  expect(screen.getAllByRole("button", { name: /下一步/ })).toHaveLength(1);
});

test("opens production tasks as a global drawer and closes without changing workspace", async () => {
  const transport = studioTransport([project]);
  render(<App transport={transport} />);
  await screen.findByRole("heading", { name: "雾城来信" });

  const trigger = screen.getByRole("button", { name: /打开任务中心/ });
  trigger.focus();
  fireEvent.click(trigger);
  const drawer = await screen.findByRole("dialog", { name: "任务中心" });
  expect(within(drawer).getByRole("heading", { name: "制作任务总览" })).toBeInTheDocument();
  const closeButton = within(drawer).getByRole("button", { name: "关闭任务中心" });
  expect(closeButton).toHaveFocus();
  expect(document.querySelector("main")).toHaveAttribute("inert");
  const forwardTab = createEvent.keyDown(document, { key: "Tab" });
  fireEvent(document, forwardTab);
  expect(forwardTab.defaultPrevented).toBe(true);
  expect(closeButton).toHaveFocus();
  const reverseTab = createEvent.keyDown(document, { key: "Tab", shiftKey: true });
  fireEvent(document, reverseTab);
  expect(reverseTab.defaultPrevented).toBe(true);
  expect(closeButton).toHaveFocus();
  fireEvent.mouseDown(drawer);
  expect(screen.getByRole("dialog", { name: "任务中心" })).toBeInTheDocument();

  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "任务中心" })).not.toBeInTheDocument(),
  );
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(screen.getByRole("heading", { name: "雾城来信" })).toBeInTheDocument();

  fireEvent.click(trigger);
  const reopened = await screen.findByRole("dialog", { name: "任务中心" });
  fireEvent.mouseDown(reopened.parentElement as HTMLElement);
  expect(screen.queryByRole("dialog", { name: "任务中心" })).not.toBeInTheDocument();
});

test("opens the real project timeline workspace", async () => {
  const transport = studioTransport([project]);
  render(<App transport={transport} />);
  await screen.findByRole("heading", { name: "雾城来信" });

  fireEvent.click(screen.getByRole("button", { name: /剪辑台/ }));

  expect(await screen.findByRole("heading", { name: "时间线尚未生成" })).toBeInTheDocument();
  expect(transport.getProjectTimeline).toHaveBeenCalledWith(project.id);
});

test("starts a deterministic preview from the restored imported source", async () => {
  const transport = studioTransport([project]);
  vi.mocked(transport.listSources).mockResolvedValue({
    data: [sourceSummary],
    request_id: requestId,
  });
  render(<App transport={transport} />);

  expect(await screen.findAllByText(sourceResponse.data.filename)).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "生成 Fake 分镜时间线" }));

  expect(await screen.findByRole("status")).toHaveTextContent("1 个镜头");
  expect(transport.startFakeTimelineWorkflow).toHaveBeenCalledWith(project.id);
  fireEvent.click(screen.getByRole("button", { name: "查看任务记录" }));
  fireEvent.click(await screen.findByRole("button", { name: "关闭任务中心" }));
  fireEvent.click(screen.getByRole("button", { name: "进入剪辑台" }));
  expect(await screen.findByRole("heading", { name: "时间线尚未生成" })).toBeInTheDocument();
});

test("collapses production context and keeps planned areas honest", async () => {
  render(<App transport={studioTransport([project])} />);
  await screen.findByRole("heading", { name: "雾城来信" });

  const collapseRail = screen.getByRole("button", { name: "收起项目栏" });
  expect(collapseRail).toHaveAttribute("aria-expanded", "true");
  fireEvent.click(collapseRail);
  const expandRail = screen.getByRole("button", { name: "展开项目栏" });
  expect(expandRail).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(expandRail);

  const collapseInspector = screen.getByRole("button", { name: "收起属性检查器" });
  expect(collapseInspector).toHaveAttribute("aria-expanded", "true");
  fireEvent.click(collapseInspector);
  const expandInspector = screen.getByRole("button", { name: "展开属性检查器" });
  expect(expandInspector).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(expandInspector);

  for (const [label, heading] of [
    ["导演", "导演工作区尚未实现"],
    ["资产", "资产工作区尚未实现"],
    ["生成", "生成工作区尚未实现"],
    ["发布", "发布工作区尚未实现"],
  ]) {
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^\\d+${label}$`) }));
    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
  }
});

test("uses neutral source-tracing copy for a numeric project name", async () => {
  render(<App transport={studioTransport([{ ...project, name: "1" }])} />);
  await screen.findByRole("heading", { name: "1" });

  expect(screen.getByRole("heading", { name: "来源追踪" })).toBeInTheDocument();
  expect(
    screen.getByText("导入原文后，这里会显示文件、章节、段落和引用关系。"),
  ).toBeInTheDocument();
  expect(screen.queryByText("1 的来源台账")).not.toBeInTheDocument();
  const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
  expect(styles).toContain("--font-meta: 12px");
  expect(styles).toContain("--font-ui: 14px");
  expect(styles).toMatch(/\.preview-placeholder p,[\s\S]*font-size: var\(--font-ui\)/);
  expect(styles).toMatch(/\.project-card-copy small,[\s\S]*font-size: var\(--font-meta\)/);
  expect(styles).toMatch(
    /\.manifest-summary dt,[\s\S]*\.severity,[\s\S]*font-size: var\(--font-meta\)/,
  );
  expect(styles).toMatch(
    /\.project-card-copy strong,[\s\S]*\.source-block p,[\s\S]*font-size: var\(--font-ui\)/,
  );
  expect(styles).toMatch(
    /\.project-hero p,[\s\S]*\.preview-disclaimer,[\s\S]*\.question-scope > button,[\s\S]*\.story-empty-state p,[\s\S]*font-size: var\(--font-ui\)/,
  );
  expect(styles).toMatch(
    /\.project-status,[\s\S]*\.gate-chip,[\s\S]*\.project-dialog label > span,[\s\S]*font-size: var\(--font-meta\)/,
  );
});

test("opens model and API settings without requiring a selected project", async () => {
  const transport = studioTransport();
  render(<App transport={transport} />);
  await screen.findByRole("heading", { name: "还没有制作项目" });

  fireEvent.click(screen.getByRole("button", { name: /模型与 API/ }));

  expect(
    await screen.findByRole("heading", { name: "统一模型连接", level: 2 }),
  ).toBeInTheDocument();
  expect(screen.getByText("会员与 API 是两套账户体系")).toBeInTheDocument();
  expect(transport.listProviderConnections).toHaveBeenCalledTimes(1);
});

test("shows a connected, actionable empty workspace", async () => {
  render(<App transport={studioTransport()} />);

  expect(screen.getByText("正在连接创作引擎…")).toBeInTheDocument();
  expect(await screen.findByText("还没有制作项目")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "创建第一个项目" })).toBeEnabled();
  expect(screen.getByText("本地工作区服务已连接")).toBeInTheDocument();
});

test("creates and opens a project from the keyboard-friendly dialog", async () => {
  const transport = studioTransport();
  render(<App transport={transport} />);
  await screen.findByText("还没有制作项目");

  fireEvent.click(screen.getByRole("button", { name: "创建第一个项目" }));
  const name = screen.getByRole("textbox", { name: "项目名称" });
  fireEvent.change(name, { target: { value: "雾城来信" } });
  fireEvent.click(screen.getByRole("button", { name: "创建项目" }));

  await waitFor(() => expect(transport.createProject).toHaveBeenCalledOnce());
  expect(await screen.findByRole("heading", { name: "雾城来信" })).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("imports a TXT file and shows traceable chapter blocks", async () => {
  const transport = studioTransport([project]);
  render(<App transport={transport} />);
  await screen.findByRole("heading", { name: "雾城来信" });
  const file = new File(["第一章 初见\n雨落在霓虹灯下。"], "雾城来信.txt", {
    type: "text/plain",
  });

  fireEvent.change(screen.getByLabelText("选择 TXT 文件"), { target: { files: [file] } });

  await waitFor(() => expect(transport.importTextSource).toHaveBeenCalledOnce());
  expect(await screen.findByText("已解析 1 章 · 2 个文本块")).toBeInTheDocument();
  expect(screen.getByText("第一章 初见")).toBeInTheDocument();
  expect(screen.getByText("雨落在霓虹灯下。")).toBeInTheDocument();
});

test("restores the latest persisted source when a project opens", async () => {
  const transport = studioTransport([project]);
  vi.mocked(transport.listSources).mockResolvedValueOnce({
    data: [sourceSummary],
    request_id: requestId,
  });
  render(<App transport={transport} />);

  await waitFor(() => expect(transport.listSources).toHaveBeenCalledWith(project.id));
  expect(await screen.findByText("已解析 1 章 · 2 个文本块")).toBeInTheDocument();
  expect(transport.getSource).toHaveBeenCalledWith(project.id, sourceResponse.data.id);
});

test("shows a recoverable connection error", async () => {
  const transport = studioTransport();
  vi.mocked(transport.getHealth)
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(healthyResponse);
  render(<App transport={transport} />);

  expect(await screen.findByRole("heading", { name: "创作引擎未连接" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "重新连接" }));

  await waitFor(() => expect(transport.getHealth).toHaveBeenCalledTimes(2));
  expect(await screen.findByText("还没有制作项目")).toBeInTheDocument();
});

test("keeps project input when creation fails and supports Escape", async () => {
  const transport = studioTransport();
  vi.mocked(transport.createProject).mockRejectedValueOnce(new Error("conflict"));
  render(<App transport={transport} />);
  await screen.findByText("还没有制作项目");

  fireEvent.click(screen.getByRole("button", { name: "新建项目" }));
  fireEvent.change(screen.getByRole("textbox", { name: "项目名称" }), {
    target: { value: "失败后保留" },
  });
  fireEvent.change(screen.getByLabelText("单集目标时长"), { target: { value: "120" } });
  fireEvent.click(screen.getByRole("button", { name: "创建项目" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("已输入内容不会丢失");
  expect(screen.getByRole("textbox", { name: "项目名称" })).toHaveValue("失败后保留");
  expect(transport.createProject).toHaveBeenCalledWith(
    expect.objectContaining({ target_duration_seconds: 120 }),
  );
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("rejects unsupported and oversized files before transport", async () => {
  const transport = studioTransport([project]);
  render(<App transport={transport} />);
  await screen.findByRole("heading", { name: "雾城来信" });
  const input = screen.getByLabelText("选择 TXT 文件");

  fireEvent.change(input, {
    target: { files: [new File(["text"], "story.md", { type: "text/markdown" })] },
  });
  expect(await screen.findByRole("alert")).toHaveTextContent("扩展名为 .txt");

  fireEvent.change(input, {
    target: { files: [new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.txt")] },
  });
  expect(await screen.findByRole("alert")).toHaveTextContent("超过 5 MiB");
  expect(transport.importTextSource).not.toHaveBeenCalled();
});

test("shows an actionable import error and accepts drag-and-drop", async () => {
  const transport = studioTransport([project]);
  vi.mocked(transport.importTextSource).mockRejectedValueOnce(new Error("duplicate"));
  render(<App transport={transport} />);
  await screen.findByRole("heading", { name: "雾城来信" });
  const dropZone = screen.getByText("拖入 TXT，或点击选择").closest("label");
  expect(dropZone).not.toBeNull();

  fireEvent.drop(dropZone!, {
    dataTransfer: { files: [new File(["第一章"], "story.txt", { type: "text/plain" })] },
  });

  expect(await screen.findByRole("alert")).toHaveTextContent("UTF-8 文本且尚未导入");
});

test("switches between project cards and tolerates an invalid legacy date", async () => {
  const second = {
    ...project,
    id: `prj_${"2".repeat(32)}`,
    name: "夜航",
    updated_at: "invalid-date",
  };
  render(<App transport={studioTransport([project, second])} />);
  await screen.findByRole("heading", { name: "雾城来信" });

  fireEvent.click(screen.getByRole("button", { name: /夜航/ }));

  expect(await screen.findByRole("heading", { name: "夜航" })).toBeInTheDocument();
  expect(screen.getByText("刚刚更新")).toBeInTheDocument();
});

test("ignores a stale source restore after the user switches projects", async () => {
  const second = {
    ...project,
    id: `prj_${"2".repeat(32)}`,
    name: "夜航",
  };
  const transport = studioTransport([project, second]);
  let resolveFirstRestore: ((value: SourceDocumentListResponse) => void) | undefined;
  vi.mocked(transport.listSources)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirstRestore = resolve;
        }),
    )
    .mockResolvedValueOnce({ data: [], request_id: requestId });
  render(<App transport={transport} />);
  await screen.findByRole("heading", { name: "雾城来信" });

  fireEvent.click(screen.getByRole("button", { name: /夜航/ }));
  expect(await screen.findByRole("heading", { name: "夜航" })).toBeInTheDocument();
  resolveFirstRestore?.({ data: [sourceSummary], request_id: requestId });

  await waitFor(() => expect(transport.listSources).toHaveBeenCalledTimes(2));
  expect(transport.getSource).not.toHaveBeenCalled();
});

test("does not show an imported source under a project selected while upload was pending", async () => {
  const second = {
    ...project,
    id: `prj_${"2".repeat(32)}`,
    name: "夜航",
  };
  const transport = studioTransport([project, second]);
  let resolveImport: ((value: SourceDocumentResponse) => void) | undefined;
  vi.mocked(transport.importTextSource).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveImport = resolve;
      }),
  );
  render(<App transport={transport} />);
  await screen.findByRole("heading", { name: "雾城来信" });

  fireEvent.change(screen.getByLabelText("选择 TXT 文件"), {
    target: { files: [new File(["第一章 初见"], "story.txt", { type: "text/plain" })] },
  });
  await waitFor(() => expect(transport.importTextSource).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: /夜航/ }));
  expect(await screen.findByRole("heading", { name: "夜航" })).toBeInTheDocument();
  resolveImport?.(sourceResponse);

  await waitFor(() => expect(transport.listSources).toHaveBeenCalledTimes(2));
  expect(screen.queryByText("第一章 初见")).not.toBeInTheDocument();
});

test("opens the professional story workshop and presents source, canon, and review together", async () => {
  const transport = studioTransport([project]);
  vi.mocked(transport.listSources).mockResolvedValue({
    data: [sourceSummary],
    request_id: requestId,
  });
  vi.mocked(transport.getSourceManifest).mockResolvedValue(sourceManifestResponse);
  mockStoryBible(transport);
  render(<App transport={transport} />);
  await screen.findByRole("heading", { name: "雾城来信" });

  fireEvent.click(screen.getByRole("button", { name: /故事工坊/ }));

  expect(await screen.findByRole("heading", { name: "故事圣经" })).toBeInTheDocument();
  expect(screen.getByText("G1 来源已验收")).toBeInTheDocument();
  expect(screen.getByText("失忆记者循着一封旧信追查雾城真相。")).toBeInTheDocument();
  expect(screen.getAllByText("林见").length).toBeGreaterThan(0);
  expect(screen.getAllByText("林见 · 职业：记者")).toHaveLength(2);
  expect(screen.getByRole("heading", { name: "逐事实证据" })).toBeInTheDocument();
  expect(screen.getByText("林见的职业是记者")).toBeInTheDocument();
  expect(screen.getByText("字节 17–41")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "查看 林见 · 职业：记者 的来源证据" }));
  expect(screen.getByText("候选 / 争议 / 已拒绝")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "查看 林见 → 曾是搭档 → 周野 的来源证据" }));
  expect(screen.getByText("两人曾经共同行动")).toBeInTheDocument();
  expect(screen.getByText("旧信是谁寄出的？")).toBeInTheDocument();
  expect(screen.getByText(/relationship · 1 条关联事实/)).toBeInTheDocument();
  const conflictCard = screen.getByText(/relationship · 1 条关联事实/).closest("article");
  expect(conflictCard).not.toBeNull();
  expect(
    within(conflictCard!).getByRole("button", { name: /林见 → 曾是搭档 → 周野/ }),
  ).toHaveTextContent("证据 1");
  fireEvent.click(within(conflictCard!).getByRole("button", { name: /林见 → 曾是搭档 → 周野/ }));
  expect(screen.getByText("原文叙事序")).toBeInTheDocument();
  expect(screen.getByText("状态变化")).toBeInTheDocument();
  expect(screen.getByText("等待 G2 审阅")).toBeInTheDocument();
  expect(transport.getSourceManifest).toHaveBeenCalledWith(project.id);
  expect(transport.getStoryBibleIndex).toHaveBeenCalledWith(project.id);
  expect(transport.getStoryBibleVersion).toHaveBeenCalledWith(
    project.id,
    storyBibleResponse.data.version.id,
  );
});

test("defaults to the exact review version and can switch accepted and latest baselines", async () => {
  const transport = studioTransport([project]);
  vi.mocked(transport.getSourceManifest).mockResolvedValue(sourceManifestResponse);
  const reviewVersion = {
    ...storyBibleResponse.data.version,
    id: `ver_${"8".repeat(32)}`,
    version_number: 1,
    change_summary: "送审版本",
    content: {
      ...storyBibleResponse.data.version.content,
      title: "审阅版故事圣经",
    },
  };
  const acceptedVersion = {
    ...storyBibleResponse.data.version,
    id: `ver_${"9".repeat(32)}`,
    version_number: 1,
    change_summary: "已验收基线",
    content: {
      ...storyBibleResponse.data.version.content,
      title: "验收版故事圣经",
    },
  };
  mockStoryBible(transport, {
    latest: storyBibleResponse.data.version,
    review: reviewVersion,
    accepted: acceptedVersion,
  });
  render(<App transport={transport} />);
  await screen.findByRole("heading", { name: "雾城来信" });

  fireEvent.click(screen.getByRole("button", { name: /故事工坊/ }));

  expect(await screen.findByRole("heading", { name: "审阅版故事圣经" })).toBeInTheDocument();
  expect(screen.getByText("正在查看 REVIEW")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /ACCEPTEDV01/ }));
  expect(await screen.findByRole("heading", { name: "验收版故事圣经" })).toBeInTheDocument();
  expect(screen.getByText("G2 已验收基线")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /LATESTV02/ }));
  await waitFor(() =>
    expect(screen.getAllByRole("heading", { name: "雾城来信" }).length).toBeGreaterThan(0),
  );
  expect(screen.getByText("正在查看 LATEST")).toBeInTheDocument();
});

test("switches the source preview among the exact G1 latest, review, and accepted versions", async () => {
  const latestVersion = {
    ...sourceManifestVersion,
    id: `ver_${"a".repeat(32)}`,
    version_number: 3,
    change_summary: "最新来源草稿",
  };
  const reviewVersion = {
    ...sourceManifestVersion,
    id: `ver_${"b".repeat(32)}`,
    version_number: 2,
    change_summary: "正在审阅的来源",
  };
  const acceptedVersion = {
    ...sourceManifestVersion,
    id: `ver_${"c".repeat(32)}`,
    version_number: 1,
    change_summary: "下游采用的来源基线",
  };
  const transport = studioTransport([project]);
  vi.mocked(transport.getSourceManifest).mockResolvedValue({
    ...sourceManifestResponse,
    data: {
      ...sourceManifestResponse.data,
      head: {
        ...sourceManifestResponse.data.head,
        latest_version_id: latestVersion.id,
        review_version_id: reviewVersion.id,
        accepted_version_id: acceptedVersion.id,
      },
      latest_version: latestVersion,
      review_version: reviewVersion,
      accepted_version: acceptedVersion,
    },
  });
  mockStoryBible(transport, {
    latest: {
      ...storyBibleResponse.data.version,
      content: {
        ...storyBibleResponse.data.version.content,
        source_scope: {
          ...storyBibleResponse.data.version.content.source_scope,
          source_manifest_version_id: acceptedVersion.id,
        },
      },
    },
  });
  render(<App transport={transport} />);
  await screen.findByRole("heading", { name: "雾城来信" });
  fireEvent.click(screen.getByRole("button", { name: /故事工坊/ }));

  expect(await screen.findByText("正在查看 ACCEPTED 来源清单")).toBeInTheDocument();
  expect(screen.getByText("下游采用的来源基线")).toBeInTheDocument();
  const selector = screen.getByLabelText("来源清单版本");
  fireEvent.click(within(selector).getByRole("button", { name: /REVIEWV2/ }));
  expect(screen.getByText("正在审阅的来源")).toBeInTheDocument();
  fireEvent.click(within(selector).getByRole("button", { name: /LATESTV3/ }));
  expect(screen.getByText("最新来源草稿")).toBeInTheDocument();
});

test("loads evidence from the exact referenced document instead of the latest preview", async () => {
  let referencedOffset = 0;
  const referencedBlocks = [
    "上下文段落 1",
    "上下文段落 2",
    "上下文段落 3",
    "上下文段落 4",
    "上下文段落 5",
    "上下文段落 6",
    "上下文段落 7",
    "上下文段落 8",
    "旧信在港口被发现。",
  ].map((text, index) => {
    const start = referencedOffset;
    referencedOffset += new TextEncoder().encode(text).length;
    const block = {
      ...sourceResponse.data.blocks[1]!,
      id: `srcb_${String(index + 1).repeat(32)}`,
      ordinal: index,
      text,
      normalized_start_byte: start,
      normalized_end_byte: referencedOffset,
    };
    referencedOffset += 1;
    return block;
  });
  const referencedBlock = referencedBlocks.at(-1)!;
  const referencedSource: SourceDocumentResponse = {
    data: {
      ...sourceResponse.data,
      id: `src_${"6".repeat(32)}`,
      filename: "港口旧信.txt",
      raw_sha256: "7".repeat(64),
      byte_size: referencedOffset - 1,
      block_count: referencedBlocks.length,
      blocks: referencedBlocks,
    },
    request_id: requestId,
  };
  const exactStory: StoryBibleResponse = {
    ...storyBibleResponse,
    data: {
      ...storyBibleResponse.data,
      version: {
        ...storyBibleResponse.data.version,
        content: {
          ...storyBibleResponse.data.version.content,
          source_scope: {
            ...storyBibleResponse.data.version.content.source_scope,
            documents: [
              {
                source_document_id: referencedSource.data.id,
                raw_sha256: referencedSource.data.raw_sha256,
                source_block_ids: [referencedBlock.id],
                chapter_indices: [1],
              },
            ],
          },
        },
        source_spans: [
          {
            ...storyBibleResponse.data.version.source_spans[0]!,
            source_document_id: referencedSource.data.id,
            source_block_id: referencedBlock.id,
            start_byte: referencedBlock.normalized_start_byte,
            end_byte: referencedBlock.normalized_end_byte,
          },
        ],
      },
    },
  };
  const manifestWithSecondSource = {
    ...sourceManifestVersion,
    content: {
      ...sourceManifestVersion.content,
      documents: [
        ...sourceManifestVersion.content.documents,
        {
          source_document_id: referencedSource.data.id,
          filename: referencedSource.data.filename,
          media_type: "text/plain" as const,
          encoding: "utf-8" as const,
          byte_size: referencedSource.data.byte_size,
          chapter_count: referencedSource.data.chapter_count,
          raw_sha256: referencedSource.data.raw_sha256,
          normalized_sha256: "9".repeat(64),
          import_order: 2,
          blocks: [],
        },
      ],
    },
  };
  const transport = studioTransport([project]);
  vi.mocked(transport.listSources).mockResolvedValue({
    data: [sourceSummary],
    request_id: requestId,
  });
  vi.mocked(transport.getSource).mockImplementation(async (_projectId, sourceId) =>
    sourceId === referencedSource.data.id ? referencedSource : sourceResponse,
  );
  vi.mocked(transport.getSourceManifest).mockResolvedValue({
    ...sourceManifestResponse,
    data: {
      ...sourceManifestResponse.data,
      latest_version: manifestWithSecondSource,
      review_version: manifestWithSecondSource,
      accepted_version: manifestWithSecondSource,
    },
  });
  mockStoryBible(transport, { latest: exactStory.data.version });
  render(<App transport={transport} />);
  await screen.findByRole("heading", { name: "雾城来信" });

  fireEvent.click(screen.getByRole("button", { name: /故事工坊/ }));

  expect(await screen.findByText("“旧信在港口被发现。”")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: /#2港口旧信\.txt1 章src_66666666/ }),
  ).toBeInTheDocument();
  expect(screen.getAllByText(referencedSource.data.id).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: "打开《港口旧信.txt》上下文" }));
  await waitFor(() => {
    const preview = document.querySelector(".evidence-document");
    expect(preview).not.toBeNull();
    expect(within(preview as HTMLElement).getByText("港口旧信.txt")).toBeInTheDocument();
  });
  const targetBlock = await screen.findByText("旧信在港口被发现。", {
    selector: ".evidence-block p",
  });
  expect(targetBlock.closest(".evidence-block")).toHaveClass("active");
  expect(targetBlock.closest(".evidence-block")).toHaveFocus();
  expect(screen.queryByText("上下文段落 1")).not.toBeInTheDocument();
  expect(transport.getSource).toHaveBeenCalledWith(project.id, sourceResponse.data.id);
  expect(transport.getSource).toHaveBeenCalledWith(project.id, referencedSource.data.id);
  expect(screen.queryByText(/无法从绑定的来源文档恢复/)).not.toBeInTheDocument();
});

test("keeps unreliable confirmed claims out of effective canon and supports fact search", async () => {
  const transport = studioTransport([project]);
  vi.mocked(transport.getSourceManifest).mockResolvedValue(sourceManifestResponse);
  const unreliableFacts = storyBibleResponse.data.version.content.facts.map((fact) =>
    fact.kind === "location_fact"
      ? {
          ...fact,
          canon_certainty: "intentionally_unreliable" as const,
          source_reliability: "unreliable" as const,
        }
      : fact,
  );
  mockStoryBible(transport, {
    latest: {
      ...storyBibleResponse.data.version,
      content: {
        ...storyBibleResponse.data.version.content,
        facts: unreliableFacts,
      },
    },
  });
  render(<App transport={transport} />);
  await screen.findByRole("heading", { name: "雾城来信" });

  fireEvent.click(screen.getByRole("button", { name: /故事工坊/ }));
  await screen.findByRole("heading", { name: "故事圣经" });

  const canonList = screen.getByText("有效正典").closest<HTMLElement>(".fact-list");
  const reviewList = screen.getByText("候选 / 争议 / 已拒绝").closest<HTMLElement>(".fact-list");
  expect(canonList).not.toBeNull();
  expect(reviewList).not.toBeNull();
  expect(within(canonList!).queryByText("雾城 · 天气：常年多雾")).not.toBeInTheDocument();
  expect(within(reviewList!).getByText("雾城 · 天气：常年多雾")).toBeInTheDocument();
  const search = screen.getByLabelText("搜索事实");
  fireEvent.change(search, { target: { value: "电子记录" } });
  expect(search).toHaveValue("电子记录");
  expect(screen.getByText("雾城区 · 雾会干扰电子记录")).toBeInTheDocument();
  await waitFor(() => {
    const currentCanon = screen.getByText("有效正典").closest<HTMLElement>(".fact-list");
    const currentReview = screen
      .getByText("候选 / 争议 / 已拒绝")
      .closest<HTMLElement>(".fact-list");
    expect(within(currentCanon!).queryByText("林见 · 职业：记者")).not.toBeInTheDocument();
    expect(within(currentReview!).queryByText("林见 · 职业：记者")).not.toBeInTheDocument();
  });
});

test("paginates long fact and review queues without silently truncating them", async () => {
  const transport = studioTransport([project]);
  vi.mocked(transport.getSourceManifest).mockResolvedValue(sourceManifestResponse);
  const factIds = Array.from(
    { length: 21 },
    (_, index) => `fact_${index.toString(16).padStart(32, "0")}`,
  );
  const facts: StoryBibleResponse["data"]["version"]["content"]["facts"] = factIds.map(
    (factId, index) => ({
      fact_id: factId,
      kind: "world_rule_fact",
      rule: `长列表规则 ${index + 1}`,
      rule_scope: "雾城区",
      importance: "supporting",
      canon_status: "proposed",
      canon_certainty: "likely",
      origin: "ai_inference",
      source_reliability: "uncertain",
    }),
  );
  const questions: NonNullable<StoryBibleResponse["data"]["version"]["content"]["questions"]> =
    Array.from({ length: 21 }, (_, index) => ({
      question_id: `qst_${index.toString(16).padStart(32, "0")}`,
      question: `长列表问题 ${index + 1}`,
      blocking: false,
      responsible_role: "编剧",
      scope_type: "artifact",
      severity: "minor",
      status: "open",
    }));
  const conflicts: NonNullable<StoryBibleResponse["data"]["version"]["content"]["conflicts"]> =
    Array.from({ length: 21 }, (_, index) => ({
      conflict_id: `cfl_${index.toString(16).padStart(32, "0")}`,
      conflict_type: `长列表冲突 ${index + 1}`,
      fact_ids: [factIds[0]!, factIds[1]!],
      responsible_role: "连续性审阅",
      severity: "major",
      status: "unresolved",
    }));
  const entities: StoryBibleResponse["data"]["version"]["content"]["entities"] = Array.from(
    { length: 21 },
    (_, index) => ({
      entity_id: `ent_${index.toString(16).padStart(32, "0")}`,
      kind: "character",
      name: `长列表角色 ${index + 1}`,
      aliases: [`别名 ${index + 1}`],
    }),
  );
  mockStoryBible(transport, {
    latest: {
      ...storyBibleResponse.data.version,
      content: {
        ...storyBibleResponse.data.version.content,
        entities,
        facts,
        questions,
        conflicts,
      },
      source_spans: [],
    },
  });
  render(<App transport={transport} />);
  await screen.findByRole("heading", { name: "雾城来信" });
  fireEvent.click(screen.getByRole("button", { name: /故事工坊/ }));
  await screen.findByRole("heading", { name: "故事圣经" });

  expect(screen.queryByText("长列表角色 21")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "再显示 20 个实体" }));
  expect(screen.getByText("长列表角色 21")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("搜索实体"), { target: { value: "别名 21" } });
  expect(screen.getByText("长列表角色 21")).toBeInTheDocument();
  expect(screen.queryByText("雾城区 · 长列表规则 21")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "再显示 20 条事实" }));
  expect(screen.getByText("雾城区 · 长列表规则 21")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "再显示 20 个问题" }));
  expect(screen.getByText("长列表问题 21")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "再显示 20 个冲突" }));
  expect(screen.getByText(/长列表冲突 21 · 2 条关联事实/)).toBeInTheDocument();
});

test("exposes scoped questions, typed fact links, and resolved conflict decisions", async () => {
  const characterFactId = `fact_${"d".repeat(32)}`;
  const relationshipFactId = `fact_${"e".repeat(32)}`;
  const worldRuleFactId = `fact_${"4".repeat(32)}`;
  const transport = studioTransport([project]);
  vi.mocked(transport.getSourceManifest).mockResolvedValue(sourceManifestResponse);
  mockStoryBible(transport, {
    latest: {
      ...storyBibleResponse.data.version,
      content: {
        ...storyBibleResponse.data.version.content,
        facts: storyBibleResponse.data.version.content.facts.map((fact) =>
          fact.fact_id === relationshipFactId
            ? { ...fact, derived_from_fact_ids: [characterFactId] }
            : fact,
        ),
        questions: [
          {
            ...storyBibleResponse.data.version.content.questions![0]!,
            scope_type: "fact",
            scope_id: relationshipFactId,
          },
          {
            question_id: `qst_${"2".repeat(32)}`,
            question: "林见的人物小传是否完整？",
            blocking: true,
            responsible_role: "主编剧",
            scope_type: "entity",
            scope_id: `ent_${"9".repeat(32)}`,
            severity: "major",
            status: "open",
          },
          {
            question_id: `qst_${"3".repeat(32)}`,
            question: "需要核对原文上下文吗？",
            blocking: true,
            responsible_role: "连续性审阅",
            scope_type: "source_document",
            scope_id: sourceResponse.data.id,
            severity: "major",
            status: "open",
          },
        ],
        conflicts: [
          ...storyBibleResponse.data.version.content.conflicts!,
          {
            conflict_id: `cfl_${"1".repeat(32)}`,
            conflict_type: "职业归属",
            fact_ids: [characterFactId],
            responsible_role: "主编剧",
            severity: "minor",
            status: "resolved_by_user_decision",
            resolution_reason: "用户确认林见是调查记者。",
            resolution_fact_id: characterFactId,
          },
          {
            conflict_id: `cfl_${"2".repeat(32)}`,
            conflict_type: "世界规则证据不足",
            fact_ids: [worldRuleFactId],
            responsible_role: "连续性审阅",
            severity: "major",
            status: "unresolved",
          },
        ],
      },
    },
  });
  render(<App transport={transport} />);
  await screen.findByRole("heading", { name: "雾城来信" });
  fireEvent.click(screen.getByRole("button", { name: /故事工坊/ }));
  await screen.findByRole("heading", { name: "故事圣经" });

  expect(screen.getAllByText("BLOCKING")).toHaveLength(3);
  expect(screen.getByText("fact")).toBeInTheDocument();
  const relationshipCard = screen
    .getByRole("button", { name: "查看 林见 → 曾是搭档 → 周野 的来源证据" })
    .closest("article");
  expect(relationshipCard).not.toBeNull();
  const derivedLink = within(relationshipCard!).getByRole("button", {
    name: new RegExp(`派生自.*林见 · 职业：记者.*${characterFactId}`),
  });
  fireEvent.click(derivedLink);
  expect(derivedLink).toHaveTextContent(characterFactId);
  expect(screen.getByText("resolved_by_user_decision")).toBeInTheDocument();
  expect(screen.getByText("决议依据：用户确认林见是调查记者。")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /决议事实 · 林见 · 职业：记者/ })).toBeEnabled();
  const noEvidenceConflictLink = screen.getByRole("button", {
    name: /雾城区 · 雾会干扰电子记录.*证据 0/,
  });
  expect(noEvidenceConflictLink).toBeEnabled();
  fireEvent.click(noEvidenceConflictLink);
  const noEvidenceFactCard = screen
    .getByRole("button", { name: "查看 雾城区 · 雾会干扰电子记录 的来源证据" })
    .closest("article");
  expect(noEvidenceFactCard).toHaveClass("active");
  expect(noEvidenceFactCard).toHaveFocus();
  expect(screen.getByText("当前事实没有绑定可核对的精确引文。")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("搜索事实"), { target: { value: "不存在的事实" } });
  const factQuestion = screen.getByText("旧信是谁寄出的？").closest("article");
  fireEvent.click(within(factQuestion!).getByRole("button", { name: "林见 → 曾是搭档 → 周野" }));
  expect(screen.getByLabelText("搜索事实")).toHaveValue("");
  const navigatedFactCard = screen
    .getByRole("button", { name: "查看 林见 → 曾是搭档 → 周野 的来源证据" })
    .closest("article");
  expect(navigatedFactCard).toHaveClass("active");
  expect(navigatedFactCard).toHaveFocus();
  const entityQuestion = screen.getByText("林见的人物小传是否完整？").closest("article");
  fireEvent.click(within(entityQuestion!).getByRole("button", { name: "林见" }));
  expect(document.getElementById(`entity-ent_${"9".repeat(32)}`)).toHaveClass("active");
  const sourceQuestion = screen.getByText("需要核对原文上下文吗？").closest("article");
  fireEvent.click(within(sourceQuestion!).getByRole("button", { name: "雾城来信.txt" }));
  await waitFor(() => {
    const preview = document.querySelector(".evidence-document");
    expect(within(preview as HTMLElement).getByText("雾城来信.txt")).toBeInTheDocument();
    expect(document.querySelector(".evidence-excerpts")).toHaveFocus();
  });
});

test("marks unavailable evidence explicitly instead of substituting another source", async () => {
  const transport = studioTransport([project]);
  vi.mocked(transport.getSourceManifest).mockResolvedValue(sourceManifestResponse);
  mockStoryBible(transport);
  vi.mocked(transport.getSource).mockRejectedValue(new Error("source offline"));
  render(<App transport={transport} />);
  await screen.findByRole("heading", { name: "雾城来信" });
  fireEvent.click(screen.getByRole("button", { name: /故事工坊/ }));

  expect(await screen.findByText(/无法从绑定的来源文档恢复该引文/)).toBeInTheDocument();
  expect(screen.getByText(/1 份证据文档读取失败/)).toBeInTheDocument();
});

test("shows an honest G1 dependency state instead of a fake story action", async () => {
  const transport = studioTransport([project]);
  vi.mocked(transport.getSourceManifest).mockResolvedValue({
    ...sourceManifestResponse,
    data: {
      ...sourceManifestResponse.data,
      head: { ...sourceManifestResponse.data.head, accepted_version_id: null },
    },
  });
  render(<App transport={transport} />);
  await screen.findByRole("heading", { name: "雾城来信" });

  fireEvent.click(screen.getByRole("button", { name: /故事工坊/ }));

  expect(await screen.findByRole("heading", { name: "来源尚未验收" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "等待 G1 验收" })).toBeDisabled();
  expect(transport.getStoryBibleIndex).not.toHaveBeenCalled();
});

test("recovers the story workshop after a local read failure", async () => {
  const transport = studioTransport([project]);
  vi.mocked(transport.getSourceManifest)
    .mockRejectedValueOnce(new Error("sidecar restarting"))
    .mockResolvedValueOnce(sourceManifestResponse);
  vi.mocked(transport.getStoryBibleIndex).mockResolvedValue(null);
  render(<App transport={transport} />);
  await screen.findByRole("heading", { name: "雾城来信" });

  fireEvent.click(screen.getByRole("button", { name: /故事工坊/ }));
  expect(await screen.findByRole("heading", { name: "故事工坊暂时无法读取" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "重新读取" }));

  expect(await screen.findByRole("heading", { name: "可以开始拆解小说" })).toBeInTheDocument();
  expect(transport.getSourceManifest).toHaveBeenCalledTimes(2);
  expect(transport.getStoryBibleIndex).toHaveBeenCalledWith(project.id);
});

test("distinguishes latest drafts from accepted versions and marks stale G1 bindings", async () => {
  const transport = studioTransport([project]);
  vi.mocked(transport.getSourceManifest).mockResolvedValue(sourceManifestResponse);
  const staleVersion: StoryVersion = {
    ...storyBibleResponse.data.version,
    content: {
      ...storyBibleResponse.data.version.content,
      source_scope: {
        ...storyBibleResponse.data.version.content.source_scope,
        source_manifest_version_id: `ver_${"f".repeat(32)}`,
      },
    },
  };
  mockStoryBible(transport, { latest: staleVersion, accepted: staleVersion });
  render(<App transport={transport} />);
  await screen.findByRole("heading", { name: "雾城来信" });

  fireEvent.click(screen.getByRole("button", { name: /故事工坊/ }));

  expect(await screen.findByText("故事圣经来源已过期")).toBeInTheDocument();
  expect(screen.getByText("G2 来源已过期")).toBeInTheDocument();
  expect(screen.queryByText("G2 最新版已验收")).not.toBeInTheDocument();
});

test("labels a newer draft separately from the accepted downstream baseline", async () => {
  const transport = studioTransport([project]);
  vi.mocked(transport.getSourceManifest).mockResolvedValue({
    ...sourceManifestResponse,
    data: {
      ...sourceManifestResponse.data,
      head: {
        ...sourceManifestResponse.data.head,
        accepted_version_id: `ver_${"e".repeat(32)}`,
      },
    },
  });
  const latestDraft: StoryVersion = {
    ...storyBibleResponse.data.version,
    content: {
      ...storyBibleResponse.data.version.content,
      source_scope: {
        ...storyBibleResponse.data.version.content.source_scope,
        source_manifest_version_id: `ver_${"e".repeat(32)}`,
      },
    },
  };
  const acceptedStory: StoryVersion = {
    ...latestDraft,
    id: `ver_${"d".repeat(32)}`,
    version_number: 1,
    change_summary: "下游已验收故事基线",
  };
  mockStoryBible(transport, { latest: latestDraft, accepted: acceptedStory });
  render(<App transport={transport} />);
  await screen.findByRole("heading", { name: "雾城来信" });

  fireEvent.click(screen.getByRole("button", { name: /故事工坊/ }));
  await screen.findByText("正在查看 ACCEPTED");
  fireEvent.click(screen.getByRole("button", { name: /LATESTV02/ }));

  expect(await screen.findByText("G1 最新草稿未验收")).toBeInTheDocument();
  expect(screen.getByText("G2 最新草稿未验收")).toBeInTheDocument();
  expect(screen.getByText(/下游仍使用 ver_eeeeeeee/)).toBeInTheDocument();
});

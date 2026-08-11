import type { components } from "@aijian/contracts";
import { describe, expect, test, vi } from "vitest";

import { createLocalApiClient } from "./api-client";
import { createdProposalRunResponse, proposalRunCommand } from "./proposal-run-test-fixture";

type HealthResponse = components["schemas"]["HealthResponse"];
type ProjectData = components["schemas"]["ProjectData"];
type ProjectListResponse = components["schemas"]["ProjectListResponse"];
type ProjectResponse = components["schemas"]["ProjectResponse"];
type SourceDocumentResponse = components["schemas"]["SourceDocumentResponse"];
type SourceDocumentListResponse = components["schemas"]["SourceDocumentListResponse"];
type SourceManifestResponse = components["schemas"]["SourceManifestResponse"];
type StoryBibleIndexResponse = components["schemas"]["StoryBibleIndexResponse"];
type StoryBibleVersionResponse = components["schemas"]["StoryBibleVersionResponse"];
type ProviderConnectionResponse = components["schemas"]["ProviderConnectionResponse"];
type TimelineResponse = components["schemas"]["TimelineResponse"];
type AgentCatalogResponse = components["schemas"]["AgentCatalogResponse"];
type SkillCatalogResponse = components["schemas"]["SkillCatalogResponse"];
type ArtifactProposalDraftAcceptanceResponse =
  components["schemas"]["ArtifactProposalDraftAcceptanceResponse"];
type ArtifactProposalRejectionResponse = components["schemas"]["ArtifactProposalRejectionResponse"];

const healthyResponse: HealthResponse = {
  data: { status: "ok", service: "aijian-api", version: "0.1.0" },
  request_id: "88ed7974-adc3-4e35-a5c8-38b9674fc45c",
};

const session = {
  origin: "http://127.0.0.1:43123",
  token: "s".repeat(43),
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
const projectResponse: ProjectResponse = { data: project, request_id: healthyResponse.request_id };
const projectListResponse: ProjectListResponse = {
  data: [project],
  request_id: healthyResponse.request_id,
};
const timelineResponse: TimelineResponse = {
  request_id: healthyResponse.request_id,
  data: {
    project_id: project.id,
    version_id: `ver_${"9".repeat(32)}`,
    content_hash: `sha256:${"a".repeat(64)}`,
    created_at: "2026-08-10T00:00:00Z",
    total_duration_frames: 48,
    timeline: {
      schema_version: 1,
      timeline_id: "episode-01-main",
      revision: 1,
      sequence_timebase: {
        frame_rate: { num: 24, den: 1 },
        timecode_mode: "NON_DROP_FRAME",
      },
      width: 1080,
      height: 1920,
      assets: [
        {
          schema_version: 1,
          asset_id: "shot-rain",
          source_asset_sha256: `sha256:${"a".repeat(64)}`,
          source_frame_count: 96,
          proxy: null,
        },
      ],
      clips: [
        {
          schema_version: 1,
          clip_id: "clip-rain",
          asset_id: "shot-rain",
          source_in_frame: 0,
          duration_frames: 48,
        },
      ],
    },
  },
};
const sourceResponse: SourceDocumentResponse = {
  data: {
    id: `src_${"b".repeat(32)}`,
    project_id: project.id,
    filename: "雾城来信.txt",
    media_type: "text/plain",
    encoding: "utf-8",
    byte_size: 12,
    raw_sha256: "c".repeat(64),
    imported_at: "2026-08-03T03:10:00Z",
    chapter_count: 1,
    block_count: 1,
    blocks: [
      {
        id: `srcb_${"d".repeat(32)}`,
        ordinal: 0,
        kind: "chapter_heading",
        chapter_index: 1,
        text: "第一章",
        normalized_start_byte: 0,
        normalized_end_byte: 9,
        content_sha256: "e".repeat(64),
      },
    ],
  },
  request_id: healthyResponse.request_id,
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
const sourceListResponse: SourceDocumentListResponse = {
  data: [sourceSummary],
  request_id: healthyResponse.request_id,
};
const artifactHead = {
  artifact_id: `art_${"1".repeat(32)}`,
  latest_version_id: `ver_${"2".repeat(32)}`,
  review_version_id: null,
  review_submission_id: null,
  accepted_version_id: null,
  revision: 3,
  review_evidence_revision: 1,
  updated_at: "2026-08-03T04:00:00Z",
};
const sourceManifestResponse: SourceManifestResponse = {
  data: {
    project_id: project.id,
    head: artifactHead,
    latest_version: {
      artifact_id: artifactHead.artifact_id,
      id: artifactHead.latest_version_id,
      parent_version_id: null,
      version_number: 1,
      schema_version: "1.0.0",
      content_hash: `sha256:${"4".repeat(64)}`,
      change_summary: "冻结小说来源",
      created_at: "2026-08-03T04:00:00Z",
      content: {
        scope_type: "full_work",
        exclusions: ["附录"],
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
            import_order: 0,
            blocks: sourceResponse.data.blocks.map((block) => ({
              source_block_id: block.id,
              ordinal: block.ordinal,
              kind: block.kind,
              chapter_index: block.chapter_index,
              start_byte: block.normalized_start_byte,
              end_byte: block.normalized_end_byte,
              content_sha256: block.content_sha256,
            })),
          },
        ],
      },
    },
    review_version: null,
    accepted_version: null,
  },
  request_id: healthyResponse.request_id,
};
const storyBibleResponse: StoryBibleVersionResponse = {
  data: {
    project_id: project.id,
    head: {
      ...artifactHead,
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
      version_number: 1,
      schema_version: "1.0.0",
      content_hash: `sha256:${"8".repeat(64)}`,
      change_summary: "建立故事圣经",
      created_at: "2026-08-03T04:10:00Z",
      content: {
        title: "雾城来信",
        logline: "失忆记者循着一封旧信追查雾城真相。",
        source_scope: {
          scope_type: "full_work",
          source_manifest_version_id: artifactHead.latest_version_id,
          exclusions: [],
          documents: [
            {
              source_document_id: sourceResponse.data.id,
              raw_sha256: sourceResponse.data.raw_sha256,
              chapter_indices: [1],
              source_block_ids: [sourceResponse.data.blocks[0]!.id],
            },
          ],
        },
        entities: [
          {
            entity_id: `ent_${"9".repeat(32)}`,
            kind: "character",
            name: "林见",
            aliases: ["记者"],
          },
        ],
        facts: [
          {
            fact_id: `fact_${"a".repeat(32)}`,
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
            conflict_id: `cfl_${"c".repeat(32)}`,
            conflict_type: "identity",
            fact_ids: [`fact_${"a".repeat(32)}`],
            responsible_role: "编剧",
            severity: "major",
            status: "unresolved",
          },
        ],
      },
      source_spans: [
        {
          id: `spn_${"d".repeat(32)}`,
          fact_id: `fact_${"a".repeat(32)}`,
          source_document_id: sourceResponse.data.id,
          source_block_id: sourceResponse.data.blocks[0]!.id,
          role: "supports",
          start_byte: sourceResponse.data.blocks[0]!.normalized_start_byte,
          end_byte: sourceResponse.data.blocks[0]!.normalized_end_byte,
          claim: "林见的职业是记者",
          quote_hash: `sha256:${"e".repeat(64)}`,
        },
      ],
    },
  },
  request_id: healthyResponse.request_id,
};

const storyBibleIndexResponse: StoryBibleIndexResponse = {
  data: {
    project_id: project.id,
    head: storyBibleResponse.data.head,
    latest_version: {
      artifact_id: storyBibleResponse.data.version.artifact_id,
      id: storyBibleResponse.data.version.id,
      parent_version_id: storyBibleResponse.data.version.parent_version_id,
      version_number: storyBibleResponse.data.version.version_number,
      schema_version: "1.0.0",
      content_hash: storyBibleResponse.data.version.content_hash,
      change_summary: storyBibleResponse.data.version.change_summary,
      created_at: storyBibleResponse.data.version.created_at,
    },
    review_version: null,
    accepted_version: null,
  },
  request_id: healthyResponse.request_id,
};

const taskQueueResponse: components["schemas"]["TaskQueueResponse"] = {
  data: {
    project_id: project.id,
    summary: { total: 1, attention: 0, active: 1, completed: 0 },
    tasks: [
      {
        proposal_id: null,
        node: {
          workflow_run_id: `wfr_${"1".repeat(32)}`,
          node_run_id: `node_${"2".repeat(32)}`,
          node_key: "story.extract",
          node_type: "story.extract",
          status: "PENDING",
          responsible_role: "编剧",
          upstream_gate: "G1",
          input_hash: `sha256:${"a".repeat(64)}`,
          input_version_ids: [`ver_${"3".repeat(32)}`],
          output_version_id: null,
          attempt_count: 0,
          max_attempts: 2,
          updated_at: "2026-08-04T09:30:00Z",
        },
        attempt: {
          attempt_id: `att_${"4".repeat(32)}`,
          number: 1,
          execution_mode: "local",
          status: "READY",
          provider_model: null,
          provider_job_id: null,
          retry_disposition: null,
          error_code: null,
          output_version_id: null,
          started_at: null,
          finished_at: null,
          updated_at: "2026-08-04T09:30:00Z",
        },
        task: {
          task_id: `task_${"5".repeat(32)}`,
          kind: "local.story.extract",
          status: "READY",
          priority: 70,
          available_at: "2026-08-04T09:30:00Z",
          lease_generation: 0,
          lease_expires_at: null,
          heartbeat_at: null,
          updated_at: "2026-08-04T09:30:00Z",
        },
        cost: {
          status: "NOT_RECORDED",
          currency: null,
          reserved: null,
          accrued: null,
          billed: null,
          budget_limit: null,
          retry_increment_limit: null,
        },
        presentation: {
          status_label: "等待本地执行",
          next_action_label: "等待执行器领取",
          allowed_actions: ["VIEW_DETAILS"],
        },
      },
    ],
  },
  request_id: healthyResponse.request_id,
};
const proposalId = `prp_${"6".repeat(32)}`;
const artifactProposalResponse: components["schemas"]["ArtifactProposalResponse"] = {
  data: {
    project_id: project.id,
    proposal_id: proposalId,
    producer_attempt_id: `att_${"7".repeat(32)}`,
    proposal_hash: `sha256:${"8".repeat(64)}`,
    created_at: "2026-08-11T09:00:00Z",
    proposal: {
      schema_version: "1.0.0",
      proposal_id: proposalId,
      project_id: project.id,
      target_artifact_type: "SourceExtraction",
      payload: { summary: "A source-grounded extraction" },
      payload_hash: `sha256:${"9".repeat(64)}`,
      source_spans: [
        {
          source_span_id: `spn_${"a".repeat(32)}`,
          source_document_id: `src_${"b".repeat(32)}`,
          source_block_id: `srcb_${"c".repeat(32)}`,
          start_byte: 0,
          end_byte: 12,
          claim: "The letter is unsigned.",
          quote_hash: `sha256:${"d".repeat(64)}`,
        },
      ],
      claims: [],
      diff: [],
      dependencies: [],
      impacts: [],
      cost: { currency: "USD", estimated_micros: 0, actual_micros: 0 },
      confidence_basis_points: 9200,
      capability_losses: [],
      qc: [{ check_id: "source.evidence", status: "PASS", details: "Evidence bound" }],
      producer_agent_run_id: `agr_${"e".repeat(32)}`,
      producer_skill_run_id: `skr_${"f".repeat(32)}`,
    },
  },
  request_id: healthyResponse.request_id,
};
const artifactProposalAcceptanceResponse: ArtifactProposalDraftAcceptanceResponse = {
  data: {
    acceptance_id: `pda_${"1".repeat(32)}`,
    project_id: project.id,
    proposal_id: proposalId,
    draft_version_id: `ver_${"2".repeat(32)}`,
    actor_id: "local-reviewer",
    accepted_as_draft_at: "2026-08-11T09:05:00Z",
    replayed: false,
  },
  request_id: healthyResponse.request_id,
};
const artifactProposalRejectionResponse: ArtifactProposalRejectionResponse = {
  data: {
    rejection_id: `pdr_${"3".repeat(32)}`,
    project_id: project.id,
    proposal_id: proposalId,
    proposal_hash: artifactProposalResponse.data.proposal_hash,
    reason_code: "SOURCE_EVIDENCE",
    comment: "原文证据不足。",
    actor_id: "local-reviewer",
    rejected_at: "2026-08-11T09:06:00Z",
    replayed: false,
  },
  request_id: healthyResponse.request_id,
};

const agentCatalogResponse: AgentCatalogResponse = {
  data: {
    project_id: project.id,
    agents: [
      {
        schema_version: "1.0.0",
        agent_definition_id: "writer.source-analyst",
        version: "1.0.0",
        display_name: "Source analyst",
        role: "writer",
        layer: "EXECUTION",
        responsibilities: ["Extract source facts"],
        forbidden_actions: ["Write ArtifactVersion directly"],
        skill_refs: [{ definition_id: "source.extract", version: "1.0.0" }],
        default_policy_version: "policy.local-safe@1.0.0",
        context_policy_version: "context.progressive@1.0.0",
        compatibility: {
          minimum_schema_version: "1.0.0",
          maximum_schema_version: "1.0.0",
        },
      },
    ],
  },
  request_id: healthyResponse.request_id,
};

const skillCatalogResponse: SkillCatalogResponse = {
  data: {
    project_id: project.id,
    skills: [
      {
        schema_version: "1.0.0",
        skill_definition_id: "source.extract",
        version: "1.0.0",
        display_name: "Source extraction",
        input_schema_ref: "schema://aijian/SourceExtractInput/1.0.0",
        output_schema_ref: "schema://aijian/SourceExtractionProposal/1.0.0",
        readable_artifact_types: ["SourceManifest"],
        allowed_tools: ["source.read"],
        allowed_provider_capabilities: ["LOCAL_FAKE_TEXT"],
        budget: {
          currency: "USD",
          soft_limit_micros: 0,
          hard_limit_micros: 0,
          retry_increment_limit_micros: 0,
        },
        timeout_seconds: 30,
        max_attempts: 2,
        required_gate: "G1",
        invalidation_edges: ["SourceManifest->SourceExtraction"],
        ui_renderer: "proposal.source-extraction",
        fixture_refs: ["fixture://agent-skill/contracts-v1"],
        compatibility: {
          minimum_schema_version: "1.0.0",
          maximum_schema_version: "1.0.0",
        },
      },
    ],
  },
  request_id: healthyResponse.request_id,
};

const providerConnectionResponse: ProviderConnectionResponse = {
  data: {
    id: `pcn_${"6".repeat(32)}`,
    provider_kind: "OPENAI",
    display_name: "OpenAI 主连接",
    base_url: "https://api.openai.com/v1",
    enabled: true,
    models: [{ model_id: "gpt-production", capabilities: ["TEXT"] }],
    credential_status: "CONFIGURED",
    revision: 1,
    created_at: "2026-08-04T09:30:00Z",
    updated_at: "2026-08-04T09:30:00Z",
  },
  request_id: healthyResponse.request_id,
};

const comprehensiveStoryBibleResponse: StoryBibleVersionResponse = {
  ...storyBibleResponse,
  data: {
    ...storyBibleResponse.data,
    head: {
      ...storyBibleResponse.data.head,
      review_version_id: `ver_${"9".repeat(32)}`,
      review_submission_id: `sub_${"a".repeat(32)}`,
      accepted_version_id: `ver_${"8".repeat(32)}`,
    },
    version: {
      ...storyBibleResponse.data.version,
      content: {
        ...storyBibleResponse.data.version.content,
        facts: [
          {
            fact_id: `fact_${"a".repeat(32)}`,
            kind: "character_fact",
            character_id: `ent_${"9".repeat(32)}`,
            attribute: "职业",
            value: "记者",
            importance: "core",
            canon_status: "confirmed",
            canon_certainty: "certain",
            origin: "source_explicit_assertion",
            source_reliability: "reliable",
            extraction_confidence_bps: 9_500,
            viewpoint_entity_id: `ent_${"9".repeat(32)}`,
            decision_reason: "来源明确",
            impact_scope: ["人物设定"],
            supersedes_fact_ids: [`fact_${"1".repeat(32)}`],
            derived_from_fact_ids: [`fact_${"2".repeat(32)}`],
            validity: {
              starts_after_event_fact_id: `fact_${"3".repeat(32)}`,
              ends_after_event_fact_id: null,
            },
          },
          {
            fact_id: `fact_${"1".repeat(32)}`,
            kind: "location_fact",
            location_id: `ent_${"1".repeat(32)}`,
            attribute: "天气",
            value: "多雾",
            importance: "supporting",
            canon_status: "confirmed",
            canon_certainty: "likely",
            origin: "source_explicit_assertion",
            source_reliability: "reliable",
          },
          {
            fact_id: `fact_${"2".repeat(32)}`,
            kind: "organization_fact",
            organization_id: `ent_${"2".repeat(32)}`,
            attribute: "职责",
            value: "管理档案",
            importance: "supporting",
            canon_status: "confirmed",
            canon_certainty: "certain",
            origin: "source_explicit_assertion",
            source_reliability: "reliable",
          },
          {
            fact_id: `fact_${"4".repeat(32)}`,
            kind: "relationship_fact",
            subject_entity_id: `ent_${"9".repeat(32)}`,
            predicate: "搭档",
            object_entity_id: `ent_${"4".repeat(32)}`,
            validity: null,
            importance: "core",
            canon_status: "contested",
            canon_certainty: "ambiguous",
            origin: "source_interpretation",
            viewpoint_entity_id: `ent_${"9".repeat(32)}`,
            source_reliability: "uncertain",
          },
          {
            fact_id: `fact_${"3".repeat(32)}`,
            kind: "event_fact",
            participants: [`ent_${"9".repeat(32)}`],
            location_id: `ent_${"1".repeat(32)}`,
            source_narrative_order: 2,
            story_time_order: 1,
            temporal_relations: [
              { relation: "before", other_event_fact_id: `fact_${"5".repeat(32)}` },
            ],
            caused_by_fact_ids: [`fact_${"2".repeat(32)}`],
            state_changes: [
              {
                entity_id: `ent_${"9".repeat(32)}`,
                property_key: "condition",
                before: { kind: "text", value: "平静" },
                after: { kind: "entity_ref", entity_id: `ent_${"4".repeat(32)}` },
              },
              {
                entity_id: `ent_${"9".repeat(32)}`,
                property_key: "alive",
                before: { kind: "boolean", value: true },
                after: { kind: "number", value: 1 },
              },
            ],
            importance: "core",
            canon_status: "confirmed",
            canon_certainty: "certain",
            origin: "source_explicit_assertion",
            source_reliability: "reliable",
          },
          {
            fact_id: `fact_${"5".repeat(32)}`,
            kind: "world_rule_fact",
            rule_scope: "雾城",
            rule: "雾会干扰记录",
            exceptions: ["机械钟"],
            importance: "core",
            canon_status: "proposed",
            canon_certainty: "ambiguous",
            origin: "ai_inference",
            source_reliability: "not_applicable",
          },
          {
            fact_id: `fact_${"6".repeat(32)}`,
            kind: "prop_fact",
            prop_id: `ent_${"6".repeat(32)}`,
            property_key: "holder",
            value: null,
            importance: "detail",
            canon_status: "confirmed",
            canon_certainty: "certain",
            origin: "user_decision",
            source_reliability: "not_applicable",
            decision_reason: "导演决定",
            impact_scope: ["道具连续性"],
          },
          {
            fact_id: `fact_${"7".repeat(32)}`,
            kind: "costume_fact",
            costume_id: `ent_${"7".repeat(32)}`,
            property_key: "appearance",
            value: { kind: "text", value: "灰色" },
            validity: {},
            importance: "detail",
            canon_status: "rejected",
            canon_certainty: "intentionally_unreliable",
            origin: "ai_inference",
            source_reliability: "unreliable",
          },
        ],
      },
    },
  },
};

function notFoundResponse(code: string) {
  return {
    error: { code, message: "Not found", retryable: false, details: {} },
    request_id: healthyResponse.request_id,
  };
}

describe("local API client", () => {
  test("requests health only from the configured loopback origin", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(healthyResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const client = createLocalApiClient(fetchMock, session);

    await expect(client.getHealth()).resolves.toEqual(healthyResponse);
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:43123/api/v1/health", {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${session.token}`,
        Origin: "app://aijian",
      },
    });
  });

  test.each([
    "not-a-url",
    "https://127.0.0.1:43123",
    "http://127.0.0.1",
    "http://localhost:43123",
    "http://0.0.0.0:43123",
    "http://example.com:43123",
    "http://user:password@127.0.0.1:43123",
  ])("rejects a non-canonical local API URL: %s", (origin) => {
    expect(() => createLocalApiClient(vi.fn(), { ...session, origin })).toThrow(
      "canonical loopback",
    );
  });

  test("rejects a weak sidecar token", () => {
    expect(() => createLocalApiClient(vi.fn(), { ...session, token: "short" })).toThrow(
      "valid sidecar session",
    );
  });

  test("rejects HTTP failures and malformed health payloads", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 502 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { status: "ok" } })));
    const client = createLocalApiClient(fetchMock, session);

    await expect(client.getHealth()).rejects.toThrow("status 502");
    await expect(client.getHealth()).rejects.toThrow("published contract");
  });

  test("rejects a declared local API payload above the desktop byte limit", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("{}", {
        headers: { "Content-Length": String(16 * 1024 * 1024 + 1) },
      }),
    );
    const client = createLocalApiClient(fetchMock, session);

    await expect(client.getHealth()).rejects.toThrow("desktop safety limit");
  });

  test.each([
    ["missing", undefined],
    ["incorrect", "2"],
  ])("stream-limits a local API payload with %s Content-Length", async (_label, length) => {
    const chunk = new Uint8Array(8 * 1024 * 1024);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.enqueue(new Uint8Array(1));
        controller.close();
      },
    });
    const headers = length ? { "Content-Length": length } : undefined;
    const fetchMock = vi.fn().mockResolvedValue(new Response(body, { headers }));
    const client = createLocalApiClient(fetchMock, session);

    await expect(client.getHealth()).rejects.toThrow("desktop safety limit");
  });

  test("lists, creates, and fetches projects through authenticated requests", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(projectListResponse))
      .mockResolvedValueOnce(Response.json(projectResponse, { status: 201 }))
      .mockResolvedValueOnce(Response.json(projectResponse));
    const client = createLocalApiClient(fetchMock, session);
    const input = {
      name: "雾城来信",
      aspect_ratio: "9:16" as const,
      target_duration_seconds: 90,
      source_language: "zh-CN" as const,
    };

    await expect(client.listProjects()).resolves.toEqual(projectListResponse);
    await expect(client.createProject(input)).resolves.toEqual(projectResponse);
    await expect(client.getProject(project.id)).resolves.toEqual(projectResponse);
    expect(fetchMock).toHaveBeenNthCalledWith(1, `${session.origin}/api/v1/projects`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${session.token}`,
        Origin: "app://aijian",
      },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, `${session.origin}/api/v1/projects`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${session.token}`,
        "Content-Type": "application/json",
        Origin: "app://aijian",
      },
      body: JSON.stringify(input),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      `${session.origin}/api/v1/projects/${project.id}`,
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${session.token}`,
          Origin: "app://aijian",
        },
      },
    );
  });

  test("imports one base64 text source without exposing a file path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(sourceResponse, { status: 201 }));
    const client = createLocalApiClient(fetchMock, session);
    const input = {
      filename: "雾城来信.txt",
      media_type: "text/plain" as const,
      content_base64: "5qyn5ZOl5p2l5L+hCg==",
    };

    await expect(client.importTextSource(project.id, input)).resolves.toEqual(sourceResponse);
    expect(fetchMock).toHaveBeenCalledWith(
      `${session.origin}/api/v1/projects/${project.id}/sources`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${session.token}`,
          "Content-Type": "application/json",
          Origin: "app://aijian",
        },
        body: JSON.stringify(input),
      },
    );
  });

  test("lists and restores a persisted source through constrained ids", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(sourceListResponse))
      .mockResolvedValueOnce(Response.json(sourceResponse));
    const client = createLocalApiClient(fetchMock, session);

    await expect(client.listSources(project.id)).resolves.toEqual(sourceListResponse);
    await expect(client.getSource(project.id, sourceResponse.data.id)).resolves.toEqual(
      sourceResponse,
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `${session.origin}/api/v1/projects/${project.id}/sources`,
      expect.objectContaining({ headers: expect.any(Object) }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `${session.origin}/api/v1/projects/${project.id}/sources/${sourceResponse.data.id}`,
      expect.objectContaining({ headers: expect.any(Object) }),
    );

    await expect(client.getSource(project.id, "src_unsafe/path")).rejects.toThrow(
      "valid source id",
    );
  });

  test("rejects source responses that escape the requested project or source", async () => {
    const otherProjectId = `prj_${"f".repeat(32)}`;
    const otherSourceId = `src_${"e".repeat(32)}`;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          ...sourceListResponse,
          data: [{ ...sourceSummary, project_id: otherProjectId }],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          ...sourceResponse,
          data: { ...sourceResponse.data, project_id: otherProjectId },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          ...sourceResponse,
          data: { ...sourceResponse.data, id: otherSourceId },
        }),
      );
    const client = createLocalApiClient(fetchMock, session);

    await expect(client.listSources(project.id)).rejects.toThrow("published contract");
    await expect(client.getSource(project.id, sourceResponse.data.id)).rejects.toThrow(
      "published contract",
    );
    await expect(client.getSource(project.id, sourceResponse.data.id)).rejects.toThrow(
      "published contract",
    );
  });

  test("rejects malformed renderer inputs before making a local request", async () => {
    const fetchMock = vi.fn();
    const client = createLocalApiClient(fetchMock, session);

    await expect(client.getProject("../workspace.sqlite3")).rejects.toThrow("valid project id");
    await expect(client.listSources("../workspace.sqlite3")).rejects.toThrow("valid project id");
    await expect(client.getSource("../workspace.sqlite3", sourceResponse.data.id)).rejects.toThrow(
      "valid project id",
    );
    await expect(
      client.createProject({
        name: " ",
        aspect_ratio: "9:16",
        target_duration_seconds: 90,
        source_language: "zh-CN",
      }),
    ).rejects.toThrow("valid project input");
    await expect(
      client.importTextSource(project.id, {
        filename: "story.txt",
        media_type: "text/plain",
        content_base64: "not base64",
      }),
    ).rejects.toThrow("valid text source input");
    await expect(
      client.importTextSource("../workspace.sqlite3", {
        filename: "story.txt",
        media_type: "text/plain",
        content_base64: "5p2l5L+hCg==",
      }),
    ).rejects.toThrow("valid project id");
    await expect(client.getSourceManifest("../workspace.sqlite3")).rejects.toThrow(
      "valid project id",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("rejects malformed project and source responses", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ data: [{ name: "missing id" }] }))
      .mockResolvedValueOnce(Response.json({ data: { ...sourceResponse.data, blocks: [] } }));
    const client = createLocalApiClient(fetchMock, session);

    await expect(client.listProjects()).rejects.toThrow("published contract");
    await expect(
      client.importTextSource(project.id, {
        filename: "story.txt",
        media_type: "text/plain",
        content_base64: "5p2l5L+hCg==",
      }),
    ).rejects.toThrow("published contract");
  });

  test("reads G1 and G2 artifacts through constrained public routes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(sourceManifestResponse))
      .mockResolvedValueOnce(Response.json(storyBibleIndexResponse))
      .mockResolvedValueOnce(Response.json(storyBibleResponse));
    const client = createLocalApiClient(fetchMock, session);

    await expect(client.getSourceManifest(project.id)).resolves.toEqual(sourceManifestResponse);
    await expect(client.getStoryBibleIndex(project.id)).resolves.toEqual(storyBibleIndexResponse);
    await expect(
      client.getStoryBibleVersion(project.id, storyBibleResponse.data.version.id),
    ).resolves.toEqual(storyBibleResponse);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `${session.origin}/api/v1/projects/${project.id}/source-manifest`,
      expect.objectContaining({ headers: expect.any(Object) }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `${session.origin}/api/v1/projects/${project.id}/story-bible`,
      expect.objectContaining({ headers: expect.any(Object) }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      `${session.origin}/api/v1/projects/${project.id}/story-bible/versions/${storyBibleResponse.data.version.id}`,
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  test("reads a project-scoped task queue and rejects secret-shaped extra fields", async () => {
    const validClient = createLocalApiClient(
      vi.fn().mockResolvedValue(Response.json(taskQueueResponse)),
      session,
    );
    await expect(validClient.listProjectTasks(project.id)).resolves.toEqual(taskQueueResponse);

    const invalidPayload = structuredClone(taskQueueResponse) as unknown as Record<string, unknown>;
    const data = invalidPayload.data as { tasks: Array<{ task: Record<string, unknown> }> };
    data.tasks[0]!.task.lease_token = "must-not-cross-ipc";
    const invalidClient = createLocalApiClient(
      vi.fn().mockResolvedValue(Response.json(invalidPayload)),
      session,
    );
    await expect(invalidClient.listProjectTasks(project.id)).rejects.toThrow("published contract");

    const invalidProposal = structuredClone(taskQueueResponse);
    invalidProposal.data.tasks[0]!.proposal_id = "prp_not-canonical";
    const invalidProposalClient = createLocalApiClient(
      vi.fn().mockResolvedValue(Response.json(invalidProposal)),
      session,
    );
    await expect(invalidProposalClient.listProjectTasks(project.id)).rejects.toThrow(
      "published contract",
    );
  });

  test("reads and validates a project-scoped artifact proposal", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(artifactProposalResponse));
    const client = createLocalApiClient(fetchMock, session);

    await expect(client.getArtifactProposal(project.id, proposalId)).resolves.toEqual(
      artifactProposalResponse,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `${session.origin}/api/v1/projects/${project.id}/proposals/${proposalId}`,
      expect.objectContaining({ headers: expect.any(Object) }),
    );

    const detached = structuredClone(artifactProposalResponse);
    detached.data.proposal.project_id = `prj_${"0".repeat(32)}`;
    const detachedClient = createLocalApiClient(
      vi.fn().mockResolvedValue(Response.json(detached)),
      session,
    );
    await expect(detachedClient.getArtifactProposal(project.id, proposalId)).rejects.toThrow(
      "published contract",
    );
    await expect(client.getArtifactProposal(project.id, "not-a-proposal")).rejects.toThrow(
      "valid proposal id",
    );
  });

  test("submits deterministic proposal decisions with normalized inputs", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(artifactProposalAcceptanceResponse, { status: 201 }))
      .mockResolvedValueOnce(Response.json(artifactProposalAcceptanceResponse))
      .mockResolvedValueOnce(Response.json(artifactProposalRejectionResponse, { status: 201 }));
    const client = createLocalApiClient(fetchMock, session);

    const acceptanceInput = { parent_version_id: null, expected_head_revision: null };
    await expect(
      client.acceptArtifactProposalAsDraft(project.id, proposalId, acceptanceInput),
    ).resolves.toEqual({ kind: "SUCCEEDED", receipt: artifactProposalAcceptanceResponse });
    await client.acceptArtifactProposalAsDraft(project.id, proposalId, acceptanceInput);
    await expect(
      client.rejectArtifactProposal(project.id, proposalId, {
        reason_code: "SOURCE_EVIDENCE",
        comment: "  原文证据不足。\r\n  ",
      }),
    ).resolves.toEqual({ kind: "SUCCEEDED", receipt: artifactProposalRejectionResponse });

    const firstInit = fetchMock.mock.calls[0]![1] as RequestInit;
    const secondInit = fetchMock.mock.calls[1]![1] as RequestInit;
    const thirdInit = fetchMock.mock.calls[2]![1] as RequestInit;
    expect(new Headers(firstInit.headers).get("Idempotency-Key")).toMatch(
      /^proposal-accept:sha256:[0-9a-f]{64}$/,
    );
    expect(new Headers(secondInit.headers).get("Idempotency-Key")).toBe(
      new Headers(firstInit.headers).get("Idempotency-Key"),
    );
    expect(new Headers(thirdInit.headers).get("Idempotency-Key")).toMatch(
      /^proposal-reject:sha256:[0-9a-f]{64}$/,
    );
    expect(thirdInit.body).toBe(
      JSON.stringify({ reason_code: "SOURCE_EVIDENCE", comment: "原文证据不足。" }),
    );
  });

  test("separates definite decision failures from remote unknown results", async () => {
    const errorPayload = {
      error: {
        code: "ARTIFACT_PROPOSAL_ACCEPTANCE_CONFLICT",
        message: "conflict",
        retryable: false,
        details: {},
      },
      request_id: healthyResponse.request_id,
    };
    const definiteClient = createLocalApiClient(
      vi.fn().mockResolvedValue(Response.json(errorPayload, { status: 409 })),
      session,
    );
    await expect(
      definiteClient.acceptArtifactProposalAsDraft(project.id, proposalId, {
        parent_version_id: null,
        expected_head_revision: null,
      }),
    ).resolves.toEqual({
      kind: "DEFINITE_SERVER_ERROR",
      status: 409,
      code: "ARTIFACT_PROPOSAL_ACCEPTANCE_CONFLICT",
      request_id: healthyResponse.request_id,
    });

    for (const fetcher of [
      vi.fn().mockRejectedValue(new Error("connection reset")),
      vi.fn().mockResolvedValue(Response.json({ malformed: true }, { status: 201 })),
      vi.fn().mockResolvedValue(Response.json(errorPayload, { status: 500 })),
    ]) {
      const unknownClient = createLocalApiClient(fetcher, session);
      await expect(
        unknownClient.acceptArtifactProposalAsDraft(project.id, proposalId, {
          parent_version_id: null,
          expected_head_revision: null,
        }),
      ).resolves.toEqual({ kind: "REMOTE_UNKNOWN" });
    }
  });

  test("rejects malformed proposal decision input before HTTP", async () => {
    const fetchMock = vi.fn();
    const client = createLocalApiClient(fetchMock, session);
    await expect(
      client.rejectArtifactProposal(project.id, proposalId, {
        reason_code: "SOURCE_EVIDENCE",
        comment: "\u0007",
      }),
    ).rejects.toThrow("valid proposal rejection input");
    await expect(
      client.acceptArtifactProposalAsDraft(project.id, proposalId, {
        parent_version_id: `ver_${"4".repeat(32)}`,
        expected_head_revision: null,
      }),
    ).rejects.toThrow("valid proposal acceptance input");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("reads project-scoped Agent and Skill catalogs through the authenticated client", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(agentCatalogResponse))
      .mockResolvedValueOnce(Response.json(skillCatalogResponse));
    const client = createLocalApiClient(fetchMock, session);

    await expect(client.listProjectAgents(project.id)).resolves.toEqual(agentCatalogResponse);
    await expect(client.listProjectSkills(project.id)).resolves.toEqual(skillCatalogResponse);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `${session.origin}/api/v1/projects/${project.id}/agents`,
      expect.objectContaining({ headers: expect.any(Object) }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `${session.origin}/api/v1/projects/${project.id}/skills`,
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  test("keeps proposal run operation identity stable for remote-unknown retries", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("connection reset"));
    const client = createLocalApiClient(fetchMock, session);

    await expect(client.createProposalRun(project.id, proposalRunCommand)).resolves.toEqual({
      kind: "REMOTE_UNKNOWN",
    });
    await expect(client.createProposalRun(project.id, proposalRunCommand)).resolves.toEqual({
      kind: "REMOTE_UNKNOWN",
    });
    const first = fetchMock.mock.calls[0]![1] as RequestInit;
    const second = fetchMock.mock.calls[1]![1] as RequestInit;
    expect(new Headers(first.headers).get("Idempotency-Key")).toBe(
      `proposal-run:create:v1:${proposalRunCommand.operation_id}`,
    );
    expect(new Headers(second.headers).get("Idempotency-Key")).toBe(
      new Headers(first.headers).get("Idempotency-Key"),
    );
  });

  test("distinguishes fresh proposal runs from exact server replays", async () => {
    const receipt = createdProposalRunResponse();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(receipt, { status: 201 }))
      .mockResolvedValueOnce(Response.json(receipt, { status: 200 }));
    const client = createLocalApiClient(fetchMock, session);

    await expect(client.createProposalRun(project.id, proposalRunCommand)).resolves.toEqual({
      kind: "SUCCEEDED",
      receipt,
      replayed: false,
    });
    await expect(client.createProposalRun(project.id, proposalRunCommand)).resolves.toEqual({
      kind: "SUCCEEDED",
      receipt,
      replayed: true,
    });
    expect((fetchMock.mock.calls[0]![1] as RequestInit).body).toBe(
      JSON.stringify(proposalRunCommand.input),
    );
  });

  test("separates operation identity from otherwise identical run inputs", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("unknown"));
    const client = createLocalApiClient(fetchMock, session);
    const secondOperation = {
      ...proposalRunCommand,
      operation_id: "87302cb8-71f8-4bb9-856a-162571f1ae6e",
    };
    const changedInput = {
      ...proposalRunCommand,
      input: { ...proposalRunCommand.input, end_byte: 25 },
    };

    await client.createProposalRun(project.id, proposalRunCommand);
    await client.createProposalRun(project.id, changedInput);
    await client.createProposalRun(project.id, secondOperation);
    const keys = fetchMock.mock.calls.map((call) =>
      new Headers((call[1] as RequestInit).headers).get("Idempotency-Key"),
    );
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
    expect((fetchMock.mock.calls[1]![1] as RequestInit).body).toBe(
      JSON.stringify(changedInput.input),
    );
  });

  test("classifies only contract-valid proposal run client failures as definite", async () => {
    const errorPayload = {
      error: { code: "PROPOSAL_RUN_CONFLICT", message: "conflict", retryable: false, details: {} },
      request_id: healthyResponse.request_id,
    };
    for (const status of [401, 403, 404, 409, 422]) {
      const client = createLocalApiClient(
        vi.fn().mockResolvedValue(Response.json(errorPayload, { status })),
        session,
      );
      await expect(client.createProposalRun(project.id, proposalRunCommand)).resolves.toEqual({
        kind: "DEFINITE_SERVER_ERROR",
        status,
        code: "PROPOSAL_RUN_CONFLICT",
        request_id: healthyResponse.request_id,
      });
    }
    for (const response of [
      Response.json(errorPayload, { status: 500 }),
      Response.json({ ...errorPayload, extra: true }, { status: 409 }),
      Response.json(createdProposalRunResponse(), { status: 202 }),
    ]) {
      const client = createLocalApiClient(vi.fn().mockResolvedValue(response), session);
      await expect(client.createProposalRun(project.id, proposalRunCommand)).resolves.toEqual({
        kind: "REMOTE_UNKNOWN",
      });
    }
  });

  test("rejects unsupported proposal run commands before HTTP", async () => {
    const fetchMock = vi.fn();
    const client = createLocalApiClient(fetchMock, session);
    await expect(
      client.createProposalRun(project.id, {
        ...proposalRunCommand,
        input: { ...proposalRunCommand.input, end_byte: 0 },
      }),
    ).rejects.toThrow("valid proposal run command");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("rejects malformed catalog metadata and invalid project ids before transport", async () => {
    const malformed = structuredClone(agentCatalogResponse) as unknown as Record<string, unknown>;
    const data = malformed.data as { agents: Array<Record<string, unknown>> };
    data.agents[0]!.prompt_text = "must not cross the boundary";
    const malformedClient = createLocalApiClient(
      vi.fn().mockResolvedValue(Response.json(malformed)),
      session,
    );
    await expect(malformedClient.listProjectAgents(project.id)).rejects.toThrow(
      "published contract",
    );

    const malformedSkill = structuredClone(skillCatalogResponse) as unknown as Record<
      string,
      unknown
    >;
    const skillData = malformedSkill.data as { skills: Array<Record<string, unknown>> };
    const skillBudget = skillData.skills[0]!.budget as Record<string, unknown>;
    skillBudget.api_key = "must not cross the boundary";
    const malformedSkillClient = createLocalApiClient(
      vi.fn().mockResolvedValue(Response.json(malformedSkill)),
      session,
    );
    await expect(malformedSkillClient.listProjectSkills(project.id)).rejects.toThrow(
      "published contract",
    );

    const wrongProject = structuredClone(agentCatalogResponse);
    wrongProject.data.project_id = `prj_${"b".repeat(32)}`;
    const wrongProjectClient = createLocalApiClient(
      vi.fn().mockResolvedValue(Response.json(wrongProject)),
      session,
    );
    await expect(wrongProjectClient.listProjectAgents(project.id)).rejects.toThrow(
      "published contract",
    );

    const unsafeBudget = structuredClone(skillCatalogResponse);
    unsafeBudget.data.skills[0]!.budget.hard_limit_micros = Number.MAX_SAFE_INTEGER + 1;
    const unsafeBudgetClient = createLocalApiClient(
      vi.fn().mockResolvedValue(Response.json(unsafeBudget)),
      session,
    );
    await expect(unsafeBudgetClient.listProjectSkills(project.id)).rejects.toThrow(
      "published contract",
    );

    const fetchMock = vi.fn();
    const client = createLocalApiClient(fetchMock, session);
    await expect(client.listProjectSkills("../workspace.sqlite3")).rejects.toThrow(
      "valid project id",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("counts catalog string limits by Unicode code point", async () => {
    const unicodeCatalog = structuredClone(agentCatalogResponse);
    unicodeCatalog.data.agents[0]!.display_name = "😀".repeat(80);
    const client = createLocalApiClient(
      vi.fn().mockResolvedValue(Response.json(unicodeCatalog)),
      session,
    );

    await expect(client.listProjectAgents(project.id)).resolves.toEqual(unicodeCatalog);
  });

  test("validates provider connections across the privileged desktop boundary", async () => {
    const listResponse = {
      data: [providerConnectionResponse.data],
      request_id: healthyResponse.request_id,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(listResponse))
      .mockResolvedValueOnce(Response.json(providerConnectionResponse, { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = createLocalApiClient(fetchMock, session);
    const input = {
      provider_kind: "OPENAI" as const,
      display_name: "OpenAI 主连接",
      base_url: "https://api.openai.com/v1",
      enabled: true,
      models: [{ model_id: "gpt-production", capabilities: ["TEXT" as const] }],
      api_key: "sk-test-only",
    };

    await expect(client.listProviderConnections()).resolves.toEqual(listResponse);
    await expect(client.createProviderConnection(input)).resolves.toEqual(
      providerConnectionResponse,
    );
    await expect(client.deleteProviderConnection(providerConnectionResponse.data.id)).resolves.toBe(
      undefined,
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `${session.origin}/api/v1/provider-connections`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(input),
      }),
    );
  });

  test("rejects provider secrets in responses and unsafe renderer inputs", async () => {
    const secretShaped = structuredClone(providerConnectionResponse) as unknown as {
      data: Record<string, unknown>;
    };
    secretShaped.data.api_key = "must-not-cross-ipc";
    const responseClient = createLocalApiClient(
      vi.fn().mockResolvedValue(Response.json(secretShaped)),
      session,
    );
    await expect(
      responseClient.createProviderConnection({
        provider_kind: "OLLAMA",
        display_name: "本机",
        base_url: "http://127.0.0.1:11434/v1",
        enabled: true,
        models: [{ model_id: "qwen-local", capabilities: ["TEXT"] }],
      }),
    ).rejects.toThrow("published contract");

    const fetchMock = vi.fn();
    const inputClient = createLocalApiClient(fetchMock, session);
    await expect(
      inputClient.createProviderConnection({
        provider_kind: "OPENAI",
        display_name: "不安全",
        base_url: "http://api.example.com/v1",
        enabled: true,
        models: [],
        api_key: "sk-test-only",
      }),
    ).rejects.toThrow("valid provider connection input");
    for (const unsafeInput of [
      {
        provider_kind: "OPENAI" as const,
        display_name: "伪造 OpenAI",
        base_url: "https://evil.example/v1",
        enabled: true,
        models: [{ model_id: "gpt-production", capabilities: ["TEXT" as const] }],
        api_key: "sk-test-only",
      },
      {
        provider_kind: "XAI" as const,
        display_name: "错误 xAI",
        base_url: "https://api.openai.com/v1",
        enabled: true,
        models: [{ model_id: "grok-production", capabilities: ["TEXT" as const] }],
        api_key: "xai-test-only",
      },
      {
        provider_kind: "OLLAMA" as const,
        display_name: "远程 Ollama",
        base_url: "https://ollama.example/v1",
        enabled: true,
        models: [{ model_id: "qwen-remote", capabilities: ["TEXT" as const] }],
      },
      {
        provider_kind: "OPENAI_COMPATIBLE" as const,
        display_name: "本地兼容",
        base_url: "http://127.0.0.1:9000/v1",
        enabled: true,
        models: [{ model_id: "local-compatible", capabilities: ["TEXT" as const] }],
        api_key: "compatible-test",
      },
      {
        provider_kind: "OPENAI_COMPATIBLE" as const,
        display_name: "私网兼容",
        base_url: "https://169.254.169.254/latest/meta-data",
        enabled: true,
        models: [{ model_id: "private-compatible", capabilities: ["TEXT" as const] }],
        api_key: "compatible-test",
      },
      {
        provider_kind: "OPENAI_COMPATIBLE" as const,
        display_name: "组播兼容",
        base_url: "https://[ff02::1]/v1",
        enabled: true,
        models: [{ model_id: "multicast-compatible", capabilities: ["TEXT" as const] }],
        api_key: "compatible-test",
      },
    ]) {
      await expect(inputClient.createProviderConnection(unsafeInput)).rejects.toThrow(
        "valid provider connection input",
      );
    }
    await expect(inputClient.deleteProviderConnection("pcn_unsafe")).rejects.toThrow(
      "valid provider connection id",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("surfaces provider deletion failures", async () => {
    const client = createLocalApiClient(
      vi.fn().mockResolvedValue(new Response(null, { status: 503 })),
      session,
    );

    await expect(
      client.deleteProviderConnection(providerConnectionResponse.data.id),
    ).rejects.toThrow("status 503");
  });

  test("preserves a typed credential-cleanup error across the desktop boundary", async () => {
    const errorResponse = {
      error: {
        code: "CREDENTIAL_CLEANUP_REQUIRED",
        message: "cleanup required",
        details: {},
        retryable: false,
      },
      request_id: healthyResponse.request_id,
    };
    const client = createLocalApiClient(
      vi.fn().mockResolvedValue(Response.json(errorResponse, { status: 503 })),
      session,
    );

    await expect(
      client.createProviderConnection({
        provider_kind: "OPENAI",
        display_name: "OpenAI 主连接",
        base_url: "https://api.openai.com/v1",
        enabled: true,
        models: [{ model_id: "gpt-production", capabilities: ["TEXT"] }],
        api_key: "sk-test-only",
      }),
    ).rejects.toThrow("CREDENTIAL_CLEANUP_REQUIRED");
  });

  test("accepts every typed fact variant and exact historical story roles", async () => {
    const client = createLocalApiClient(
      vi.fn().mockResolvedValue(Response.json(comprehensiveStoryBibleResponse)),
      session,
    );

    await expect(
      client.getStoryBibleVersion(project.id, comprehensiveStoryBibleResponse.data.version.id),
    ).resolves.toEqual(comprehensiveStoryBibleResponse);
  });

  test("represents an artifact not found without weakening other response checks", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(notFoundResponse("SOURCE_MANIFEST_NOT_FOUND"), { status: 404 }),
      )
      .mockResolvedValueOnce(Response.json({ data: { head: {} } }));
    const client = createLocalApiClient(fetchMock, session);

    await expect(client.getSourceManifest(project.id)).resolves.toBeNull();
    await expect(client.getStoryBibleIndex(project.id)).rejects.toThrow("published contract");
    await expect(client.getStoryBibleIndex("../unsafe")).rejects.toThrow("valid project id");
    await expect(client.getStoryBibleVersion(project.id, "ver_unsafe")).rejects.toThrow(
      "valid version id",
    );
  });

  test("does not collapse a missing project into an absent child artifact", async () => {
    const client = createLocalApiClient(
      vi
        .fn()
        .mockResolvedValue(Response.json(notFoundResponse("PROJECT_NOT_FOUND"), { status: 404 })),
      session,
    );

    await expect(client.getStoryBibleIndex(project.id)).rejects.toThrow("PROJECT_NOT_FOUND");
  });

  test("rejects malformed nested artifact records at the desktop trust boundary", async () => {
    const malformedPayloads: Array<{
      target: "manifest" | "story_index" | "story_version";
      payload: unknown;
    }> = [
      {
        target: "manifest",
        payload: {
          ...sourceManifestResponse,
          data: { ...sourceManifestResponse.data, project_id: `prj_${"f".repeat(32)}` },
        },
      },
      {
        target: "manifest",
        payload: {
          ...sourceManifestResponse,
          data: { ...sourceManifestResponse.data, head: null },
        },
      },
      {
        target: "manifest",
        payload: {
          ...sourceManifestResponse,
          data: { ...sourceManifestResponse.data, latest_version: null },
        },
      },
      {
        target: "manifest",
        payload: {
          ...sourceManifestResponse,
          data: {
            ...sourceManifestResponse.data,
            latest_version: {
              ...sourceManifestResponse.data.latest_version,
              content: { scope_type: "full_work", documents: [null] },
            },
          },
        },
      },
      {
        target: "manifest",
        payload: {
          ...sourceManifestResponse,
          data: {
            ...sourceManifestResponse.data,
            latest_version: {
              ...sourceManifestResponse.data.latest_version,
              content: {
                ...sourceManifestResponse.data.latest_version.content,
                documents: [
                  {
                    ...sourceManifestResponse.data.latest_version.content.documents[0],
                    blocks: [null],
                  },
                ],
              },
            },
          },
        },
      },
      {
        target: "story_index",
        payload: {
          ...storyBibleIndexResponse,
          data: {
            ...storyBibleIndexResponse.data,
            latest_version: {
              ...storyBibleIndexResponse.data.latest_version,
              content: { must_not_cross_index_boundary: true },
            },
          },
        },
      },
      {
        target: "story_version",
        payload: {
          ...storyBibleResponse,
          data: {
            ...storyBibleResponse.data,
            confirmation_token: "must-not-cross-renderer-boundary",
          },
        },
      },
      {
        target: "story_version",
        payload: {
          ...storyBibleResponse,
          data: {
            ...storyBibleResponse.data,
            version: {
              ...storyBibleResponse.data.version,
              content: {
                ...storyBibleResponse.data.version.content,
                facts: [
                  {
                    fact_id: `fact_${"a".repeat(32)}`,
                    kind: "event_fact",
                    importance: "core",
                    canon_status: "confirmed",
                    canon_certainty: "certain",
                    origin: "source_explicit_assertion",
                    source_reliability: "reliable",
                    source_narrative_order: 0,
                    story_time_order: 0,
                  },
                ],
              },
            },
          },
        },
      },
      {
        target: "story_version",
        payload: {
          ...storyBibleResponse,
          data: {
            ...storyBibleResponse.data,
            head: {
              ...storyBibleResponse.data.head,
              artifact_id: `art_${"f".repeat(32)}`,
            },
          },
        },
      },
      {
        target: "story_version",
        payload: {
          ...storyBibleResponse,
          data: {
            ...storyBibleResponse.data,
            version: {
              ...storyBibleResponse.data.version,
              content: { ...storyBibleResponse.data.version.content, entities: [null] },
            },
          },
        },
      },
      {
        target: "story_version",
        payload: {
          ...storyBibleResponse,
          data: {
            ...storyBibleResponse.data,
            version: {
              ...storyBibleResponse.data.version,
              content: { ...storyBibleResponse.data.version.content, facts: [null] },
            },
          },
        },
      },
      {
        target: "story_version",
        payload: {
          ...storyBibleResponse,
          data: {
            ...storyBibleResponse.data,
            version: {
              ...storyBibleResponse.data.version,
              content: { ...storyBibleResponse.data.version.content, questions: [null] },
            },
          },
        },
      },
      {
        target: "story_version",
        payload: {
          ...storyBibleResponse,
          data: {
            ...storyBibleResponse.data,
            version: {
              ...storyBibleResponse.data.version,
              content: { ...storyBibleResponse.data.version.content, conflicts: [null] },
            },
          },
        },
      },
      {
        target: "story_version",
        payload: {
          ...storyBibleResponse,
          data: {
            ...storyBibleResponse.data,
            version: {
              ...storyBibleResponse.data.version,
              source_spans: [null],
            },
          },
        },
      },
    ];
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => Response.json(malformedPayloads.shift()?.payload));
    const client = createLocalApiClient(fetchMock, session);

    for (const record of [...malformedPayloads]) {
      const request =
        record.target === "manifest"
          ? client.getSourceManifest(project.id)
          : record.target === "story_index"
            ? client.getStoryBibleIndex(project.id)
            : client.getStoryBibleVersion(project.id, storyBibleResponse.data.version.id);
      await expect(request).rejects.toThrow("published contract");
    }
  });

  test("reads and edits a validated project timeline through the sidecar", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => Response.json(timelineResponse));
    const client = createLocalApiClient(fetchMock, session);

    await expect(client.getProjectTimeline(project.id)).resolves.toEqual(timelineResponse);
    await expect(client.startFakeTimelineWorkflow(project.id)).resolves.toEqual(timelineResponse);
    await client.trimTimelineClip(project.id, {
      clip_id: "clip-rain",
      new_source_in_frame: 2,
      new_duration_frames: 40,
      expected_revision: 1,
    });
    await client.reorderTimelineClip(project.id, {
      clip_id: "clip-rain",
      new_index: 0,
      expected_revision: 1,
    });
    await client.replaceTimelineClip(project.id, {
      clip_id: "clip-rain",
      replacement_asset_id: "shot-rain",
      replacement_source_in_frame: 4,
      expected_revision: 1,
    });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `${session.origin}/api/v1/projects/${project.id}/timeline`,
      `${session.origin}/api/v1/projects/${project.id}/workflows/fake-timeline`,
      `${session.origin}/api/v1/projects/${project.id}/timeline/trim`,
      `${session.origin}/api/v1/projects/${project.id}/timeline/reorder`,
      `${session.origin}/api/v1/projects/${project.id}/timeline/replace`,
    ]);
  });

  test("returns null only for the typed missing-timeline response", async () => {
    const client = createLocalApiClient(
      vi
        .fn()
        .mockResolvedValue(Response.json(notFoundResponse("TIMELINE_NOT_FOUND"), { status: 404 })),
      session,
    );
    await expect(client.getProjectTimeline(project.id)).resolves.toBeNull();
  });

  test("rejects a timeline whose proxy timebase differs from its sequence", async () => {
    const mismatched = structuredClone(timelineResponse);
    const asset = mismatched.data.timeline.assets[0];
    if (asset === undefined) throw new Error("timeline fixture asset is missing");
    asset.proxy = {
      schema_version: 1,
      mapping_schema_version: 1,
      proxy_asset_sha256: `sha256:${"b".repeat(64)}`,
      editable_frame_count: 96,
      sequence_timebase: {
        frame_rate: { num: 25, den: 1 },
        timecode_mode: "NON_DROP_FRAME",
      },
    };
    const client = createLocalApiClient(
      vi.fn().mockResolvedValue(Response.json(mismatched)),
      session,
    );

    await expect(client.getProjectTimeline(project.id)).rejects.toThrow("published contract");
  });

  test("does not treat non-404 artifact failures as an absent artifact", async () => {
    const client = createLocalApiClient(
      vi.fn().mockResolvedValue(new Response(null, { status: 503 })),
      session,
    );

    await expect(client.getSourceManifest(project.id)).rejects.toThrow("status 503");
  });
});

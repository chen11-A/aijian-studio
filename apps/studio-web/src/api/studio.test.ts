import { afterEach, describe, expect, test, vi } from "vitest";

import {
  createStudioTransport,
  type HealthResponse,
  type AgentCatalogResponse,
  type ArtifactProposalResponse,
  type ProjectData,
  type SourceManifestResponse,
  type SkillCatalogResponse,
  type StoryBibleIndexResponse,
  type StoryBibleVersionResponse,
  type TaskQueueResponse,
  type TimelineResponse,
} from "./studio";

const requestId = "e6225937-1243-427b-bc98-56eda28e9dd3";
const health: HealthResponse = {
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
const sourceManifest = {
  data: {
    project_id: project.id,
    head: {
      artifact_id: `art_${"1".repeat(32)}`,
      latest_version_id: `ver_${"2".repeat(32)}`,
      review_version_id: `ver_${"2".repeat(32)}`,
      review_submission_id: `sub_${"3".repeat(32)}`,
      accepted_version_id: `ver_${"2".repeat(32)}`,
      revision: 3,
      review_evidence_revision: 1,
      updated_at: "2026-08-03T04:00:00Z",
    },
    latest_version: {
      artifact_id: `art_${"1".repeat(32)}`,
      id: `ver_${"2".repeat(32)}`,
      parent_version_id: null,
      version_number: 1,
      schema_version: "1.0.0",
      content_hash: `sha256:${"4".repeat(64)}`,
      change_summary: "冻结小说来源",
      created_at: "2026-08-03T04:00:00Z",
      content: { scope_type: "full_work", documents: [] },
    },
    review_version: null,
    accepted_version: null,
  },
  request_id: requestId,
} satisfies SourceManifestResponse;
const storyBibleVersion = {
  data: {
    project_id: project.id,
    head: {
      ...sourceManifest.data.head,
      artifact_id: `art_${"5".repeat(32)}`,
      latest_version_id: `ver_${"6".repeat(32)}`,
      review_version_id: null,
      review_submission_id: null,
      accepted_version_id: null,
    },
    version: {
      artifact_id: `art_${"5".repeat(32)}`,
      id: `ver_${"6".repeat(32)}`,
      parent_version_id: null,
      version_number: 1,
      schema_version: "1.0.0",
      content_hash: `sha256:${"7".repeat(64)}`,
      change_summary: "建立故事圣经",
      created_at: "2026-08-03T04:10:00Z",
      content: {
        title: "雾城来信",
        logline: "失忆记者循着一封旧信追查雾城真相。",
        source_scope: {
          scope_type: "full_work",
          source_manifest_version_id: sourceManifest.data.latest_version.id,
          documents: [],
        },
        entities: [],
        facts: [],
      },
      source_spans: [],
    },
  },
  request_id: requestId,
} satisfies StoryBibleVersionResponse;
const storyBibleIndex = {
  data: {
    project_id: project.id,
    head: storyBibleVersion.data.head,
    latest_version: {
      artifact_id: storyBibleVersion.data.version.artifact_id,
      id: storyBibleVersion.data.version.id,
      parent_version_id: storyBibleVersion.data.version.parent_version_id,
      version_number: storyBibleVersion.data.version.version_number,
      schema_version: "1.0.0",
      content_hash: storyBibleVersion.data.version.content_hash,
      change_summary: storyBibleVersion.data.version.change_summary,
      created_at: storyBibleVersion.data.version.created_at,
    },
    review_version: null,
    accepted_version: null,
  },
  request_id: requestId,
} satisfies StoryBibleIndexResponse;
const taskQueue = {
  data: {
    project_id: project.id,
    summary: { total: 0, attention: 0, active: 0, completed: 0 },
    tasks: [],
  },
  request_id: requestId,
} satisfies TaskQueueResponse;
const proposalId = `prp_${"2".repeat(32)}`;
const artifactProposal = {
  data: {
    project_id: project.id,
    proposal_id: proposalId,
    producer_attempt_id: `att_${"3".repeat(32)}`,
    proposal_hash: `sha256:${"4".repeat(64)}`,
    created_at: "2026-08-11T09:00:00Z",
    proposal: {
      schema_version: "1.0.0",
      proposal_id: proposalId,
      project_id: project.id,
      target_artifact_type: "SourceExtraction",
      payload: { summary: "A source-grounded extraction" },
      payload_hash: `sha256:${"5".repeat(64)}`,
      source_spans: [
        {
          source_span_id: `spn_${"6".repeat(32)}`,
          source_document_id: `src_${"7".repeat(32)}`,
          source_block_id: `srcb_${"8".repeat(32)}`,
          start_byte: 0,
          end_byte: 12,
          claim: "The letter is unsigned.",
          quote_hash: `sha256:${"9".repeat(64)}`,
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
      producer_agent_run_id: `agr_${"b".repeat(32)}`,
      producer_skill_run_id: `skr_${"c".repeat(32)}`,
    },
  },
  request_id: requestId,
} satisfies ArtifactProposalResponse;
const agentCatalog = {
  data: { project_id: project.id, agents: [] },
  request_id: requestId,
} satisfies AgentCatalogResponse;
const skillCatalog = {
  data: { project_id: project.id, skills: [] },
  request_id: requestId,
} satisfies SkillCatalogResponse;
const providerConnections = { data: [], request_id: requestId };
const timeline = {
  data: {
    project_id: project.id,
    version_id: `ver_${"8".repeat(32)}`,
    content_hash: `sha256:${"9".repeat(64)}`,
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
          source_asset_sha256: `sha256:${"a".repeat(64)}`,
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

afterEach(() => {
  delete window.aijian;
  vi.unstubAllGlobals();
});

describe("studio transport", () => {
  test("uses the narrow Electron preload bridge when it is available", async () => {
    const bridge = {
      health: vi.fn().mockResolvedValue(health),
      listProjects: vi.fn().mockResolvedValue({ data: [project], request_id: requestId }),
      createProject: vi.fn().mockResolvedValue({ data: project, request_id: requestId }),
      getProject: vi.fn().mockResolvedValue({ data: project, request_id: requestId }),
      listSources: vi.fn(),
      getSource: vi.fn(),
      importTextSource: vi.fn(),
      getSourceManifest: vi.fn().mockResolvedValue(sourceManifest),
      getStoryBibleIndex: vi.fn().mockResolvedValue(storyBibleIndex),
      getStoryBibleVersion: vi.fn().mockResolvedValue(storyBibleVersion),
      listProjectTasks: vi.fn().mockResolvedValue(taskQueue),
      getArtifactProposal: vi.fn().mockResolvedValue(artifactProposal),
      acceptArtifactProposalAsDraft: vi.fn().mockResolvedValue({ kind: "REMOTE_UNKNOWN" }),
      rejectArtifactProposal: vi.fn().mockResolvedValue({ kind: "REMOTE_UNKNOWN" }),
      listProjectAgents: vi.fn().mockResolvedValue(agentCatalog),
      listProjectSkills: vi.fn().mockResolvedValue(skillCatalog),
      startFakeTimelineWorkflow: vi.fn().mockResolvedValue(timeline),
      getProjectTimeline: vi.fn().mockResolvedValue(null),
      trimTimelineClip: vi.fn(),
      reorderTimelineClip: vi.fn(),
      replaceTimelineClip: vi.fn(),
      listProviderConnections: vi.fn().mockResolvedValue(providerConnections),
      createProviderConnection: vi.fn().mockResolvedValue({}),
      deleteProviderConnection: vi.fn().mockResolvedValue(undefined),
    };
    window.aijian = bridge;
    const transport = createStudioTransport();

    await transport.getHealth();
    await transport.listProjects();
    await transport.createProject({
      name: project.name,
      aspect_ratio: "9:16",
      target_duration_seconds: 90,
      source_language: "zh-CN",
    });
    await transport.getProject(project.id);
    await transport.listSources(project.id);
    await transport.getSource(project.id, `src_${"b".repeat(32)}`);
    await transport.importTextSource(project.id, {
      filename: "story.txt",
      media_type: "text/plain",
      content_base64: "5p2l5L+hCg==",
    });
    await transport.getSourceManifest(project.id);
    await transport.getStoryBibleIndex(project.id);
    await transport.getStoryBibleVersion(project.id, storyBibleVersion.data.version.id);
    await transport.listProjectTasks(project.id);
    await transport.getArtifactProposal(project.id, proposalId);
    await transport.proposalDecisions?.acceptAsDraft(project.id, proposalId, {
      parent_version_id: null,
      expected_head_revision: null,
    });
    await transport.proposalDecisions?.reject(project.id, proposalId, {
      reason_code: "SOURCE_EVIDENCE",
      comment: "原文证据不足。",
    });
    await transport.listProjectAgents(project.id);
    await transport.listProjectSkills(project.id);
    await transport.startFakeTimelineWorkflow(project.id);
    await transport.listProviderConnections();
    await transport.createProviderConnection({
      provider_kind: "OLLAMA",
      display_name: "本机 Ollama",
      base_url: "http://127.0.0.1:11434/v1",
      enabled: true,
      models: [],
    });
    await transport.deleteProviderConnection(`pcn_${"1".repeat(32)}`);

    expect(bridge.health).toHaveBeenCalledOnce();
    expect(bridge.listProjects).toHaveBeenCalledOnce();
    expect(bridge.createProject).toHaveBeenCalledOnce();
    expect(bridge.getProject).toHaveBeenCalledWith(project.id);
    expect(bridge.listSources).toHaveBeenCalledWith(project.id);
    expect(bridge.getSource).toHaveBeenCalledWith(project.id, `src_${"b".repeat(32)}`);
    expect(bridge.importTextSource).toHaveBeenCalledOnce();
    expect(bridge.getSourceManifest).toHaveBeenCalledWith(project.id);
    expect(bridge.getStoryBibleIndex).toHaveBeenCalledWith(project.id);
    expect(bridge.getStoryBibleVersion).toHaveBeenCalledWith(
      project.id,
      storyBibleVersion.data.version.id,
    );
    expect(bridge.listProjectTasks).toHaveBeenCalledWith(project.id);
    expect(bridge.getArtifactProposal).toHaveBeenCalledWith(project.id, proposalId);
    expect(bridge.acceptArtifactProposalAsDraft).toHaveBeenCalledWith(project.id, proposalId, {
      parent_version_id: null,
      expected_head_revision: null,
    });
    expect(bridge.rejectArtifactProposal).toHaveBeenCalledWith(project.id, proposalId, {
      reason_code: "SOURCE_EVIDENCE",
      comment: "原文证据不足。",
    });
    expect(bridge.listProjectAgents).toHaveBeenCalledWith(project.id);
    expect(bridge.listProjectSkills).toHaveBeenCalledWith(project.id);
    expect(bridge.startFakeTimelineWorkflow).toHaveBeenCalledWith(project.id);
    expect(bridge.listProviderConnections).toHaveBeenCalledOnce();
    expect(bridge.createProviderConnection).toHaveBeenCalledOnce();
    expect(bridge.deleteProviderConnection).toHaveBeenCalledOnce();
  });

  test("reads the project task queue from the versioned browser route", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(taskQueue));
    vi.stubGlobal("fetch", fetchMock);
    const transport = createStudioTransport();

    expect(transport.proposalDecisions).toBeUndefined();

    await expect(transport.listProjectTasks(project.id)).resolves.toEqual(taskQueue);
    expect(fetchMock).toHaveBeenCalledWith(`/api/v1/projects/${project.id}/tasks`, {
      headers: { Accept: "application/json" },
    });
  });

  test("reads a project-scoped artifact proposal from the versioned browser route", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(artifactProposal));
    vi.stubGlobal("fetch", fetchMock);
    const transport = createStudioTransport();

    await expect(transport.getArtifactProposal(project.id, proposalId)).resolves.toEqual(
      artifactProposal,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/projects/${project.id}/proposals/${proposalId}`,
      { headers: { Accept: "application/json" } },
    );
  });

  test("fails closed on invalid proposal ids and detached browser responses", async () => {
    const detached = structuredClone(artifactProposal);
    detached.data.proposal.project_id = `prj_${"0".repeat(32)}`;
    const fetchMock = vi.fn().mockResolvedValue(Response.json(detached));
    vi.stubGlobal("fetch", fetchMock);
    const transport = createStudioTransport();

    await expect(transport.getArtifactProposal(project.id, proposalId)).rejects.toThrow(
      "published contract",
    );
    await expect(transport.getArtifactProposal(project.id, "bad-proposal")).rejects.toThrow(
      "valid proposal id",
    );
    await expect(transport.getArtifactProposal("bad-project", proposalId)).rejects.toThrow(
      "valid project id",
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  test("reads Agent and Skill catalogs from project-scoped browser routes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(agentCatalog))
      .mockResolvedValueOnce(Response.json(skillCatalog));
    vi.stubGlobal("fetch", fetchMock);
    const transport = createStudioTransport();

    await expect(transport.listProjectAgents(project.id)).resolves.toEqual(agentCatalog);
    await expect(transport.listProjectSkills(project.id)).resolves.toEqual(skillCatalog);
    expect(fetchMock).toHaveBeenNthCalledWith(1, `/api/v1/projects/${project.id}/agents`, {
      headers: { Accept: "application/json" },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, `/api/v1/projects/${project.id}/skills`, {
      headers: { Accept: "application/json" },
    });
  });

  test("starts the deterministic timeline workflow through the public browser route", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(timeline));
    vi.stubGlobal("fetch", fetchMock);
    const transport = createStudioTransport();

    await expect(transport.startFakeTimelineWorkflow(project.id)).resolves.toEqual(timeline);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/projects/${project.id}/workflows/fake-timeline`,
      { method: "POST", headers: { Accept: "application/json" } },
    );
  });

  test("uses versioned provider connection routes in a browser", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(providerConnections))
      .mockResolvedValueOnce(Response.json({}, { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const transport = createStudioTransport();
    const input = {
      provider_kind: "OLLAMA" as const,
      display_name: "本机 Ollama",
      base_url: "http://127.0.0.1:11434/v1",
      enabled: true,
      models: [],
    };

    await expect(transport.listProviderConnections()).resolves.toEqual(providerConnections);
    await transport.createProviderConnection(input);
    await transport.deleteProviderConnection(`pcn_${"1".repeat(32)}`);

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/v1/provider-connections", {
      headers: { Accept: "application/json" },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/provider-connections",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      `/api/v1/provider-connections/pcn_${"1".repeat(32)}`,
      { method: "DELETE", headers: { Accept: "application/json" } },
    );
  });

  test("uses versioned same-origin routes in a browser", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(health))
      .mockResolvedValueOnce(Response.json({ data: [project], request_id: requestId }));
    vi.stubGlobal("fetch", fetchMock);
    const transport = createStudioTransport();

    await expect(transport.getHealth()).resolves.toEqual(health);
    await expect(transport.listProjects()).resolves.toEqual({
      data: [project],
      request_id: requestId,
    });
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/v1/health", {
      headers: { Accept: "application/json" },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/v1/projects", {
      headers: { Accept: "application/json" },
    });
  });

  test("posts project and source inputs without adding local paths", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ data: project, request_id: requestId }, { status: 201 }),
      )
      .mockResolvedValueOnce(Response.json({ data: project, request_id: requestId }))
      .mockResolvedValueOnce(
        Response.json({ data: { id: "source" }, request_id: requestId }, { status: 201 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const transport = createStudioTransport();
    const projectInput = {
      name: project.name,
      aspect_ratio: "9:16" as const,
      target_duration_seconds: 90,
      source_language: "zh-CN" as const,
    };
    const sourceInput = {
      filename: "story.txt",
      media_type: "text/plain" as const,
      content_base64: "5p2l5L+hCg==",
    };

    await transport.createProject(projectInput);
    await transport.getProject(project.id);
    await transport.importTextSource(project.id, sourceInput);

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/v1/projects", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(projectInput),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, `/api/v1/projects/${project.id}`, {
      headers: { Accept: "application/json" },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(3, `/api/v1/projects/${project.id}/sources`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(sourceInput),
    });
  });

  test("restores source summaries and details through versioned browser routes", async () => {
    const sourceId = `src_${"b".repeat(32)}`;
    const listResponse = { data: [], request_id: requestId };
    const detailResponse = { data: { id: sourceId }, request_id: requestId };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(listResponse))
      .mockResolvedValueOnce(Response.json(detailResponse));
    vi.stubGlobal("fetch", fetchMock);
    const transport = createStudioTransport();

    await expect(transport.listSources(project.id)).resolves.toEqual(listResponse);
    await expect(transport.getSource(project.id, sourceId)).resolves.toEqual(detailResponse);
    expect(fetchMock).toHaveBeenNthCalledWith(1, `/api/v1/projects/${project.id}/sources`, {
      headers: { Accept: "application/json" },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/api/v1/projects/${project.id}/sources/${sourceId}`,
      { headers: { Accept: "application/json" } },
    );
  });

  test("rejects HTTP failures and malformed health payloads", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ status: "ok" }));
    vi.stubGlobal("fetch", fetchMock);
    const transport = createStudioTransport();

    await expect(transport.getHealth()).rejects.toThrow("status 503");
    await expect(transport.getHealth()).rejects.toThrow("published contract");
  });

  test("preserves a typed credential-cleanup error for provider recovery UI", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          {
            error: {
              code: "CREDENTIAL_CLEANUP_REQUIRED",
              message: "cleanup required",
              details: {},
              retryable: false,
            },
            request_id: requestId,
          },
          { status: 503 },
        ),
      ),
    );

    await expect(createStudioTransport().listProviderConnections()).rejects.toThrow(
      "CREDENTIAL_CLEANUP_REQUIRED",
    );
  });

  test("reads optional G1 and G2 artifacts from versioned browser routes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(sourceManifest))
      .mockResolvedValueOnce(
        Response.json(
          {
            error: {
              code: "STORY_BIBLE_NOT_FOUND",
              message: "Not found",
              retryable: false,
              details: {},
            },
            request_id: requestId,
          },
          { status: 404 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const transport = createStudioTransport();

    await expect(transport.getSourceManifest(project.id)).resolves.toEqual(sourceManifest);
    await expect(transport.getStoryBibleIndex(project.id)).resolves.toBeNull();
    expect(fetchMock).toHaveBeenNthCalledWith(1, `/api/v1/projects/${project.id}/source-manifest`, {
      headers: { Accept: "application/json" },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, `/api/v1/projects/${project.id}/story-bible`, {
      headers: { Accept: "application/json" },
    });
  });

  test("does not collapse PROJECT_NOT_FOUND into an optional artifact", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          {
            error: {
              code: "PROJECT_NOT_FOUND",
              message: "Not found",
              retryable: false,
              details: {},
            },
            request_id: requestId,
          },
          { status: 404 },
        ),
      ),
    );
    const transport = createStudioTransport();

    await expect(transport.getSourceManifest(project.id)).rejects.toThrow("PROJECT_NOT_FOUND");
  });
});

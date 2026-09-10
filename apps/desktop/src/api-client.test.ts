import type { components } from "@aijian/contracts";
import {
  isInvalidationOperationPageResponse,
  isInvalidationOperationResponse,
  type InvalidationOperationPageResponse,
} from "@aijian/contracts/invalidation-operation";
import { describe, expect, test, vi } from "vitest";

import { createLocalApiClient } from "./api-client";
import { isTimelineResponse } from "./timeline-contract";
import type {
  SourceManifestPreparedReview,
  SourceManifestReviewTarget,
  SourceManifestSubmissionReceipt,
  SourceManifestSignoffReceipt,
  SourceManifestDecisionReceipt,
  SourceManifestReviewClient,
} from "./api-client";
import type { FakeTimelineRunCreateCommand } from "./fake-timeline-run-contract";
import { createdProposalRunResponse, proposalRunCommand } from "./proposal-run-test-fixture";

describe("source review bounded I/O", () => {
  const identity = () => ({
    project_id: project.id,
    version_id: artifactHead.latest_version_id,
    content_hash: sourceManifestResponse.data.latest_version.content_hash,
    expected_revision: artifactHead.revision,
  });

  test("uses one deadline across delayed fetch and multiple reader chunks without resetting it", async () => {
    vi.useFakeTimers();
    try {
      let resolveFetch!: (value: Response) => void;
      type ReadResult = { done: false; value: Uint8Array } | { done: true; value: undefined };
      let resolveRead!: (value: ReadResult) => void;
      const cancel = vi.fn(async () => {});
      const releaseLock = vi.fn();
      const reader = {
        read: vi.fn(
          () =>
            new Promise<ReadResult>((resolve) => {
              resolveRead = resolve;
            }),
        ),
        cancel,
        releaseLock,
      };
      const response = {
        status: 200,
        headers: new Headers({ ETag: '"revision-3"' }),
        body: { getReader: () => reader, cancel },
      } as unknown as Response;
      const fetcher = vi.fn(
        (_url: string, _init?: RequestInit) =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          }),
      );
      let result: unknown = "pending";
      void createLocalApiClient(fetcher, session)
        .prepareSourceManifestSubmit(reviewTarget())
        .then((value) => {
          result = value;
        });
      await vi.advanceTimersByTimeAsync(9_000);
      resolveFetch(response);
      await vi.advanceTimersByTimeAsync(5_000);
      resolveRead({ done: false, value: new TextEncoder().encode("{") });
      await vi.advanceTimersByTimeAsync(999);
      expect(result).toBe("pending");
      expect(reader.read).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(result).toEqual({ kind: "REMOTE_UNKNOWN" });
      expect(fetcher.mock.calls[0]![1]!.signal!.aborted).toBe(true);
      expect(fetcher).toHaveBeenCalledOnce();
      expect(cancel).toHaveBeenCalled();
      expect(releaseLock).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
      resolveRead({ done: true, value: undefined });
      await vi.advanceTimersByTimeAsync(0);
      expect(result).toEqual({ kind: "REMOTE_UNKNOWN" });
    } finally {
      vi.useRealTimers();
    }
  });

  test("cancels a fetch body that arrives after timeout and never retries the POST", async () => {
    vi.useFakeTimers();
    try {
      let resolveFetch!: (value: Response) => void;
      const fetcher = vi.fn(
        (_url: string, _init?: RequestInit) =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          }),
      );
      const pending = createLocalApiClient(fetcher, session).submitSourceManifestReview(
        reviewTarget(),
        preparedReview(),
      );
      await vi.advanceTimersByTimeAsync(15_000);
      await expect(pending).resolves.toEqual({ kind: "REMOTE_UNKNOWN" });
      const cancel = vi.fn(async () => {});
      resolveFetch({ body: { cancel } } as unknown as Response);
      await vi.advanceTimersByTimeAsync(0);
      expect(cancel).toHaveBeenCalledOnce();
      expect(fetcher.mock.calls[0]![1]!.signal!.aborted).toBe(true);
      expect(fetcher).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test("bounds real ReadableStream pull/cancel promises that never settle", async () => {
    vi.useFakeTimers();
    try {
      const cancel = vi.fn(() => new Promise<void>(() => {}));
      const body = new ReadableStream<Uint8Array>({
        pull: () => new Promise<void>(() => {}),
        cancel,
      });
      const pending = createLocalApiClient(
        async () => new Response(body, { headers: { ETag: '"revision-3"' } }),
        session,
      ).prepareSourceManifestSubmit(reviewTarget());
      await vi.advanceTimersByTimeAsync(15_000);
      await expect(pending).resolves.toEqual({ kind: "REMOTE_UNKNOWN" });
      expect(cancel).toHaveBeenCalledOnce();
      expect(body.locked).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test("keeps legacy GET behavior unchanged beyond 15 seconds and snapshots the new GET input", async () => {
    vi.useFakeTimers();
    try {
      let resolveFetch!: (value: Response) => void;
      const fetcher = vi.fn(
        (_url: string, _init?: RequestInit) =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          }),
      );
      const client = createLocalApiClient(fetcher, session);
      let result: unknown = "pending";
      void client.getSourceManifest(project.id).then((value) => {
        result = value;
      });
      await vi.advanceTimersByTimeAsync(16_000);
      expect(result).toBe("pending");
      expect(fetcher.mock.calls[0]![1]!.signal).toBeUndefined();
      resolveFetch(Response.json(sourceManifestResponse));
      await vi.advanceTimersByTimeAsync(0);
      expect(result).toEqual(sourceManifestResponse);
      const input = identity();
      const pending = client.getSourceManifestForReview(input);
      input.version_id = `ver_${"0".repeat(32)}`;
      input.expected_revision = 99;
      resolveFetch(Response.json(sourceManifestResponse, { headers: { ETag: '"revision-3"' } }));
      await expect(pending).resolves.toEqual({
        kind: "SUCCEEDED",
        receipt: sourceManifestResponse,
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test("accepts bounded bodyless and chunked valid UTF-8 JSON and maps network rejection safely", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(preparedReview()));
    const bodyless = {
      status: 200,
      headers: new Headers({ ETag: '"revision-3"' }),
      body: null,
      arrayBuffer: async () => bytes.buffer,
    } as Response;
    const chunked = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes.slice(0, 11));
          controller.enqueue(bytes.slice(11));
          controller.close();
        },
      }),
      { headers: { ETag: '"revision-3"' } },
    );
    for (const response of [bodyless, chunked]) {
      await expect(
        createLocalApiClient(async () => response, session).prepareSourceManifestSubmit(
          reviewTarget(),
        ),
      ).resolves.toEqual({ kind: "SUCCEEDED", receipt: preparedReview() });
    }
    const fetcher = vi.fn(async () => {
      throw new Error("synthetic secret failure");
    });
    await expect(
      createLocalApiClient(fetcher, session).prepareSourceManifestSubmit(reviewTarget()),
    ).resolves.toEqual({ kind: "REMOTE_UNKNOWN" });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  test.each(["reader", "arrayBuffer"])(
    "bounds an uncooperative %s and cleans resources",
    async (source) => {
      vi.useFakeTimers();
      try {
        const cancel = vi.fn(() => new Promise<void>(() => {}));
        const releaseLock = vi.fn();
        const response = {
          status: 200,
          headers: new Headers({ ETag: '"revision-3"' }),
          body:
            source === "reader"
              ? {
                  getReader: () => ({
                    read: () => new Promise<never>(() => {}),
                    cancel,
                    releaseLock,
                  }),
                  cancel,
                }
              : null,
          arrayBuffer: () => new Promise<ArrayBuffer>(() => {}),
        } as unknown as Response;
        const client = createLocalApiClient(async () => response, session);
        let result: unknown = "pending";
        void client.getSourceManifestForReview(identity()).then((value) => {
          result = value;
        });
        await vi.advanceTimersByTimeAsync(15_000);
        expect(result).toEqual({ kind: "REMOTE_UNKNOWN" });
        if (source === "reader") {
          expect(cancel).toHaveBeenCalled();
          expect(releaseLock).toHaveBeenCalledOnce();
        }
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  test("checks the exact initial version and hash and rejects extra input before I/O", async () => {
    const fetcher = vi.fn(async () =>
      Response.json(sourceManifestResponse, { headers: { ETag: '"revision-3"' } }),
    );
    const client = createLocalApiClient(fetcher, session);
    await expect(
      client.getSourceManifestForReview({ ...identity(), extra: true } as never),
    ).resolves.toEqual({ kind: "INVALID_INPUT" });
    expect(fetcher).not.toHaveBeenCalled();
    await expect(
      client.getSourceManifestForReview({
        ...identity(),
        content_hash: `sha256:${"0".repeat(64)}`,
      }),
    ).resolves.toEqual({ kind: "REMOTE_UNKNOWN" });
  });

  test("recognizes only the status-bound fixed safe GET error envelope", async () => {
    const payload = {
      error: {
        code: "SOURCE_MANIFEST_NOT_FOUND",
        message: "sensitive synthetic text",
        retryable: false,
        details: {},
      },
      request_id: healthyResponse.request_id,
    };
    const fetcher = vi.fn(async () => Response.json(payload, { status: 404 }));
    const client = createLocalApiClient(fetcher, session);
    await expect(client.getSourceManifestForReview(identity())).resolves.toEqual({
      kind: "DEFINITE_SERVER_ERROR",
      status: 404,
      code: "SOURCE_MANIFEST_NOT_FOUND",
      request_id: healthyResponse.request_id,
    });
  });

  test("returns unknown at the total deadline even when fetch ignores abort", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn(() => new Promise<Response>(() => {}));
      const client = createLocalApiClient(fetcher, session);
      let result: unknown = "pending";
      void client
        .getSourceManifestForReview({
          project_id: project.id,
          version_id: artifactHead.latest_version_id,
          content_hash: sourceManifestResponse.data.latest_version.content_hash,
          expected_revision: artifactHead.revision,
        })
        .then((value) => {
          result = value;
        });
      await vi.advanceTimersByTimeAsync(15_000);
      expect(result).toEqual({ kind: "REMOTE_UNKNOWN" });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Episode metadata HTTP boundary", () => {
  const episodeProjectId = `prj_${"e".repeat(32)}`;
  const episodeId = `ep_${"f".repeat(32)}`;
  const episodeRequestId = "123e4567-e89b-42d3-a456-426614174000";
  const episode = (position = "1") => ({
    id: position === "1" ? episodeId : `ep_${"d".repeat(31)}${position}`,
    project_id: episodeProjectId,
    position,
    title: "第一集",
    is_default: position === "1",
    target_duration_seconds: null,
    revision: "1",
    created_at: "2026-09-07T01:02:03Z",
    updated_at: "2026-09-07T01:02:03Z",
  });
  const episodeResponse = () => ({ data: episode(), request_id: episodeRequestId });
  const episodeHeaders = { "X-Request-ID": episodeRequestId };

  test("lists and gets only identity-bound Episode bodies with sidecar headers", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          { data: [episode()], request_id: episodeRequestId },
          { headers: episodeHeaders },
        ),
      )
      .mockResolvedValueOnce(Response.json(episodeResponse(), { headers: episodeHeaders }));
    const client = createLocalApiClient(fetcher, session);

    await expect(client.listEpisodes(episodeProjectId, { limit: 1, offset: "0" })).resolves.toEqual(
      {
        data: [episode()],
        request_id: episodeRequestId,
      },
    );
    await expect(client.getEpisode(episodeProjectId, episodeId)).resolves.toEqual(
      episodeResponse(),
    );
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      `${session.origin}/api/v1/projects/${episodeProjectId}/episodes?limit=1&offset=0`,
      `${session.origin}/api/v1/projects/${episodeProjectId}/episodes/${episodeId}`,
    ]);
    const init = fetcher.mock.calls[0]![1] as RequestInit;
    expect(new Headers(init.headers).get("Authorization")).toBe(`Bearer ${session.token}`);
    expect(new Headers(init.headers).get("Origin")).toBe("app://aijian");
  });

  test("rejects invalid Episode reads before dispatch and malformed response identity after dispatch", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response('{"path":"C:/secret/token"}', {
        headers: { "X-Request-ID": "123e4567-e89b-42d3-a456-426614174001" },
      }),
    );
    const client = createLocalApiClient(fetcher, session);
    await expect(client.listEpisodes("../workspace.sqlite3", { offset: "0" })).rejects.toThrow(
      "valid project id",
    );
    await expect(client.listEpisodes(episodeProjectId, { offset: "00" })).rejects.toThrow(
      "valid Episode list query",
    );
    expect(fetcher).not.toHaveBeenCalled();
    await expect(client.getEpisode(episodeProjectId, episodeId)).rejects.toThrow(
      "Episode request could not be completed",
    );
    expect(fetcher).toHaveBeenCalledOnce();
  });

  test("creates once with normalized input and makes only valid 201 a success", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        Response.json(episodeResponse(), { status: 201, headers: episodeHeaders }),
      );
    const client = createLocalApiClient(fetcher, session);
    await expect(
      client.createEpisode(episodeProjectId, {
        title: "  第一集  ",
        target_duration_seconds: null,
      }),
    ).resolves.toEqual({ kind: "SUCCEEDED", receipt: episodeResponse() });
    expect(fetcher).toHaveBeenCalledOnce();
    const init = fetcher.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ title: "第一集", target_duration_seconds: null }));
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  test("keeps failed or unreadable create completion unknown after exactly one dispatch", async () => {
    const error = {
      error: { code: "EPISODE_CREATE_CONFLICT", message: "safe", retryable: false, details: {} },
      request_id: episodeRequestId,
    };
    for (const { response, definite } of [
      { response: Response.json(error, { status: 409, headers: episodeHeaders }), definite: true },
      { response: Response.json(error, { status: 500, headers: episodeHeaders }), definite: false },
      {
        response: Response.json(episodeResponse(), { status: 200, headers: episodeHeaders }),
        definite: false,
      },
      {
        response: Response.json(
          { ...error, extra: true },
          { status: 409, headers: episodeHeaders },
        ),
        definite: false,
      },
      { response: new Response("{", { status: 201, headers: episodeHeaders }), definite: false },
    ]) {
      const fetcher = vi.fn().mockResolvedValue(response);
      const result = await createLocalApiClient(fetcher, session).createEpisode(episodeProjectId, {
        title: "第一集",
      });
      if (definite) {
        expect(result).toEqual({
          kind: "DEFINITE_SERVER_ERROR",
          status: 409,
          code: "EPISODE_CREATE_CONFLICT",
          request_id: episodeRequestId,
        });
      } else {
        expect(result).toEqual({ kind: "REMOTE_UNKNOWN" });
      }
      expect(fetcher).toHaveBeenCalledOnce();
    }
    const invalidFetcher = vi.fn();
    await expect(
      createLocalApiClient(invalidFetcher, session).createEpisode(episodeProjectId, {
        title: "bad\ninput",
      }),
    ).rejects.toThrow("valid Episode input");
    expect(invalidFetcher).not.toHaveBeenCalled();

    const networkFetcher = vi.fn().mockRejectedValue(new Error("token=must-not-leak"));
    await expect(
      createLocalApiClient(networkFetcher, session).createEpisode(episodeProjectId, {
        title: "第一集",
      }),
    ).resolves.toEqual({ kind: "REMOTE_UNKNOWN" });
    expect(networkFetcher).toHaveBeenCalledOnce();
  });
});

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

const reviewTarget = (submitted = false): SourceManifestReviewTarget => ({
  project_id: project.id,
  version_id: artifactHead.latest_version_id,
  content_hash: sourceManifestResponse.data.latest_version.content_hash,
  expected_revision: submitted ? 4 : 3,
  artifact_id: artifactHead.artifact_id,
  version_number: 1,
  review_evidence_revision: submitted ? 2 : 1,
  review_version_id: submitted ? artifactHead.latest_version_id : null,
  review_submission_id: submitted ? `sub_${"3".repeat(32)}` : null,
  accepted_version_id: null,
});

function preparedReview(
  action: "submit" | "signoff" | "decision" = "submit",
): SourceManifestPreparedReview {
  const target = reviewTarget(action !== "submit");
  return {
    request_id: healthyResponse.request_id,
    data: {
      confirmation_token: "synthetic-confirmation-token-for-tests",
      report: {
        id: `rpt_${"4".repeat(32)}`,
        artifact_id: target.artifact_id,
        version_id: target.version_id,
        gate: "G1",
        submission_id: action === "submit" ? null : target.review_submission_id,
        policy_code: "g1.source-manifest",
        policy_version: "1",
        head_revision: target.expected_revision,
        review_evidence_revision: target.review_evidence_revision,
        report: {
          ready: true,
          blocking: [],
          policy_code: "g1.source-manifest",
          policy_version: "1",
          policy_snapshot_hash:
            "sha256:d9b44c6cb3464ff85eb7a546286691af0cf92e536d361fc8d5985aaf4320420c",
        },
        report_hash: "sha256:8369949613bef69a80963393f43ccf81ab7e87bbc3781ca6a73115e8b4eec3a6",
        created_at: "2026-09-04T06:00:00Z",
        expires_at: "2026-09-04T06:05:00Z",
      },
      challenge: {
        id: `chg_${"5".repeat(32)}`,
        artifact_id: target.artifact_id,
        version_id: target.version_id,
        gate: "G1",
        action,
        readiness_report_id: `rpt_${"4".repeat(32)}`,
        head_revision: target.expected_revision + (action === "decision" ? 1 : 0),
        review_evidence_revision: target.review_evidence_revision,
        created_at: "2026-09-04T06:00:00Z",
        expires_at: "2026-09-04T06:05:00Z",
        consumed_at: null,
      },
    },
  };
}

function submissionReceipt(): SourceManifestSubmissionReceipt {
  const target = reviewTarget(true);
  return {
    request_id: healthyResponse.request_id,
    data: {
      head: {
        ...artifactHead,
        revision: 4,
        review_evidence_revision: 2,
        review_version_id: target.version_id,
        review_submission_id: target.review_submission_id,
      },
      submission: {
        id: target.review_submission_id!,
        artifact_id: target.artifact_id,
        version_id: target.version_id,
        gate: "G1",
        readiness_report_id: preparedReview().data.report.id,
        supersedes_submission_id: null,
        submitted_by_actor_id: "local-user",
        submitted_at: "2026-09-04T06:01:00Z",
      },
    },
  };
}

function signoffReceipt(): SourceManifestSignoffReceipt {
  const target = reviewTarget(true);
  return {
    request_id: healthyResponse.request_id,
    data: {
      head: { ...submissionReceipt().data.head, revision: 5 },
      signoffs: ["writer", "producer"].map((role, index) => ({
        id: `sig_${String(index + 6).repeat(32)}`,
        artifact_id: target.artifact_id,
        version_id: target.version_id,
        submission_id: target.review_submission_id!,
        gate: "G1",
        role,
        actor_id: "local-user",
        review_evidence_revision: target.review_evidence_revision,
        readiness_report_id: preparedReview("signoff").data.report.id,
        self_review: true,
        supersedes_signoff_id: null,
        signed_at: "2026-09-04T06:02:00Z",
      })),
    },
  };
}

function decisionReceipt(): SourceManifestDecisionReceipt {
  const target = reviewTarget(true);
  return {
    request_id: healthyResponse.request_id,
    data: {
      head: {
        ...signoffReceipt().data.head,
        revision: 6,
        review_version_id: null,
        review_submission_id: null,
        accepted_version_id: target.version_id,
      },
      decision: {
        id: `dec_${"8".repeat(32)}`,
        artifact_id: target.artifact_id,
        version_id: target.version_id,
        submission_id: target.review_submission_id!,
        gate: "G1",
        decision: "approved",
        readiness_report_id: preparedReview("signoff").data.report.id,
        actor_id: "local-user",
        actor_role: "producer",
        self_review: true,
        rationale: "确认来源基线",
        decided_at: "2026-09-04T06:03:00Z",
      },
    },
  };
}

function copiedManifest(): SourceManifestResponse {
  const result = structuredClone(sourceManifestResponse);
  result.data.latest_version.id = `ver_${"9".repeat(32)}`;
  result.data.latest_version.parent_version_id = artifactHead.latest_version_id;
  result.data.latest_version.version_number = 2;
  result.data.head.latest_version_id = result.data.latest_version.id;
  result.data.head.revision = 4;
  return result;
}

describe("source review actions", () => {
  test("invalid identities, impossible report revision, and malformed prepared input never fetch", async () => {
    const fetcher = vi.fn(async () => Response.json({}));
    const client = createLocalApiClient(fetcher, session);
    for (const input of [
      null,
      { ...reviewTarget(), extra: true },
      { ...reviewTarget(), project_id: "../outside" },
      { ...reviewTarget(), artifact_id: "invalid" },
      { ...reviewTarget(), version_id: "invalid" },
      { ...reviewTarget(), content_hash: "invalid" },
      { ...reviewTarget(), expected_revision: 0 },
      { ...reviewTarget(), expected_revision: 1.5 },
      { ...reviewTarget(), expected_revision: Number.MAX_SAFE_INTEGER },
      { ...reviewTarget(), review_evidence_revision: -1 },
      { ...reviewTarget(), version_number: 0 },
      { ...reviewTarget(), review_submission_id: `sub_${"3".repeat(32)}` },
      { ...reviewTarget(), accepted_version_id: "invalid" },
    ]) {
      const target = input as SourceManifestReviewTarget;
      await expect(client.prepareSourceManifestSubmit(target)).resolves.toEqual({
        kind: "INVALID_INPUT",
      });
      await expect(client.prepareSourceManifestSignoff(target)).resolves.toEqual({
        kind: "INVALID_INPUT",
      });
      await expect(
        client.prepareSourceManifestDecision(
          target,
          preparedReview("signoff").data.report,
          "确认来源基线",
        ),
      ).resolves.toEqual({ kind: "INVALID_INPUT" });
      await expect(client.submitSourceManifestReview(target, preparedReview())).resolves.toEqual({
        kind: "INVALID_INPUT",
      });
      await expect(
        client.signoffSourceManifestReview(target, preparedReview("signoff")),
      ).resolves.toEqual({ kind: "INVALID_INPUT" });
      await expect(
        client.decideSourceManifestReview(target, preparedReview("decision"), "确认来源基线"),
      ).resolves.toEqual({ kind: "INVALID_INPUT" });
      await expect(client.copySourceManifestDraft(target)).resolves.toEqual({
        kind: "INVALID_INPUT",
      });
    }
    for (const rationale of ["", " ", " untrimmed ", "x".repeat(1001), null]) {
      await expect(
        client.prepareSourceManifestDecision(
          { ...reviewTarget(true), expected_revision: 5 },
          preparedReview("signoff").data.report,
          rationale as string,
        ),
      ).resolves.toEqual({ kind: "INVALID_INPUT" });
    }
    const impossible = preparedReview("signoff").data.report;
    impossible.head_revision = 0;
    await expect(
      client.prepareSourceManifestDecision(
        { ...reviewTarget(true), expected_revision: 1 },
        impossible,
        "确认来源基线",
      ),
    ).resolves.toEqual({ kind: "INVALID_INPUT" });
    const malformed = preparedReview();
    Object.assign(malformed.data, { extra: true });
    await expect(client.submitSourceManifestReview(reviewTarget(), malformed)).resolves.toEqual({
      kind: "INVALID_INPUT",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  test("copies target, nested prepared data, and decision report before the first await", async () => {
    let resolve!: (value: Response) => void;
    const fetcher = vi.fn(
      (_url: string, _init?: RequestInit) =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    const client = createLocalApiClient(fetcher, session);
    const target = reviewTarget();
    const prepared = preparedReview();
    const pending = client.submitSourceManifestReview(target, prepared);
    target.project_id = `prj_${"0".repeat(32)}`;
    target.expected_revision = 99;
    prepared.data.report.id = `rpt_${"0".repeat(32)}`;
    prepared.data.confirmation_token = "changed";
    resolve(Response.json(submissionReceipt(), { headers: { ETag: '"revision-4"' } }));
    await expect(pending).resolves.toEqual({ kind: "SUCCEEDED", receipt: submissionReceipt() });
    const decisionTarget = { ...reviewTarget(true), expected_revision: 5 };
    const report = preparedReview("signoff").data.report;
    const decisionPending = client.prepareSourceManifestDecision(
      decisionTarget,
      report,
      "确认来源基线",
    );
    report.id = `rpt_${"0".repeat(32)}`;
    decisionTarget.expected_revision = 99;
    resolve(Response.json(preparedReview("decision"), { headers: { ETag: '"revision-5"' } }));
    await expect(decisionPending).resolves.toEqual({
      kind: "SUCCEEDED",
      receipt: preparedReview("decision"),
    });
    expect(fetcher.mock.calls[0]![0]).toContain(project.id);
  });

  test("consumes submit with exact prepared token and validates both revision advances", async () => {
    const receipt = submissionReceipt();
    const prepared = preparedReview();
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json(receipt, { headers: { ETag: '"revision-4"' } }),
    );
    await expect(
      createLocalApiClient(fetcher, session).submitSourceManifestReview(reviewTarget(), prepared),
    ).resolves.toEqual({ kind: "SUCCEEDED", receipt });
    expect(fetcher.mock.calls[0]![0]).toMatch(/:submit$/);
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual({
      challenge_id: prepared.data.challenge.id,
      confirmation_token: prepared.data.confirmation_token,
    });
    expect(fetcher.mock.calls[0]![1]!.headers).toMatchObject({ "If-Match": '"revision-3"' });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  test("prepares and signs writer/producer once, without inventing report_hash in signoff receipts", async () => {
    const prepared = preparedReview("signoff");
    const receipt = signoffReceipt();
    const fetcher = vi.fn(async (url: string, _init?: RequestInit) =>
      url.endsWith(":prepare-signoff")
        ? Response.json(prepared, { headers: { ETag: '"revision-4"' } })
        : Response.json(receipt, { headers: { ETag: '"revision-5"' } }),
    );
    const client = createLocalApiClient(fetcher, session);
    await expect(client.prepareSourceManifestSignoff(reviewTarget(true))).resolves.toEqual({
      kind: "SUCCEEDED",
      receipt: prepared,
    });
    await expect(client.signoffSourceManifestReview(reviewTarget(true), prepared)).resolves.toEqual(
      { kind: "SUCCEEDED", receipt },
    );
    expect(fetcher.mock.calls.map(([url]) => url.split(artifactHead.latest_version_id)[1])).toEqual(
      [":prepare-signoff", "/signoffs"],
    );
    expect(fetcher.mock.calls[0]![1]!.body).toBe("{}");
  });

  test("decision reuses the signed report with head one behind the challenge and exact rationale", async () => {
    const target = { ...reviewTarget(true), expected_revision: 5 };
    const prepared = preparedReview("decision");
    const report = preparedReview("signoff").data.report;
    const receipt = decisionReceipt();
    const fetcher = vi.fn(async (url: string, _init?: RequestInit) =>
      url.endsWith(":prepare-decision")
        ? Response.json(prepared, { headers: { ETag: '"revision-5"' } })
        : Response.json(receipt, { headers: { ETag: '"revision-6"' } }),
    );
    const client = createLocalApiClient(fetcher, session);
    await expect(
      client.prepareSourceManifestDecision(target, report, "确认来源基线"),
    ).resolves.toEqual({ kind: "SUCCEEDED", receipt: prepared });
    await expect(
      client.decideSourceManifestReview(target, prepared, "确认来源基线"),
    ).resolves.toEqual({ kind: "SUCCEEDED", receipt });
    expect(fetcher.mock.calls.map(([url]) => url.split(target.version_id)[1])).toEqual([
      ":prepare-decision",
      "/decisions",
    ]);
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual({
      decision: "approved",
      rationale: "确认来源基线",
      readiness_report_id: report.id,
    });
    expect(JSON.parse(fetcher.mock.calls[1]![1]!.body as string)).toEqual({
      decision: "approved",
      rationale: "确认来源基线",
      challenge_id: prepared.data.challenge.id,
      confirmation_token: prepared.data.confirmation_token,
    });
  });

  test("copies only to a new latest child at 201 without sending any automatic review request", async () => {
    const receipt = copiedManifest();
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json(receipt, { status: 201, headers: { ETag: '"revision-4"' } }),
    );
    await expect(
      createLocalApiClient(fetcher, session).copySourceManifestDraft(reviewTarget()),
    ).resolves.toEqual({ kind: "SUCCEEDED", receipt });
    expect(fetcher.mock.calls[0]![0]).toMatch(/:copy-draft$/);
    expect(fetcher.mock.calls[0]![1]!.body).toBe("{}");
    expect(fetcher.mock.calls[0]![1]!.headers).toMatchObject({ "If-Match": '"revision-3"' });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  test.each([
    [
      "report gate",
      (p: SourceManifestPreparedReview) => {
        (p.data.report as { gate: string }).gate = "G2";
      },
    ],
    [
      "challenge gate",
      (p: SourceManifestPreparedReview) => {
        (p.data.challenge as { gate: string }).gate = "G2";
      },
    ],
    [
      "artifact",
      (p: SourceManifestPreparedReview) => {
        p.data.report.artifact_id = `art_${"0".repeat(32)}`;
      },
    ],
    [
      "version",
      (p: SourceManifestPreparedReview) => {
        p.data.challenge.version_id = `ver_${"0".repeat(32)}`;
      },
    ],
    [
      "report id",
      (p: SourceManifestPreparedReview) => {
        p.data.challenge.readiness_report_id = `rpt_${"0".repeat(32)}`;
      },
    ],
    [
      "report hash",
      (p: SourceManifestPreparedReview) => {
        p.data.report.report_hash = reviewTarget().content_hash;
      },
    ],
    [
      "policy",
      (p: SourceManifestPreparedReview) => {
        p.data.report.report.policy_snapshot_hash = reviewTarget().content_hash;
      },
    ],
    [
      "blocking",
      (p: SourceManifestPreparedReview) => {
        p.data.report.report.blocking = ["missing_source_document"];
      },
    ],
    [
      "ready",
      (p: SourceManifestPreparedReview) => {
        p.data.report.report.ready = false;
      },
    ],
    [
      "report revision",
      (p: SourceManifestPreparedReview) => {
        p.data.report.head_revision += 1;
      },
    ],
    [
      "challenge revision",
      (p: SourceManifestPreparedReview) => {
        p.data.challenge.head_revision += 1;
      },
    ],
    [
      "evidence",
      (p: SourceManifestPreparedReview) => {
        p.data.report.review_evidence_revision += 1;
      },
    ],
    [
      "action",
      (p: SourceManifestPreparedReview) => {
        p.data.challenge.action = "decision";
      },
    ],
    [
      "submission",
      (p: SourceManifestPreparedReview) => {
        p.data.report.submission_id = `sub_${"0".repeat(32)}`;
      },
    ],
    [
      "consumed",
      (p: SourceManifestPreparedReview) => {
        p.data.challenge.consumed_at = p.data.challenge.created_at;
      },
    ],
    [
      "date",
      (p: SourceManifestPreparedReview) => {
        p.data.report.created_at = "2026-02-30T06:00:00Z";
      },
    ],
    [
      "expiry",
      (p: SourceManifestPreparedReview) => {
        p.data.challenge.expires_at = p.data.challenge.created_at;
      },
    ],
    [
      "missing field",
      (p: SourceManifestPreparedReview) => {
        delete (p.data.report as Partial<typeof p.data.report>).submission_id;
      },
    ],
    [
      "extra field",
      (p: SourceManifestPreparedReview) => {
        Object.assign(p.data.report, { leaked: "synthetic" });
      },
    ],
    [
      "token",
      (p: SourceManifestPreparedReview) => {
        p.data.confirmation_token = "invalid";
      },
    ],
    [
      "request id",
      (p: SourceManifestPreparedReview) => {
        p.request_id = "not-uuid";
      },
    ],
  ])("rejects prepared %s corruption without leaking the response", async (_name, mutate) => {
    const prepared = preparedReview();
    (mutate as (p: SourceManifestPreparedReview) => void)(prepared);
    const fetcher = vi.fn(async () =>
      Response.json(prepared, { headers: { ETag: '"revision-3"' } }),
    );
    await expect(
      createLocalApiClient(fetcher, session).prepareSourceManifestSubmit(reviewTarget()),
    ).resolves.toEqual({ kind: "REMOTE_UNKNOWN" });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  test("does not replace the signed report or accept a two-revision-old report", async () => {
    const target = { ...reviewTarget(true), expected_revision: 5 };
    const prepared = preparedReview("decision");
    prepared.data.report.id = `rpt_${"0".repeat(32)}`;
    prepared.data.challenge.readiness_report_id = prepared.data.report.id;
    const fetcher = vi.fn(async () =>
      Response.json(prepared, { headers: { ETag: '"revision-5"' } }),
    );
    const client = createLocalApiClient(fetcher, session);
    await expect(
      client.prepareSourceManifestDecision(
        target,
        preparedReview("signoff").data.report,
        "确认来源基线",
      ),
    ).resolves.toEqual({ kind: "REMOTE_UNKNOWN" });
    const report = preparedReview("signoff").data.report;
    report.head_revision = 3;
    await expect(
      client.prepareSourceManifestDecision(target, report, "确认来源基线"),
    ).resolves.toEqual({ kind: "INVALID_INPUT" });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  test.each(["submit", "signoff", "decision", "copy"] as const)(
    "rejects %s success corruption and wrong status",
    async (action) => {
      const receipt =
        action === "submit"
          ? submissionReceipt()
          : action === "signoff"
            ? signoffReceipt()
            : action === "decision"
              ? decisionReceipt()
              : copiedManifest();
      const target =
        action === "submit" || action === "copy"
          ? reviewTarget()
          : { ...reviewTarget(true), expected_revision: action === "decision" ? 5 : 4 };
      const invoke = (client: SourceManifestReviewClient) =>
        action === "submit"
          ? client.submitSourceManifestReview(target, preparedReview())
          : action === "signoff"
            ? client.signoffSourceManifestReview(target, preparedReview("signoff"))
            : action === "decision"
              ? client.decideSourceManifestReview(
                  target,
                  preparedReview("decision"),
                  "确认来源基线",
                )
              : client.copySourceManifestDraft(target);
      const fetcher = vi.fn(async () =>
        Response.json(receipt, {
          status: action === "copy" ? 200 : 201,
          headers: { ETag: `"revision-${target.expected_revision + 1}"` },
        }),
      );
      await expect(invoke(createLocalApiClient(fetcher, session))).resolves.toEqual({
        kind: "REMOTE_UNKNOWN",
      });
      receipt.data.head.review_evidence_revision += 1;
      fetcher.mockImplementation(async () =>
        Response.json(receipt, {
          status: action === "copy" ? 201 : 200,
          headers: { ETag: `"revision-${target.expected_revision + 1}"` },
        }),
      );
      await expect(invoke(createLocalApiClient(fetcher, session))).resolves.toEqual({
        kind: "REMOTE_UNKNOWN",
      });
    },
  );

  test("rejects wrong roles, actor, duplicate signoffs, changed rationale, and copy parent", async () => {
    for (const mutate of [
      (r: SourceManifestSignoffReceipt) => {
        r.data.signoffs[0]!.actor_id = "someone-else";
      },
      (r: SourceManifestSignoffReceipt) => {
        r.data.signoffs[0]!.role = "admin";
      },
      (r: SourceManifestSignoffReceipt) => {
        r.data.signoffs[1] = r.data.signoffs[0]!;
      },
      (r: SourceManifestSignoffReceipt) => {
        r.data.signoffs[0]!.readiness_report_id = `rpt_${"0".repeat(32)}`;
      },
    ]) {
      const receipt = signoffReceipt();
      mutate(receipt);
      const client = createLocalApiClient(
        async () => Response.json(receipt, { headers: { ETag: '"revision-5"' } }),
        session,
      );
      await expect(
        client.signoffSourceManifestReview(reviewTarget(true), preparedReview("signoff")),
      ).resolves.toEqual({ kind: "REMOTE_UNKNOWN" });
    }
    const decision = decisionReceipt();
    decision.data.decision.rationale = "changed";
    await expect(
      createLocalApiClient(
        async () => Response.json(decision, { headers: { ETag: '"revision-6"' } }),
        session,
      ).decideSourceManifestReview(
        { ...reviewTarget(true), expected_revision: 5 },
        preparedReview("decision"),
        "确认来源基线",
      ),
    ).resolves.toEqual({ kind: "REMOTE_UNKNOWN" });
    const copy = copiedManifest();
    copy.data.latest_version.parent_version_id = null;
    await expect(
      createLocalApiClient(
        async () => Response.json(copy, { status: 201, headers: { ETag: '"revision-4"' } }),
        session,
      ).copySourceManifestDraft(reviewTarget()),
    ).resolves.toEqual({ kind: "REMOTE_UNKNOWN" });
  });

  test("prepares submit with fixed scope, If-Match, and a validated main-only response", async () => {
    const prepared = preparedReview();
    const fetcher = vi.fn(async () =>
      Response.json(prepared, { headers: { ETag: '"revision-3"' } }),
    );
    const client = createLocalApiClient(fetcher, session);
    await expect(client.prepareSourceManifestSubmit(reviewTarget())).resolves.toEqual({
      kind: "SUCCEEDED",
      receipt: prepared,
    });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe(
      `${session.origin}/api/v1/internal/projects/${project.id}/source-manifest/versions/${artifactHead.latest_version_id}:prepare-submit`,
    );
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      Accept: "application/json",
      Authorization: `Bearer ${session.token}`,
      Origin: "app://aijian",
      "Content-Type": "application/json",
      "If-Match": '"revision-3"',
    });
    expect(init.body).toBe("{}");
  });
});

describe("source review response boundary", () => {
  const invoke = (client: SourceManifestReviewClient, phase: "get" | "review" | "copy") =>
    phase === "get"
      ? client.getSourceManifestForReview({
          project_id: project.id,
          version_id: artifactHead.latest_version_id,
          content_hash: sourceManifestResponse.data.latest_version.content_hash,
          expected_revision: 3,
        })
      : phase === "review"
        ? client.prepareSourceManifestSubmit(reviewTarget())
        : client.copySourceManifestDraft(reviewTarget());
  const errors = [
    [401, "SIDECAR_AUTH_REQUIRED"],
    [403, "SIDECAR_REQUEST_REJECTED"],
    [404, "PROJECT_NOT_FOUND"],
    [404, "SOURCE_MANIFEST_NOT_FOUND"],
    [409, "GATE_NOT_READY"],
    [409, "REVIEW_INVALID"],
    [412, "PRECONDITION_FAILED"],
    [422, "VALIDATION_ERROR"],
    [428, "PRECONDITION_REQUIRED"],
  ] as const;

  test.each(["get", "review", "copy"] as const)(
    "uses the phase/status/code union for %s and discards raw message",
    async (phase) => {
      for (const [status, code] of errors) {
        const payload = {
          request_id: healthyResponse.request_id,
          error: {
            code,
            message: "synthetic secret confirmation_token must not escape",
            retryable: false,
            details: {},
          },
        };
        const client = createLocalApiClient(
          async () => Response.json(payload, { status }),
          session,
        );
        const allowed =
          status === 409
            ? phase === "review"
            : status === 412 || status === 428
              ? phase !== "get"
              : true;
        await expect(invoke(client, phase)).resolves.toEqual(
          allowed
            ? {
                kind: "DEFINITE_SERVER_ERROR",
                status,
                code,
                request_id: healthyResponse.request_id,
              }
            : { kind: "REMOTE_UNKNOWN" },
        );
        const mismatched = createLocalApiClient(
          async () => Response.json(payload, { status: status === 401 ? 403 : 401 }),
          session,
        );
        await expect(invoke(mismatched, phase)).resolves.toEqual({ kind: "REMOTE_UNKNOWN" });
      }
    },
  );

  test.each([
    {
      error: {
        code: "PRECONDITION_FAILED",
        message: "synthetic",
        retryable: false,
        details: { confirmation_token: "synthetic" },
      },
      request_id: healthyResponse.request_id,
    },
    {
      error: { code: "PRECONDITION_FAILED", message: "synthetic", retryable: true, details: {} },
      request_id: healthyResponse.request_id,
    },
    {
      error: { code: "PRECONDITION_FAILED", message: "synthetic", retryable: false },
      request_id: healthyResponse.request_id,
    },
    {
      error: {
        code: "PRECONDITION_FAILED",
        message: "synthetic",
        retryable: false,
        details: {},
        extra: true,
      },
      request_id: healthyResponse.request_id,
    },
    {
      error: { code: "PRECONDITION_FAILED", message: "synthetic", retryable: false, details: {} },
      request_id: healthyResponse.request_id,
      extra: true,
    },
    {
      error: { code: "arbitrary-secret-code", message: "synthetic", retryable: false, details: {} },
      request_id: healthyResponse.request_id,
    },
    { detail: "Not Found" },
  ])("rejects malformed or nonbusiness error envelopes %#", async (payload) => {
    const client = createLocalApiClient(
      async () => Response.json(payload, { status: "detail" in payload ? 404 : 412 }),
      session,
    );
    await expect(client.copySourceManifestDraft(reviewTarget())).resolves.toEqual({
      kind: "REMOTE_UNKNOWN",
    });
  });

  test.each([undefined, 'W/"revision-3"', '"revision-4"', '"sha256:wrong"'])(
    "rejects missing or nonexact ETag %s",
    async (etag) => {
      const client = createLocalApiClient(
        async () =>
          Response.json(preparedReview(), { headers: etag === undefined ? {} : { ETag: etag } }),
        session,
      );
      await expect(client.prepareSourceManifestSubmit(reviewTarget())).resolves.toEqual({
        kind: "REMOTE_UNKNOWN",
      });
    },
  );

  test("keeps the 16 MiB limit inclusive and rejects UTF-8, JSON, and oversized bodies", async () => {
    const json = JSON.stringify(preparedReview());
    const max = 16 * 1024 * 1024;
    const padded = json + " ".repeat(max - Buffer.byteLength(json));
    const valid = createLocalApiClient(
      async () => new Response(padded, { headers: { ETag: '"revision-3"' } }),
      session,
    );
    await expect(valid.prepareSourceManifestSubmit(reviewTarget())).resolves.toEqual({
      kind: "SUCCEEDED",
      receipt: preparedReview(),
    });
    for (const response of [
      new Response(padded + " ", { headers: { ETag: '"revision-3"' } }),
      new Response(json, { headers: { ETag: '"revision-3"', "Content-Length": String(max + 1) } }),
      new Response(new Uint8Array([0xc3, 0x28]), { headers: { ETag: '"revision-3"' } }),
      new Response("not json", { headers: { ETag: '"revision-3"' } }),
      Response.json({ detail: "synthetic" }, { status: 503 }),
    ]) {
      await expect(
        createLocalApiClient(async () => response, session).prepareSourceManifestSubmit(
          reviewTarget(),
        ),
      ).resolves.toEqual({ kind: "REMOTE_UNKNOWN" });
    }
    const bytes = new TextEncoder().encode(padded + " ");
    const bodyless = {
      status: 200,
      headers: new Headers({ ETag: '"revision-3"' }),
      body: null,
      arrayBuffer: async () => bytes.buffer,
    } as Response;
    await expect(
      createLocalApiClient(async () => bodyless, session).prepareSourceManifestSubmit(
        reviewTarget(),
      ),
    ).resolves.toEqual({ kind: "REMOTE_UNKNOWN" });
  });

  test("rejects incomplete manifest heads, bad dates, identity mismatch, and unsafe integers", async () => {
    const cases: ((r: SourceManifestResponse) => void)[] = [
      (r) => {
        delete (r.data.head as Partial<typeof r.data.head>).accepted_version_id;
      },
      (r) => {
        r.data.head.updated_at = "invalid";
      },
      (r) => {
        r.data.latest_version.created_at = "2026-02-30T00:00:00Z";
      },
      (r) => {
        r.data.project_id = `prj_${"0".repeat(32)}`;
      },
      (r) => {
        r.data.latest_version.content_hash = `sha256:${"0".repeat(64)}`;
      },
      (r) => {
        r.data.latest_version.version_number = Number.MAX_SAFE_INTEGER + 1;
      },
      (r) => {
        r.data.latest_version.content.documents[0]!.byte_size = -1;
      },
    ];
    for (const mutate of cases) {
      const receipt = structuredClone(sourceManifestResponse);
      mutate(receipt);
      await expect(
        invoke(
          createLocalApiClient(
            async () => Response.json(receipt, { headers: { ETag: '"revision-3"' } }),
            session,
          ),
          "get",
        ),
      ).resolves.toEqual({ kind: "REMOTE_UNKNOWN" });
    }
  });
});
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
const invalidationOperationId = `ivo_${"7".repeat(32)}`;
const invalidationOperationResponse: components["schemas"]["InvalidationOperationResponse"] = {
  data: {
    operation_id: invalidationOperationId,
    project_id: project.id,
    changed_artifact_id: `art_${"8".repeat(32)}`,
    old_accepted_version_id: `ver_${"9".repeat(32)}`,
    new_accepted_version_id: `ver_${"a".repeat(32)}`,
    gate_decision_id: `dec_${"b".repeat(32)}`,
    assessment_hash: `sha256:${"c".repeat(64)}`,
    created_at: "2026-09-03T09:00:00Z",
    paths: [
      {
        path_id: `ivp_${"d".repeat(32)}`,
        operation_id: invalidationOperationId,
        project_id: project.id,
        affected_artifact_id: `art_${"e".repeat(32)}`,
        affected_version_id: `ver_${"f".repeat(32)}`,
        classification: "STALE",
        aggregate_impact: "blocking",
        dependency_ids: [`dep_${"1".repeat(32)}`],
        relationships: ["depends_on"],
        edge_impacts: ["blocking"],
        effective_impact: "blocking",
        ordinal: 0,
        created_at: "2026-09-03T09:00:00Z",
      },
    ],
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

const fakeTimelineRunCommand: FakeTimelineRunCreateCommand = {
  operation_id: "7e0df32e-299a-4bb7-b77e-b85f20c41d61",
  input: {
    source_manifest_version_id: `ver_${"1".repeat(32)}`,
    source_document_id: `src_${"2".repeat(32)}`,
  },
};
const fakeTimelineCapabilityLosses = [
  "FAKE_IMAGE_NO_SEMANTIC_GENERATION",
  "STATIC_FRAME_NO_MOTION_GENERATION",
  "PLACEHOLDER_TONE_NO_SPEECH_OR_VOICE_IDENTITY",
] as const;
function createdFakeTimelineRunResponse(
  statusPair: { attempt_status?: string; task_status?: string } = {},
) {
  return {
    data: {
      project_id: project.id,
      source_manifest_version_id: fakeTimelineRunCommand.input.source_manifest_version_id,
      source_document_id: fakeTimelineRunCommand.input.source_document_id,
      workflow_run_id: `wfr_${"3".repeat(32)}`,
      node_run_id: `node_${"4".repeat(32)}`,
      attempt_id: `att_${"5".repeat(32)}`,
      task_id: `task_${"6".repeat(32)}`,
      attempt_status: statusPair.attempt_status ?? "READY",
      task_status: statusPair.task_status ?? "READY",
      capability_losses: [...fakeTimelineCapabilityLosses],
    },
    request_id: healthyResponse.request_id,
  };
}

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

  test("reads only an exact, bounded invalidation operation response", async () => {
    expect(
      isInvalidationOperationResponse(
        invalidationOperationResponse,
        project.id,
        invalidationOperationId,
      ),
    ).toBe(true);
    const fetchMock = vi.fn().mockResolvedValue(Response.json(invalidationOperationResponse));
    const client = createLocalApiClient(fetchMock, session);

    await expect(
      client.getInvalidationOperation(project.id, invalidationOperationId),
    ).resolves.toEqual(invalidationOperationResponse);
    expect(fetchMock).toHaveBeenCalledWith(
      `${session.origin}/api/v1/projects/${project.id}/invalidation-operations/${invalidationOperationId}`,
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${session.token}`,
          Origin: "app://aijian",
        },
      },
    );

    const invalidInputFetch = vi.fn();
    const invalidInputClient = createLocalApiClient(invalidInputFetch, session);
    await expect(
      invalidInputClient.getInvalidationOperation("prj_not-canonical", invalidationOperationId),
    ).rejects.toThrow("valid project id");
    await expect(
      invalidInputClient.getInvalidationOperation(project.id, "ivo_not-canonical"),
    ).rejects.toThrow("valid invalidation operation id");
    expect(invalidInputFetch).not.toHaveBeenCalled();
  });

  test("lists only exact bounded invalidation-operation pages", async () => {
    const { paths: _paths, ...summary } = invalidationOperationResponse.data;
    void _paths;
    const page = {
      data: {
        items: [{ ...summary, reason_path_count: 1 }],
        next_cursor: invalidationOperationId,
      },
      request_id: healthyResponse.request_id,
    } satisfies InvalidationOperationPageResponse;
    const defaultPage = { ...page, data: { ...page.data, next_cursor: null } };
    const emptyPage = { ...defaultPage, data: { ...defaultPage.data, items: [] } };
    const continuedPage = {
      ...page,
      data: {
        ...page.data,
        items: [{ ...page.data.items[0], operation_id: `ivo_${"e".repeat(32)}` }],
        next_cursor: `ivo_${"e".repeat(32)}`,
      },
    };

    expect(isInvalidationOperationPageResponse(emptyPage, project.id, {})).toBe(true);
    expect(isInvalidationOperationPageResponse(page, project.id, { limit: 1 })).toBe(true);
    expect(isInvalidationOperationPageResponse(page, project.id, {})).toBe(false);
    const firstOperationId = `ivo_${"d".repeat(32)}`;
    const secondOperationId = `ivo_${"7".repeat(32)}`;
    const twoItemPage = {
      ...page,
      data: {
        ...page.data,
        items: [
          { ...page.data.items[0], operation_id: firstOperationId },
          { ...page.data.items[0], operation_id: secondOperationId },
        ],
        next_cursor: secondOperationId,
      },
    };
    expect(isInvalidationOperationPageResponse(twoItemPage, project.id, { limit: 2 })).toBe(true);
    expect(
      isInvalidationOperationPageResponse(
        {
          ...twoItemPage,
          data: { ...twoItemPage.data, items: [page.data.items[0], page.data.items[0]] },
        },
        project.id,
        { limit: 2 },
      ),
    ).toBe(false);
    expect(
      isInvalidationOperationPageResponse(twoItemPage, project.id, {
        limit: 2,
        cursor: firstOperationId,
      }),
    ).toBe(false);
    const withTwoItems = (first: Record<string, unknown>, second: Record<string, unknown>) => ({
      ...twoItemPage,
      data: { ...twoItemPage.data, items: [first, second], next_cursor: second.operation_id },
    });
    expect(
      isInvalidationOperationPageResponse(
        withTwoItems(
          { ...twoItemPage.data.items[0], created_at: "2026-08-03T02:00:00Z" },
          { ...twoItemPage.data.items[1], created_at: "2026-08-03T03:00:00Z" },
        ),
        project.id,
        { limit: 2 },
      ),
    ).toBe(false);
    expect(
      isInvalidationOperationPageResponse(
        withTwoItems(
          { ...twoItemPage.data.items[0], created_at: "2026-08-03T03:00:00.000002Z" },
          { ...twoItemPage.data.items[1], created_at: "2026-08-03T03:00:00.000001Z" },
        ),
        project.id,
        { limit: 2 },
      ),
    ).toBe(true);
    expect(
      isInvalidationOperationPageResponse(
        withTwoItems(
          { ...twoItemPage.data.items[0], created_at: "2026-08-03T11:00:00+08:00" },
          { ...twoItemPage.data.items[1], created_at: "2026-08-03T03:00:00Z" },
        ),
        project.id,
        { limit: 2 },
      ),
    ).toBe(true);
    expect(
      isInvalidationOperationPageResponse(
        withTwoItems(
          { ...twoItemPage.data.items[1], created_at: "2026-08-03T03:00:00Z" },
          { ...twoItemPage.data.items[0], created_at: "2026-08-03T03:00:00Z" },
        ),
        project.id,
        { limit: 2 },
      ),
    ).toBe(false);
    const twentyOneItems = Array.from({ length: 21 }, () => page.data.items[0]);
    const hundredItems = Array.from({ length: 100 }, (_, index) => ({
      ...page.data.items[0],
      operation_id: `ivo_${(100 - index).toString(16).padStart(32, "0")}`,
    }));
    expect(
      isInvalidationOperationPageResponse(
        { ...page, data: { ...page.data, items: twentyOneItems } },
        project.id,
        {},
      ),
    ).toBe(false);
    expect(
      isInvalidationOperationPageResponse(
        {
          ...page,
          data: {
            ...page.data,
            items: hundredItems,
            next_cursor: hundredItems.at(-1)!.operation_id,
          },
        },
        project.id,
        { limit: 100 },
      ),
    ).toBe(true);

    const invalidPages: readonly unknown[] = [
      { ...page, extra: true },
      { ...page, data: { ...page.data, extra: true } },
      {
        ...page,
        data: {
          ...page.data,
          items: [{ ...page.data.items[0], project_id: `prj_${"b".repeat(32)}` }],
        },
      },
      { ...page, data: { ...page.data, items: [{ ...page.data.items[0], extra: true }] } },
      {
        ...page,
        data: { ...page.data, items: [{ ...page.data.items[0], operation_id: "ivo_bad" }] },
      },
      {
        ...page,
        data: { ...page.data, items: [{ ...page.data.items[0], assessment_hash: "bad" }] },
      },
      { ...page, data: { ...page.data, items: [{ ...page.data.items[0], created_at: "bad" }] } },
      {
        ...page,
        data: { ...page.data, items: [{ ...page.data.items[0], reason_path_count: -1 }] },
      },
      {
        ...page,
        data: { ...page.data, items: [{ ...page.data.items[0], reason_path_count: 0.5 }] },
      },
      {
        ...page,
        data: { ...page.data, items: [{ ...page.data.items[0], reason_path_count: Number.NaN }] },
      },
      {
        ...page,
        data: {
          ...page.data,
          items: [{ ...page.data.items[0], reason_path_count: Number.MAX_SAFE_INTEGER + 1 }],
        },
      },
      { ...page, data: { ...page.data, next_cursor: "ivo_bad" } },
      { ...page, data: { ...page.data, next_cursor: `ivo_${"c".repeat(32)}` } },
      { ...page, data: { ...page.data, items: [page.data.items[0], page.data.items[0]] } },
      {
        ...page,
        data: { ...page.data, items: Array.from({ length: 101 }, () => page.data.items[0]) },
      },
    ];
    for (const invalidPage of invalidPages) {
      expect(isInvalidationOperationPageResponse(invalidPage, project.id, { limit: 1 })).toBe(
        false,
      );
    }

    const cursorOnlyPage = {
      ...continuedPage,
      data: { ...continuedPage.data, next_cursor: null },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(defaultPage))
      .mockResolvedValueOnce(Response.json(page))
      .mockResolvedValueOnce(Response.json(cursorOnlyPage))
      .mockResolvedValueOnce(Response.json(continuedPage))
      .mockResolvedValueOnce(Response.json(defaultPage));
    const client = createLocalApiClient(fetchMock, session);
    await expect(client.listInvalidationOperations(project.id)).resolves.toEqual(defaultPage);
    await expect(client.listInvalidationOperations(project.id, { limit: 1 })).resolves.toEqual(
      page,
    );
    await expect(
      client.listInvalidationOperations(project.id, { cursor: invalidationOperationId }),
    ).resolves.toEqual(cursorOnlyPage);
    await expect(
      client.listInvalidationOperations(project.id, { limit: 1, cursor: invalidationOperationId }),
    ).resolves.toEqual(continuedPage);
    await expect(client.listInvalidationOperations(project.id, { cursor: null })).resolves.toEqual(
      defaultPage,
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `${session.origin}/api/v1/projects/${project.id}/invalidation-operations`,
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${session.token}`,
          Origin: "app://aijian",
        },
      },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `${session.origin}/api/v1/projects/${project.id}/invalidation-operations?limit=1`,
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${session.token}`,
          Origin: "app://aijian",
        },
      },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      `${session.origin}/api/v1/projects/${project.id}/invalidation-operations?cursor=${invalidationOperationId}`,
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${session.token}`,
          Origin: "app://aijian",
        },
      },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      `${session.origin}/api/v1/projects/${project.id}/invalidation-operations?limit=1&cursor=${invalidationOperationId}`,
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${session.token}`,
          Origin: "app://aijian",
        },
      },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      `${session.origin}/api/v1/projects/${project.id}/invalidation-operations`,
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${session.token}`,
          Origin: "app://aijian",
        },
      },
    );

    const invalidInputFetch = vi.fn();
    const invalidInputClient = createLocalApiClient(invalidInputFetch, session);
    for (const query of [
      { limit: 0 },
      { limit: 101 },
      { limit: 1.5 },
      { limit: Number.NaN },
      { cursor: "ivo_bad" },
      { extra: true },
      [],
    ]) {
      await expect(
        invalidInputClient.listInvalidationOperations(project.id, query as never),
      ).rejects.toThrow("valid invalidation operation page query");
    }
    await expect(invalidInputClient.listInvalidationOperations("prj_bad")).rejects.toThrow(
      "valid project id",
    );
    expect(invalidInputFetch).not.toHaveBeenCalled();

    await expect(
      createLocalApiClient(
        vi
          .fn()
          .mockResolvedValue(
            Response.json({ ...defaultPage, data: { ...defaultPage.data, extra: true } }),
          ),
        session,
      ).listInvalidationOperations(project.id),
    ).rejects.toThrow("published contract");
    await expect(
      createLocalApiClient(
        vi.fn().mockResolvedValue(new Response("server failure", { status: 500 })),
        session,
      ).listInvalidationOperations(project.id),
    ).rejects.toThrow("status 500");
    await expect(
      createLocalApiClient(
        vi.fn().mockRejectedValue(new Error("network offline")),
        session,
      ).listInvalidationOperations(project.id),
    ).rejects.toThrow("network offline");
    await expect(
      createLocalApiClient(
        vi.fn().mockResolvedValue(new Response(" ".repeat(16 * 1024 * 1024 + 1))),
        session,
      ).listInvalidationOperations(project.id),
    ).rejects.toThrow("desktop safety limit");
  });

  test("rejects malformed invalidation responses and preserves HTTP failures", async () => {
    const path = invalidationOperationResponse.data.paths[0]!;
    const withData = (data: Record<string, unknown>) => ({
      ...invalidationOperationResponse,
      data: { ...invalidationOperationResponse.data, ...data },
    });
    const withPath = (pathData: Record<string, unknown>) =>
      withData({ paths: [{ ...path, ...pathData }] });
    const secondPath = { ...path, path_id: `ivp_${"2".repeat(32)}`, ordinal: 1 };
    const withTwoPaths = (first: Record<string, unknown>, second: Record<string, unknown>) =>
      withData({
        paths: [
          { ...path, ...first },
          { ...secondPath, ...second },
        ],
      });
    const invalidPayloads: Array<[string, unknown]> = [
      ["root extra", { ...invalidationOperationResponse, extra: "must-not-cross-boundary" }],
      ["data extra", withData({ token: "must-not-cross-boundary" })],
      ["path extra", withPath({ token: "must-not-cross-boundary" })],
      ["request id", { ...invalidationOperationResponse, request_id: "not-a-uuid" }],
      ["assessment hash", withData({ assessment_hash: "sha256:invalid" })],
      ["root operation", withData({ operation_id: `ivo_${"0".repeat(32)}` })],
      ["root project", withData({ project_id: `prj_${"0".repeat(32)}` })],
      ["path operation", withPath({ operation_id: `ivo_${"0".repeat(32)}` })],
      ["path project", withPath({ project_id: `prj_${"0".repeat(32)}` })],
      ["ordinal gap", withTwoPaths({}, { ordinal: 2 })],
      ["ordinal duplicate", withTwoPaths({}, { ordinal: 0 })],
      ["empty relationship", withPath({ relationships: [] })],
      [
        "unequal path arrays",
        withPath({ dependency_ids: [`dep_${"1".repeat(32)}`, `dep_${"2".repeat(32)}`] }),
      ],
      ["classification", withPath({ classification: "UNKNOWN" })],
      ["root naive datetime", withData({ created_at: "2026-09-03T09:00:00" })],
      ["root invalid calendar datetime", withData({ created_at: "2026-02-30T09:00:00Z" })],
      ["root invalid hour datetime", withData({ created_at: "2026-09-03T24:00:00Z" })],
      ["path invalid calendar datetime", withPath({ created_at: "2026-02-30T09:00:00Z" })],
    ];

    for (const [label, payload] of invalidPayloads) {
      expect(
        isInvalidationOperationResponse(payload, project.id, invalidationOperationId),
        label,
      ).toBe(false);
      const client = createLocalApiClient(
        vi.fn().mockResolvedValue(Response.json(payload)),
        session,
      );
      await expect(
        client.getInvalidationOperation(project.id, invalidationOperationId),
      ).rejects.toThrow("published contract");
    }

    expect(
      isInvalidationOperationResponse(withData({ paths: [] }), project.id, invalidationOperationId),
    ).toBe(true);

    const errorPayload = {
      error: {
        code: "INVALIDATION_OPERATION_NOT_FOUND",
        message: "not found",
        retryable: false,
        details: {},
      },
      request_id: healthyResponse.request_id,
    };
    for (const status of [404, 413, 422, 500]) {
      const client = createLocalApiClient(
        vi.fn().mockResolvedValue(Response.json(errorPayload, { status })),
        session,
      );
      await expect(
        client.getInvalidationOperation(project.id, invalidationOperationId),
      ).rejects.toThrow(`status ${status}`);
    }

    const oversizedClient = createLocalApiClient(
      vi.fn().mockResolvedValue(
        new Response("{}", {
          headers: { "Content-Length": String(16 * 1024 * 1024 + 1) },
        }),
      ),
      session,
    );
    await expect(
      oversizedClient.getInvalidationOperation(project.id, invalidationOperationId),
    ).rejects.toThrow("desktop safety limit");
  });

  test("enforces the canonical data UTF-8 limit independently of transport size", async () => {
    const maxDataBytes = 4 * 1024 * 1024;
    const responseWithRelationship = (relationship: string) => ({
      ...invalidationOperationResponse,
      data: {
        ...invalidationOperationResponse.data,
        paths: [
          {
            ...invalidationOperationResponse.data.paths[0]!,
            relationships: [relationship],
          },
        ],
      },
    });
    const base = responseWithRelationship("");
    const baseBytes = new TextEncoder().encode(JSON.stringify(base.data)).byteLength;
    const multiByteCharacter = "汉";
    const multiByteCharacterBytes = new TextEncoder().encode(multiByteCharacter).byteLength;
    const remainingBytes = maxDataBytes - baseBytes;
    const multiByteCount = Math.floor(remainingBytes / multiByteCharacterBytes);
    const asciiPaddingBytes = remainingBytes % multiByteCharacterBytes;
    const atLimit = responseWithRelationship(
      multiByteCharacter.repeat(multiByteCount) + "x".repeat(asciiPaddingBytes),
    );
    const overLimit = responseWithRelationship(
      atLimit.data.paths[0]!.relationships[0]! + multiByteCharacter,
    );

    expect(multiByteCharacterBytes).toBe(3);
    expect(atLimit.data.paths[0]!.relationships[0]!.length).toBeLessThan(remainingBytes);
    expect(new TextEncoder().encode(JSON.stringify(atLimit.data)).byteLength).toBe(maxDataBytes);
    expect(new TextEncoder().encode(JSON.stringify(overLimit.data)).byteLength).toBe(
      maxDataBytes + multiByteCharacterBytes,
    );
    expect(isInvalidationOperationResponse(atLimit, project.id, invalidationOperationId)).toBe(
      true,
    );
    expect(isInvalidationOperationResponse(overLimit, project.id, invalidationOperationId)).toBe(
      false,
    );

    const client = createLocalApiClient(
      vi.fn().mockResolvedValue(Response.json(overLimit)),
      session,
    );
    await expect(
      client.getInvalidationOperation(project.id, invalidationOperationId),
    ).rejects.toThrow("published contract");
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

  test("accepts a complete immutable media binding and rejects a noncanonical mapping", async () => {
    const bound = structuredClone(timelineResponse);
    const asset = bound.data.timeline.assets[0];
    if (asset === undefined) throw new Error("timeline fixture asset is missing");
    bound.data.timeline.media_package = {
      schema_version: 1,
      media_package_id: `fmp_${"d".repeat(32)}`,
      manifest_relative_path: "manifest.json",
      manifest_sha256: `sha256:${"b".repeat(64)}`,
      assets: [
        {
          schema_version: 1,
          asset_id: asset.asset_id,
          preview_relative_path: "shot-01/preview.webm",
          preview_sha256: asset.source_asset_sha256,
          preview_byte_length: 100,
          preview_mime_type: "video/webm",
          preview_kind: "DEVELOPMENT_FAKE",
          source_asset_sha256: asset.source_asset_sha256,
          source_frame_count: asset.source_frame_count,
          editing_asset_sha256: asset.source_asset_sha256,
          editable_frame_count: asset.source_frame_count,
        },
      ],
    };
    const validClient = createLocalApiClient(
      vi.fn().mockResolvedValue(Response.json(bound)),
      session,
    );
    await expect(validClient.getProjectTimeline(project.id)).resolves.toEqual(bound);

    const invalid = structuredClone(bound);
    const binding = invalid.data.timeline.media_package?.assets[0];
    if (binding === undefined) throw new Error("timeline fixture binding is missing");
    binding.preview_relative_path = "C:/outside.webm";
    const invalidClient = createLocalApiClient(
      vi.fn().mockResolvedValue(Response.json(invalid)),
      session,
    );
    await expect(invalidClient.getProjectTimeline(project.id)).rejects.toThrow(
      "published contract",
    );

    for (const mutate of [
      (response: typeof bound) => {
        response.data.timeline.media_package!.assets[0]!.preview_sha256 = `sha256:${"c".repeat(64)}`;
      },
      (response: typeof bound) => {
        response.data.timeline.media_package!.assets.push(
          structuredClone(response.data.timeline.media_package!.assets[0]!),
        );
      },
      (response: typeof bound) => {
        (
          response.data.timeline.media_package!.assets[0]! as object as Record<string, unknown>
        ).unexpected = true;
      },
    ]) {
      const malformed = structuredClone(bound);
      mutate(malformed);
      const malformedClient = createLocalApiClient(
        vi.fn().mockResolvedValue(Response.json(malformed)),
        session,
      );
      await expect(malformedClient.getProjectTimeline(project.id)).rejects.toThrow(
        "published contract",
      );
    }
  });

  test("matches a non-sequential media binding by asset id without a linear asset scan", () => {
    const bound = structuredClone(timelineResponse);
    const firstAsset = bound.data.timeline.assets[0];
    if (firstAsset === undefined) {
      throw new Error("timeline asset fixture is incomplete");
    }
    bound.data.timeline.media_package = {
      schema_version: 1,
      media_package_id: `fmp_${"d".repeat(32)}`,
      manifest_relative_path: "manifest.json",
      manifest_sha256: `sha256:${"b".repeat(64)}`,
      assets: [
        {
          schema_version: 1,
          asset_id: firstAsset.asset_id,
          preview_relative_path: "shot-01/preview.webm",
          preview_sha256: firstAsset.source_asset_sha256,
          preview_byte_length: 100,
          preview_mime_type: "video/webm",
          preview_kind: "DEVELOPMENT_FAKE",
          source_asset_sha256: firstAsset.source_asset_sha256,
          source_frame_count: firstAsset.source_frame_count,
          editing_asset_sha256: firstAsset.source_asset_sha256,
          editable_frame_count: firstAsset.source_frame_count,
        },
      ],
    };
    const firstBinding = bound.data.timeline.media_package.assets[0];
    if (firstBinding === undefined) throw new Error("timeline binding fixture is incomplete");
    const secondAsset = structuredClone(firstAsset);
    secondAsset.asset_id = "fake-asset-02";
    secondAsset.source_asset_sha256 = `sha256:${"e".repeat(64)}`;
    bound.data.timeline.assets.push(secondAsset);
    const secondBinding = structuredClone(firstBinding);
    secondBinding.asset_id = secondAsset.asset_id;
    secondBinding.source_asset_sha256 = secondAsset.source_asset_sha256;
    secondBinding.editing_asset_sha256 = secondAsset.source_asset_sha256;
    secondBinding.preview_sha256 = secondAsset.source_asset_sha256;
    bound.data.timeline.media_package!.assets.unshift(secondBinding);

    const findSpy = vi.spyOn(bound.data.timeline.assets, "find");
    try {
      expect(isTimelineResponse(bound, project.id)).toBe(true);
      expect(findSpy).not.toHaveBeenCalled();
    } finally {
      findSpy.mockRestore();
    }
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

  test("posts the exact fake timeline header and body and retries unknown with the same identity", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("connection reset"));
    const client = createLocalApiClient(fetchMock, session);

    await expect(client.createFakeTimelineRun(project.id, fakeTimelineRunCommand)).resolves.toEqual(
      {
        kind: "REMOTE_UNKNOWN",
      },
    );
    await expect(client.createFakeTimelineRun(project.id, fakeTimelineRunCommand)).resolves.toEqual(
      {
        kind: "REMOTE_UNKNOWN",
      },
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = fetchMock.mock.calls[0]!;
    const second = fetchMock.mock.calls[1]!;
    expect(first[0]).toBe(`${session.origin}/api/v1/projects/${project.id}/fake-timeline-runs`);
    expect(second[0]).toBe(first[0]);
    const firstInit = first[1] as RequestInit;
    const secondInit = second[1] as RequestInit;
    expect(firstInit.method).toBe("POST");
    expect(firstInit.body).toBe(JSON.stringify(fakeTimelineRunCommand.input));
    expect(secondInit.body).toBe(firstInit.body);
    expect(new Headers(firstInit.headers).get("Idempotency-Key")).toBe(
      `fake-timeline-run:create:v1:${fakeTimelineRunCommand.operation_id}`,
    );
    expect(new Headers(secondInit.headers).get("Idempotency-Key")).toBe(
      new Headers(firstInit.headers).get("Idempotency-Key"),
    );
    expect(firstInit.signal).toBeInstanceOf(AbortSignal);
  });

  test("distinguishes a fresh 201 fake timeline run from an exact 200 replay", async () => {
    const receipt = createdFakeTimelineRunResponse();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(receipt, { status: 201 }))
      .mockResolvedValueOnce(Response.json(receipt, { status: 200 }));
    const client = createLocalApiClient(fetchMock, session);

    await expect(client.createFakeTimelineRun(project.id, fakeTimelineRunCommand)).resolves.toEqual(
      {
        kind: "SUCCEEDED",
        receipt,
        replayed: false,
      },
    );
    await expect(client.createFakeTimelineRun(project.id, fakeTimelineRunCommand)).resolves.toEqual(
      {
        kind: "SUCCEEDED",
        receipt,
        replayed: true,
      },
    );
    expect((fetchMock.mock.calls[0]![1] as RequestInit).body).toBe(
      JSON.stringify(fakeTimelineRunCommand.input),
    );
  });

  test("rejects invalid fake timeline project, command, extra keys, and source ids before HTTP", async () => {
    const fetchMock = vi.fn();
    const client = createLocalApiClient(fetchMock, session);

    await expect(
      client.createFakeTimelineRun("../workspace.sqlite3", fakeTimelineRunCommand),
    ).rejects.toThrow("valid project id");
    await expect(
      client.createFakeTimelineRun(project.id, {
        ...fakeTimelineRunCommand,
        operation_id: fakeTimelineRunCommand.operation_id.toUpperCase(),
      }),
    ).rejects.toThrow("valid fake timeline run command");
    await expect(
      client.createFakeTimelineRun(project.id, {
        ...fakeTimelineRunCommand,
        extra: true,
      } as FakeTimelineRunCreateCommand),
    ).rejects.toThrow("valid fake timeline run command");
    await expect(
      client.createFakeTimelineRun(project.id, {
        ...fakeTimelineRunCommand,
        input: {
          ...fakeTimelineRunCommand.input,
          source_document_id: `SRC_${"2".repeat(32)}`,
        },
      }),
    ).rejects.toThrow("valid fake timeline run command");
    await expect(
      client.createFakeTimelineRun(project.id, {
        ...fakeTimelineRunCommand,
        input: {
          ...fakeTimelineRunCommand.input,
          source_manifest_version_id: "ver_not-canonical",
        },
      }),
    ).rejects.toThrow("valid fake timeline run command");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("classifies contract-valid fake timeline errors, special 503, and unknown transport", async () => {
    const errorPayload = {
      error: {
        code: "FAKE_TIMELINE_RUN_CONFLICT",
        message: "conflict",
        retryable: false,
        details: {},
      },
      request_id: healthyResponse.request_id,
    };
    const unavailable = {
      error: {
        code: "FAKE_TIMELINE_RUNTIME_UNAVAILABLE",
        message: "runtime unavailable",
        retryable: true,
        details: {},
      },
      request_id: healthyResponse.request_id,
    };
    for (const status of [401, 403, 404, 409, 422]) {
      const client = createLocalApiClient(
        vi.fn().mockResolvedValue(Response.json(errorPayload, { status })),
        session,
      );
      await expect(
        client.createFakeTimelineRun(project.id, fakeTimelineRunCommand),
      ).resolves.toEqual({
        kind: "DEFINITE_SERVER_ERROR",
        status,
        code: "FAKE_TIMELINE_RUN_CONFLICT",
        request_id: healthyResponse.request_id,
      });
    }
    const unavailableClient = createLocalApiClient(
      vi.fn().mockResolvedValue(Response.json(unavailable, { status: 503 })),
      session,
    );
    await expect(
      unavailableClient.createFakeTimelineRun(project.id, fakeTimelineRunCommand),
    ).resolves.toEqual({
      kind: "DEFINITE_SERVER_ERROR",
      status: 503,
      code: "FAKE_TIMELINE_RUNTIME_UNAVAILABLE",
      request_id: healthyResponse.request_id,
    });

    const timeoutError = new DOMException(
      "The operation was aborted due to timeout",
      "TimeoutError",
    );
    for (const response of [
      { fetcher: vi.fn().mockResolvedValue(Response.json(errorPayload, { status: 500 })) },
      { fetcher: vi.fn().mockRejectedValue(new Error("connection reset")) },
      { fetcher: vi.fn().mockRejectedValue(timeoutError) },
      {
        fetcher: vi
          .fn()
          .mockResolvedValue(Response.json(createdFakeTimelineRunResponse(), { status: 202 })),
      },
      {
        fetcher: vi
          .fn()
          .mockResolvedValue(Response.json({ ...errorPayload, extra: true }, { status: 409 })),
      },
      { fetcher: vi.fn().mockResolvedValue(Response.json(errorPayload, { status: 503 })) },
      {
        fetcher: vi
          .fn()
          .mockResolvedValue(Response.json({ ...unavailable, extra: true }, { status: 503 })),
      },
      { fetcher: vi.fn().mockResolvedValue(new Response("{", { status: 201 })) },
      {
        fetcher: vi.fn().mockResolvedValue(
          new Response("{}", {
            status: 201,
            headers: { "Content-Length": String(16 * 1024 * 1024 + 1) },
          }),
        ),
      },
      {
        fetcher: vi.fn().mockResolvedValue(
          Response.json(
            createdFakeTimelineRunResponse({ attempt_status: "LEASED", task_status: "LEASED" }),
            {
              status: 201,
            },
          ),
        ),
      },
    ]) {
      const client = createLocalApiClient(response.fetcher, session);
      await expect(
        client.createFakeTimelineRun(project.id, fakeTimelineRunCommand),
      ).resolves.toEqual({ kind: "REMOTE_UNKNOWN" });
    }
  });

  test("binds the fake timeline header to operation identity and sends the exact changed body", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("unknown"));
    const client = createLocalApiClient(fetchMock, session);
    const secondOperation = {
      ...fakeTimelineRunCommand,
      operation_id: "87302cb8-71f8-4bb9-856a-162571f1ae6e",
    };
    const changedInput = {
      ...fakeTimelineRunCommand,
      input: {
        ...fakeTimelineRunCommand.input,
        source_document_id: `src_${"9".repeat(32)}`,
      },
    };

    await client.createFakeTimelineRun(project.id, fakeTimelineRunCommand);
    await client.createFakeTimelineRun(project.id, changedInput);
    await client.createFakeTimelineRun(project.id, secondOperation);
    const keys = fetchMock.mock.calls.map((call) =>
      new Headers((call[1] as RequestInit).headers).get("Idempotency-Key"),
    );
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
    expect((fetchMock.mock.calls[1]![1] as RequestInit).body).toBe(
      JSON.stringify(changedInput.input),
    );
    expect((fetchMock.mock.calls[2]![1] as RequestInit).body).toBe(
      JSON.stringify(secondOperation.input),
    );
  });
});

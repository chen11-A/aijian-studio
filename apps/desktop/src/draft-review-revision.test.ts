import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { createLocalApiClient } from "./api-client";
import { createDraftReviewRevisionClient } from "./draft-review-revision-client";
import {
  DRAFT_REVIEW_REVISION_CHANNELS,
  isApproveDraftReviewRevisionPlanRequest,
  isAttachDraftReviewRevisionCandidateRequest,
  isCreateDraftReviewRevisionPlanRequest,
  isDraftReviewRevisionResponse,
  isDraftReviewRevisionScopeResponse,
  isRecheckDraftReviewRevisionCandidateRequest,
  type ApproveDraftReviewRevisionPlanRequest,
  type AttachDraftReviewRevisionCandidateRequest,
  type CreateDraftReviewRevisionPlanRequest,
  type DraftReviewRevisionCandidate,
  type DraftReviewRevisionGateway,
  type DraftReviewRevisionPlan,
  type DraftReviewRevisionPlanEntry,
  type DraftReviewRevisionResponse,
  type DraftReviewRevisionSegment,
  type RecheckDraftReviewRevisionCandidateRequest,
} from "./draft-review-revision-contract";
import { registerDraftReviewRevisionHandlers } from "./draft-review-revision-ipc";

const project = `prj_${"a".repeat(32)}`;
const episode = `ep_${"b".repeat(32)}`;
const operation = `dmp_${"c".repeat(32)}`;
const requestId = "00000000-0000-4000-8000-000000000001";
const proof = {
  assembly_version_id: `ver_${"d".repeat(32)}`,
  assembly_content_hash: `sha256:${"e".repeat(64)}`,
  output_sha256: "f".repeat(64),
  output_bytes: 1024,
};
const source = {
  ...proof,
  project_id: project,
  episode_id: episode,
  operation_id: operation,
  assembly_version_number: 2,
  total_frames: 100,
  frame_rate_num: 25,
  frame_rate_den: 1,
};
const segment: DraftReviewRevisionSegment = {
  segment_id: "seg_visual",
  track_kind: "VISUAL",
  start_frame: 0,
  end_frame: 100,
  segment_hash: `sha256:${"0".repeat(64)}`,
  media: {
    asset_id: `asset_${"1".repeat(32)}`,
    asset_version_id: `asv_${"2".repeat(32)}`,
    sha256: "3".repeat(64),
  },
  storyboard_ref: {
    storyboard_version_id: `ver_${"4".repeat(32)}`,
    shot_id: `shp_${"5".repeat(32)}`,
  },
};
const create: CreateDraftReviewRevisionPlanRequest = {
  ...proof,
  plan_id: `drp_${"1".repeat(32)}`,
  note_ids: [`drn_${"2".repeat(32)}`],
  affected_segment_ids: [segment.segment_id],
  instruction: "手动修改视线。\nKeep other segments intact.",
};
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (typeof value === "object" && value !== null)
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, sorted(item)]),
    );
  return value;
}
function contentHash(value: object): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(sorted(value)), "utf8")
    .digest("hex")}`;
}
const planContent = {
  plan_id: create.plan_id,
  source,
  notes: [
    {
      note_id: create.note_ids[0]!,
      frame_index: 24,
      text: "Fix the eyeline.",
      actor_id: "local-manual-reviewer",
      created_at: "2026-10-09T00:00:00+00:00",
    },
  ],
  affected_segments: [segment],
  instruction: create.instruction,
  actor_id: "local-manual-reviewer",
  created_at: "2026-10-09T00:00:30+00:00",
};
const plan: DraftReviewRevisionPlan = { ...planContent, plan_hash: contentHash(planContent) };
const approve: ApproveDraftReviewRevisionPlanRequest = {
  approval_id: `dra_${"3".repeat(32)}`,
  expected_plan_hash: plan.plan_hash,
};
const approval = {
  approval_id: approve.approval_id,
  plan_id: plan.plan_id,
  plan_hash: plan.plan_hash,
  assembly_version_number_at_approval: 3,
  actor_id: "local-manual-reviewer",
  created_at: "2026-10-09T00:01:00+00:00",
};
const candidateTarget = {
  ...source,
  operation_id: `dmp_${"6".repeat(32)}`,
  assembly_version_id: `ver_${"7".repeat(32)}`,
  assembly_version_number: 4,
  assembly_content_hash: `sha256:${"8".repeat(64)}`,
  output_sha256: "9".repeat(64),
  output_bytes: 2048,
};
const candidateContent = {
  candidate_id: `drc_${"4".repeat(32)}`,
  plan_id: plan.plan_id,
  plan_hash: plan.plan_hash,
  approval_id: approval.approval_id,
  target: candidateTarget,
  segments: [{ ...segment, segment_hash: `sha256:${"a".repeat(64)}` }],
  comparison: {
    unchanged_segment_ids: [],
    changed_segment_ids: [segment.segment_id],
    removed_segment_ids: [],
    added_segment_ids: [],
    out_of_scope_segment_ids: [],
    sequence_settings_changed: false,
  },
  change_summary: "Manually replaced the chosen shot.",
  actor_id: "local-manual-reviewer",
  created_at: "2026-10-09T00:02:00+00:00",
};
const candidate: DraftReviewRevisionCandidate = {
  ...candidateContent,
  candidate_hash: contentHash(candidateContent),
};
const attach: AttachDraftReviewRevisionCandidateRequest = {
  assembly_version_id: candidateTarget.assembly_version_id,
  assembly_content_hash: candidateTarget.assembly_content_hash,
  output_sha256: candidateTarget.output_sha256,
  output_bytes: candidateTarget.output_bytes,
  candidate_id: candidate.candidate_id,
  expected_plan_hash: plan.plan_hash,
  approval_id: approval.approval_id,
  candidate_operation_id: candidateTarget.operation_id,
  change_summary: candidate.change_summary,
};
const recheck: RecheckDraftReviewRevisionCandidateRequest = {
  recheck_id: `drk_${"5".repeat(32)}`,
  expected_candidate_hash: candidate.candidate_hash,
  outcome: "MANUALLY_CHECKED",
  reason: "Checked against the saved candidate at frame 24.",
};
const checked = {
  recheck_id: recheck.recheck_id,
  candidate_id: candidate.candidate_id,
  candidate_hash: candidate.candidate_hash,
  outcome: recheck.outcome,
  reason: recheck.reason,
  actor_id: "local-manual-reviewer",
  created_at: "2026-10-09T00:03:00+00:00",
};
const planned: DraftReviewRevisionPlanEntry = { plan, approval: null, candidates: [] };
const approved: DraftReviewRevisionPlanEntry = { plan, approval, candidates: [] };
const attached: DraftReviewRevisionPlanEntry = {
  plan,
  approval,
  candidates: [{ candidate, output_verified: true, recheck: null }],
};
const rechecked: DraftReviewRevisionPlanEntry = {
  plan,
  approval,
  candidates: [{ candidate, output_verified: true, recheck: checked }],
};
function receipt(plans: DraftReviewRevisionPlanEntry[] = []): DraftReviewRevisionResponse {
  return {
    data: { source, output_verified: true, plans, manual_review_only: true },
    request_id: requestId,
  };
}
const scopeReceipt = {
  data: { source, output_verified: true, segments: [segment], manual_review_only: true },
  request_id: requestId,
};
function http(payload: unknown = receipt(), status = 200, header: string | null = requestId) {
  return { status, payload, requestId: header };
}
function error(status = 409, code = "DRAFT_REVISION_ID_REUSED") {
  return http(
    {
      error: { code, message: "Unavailable", details: {}, retryable: false },
      request_id: requestId,
    },
    status,
  );
}
function fetchResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", "X-Request-ID": requestId },
  });
}
const base = `/api/v1/projects/${project}/episodes/${episode}/draft-exports/${operation}/revision-plans`;
const actions = ["create", "approve", "attach", "recheck"] as const;
const inputs = { create, approve, attach, recheck };
const before = {
  create: receipt(),
  approve: receipt([planned]),
  attach: receipt([approved]),
  recheck: receipt([attached]),
};
const after = {
  create: receipt([planned]),
  approve: receipt([approved]),
  attach: receipt([attached]),
  recheck: receipt([rechecked]),
};
const suffixes = {
  create: "",
  approve: `/${plan.plan_id}/approvals`,
  attach: `/${plan.plan_id}/candidates`,
  recheck: `/${plan.plan_id}/candidates/${candidate.candidate_id}/rechecks`,
};
function mutation(client: DraftReviewRevisionGateway, action: (typeof actions)[number]) {
  if (action === "create")
    return client.createDraftReviewRevisionPlan(project, episode, operation, create);
  if (action === "approve")
    return client.approveDraftReviewRevisionPlan(
      project,
      episode,
      operation,
      plan.plan_id,
      approve,
    );
  if (action === "attach")
    return client.attachDraftReviewRevisionCandidate(
      project,
      episode,
      operation,
      plan.plan_id,
      attach,
    );
  return client.recheckDraftReviewRevisionCandidate(
    project,
    episode,
    operation,
    plan.plan_id,
    candidate.candidate_id,
    recheck,
  );
}

describe("bounded manual revision closed contracts", () => {
  it("accepts generated requests, hash-bound history, and dynamic output availability", () => {
    expect(isCreateDraftReviewRevisionPlanRequest(create)).toBe(true);
    expect(isApproveDraftReviewRevisionPlanRequest(approve)).toBe(true);
    expect(isAttachDraftReviewRevisionCandidateRequest(attach)).toBe(true);
    expect(isRecheckDraftReviewRevisionCandidateRequest(recheck)).toBe(true);
    for (const payload of [receipt(), ...Object.values(after)])
      expect(isDraftReviewRevisionResponse(payload, project, episode, operation, requestId)).toBe(
        true,
      );
    const unavailable = structuredClone(after.recheck);
    unavailable.data.output_verified = false;
    unavailable.data.plans[0]!.candidates[0]!.output_verified = false;
    expect(isDraftReviewRevisionResponse(unavailable, project, episode, operation, requestId)).toBe(
      true,
    );
    expect(
      isDraftReviewRevisionScopeResponse(scopeReceipt, project, episode, operation, requestId),
    ).toBe(true);
    expect(
      isCreateDraftReviewRevisionPlanRequest({ ...create, instruction: "😀".repeat(2000) }),
    ).toBe(true);
  });
  it.each([
    { note_ids: [] },
    { note_ids: [create.note_ids[0], create.note_ids[0]] },
    { note_ids: ["../note"] },
    { note_ids: Array(51).fill(create.note_ids[0]) },
    { affected_segment_ids: [] },
    { affected_segment_ids: ["../segment"] },
    { affected_segment_ids: [segment.segment_id, segment.segment_id] },
    { affected_segment_ids: Array(101).fill(segment.segment_id) },
    { plan_id: "../plan" },
    { instruction: " " },
    { instruction: "bad\0text" },
    { instruction: "\ud800" },
    { instruction: "😀".repeat(2001) },
    { output_bytes: 0 },
    { output_bytes: Number.MAX_SAFE_INTEGER + 1 },
    { assembly_content_hash: "bad" },
    { actor_id: "forged" },
    { provider: "OpenAI" },
    { output_path: "/secret.mp4" },
    { approved: true },
    { release: true },
  ])("rejects unsafe plan input %j", (patch) => {
    expect(isCreateDraftReviewRevisionPlanRequest({ ...create, ...patch })).toBe(false);
  });
  it("requires every own key and rejects metadata for all four request types", () => {
    const guards = [
      isCreateDraftReviewRevisionPlanRequest,
      isApproveDraftReviewRevisionPlanRequest,
      isAttachDraftReviewRevisionCandidateRequest,
      isRecheckDraftReviewRevisionCandidateRequest,
    ];
    const commands = Object.values(inputs);
    commands.forEach((command, index) => {
      const guard = guards[index]!;
      for (const key of Object.keys(command)) {
        const missing = { ...command } as Record<string, unknown>;
        delete missing[key];
        expect(guard(missing)).toBe(false);
      }
      for (const extra of [
        { actor_id: "forged" },
        { output_path: "C:\\secret" },
        { provider: "OpenAI" },
        { release: true },
      ])
        expect(guard({ ...command, ...extra })).toBe(false);
      expect(guard(null)).toBe(false);
      expect(guard([])).toBe(false);
    });
    expect(
      isApproveDraftReviewRevisionPlanRequest({ ...approve, approval_id: "../approval" }),
    ).toBe(false);
    expect(isApproveDraftReviewRevisionPlanRequest({ ...approve, expected_plan_hash: "bad" })).toBe(
      false,
    );
    expect(
      isAttachDraftReviewRevisionCandidateRequest({
        ...attach,
        candidate_operation_id: "../candidate",
      }),
    ).toBe(false);
    expect(isAttachDraftReviewRevisionCandidateRequest({ ...attach, approval_id: "bad" })).toBe(
      false,
    );
    expect(isAttachDraftReviewRevisionCandidateRequest({ ...attach, change_summary: "\0" })).toBe(
      false,
    );
    expect(isRecheckDraftReviewRevisionCandidateRequest({ ...recheck, outcome: "APPROVED" })).toBe(
      false,
    );
    expect(
      isRecheckDraftReviewRevisionCandidateRequest({ ...recheck, expected_candidate_hash: "bad" }),
    ).toBe(false);
    expect(isRecheckDraftReviewRevisionCandidateRequest({ ...recheck, reason: " " })).toBe(false);
  });
  it("rejects wrong scope, envelopes, exact nested keys, duplicate IDs, and forged hashes", () => {
    const valid = after.recheck;
    const invalid: unknown[] = [
      null,
      [],
      { data: valid.data },
      { ...valid, extra: true },
      { ...valid, request_id: "bad" },
      { ...valid, data: { ...valid.data, manual_review_only: false } },
      { ...valid, data: { ...valid.data, output_verified: "true" } },
      {
        ...valid,
        data: { ...valid.data, source: { ...source, operation_id: `dmp_${"0".repeat(32)}` } },
      },
      { ...valid, data: { ...valid.data, source: { ...source, output_path: "/secret" } } },
      { ...valid, data: { ...valid.data, plans: [rechecked, rechecked] } },
      { ...valid, data: { ...valid.data, plans: Array(101).fill(rechecked) } },
      receipt([{ ...planned, plan: { ...plan, plan_hash: `sha256:${"0".repeat(64)}` } }]),
      receipt([{ ...planned, plan: { ...plan, instruction: "changed without a new hash" } }]),
      receipt([
        {
          ...attached,
          candidates: [
            {
              ...attached.candidates[0]!,
              candidate: { ...candidate, candidate_hash: `sha256:${"0".repeat(64)}` },
            },
          ],
        },
      ]),
      receipt([{ ...approved, approval: { ...approval, plan_hash: `sha256:${"0".repeat(64)}` } }]),
      receipt([{ ...approved, approval: { ...approval, created_at: "2026-10-08T00:00:00Z" } }]),
      receipt([{ ...attached, approval: null }]),
      receipt([
        {
          ...rechecked,
          candidates: [
            {
              candidate,
              output_verified: true,
              recheck: { ...checked, candidate_hash: `sha256:${"0".repeat(64)}` },
            },
          ],
        },
      ]),
      receipt([
        {
          ...rechecked,
          candidates: [
            {
              candidate,
              output_verified: true,
              recheck: { ...checked, created_at: "2026-10-08T00:00:00Z" },
            },
          ],
        },
      ]),
    ];
    for (const payload of invalid)
      expect(isDraftReviewRevisionResponse(payload, project, episode, operation, requestId)).toBe(
        false,
      );
    expect(isDraftReviewRevisionResponse(valid, project, episode, operation, null)).toBe(false);
    expect(
      isDraftReviewRevisionResponse(
        valid,
        project,
        episode,
        operation,
        "00000000-0000-4000-8000-000000000002",
      ),
    ).toBe(false);
  });
  it("rejects internally inconsistent candidate versions and comparisons even with recomputed hashes", () => {
    for (const patch of [
      { target: { ...candidateTarget, operation_id: operation } },
      { target: { ...candidateTarget, assembly_version_id: source.assembly_version_id } },
      {
        target: {
          ...candidateTarget,
          assembly_version_number: approval.assembly_version_number_at_approval,
        },
      },
      { approval_id: `dra_${"0".repeat(32)}` },
      { comparison: { ...candidate.comparison, out_of_scope_segment_ids: [segment.segment_id] } },
      { comparison: { ...candidate.comparison, unchanged_segment_ids: [segment.segment_id] } },
      { comparison: { ...candidate.comparison, changed_segment_ids: [] } },
      { segments: [{ ...segment, end_frame: 101 }] },
      { segments: [{ ...segment, media: null }] },
      { segments: [{ ...segment, track_kind: "SUBTITLE", media: null }] },
      { segments: [segment, segment] },
    ]) {
      const content = { ...candidateContent, ...patch };
      const invalid = { ...content, candidate_hash: contentHash(content) };
      expect(
        isDraftReviewRevisionResponse(
          {
            ...receipt(),
            data: {
              ...receipt().data,
              plans: [
                {
                  plan,
                  approval,
                  candidates: [{ candidate: invalid, output_verified: true, recheck: null }],
                },
              ],
            },
          },
          project,
          episode,
          operation,
          requestId,
        ),
      ).toBe(false);
    }
  });
  it("keeps scope transport closed and frame-bound", () => {
    for (const patch of [
      { source: { ...source, total_frames: 1_000_001 } },
      { source: { ...source, frame_rate_den: 0 } },
      { source: { ...source, project_id: `prj_${"0".repeat(32)}` } },
      { output_verified: "true" },
      { segments: [segment, segment] },
      { segments: [{ ...segment, start_frame: -1 }] },
      { segments: [{ ...segment, end_frame: 0 }] },
      { segments: [{ ...segment, end_frame: 101 }] },
      {
        segments: [
          { ...segment, storyboard_ref: { ...segment.storyboard_ref, shot_id: "../shot" } },
        ],
      },
      { segments: [{ ...segment, output_path: "/secret" }] },
      { manual_review_only: false },
      { release: true },
    ])
      expect(
        isDraftReviewRevisionScopeResponse(
          { ...scopeReceipt, data: { ...scopeReceipt.data, ...patch } },
          project,
          episode,
          operation,
          requestId,
        ),
      ).toBe(false);
  });
  it("enforces the total candidate cap across the source history", () => {
    const candidates = Array.from({ length: 21 }, (_, index) => {
      const content = {
        ...candidateContent,
        candidate_id: `drc_${index.toString(16).padStart(32, "0")}`,
      };
      return {
        candidate: { ...content, candidate_hash: contentHash(content) },
        output_verified: true,
        recheck: null,
      };
    });
    expect(
      isDraftReviewRevisionResponse(
        receipt([{ plan, approval, candidates: candidates.slice(0, 20) }]),
        project,
        episode,
        operation,
        requestId,
      ),
    ).toBe(true);
    expect(
      isDraftReviewRevisionResponse(
        receipt([{ plan, approval, candidates }]),
        project,
        episode,
        operation,
        requestId,
      ),
    ).toBe(false);
  });
});

describe("bounded manual revision authenticated client and exact readback", () => {
  it.each(actions)(
    "sends %s through authenticated local transport and waits for exact GET",
    async (action) => {
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(fetchResponse(before[action]))
        .mockResolvedValueOnce(fetchResponse(after[action], 201))
        .mockResolvedValueOnce(fetchResponse(after[action]));
      const client = createLocalApiClient(fetcher, {
        origin: "http://127.0.0.1:43124",
        token: "t".repeat(43),
      });
      expect(await mutation(client, action)).toEqual({ kind: "FOUND", receipt: after[action] });
      expect(fetcher.mock.calls.map((call) => call[1].method ?? "GET")).toEqual([
        "GET",
        "POST",
        "GET",
      ]);
      expect(fetcher.mock.calls[1]![0]).toBe(`http://127.0.0.1:43124${base}${suffixes[action]}`);
      expect(JSON.parse(fetcher.mock.calls[1]![1].body)).toEqual(inputs[action]);
      expect(fetcher.mock.calls[1]![1].headers).toMatchObject({
        "Content-Type": "application/json",
        Authorization: `Bearer ${"t".repeat(43)}`,
      });
    },
  );
  it("reads list and separate scope over the same authenticated boundary", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(fetchResponse(receipt()))
      .mockResolvedValueOnce(fetchResponse(scopeReceipt));
    const client = createLocalApiClient(fetcher, {
      origin: "http://127.0.0.1:43124",
      token: "t".repeat(43),
    });
    expect((await client.listDraftReviewRevisionPlans(project, episode, operation)).kind).toBe(
      "FOUND",
    );
    expect((await client.getDraftReviewRevisionScope(project, episode, operation)).kind).toBe(
      "FOUND",
    );
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
      `http://127.0.0.1:43124${base}`,
      `http://127.0.0.1:43124${base}/scope`,
    ]);
  });
  it.each(actions)(
    "reconciles an unknown %s once without replay or replacement IDs",
    async (action) => {
      for (const unknown of [
        null,
        http({}, 200),
        http(after[action], 201, null),
        error(503, "DRAFT_REVISION_UNKNOWN"),
      ]) {
        const request = vi
          .fn()
          .mockResolvedValueOnce(http(before[action]))
          .mockResolvedValueOnce(unknown)
          .mockResolvedValueOnce(http(after[action]));
        expect(
          await mutation(
            createDraftReviewRevisionClient(request, { Authorization: "Bearer local" }),
            action,
          ),
        ).toEqual({ kind: "FOUND", receipt: after[action] });
        expect(request.mock.calls.map((call) => call[1].method ?? "GET")).toEqual([
          "GET",
          "POST",
          "GET",
        ]);
        expect(JSON.parse(request.mock.calls[1]![1].body)).toEqual(inputs[action]);
      }
    },
  );
  it.each(actions)("keeps %s unknown when readback is missing or mismatched", async (action) => {
    for (const readback of [null, http(before[action]), error(404, "DRAFT_REVISION_NOT_FOUND")]) {
      const request = vi
        .fn()
        .mockResolvedValueOnce(http(before[action]))
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(readback);
      expect(await mutation(createDraftReviewRevisionClient(request, {}), action)).toEqual({
        kind: "REMOTE_UNKNOWN",
      });
      expect(request).toHaveBeenCalledTimes(3);
    }
  });
  it.each(actions)("returns a validated definite %s conflict without replay", async (action) => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(http(before[action]))
      .mockResolvedValueOnce(error())
      .mockResolvedValueOnce(http(before[action]));
    expect(await mutation(createDraftReviewRevisionClient(request, {}), action)).toEqual({
      kind: "DEFINITE_SERVER_ERROR",
      status: 409,
      code: "DRAFT_REVISION_ID_REUSED",
      request_id: requestId,
    });
    expect(request).toHaveBeenCalledTimes(3);
  });
  it.each(actions)(
    "reconciles post-commit-like %s integrity errors before classifying the outcome",
    async (action) => {
      const committed = vi
        .fn()
        .mockResolvedValueOnce(http(before[action]))
        .mockResolvedValueOnce(error(409, "DRAFT_REVISION_HISTORY_CORRUPT"))
        .mockResolvedValueOnce(http(after[action]));
      expect(await mutation(createDraftReviewRevisionClient(committed, {}), action)).toEqual({
        kind: "FOUND",
        receipt: after[action],
      });
      expect(committed).toHaveBeenCalledTimes(3);
      for (const readback of [
        null,
        error(409, "DRAFT_REVISION_TARGET_CORRUPT"),
        http(before[action]),
      ]) {
        const uncertain = vi
          .fn()
          .mockResolvedValueOnce(http(before[action]))
          .mockResolvedValueOnce(error(409, "DRAFT_REVISION_HISTORY_CORRUPT"))
          .mockResolvedValueOnce(readback);
        expect(await mutation(createDraftReviewRevisionClient(uncertain, {}), action)).toEqual({
          kind: "REMOTE_UNKNOWN",
        });
        expect(uncertain).toHaveBeenCalledTimes(3);
      }
    },
  );
  it.each(actions)(
    "retains the original %s command when a pre-read fails during a retry",
    async (action) => {
      const request = vi.fn().mockResolvedValueOnce(error(409, "DRAFT_REVISION_HISTORY_CORRUPT"));
      expect(await mutation(createDraftReviewRevisionClient(request, {}), action)).toEqual({
        kind: "REMOTE_UNKNOWN",
      });
      expect(request).toHaveBeenCalledTimes(1);
    },
  );
  it("never establishes success before the GET completes", async () => {
    let finish: ((value: ReturnType<typeof http> | null) => void) | undefined;
    const request = vi
      .fn()
      .mockResolvedValueOnce(http())
      .mockResolvedValueOnce(http(after.create))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
    let settled = false;
    const pending = mutation(createDraftReviewRevisionClient(request, {}), "create").then(
      (value) => {
        settled = true;
        return value;
      },
    );
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(3));
    expect(settled).toBe(false);
    finish!(null);
    expect(await pending).toEqual({ kind: "REMOTE_UNKNOWN" });
  });
  it("preserves immutable actor and timestamps across a valid POST and readback", async () => {
    const content = { ...planContent, actor_id: "different actor" };
    const altered = { ...content, plan_hash: contentHash(content) };
    const request = vi
      .fn()
      .mockResolvedValueOnce(http())
      .mockResolvedValueOnce(http(after.create))
      .mockResolvedValueOnce(http(receipt([{ ...planned, plan: altered }])));
    expect(await mutation(createDraftReviewRevisionClient(request, {}), "create")).toEqual({
      kind: "REMOTE_UNKNOWN",
    });
  });
  it("preserves prior unrelated plans when a new mutation is reconciled", async () => {
    const content = { ...planContent, plan_id: `drp_${"0".repeat(32)}` };
    const older = { ...planned, plan: { ...content, plan_hash: contentHash(content) } };
    const request = vi
      .fn()
      .mockResolvedValueOnce(http(receipt([older])))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(http(after.create));
    expect(await mutation(createDraftReviewRevisionClient(request, {}), "create")).toEqual({
      kind: "REMOTE_UNKNOWN",
    });
  });
  it("retains the original command when the event ID exists with mismatched evidence", async () => {
    const content = { ...planContent, instruction: "Different instruction under the same ID" };
    const old = receipt([{ ...planned, plan: { ...content, plan_hash: contentHash(content) } }]);
    const request = vi
      .fn()
      .mockResolvedValueOnce(http(old))
      .mockResolvedValueOnce(error())
      .mockResolvedValueOnce(http(old));
    expect(await mutation(createDraftReviewRevisionClient(request, {}), "create")).toEqual({
      kind: "REMOTE_UNKNOWN",
    });
    expect(request).toHaveBeenCalledTimes(3);
  });
  it("preserves the exact caller command and ID across explicit retries", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(http())
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(http())
      .mockResolvedValueOnce(http())
      .mockResolvedValueOnce(http(after.create))
      .mockResolvedValueOnce(http(after.create));
    const client = createDraftReviewRevisionClient(request, {});
    expect(await mutation(client, "create")).toEqual({ kind: "REMOTE_UNKNOWN" });
    expect(await mutation(client, "create")).toEqual({ kind: "FOUND", receipt: after.create });
    expect(JSON.parse(request.mock.calls[1]![1].body)).toEqual(create);
    expect(JSON.parse(request.mock.calls[4]![1].body)).toEqual(create);
    expect(request).toHaveBeenCalledTimes(6);
  });
  it("returns unknown on thrown transports and invalid reads", async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error("lost"))
      .mockResolvedValueOnce(http({}, 200))
      .mockResolvedValueOnce(http(scopeReceipt, 200, null))
      .mockResolvedValueOnce(error(503, "DRAFT_REVISION_UNKNOWN"));
    const client = createDraftReviewRevisionClient(request, {});
    expect(await client.listDraftReviewRevisionPlans(project, episode, operation)).toEqual({
      kind: "REMOTE_UNKNOWN",
    });
    expect(await client.listDraftReviewRevisionPlans(project, episode, operation)).toEqual({
      kind: "REMOTE_UNKNOWN",
    });
    expect(await client.getDraftReviewRevisionScope(project, episode, operation)).toEqual({
      kind: "REMOTE_UNKNOWN",
    });
    expect(await client.getDraftReviewRevisionScope(project, episode, operation)).toEqual({
      kind: "REMOTE_UNKNOWN",
    });
  });
  it("copies plan input before awaiting history so concurrent edits cannot alter the POST", async () => {
    const input = structuredClone(create);
    let finish: ((value: ReturnType<typeof http>) => void) | undefined;
    const request = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce(http(after.create))
      .mockResolvedValueOnce(http(after.create));
    const pending = createDraftReviewRevisionClient(request, {}).createDraftReviewRevisionPlan(
      project,
      episode,
      operation,
      input,
    );
    input.instruction = "changed";
    input.note_ids[0] = `drn_${"0".repeat(32)}`;
    input.affected_segment_ids.push("seg_extra");
    finish!(http());
    expect((await pending).kind).toBe("FOUND");
    expect(JSON.parse(request.mock.calls[1]![1].body)).toEqual(create);
  });
  it("validates direct inputs before HTTP and requires the exact original plan or candidate", async () => {
    const request = vi.fn();
    const client = createDraftReviewRevisionClient(request, {});
    await expect(
      client.listDraftReviewRevisionPlans(project, episode, "../operation"),
    ).rejects.toThrow("canonical");
    await expect(
      client.getDraftReviewRevisionScope("../project", episode, operation),
    ).rejects.toThrow("canonical");
    await expect(
      client.createDraftReviewRevisionPlan(project, episode, operation, {
        ...create,
        output_path: "/secret",
      } as CreateDraftReviewRevisionPlanRequest),
    ).rejects.toThrow("exact");
    await expect(
      client.approveDraftReviewRevisionPlan(project, episode, operation, "../plan", approve),
    ).rejects.toThrow("canonical");
    await expect(
      client.attachDraftReviewRevisionCandidate(project, episode, operation, plan.plan_id, {
        ...attach,
        candidate_operation_id: "../candidate",
      }),
    ).rejects.toThrow("exact");
    await expect(
      client.recheckDraftReviewRevisionCandidate(
        project,
        episode,
        operation,
        plan.plan_id,
        "../candidate",
        recheck,
      ),
    ).rejects.toThrow("exact");
    expect(request).not.toHaveBeenCalled();
    for (const action of actions) {
      const empty = vi.fn().mockResolvedValueOnce(http(receipt()));
      if (action === "create") continue;
      expect(await mutation(createDraftReviewRevisionClient(empty, {}), action)).toEqual({
        kind: "REMOTE_UNKNOWN",
      });
      expect(empty).toHaveBeenCalledTimes(1);
    }
  });
});

function setupIpc() {
  const client: DraftReviewRevisionGateway = {
    listDraftReviewRevisionPlans: vi.fn().mockResolvedValue({ kind: "FOUND", receipt: receipt() }),
    getDraftReviewRevisionScope: vi
      .fn()
      .mockResolvedValue({ kind: "FOUND", receipt: scopeReceipt }),
    createDraftReviewRevisionPlan: vi
      .fn()
      .mockResolvedValue({ kind: "FOUND", receipt: after.create }),
    approveDraftReviewRevisionPlan: vi
      .fn()
      .mockResolvedValue({ kind: "FOUND", receipt: after.approve }),
    attachDraftReviewRevisionCandidate: vi
      .fn()
      .mockResolvedValue({ kind: "FOUND", receipt: after.attach }),
    recheckDraftReviewRevisionCandidate: vi
      .fn()
      .mockResolvedValue({ kind: "FOUND", receipt: after.recheck }),
  };
  const clientFor = vi.fn(() => client);
  const handlers = new Map<
    string,
    (event: { top: boolean }, ...args: unknown[]) => Promise<unknown>
  >();
  registerDraftReviewRevisionHandlers<{ top: boolean }>(
    (channel, listener) => handlers.set(channel, listener),
    clientFor,
    (event) => event.top,
  );
  const invoke = (
    action: keyof typeof DRAFT_REVIEW_REVISION_CHANNELS,
    args: unknown[],
    top = true,
  ) => handlers.get(DRAFT_REVIEW_REVISION_CHANNELS[action])!({ top }, ...args);
  return { client, clientFor, handlers, invoke };
}
describe("bounded manual revision IPC and sandbox preload", () => {
  it("routes exactly six scoped capabilities", async () => {
    const env = setupIpc();
    await env.invoke("list", [project, episode, operation]);
    await env.invoke("scope", [project, episode, operation]);
    await env.invoke("create", [project, episode, operation, create]);
    await env.invoke("approve", [project, episode, operation, plan.plan_id, approve]);
    await env.invoke("attach", [project, episode, operation, plan.plan_id, attach]);
    await env.invoke("recheck", [
      project,
      episode,
      operation,
      plan.plan_id,
      candidate.candidate_id,
      recheck,
    ]);
    expect(env.handlers.size).toBe(6);
    expect(env.client.listDraftReviewRevisionPlans).toHaveBeenCalledExactlyOnceWith(
      project,
      episode,
      operation,
    );
    expect(env.client.getDraftReviewRevisionScope).toHaveBeenCalledExactlyOnceWith(
      project,
      episode,
      operation,
    );
    expect(env.client.createDraftReviewRevisionPlan).toHaveBeenCalledExactlyOnceWith(
      project,
      episode,
      operation,
      create,
    );
    expect(env.client.approveDraftReviewRevisionPlan).toHaveBeenCalledExactlyOnceWith(
      project,
      episode,
      operation,
      plan.plan_id,
      approve,
    );
    expect(env.client.attachDraftReviewRevisionCandidate).toHaveBeenCalledExactlyOnceWith(
      project,
      episode,
      operation,
      plan.plan_id,
      attach,
    );
    expect(env.client.recheckDraftReviewRevisionCandidate).toHaveBeenCalledExactlyOnceWith(
      project,
      episode,
      operation,
      plan.plan_id,
      candidate.candidate_id,
      recheck,
    );
  });
  it("rejects unauthorized subframes before retrieving a client", async () => {
    const env = setupIpc();
    for (const action of Object.keys(
      DRAFT_REVIEW_REVISION_CHANNELS,
    ) as (keyof typeof DRAFT_REVIEW_REVISION_CHANNELS)[])
      await expect(env.invoke(action, [], false)).rejects.toThrow("not authorized");
    expect(env.clientFor).not.toHaveBeenCalled();
  });
  it("rejects wrong arity, injected paths, and forged mutation keys before retrieving a client", async () => {
    const env = setupIpc();
    for (const [action, args] of [
      ["list", [project, episode]],
      ["scope", [project, episode, operation, "extra"]],
      ["list", ["../project", episode, operation]],
      ["list", [project, "bad", operation]],
      ["list", [project, episode, "../operation"]],
      ["create", [project, episode, operation, { ...create, output_path: "/secret" }]],
      ["create", [project, episode, operation, create, "extra"]],
      ["approve", [project, episode, operation, "../plan", approve]],
      ["approve", [project, episode, operation, plan.plan_id, { ...approve, actor_id: "forged" }]],
      ["attach", [project, episode, operation, plan.plan_id, { ...attach, provider: "OpenAI" }]],
      ["recheck", [project, episode, operation, plan.plan_id, "../candidate", recheck]],
      [
        "recheck",
        [
          project,
          episode,
          operation,
          plan.plan_id,
          candidate.candidate_id,
          { ...recheck, outcome: "APPROVED" },
        ],
      ],
      [
        "recheck",
        [project, episode, operation, plan.plan_id, candidate.candidate_id, recheck, "extra"],
      ],
    ] as const)
      await expect(env.invoke(action, [...args])).rejects.toThrow(
        "Draft review revision IPC requires",
      );
    expect(env.clientFor).not.toHaveBeenCalled();
  });
  it("exposes literal channels with electron as its only runtime preload import", async () => {
    const js = ts.transpileModule(readFileSync(resolve(__dirname, "preload.ts"), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const invoke = vi.fn().mockResolvedValue({ kind: "REMOTE_UNKNOWN" });
    let bridge: DraftReviewRevisionGateway | undefined;
    runInNewContext(js, {
      exports: {},
      require: (name: string) => {
        if (name !== "electron") throw new Error(`Unexpected sandbox import ${name}`);
        return {
          contextBridge: {
            exposeInMainWorld: (name: string, api: DraftReviewRevisionGateway) => {
              if (name === "aijian") bridge = api;
            },
          },
          ipcRenderer: { invoke },
        };
      },
    });
    expect(bridge).toBeDefined();
    const api = bridge!;
    await api.listDraftReviewRevisionPlans(project, episode, operation);
    expect(invoke).toHaveBeenLastCalledWith(
      DRAFT_REVIEW_REVISION_CHANNELS.list,
      project,
      episode,
      operation,
    );
    await api.getDraftReviewRevisionScope(project, episode, operation);
    expect(invoke).toHaveBeenLastCalledWith(
      DRAFT_REVIEW_REVISION_CHANNELS.scope,
      project,
      episode,
      operation,
    );
    for (const action of actions) {
      await mutation(api, action);
      const args =
        action === "create"
          ? [project, episode, operation, create]
          : action === "approve"
            ? [project, episode, operation, plan.plan_id, approve]
            : action === "attach"
              ? [project, episode, operation, plan.plan_id, attach]
              : [project, episode, operation, plan.plan_id, candidate.candidate_id, recheck];
      expect(invoke).toHaveBeenLastCalledWith(DRAFT_REVIEW_REVISION_CHANNELS[action], ...args);
    }
    expect(bridge).not.toHaveProperty("generateRevision");
    expect(bridge).not.toHaveProperty("publishDraft");
    expect(readFileSync(resolve(__dirname, "main.ts"), "utf8")).toContain(
      "registerDraftReviewRevisionHandlers<IpcMainInvokeEvent>(",
    );
  });
});

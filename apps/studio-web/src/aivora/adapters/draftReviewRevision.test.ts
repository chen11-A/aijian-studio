import { describe, expect, it } from "vitest";
import {
  eligibleRevisionCandidate,
  pendingRevisionMatches,
  revisionIdentity,
  revisionMatches,
  revisionPreservesHistory,
  revisionScopeMatches,
  revisionSourceMatches,
  revisionText,
  type PendingRevision,
} from "./draftReviewRevision";
import {
  approval,
  candidate,
  candidateData,
  candidateJob,
  plan,
  plannedData,
  recheck,
  revisionData,
  revisionScope,
  source,
  sourceJob,
} from "./draftReviewRevision.testFixtures";

describe("exact manual revision renderer evidence", () => {
  it("pins source project, episode, export, assembly, bytes, hash and frames", () => {
    expect(revisionMatches(candidateData(), sourceJob)).toBe(true);
    for (const patch of [
      { project_id: "other" },
      { episode_id: "other" },
      { operation_id: "other" },
      { assembly_version_id: "other" },
      { assembly_content_hash: "other" },
      { output_sha256: "other" },
      { output_bytes: 101 },
      { total_frames: 49 },
    ])
      expect(revisionSourceMatches({ ...source, ...patch }, sourceJob)).toBe(false);
    expect(
      revisionMatches({ ...revisionData(), manual_review_only: false } as never, sourceJob),
    ).toBe(false);
    expect(
      revisionMatches(
        { ...plannedData(), plans: [plannedData().plans[0]!, plannedData().plans[0]!] },
        sourceJob,
      ),
    ).toBe(false);
  });
  it("rejects orphan/cross-scope events and mismatched approval or recheck hashes", () => {
    const data = candidateData();
    const entry = data.plans[0]!;
    expect(revisionMatches({ ...data, plans: [{ ...entry, approval: null }] }, sourceJob)).toBe(
      false,
    );
    expect(
      revisionMatches(
        { ...data, plans: [{ ...entry, approval: { ...approval, plan_hash: "bad" } }] },
        sourceJob,
      ),
    ).toBe(false);
    expect(
      revisionMatches(
        {
          ...data,
          plans: [
            {
              ...entry,
              candidates: [
                {
                  ...entry.candidates[0]!,
                  candidate: { ...candidate, target: { ...candidate.target, episode_id: "other" } },
                },
              ],
            },
          ],
        },
        sourceJob,
      ),
    ).toBe(false);
    expect(
      revisionMatches(
        {
          ...data,
          plans: [
            {
              ...entry,
              candidates: [
                { ...entry.candidates[0]!, recheck: { ...recheck, candidate_hash: "bad" } },
              ],
            },
          ],
        },
        sourceJob,
      ),
    ).toBe(false);
    expect(
      revisionMatches(
        { ...data, plans: [{ ...entry, candidates: [...entry.candidates, ...entry.candidates] }] },
        sourceJob,
      ),
    ).toBe(false);
  });
  it("checks selectable source intervals without migrating original frames", () => {
    const scope = revisionScope();
    expect(revisionScopeMatches(scope, sourceJob)).toBe(true);
    expect(
      revisionScopeMatches(
        { ...scope, segments: [...scope.segments, ...scope.segments] },
        sourceJob,
      ),
    ).toBe(false);
    expect(
      revisionScopeMatches(
        { ...scope, segments: [{ ...scope.segments[0]!, end_frame: 51 }] },
        sourceJob,
      ),
    ).toBe(false);
    expect(
      revisionScopeMatches(
        { ...scope, segments: [{ ...scope.segments[0]!, start_frame: 25, end_frame: 25 }] },
        sourceJob,
      ),
    ).toBe(false);
  });
  it("readback requires exact immutable command content for all four actions", () => {
    const data = candidateData();
    data.plans[0]!.candidates[0]!.recheck = recheck;
    const commands: PendingRevision[] = [
      {
        kind: "create",
        command: {
          ...revisionIdentity(source),
          plan_id: plan.plan_id,
          note_ids: plan.notes.map((note) => note.note_id),
          affected_segment_ids: plan.affected_segments.map((segment) => segment.segment_id),
          instruction: plan.instruction,
        },
      },
      {
        kind: "approve",
        planId: plan.plan_id,
        command: { approval_id: approval.approval_id, expected_plan_hash: plan.plan_hash },
      },
      {
        kind: "attach",
        planId: plan.plan_id,
        command: {
          ...revisionIdentity(candidate.target),
          candidate_id: candidate.candidate_id,
          expected_plan_hash: plan.plan_hash,
          approval_id: approval.approval_id,
          candidate_operation_id: candidate.target.operation_id,
          change_summary: candidate.change_summary,
        },
      },
      {
        kind: "recheck",
        planId: plan.plan_id,
        candidateId: candidate.candidate_id,
        command: {
          recheck_id: recheck.recheck_id,
          expected_candidate_hash: candidate.candidate_hash,
          outcome: recheck.outcome,
          reason: recheck.reason,
        },
      },
    ];
    for (const command of commands) expect(pendingRevisionMatches(data, command)).toBe(true);
    expect(
      pendingRevisionMatches(data, {
        ...commands[0]!,
        command: {
          ...(commands[0]! as Extract<PendingRevision, { kind: "create" }>).command,
          instruction: "another",
        },
      } as PendingRevision),
    ).toBe(false);
    expect(
      pendingRevisionMatches(data, {
        kind: "approve",
        planId: plan.plan_id,
        command: { approval_id: approval.approval_id, expected_plan_hash: "bad" },
      }),
    ).toBe(false);
    expect(
      pendingRevisionMatches(data, {
        kind: "attach",
        planId: plan.plan_id,
        command: {
          ...revisionIdentity(candidate.target),
          candidate_id: candidate.candidate_id,
          expected_plan_hash: plan.plan_hash,
          approval_id: approval.approval_id,
          candidate_operation_id: candidate.target.operation_id,
          change_summary: "another",
        },
      }),
    ).toBe(false);
    expect(
      pendingRevisionMatches(data, {
        kind: "recheck",
        planId: plan.plan_id,
        candidateId: candidate.candidate_id,
        command: {
          recheck_id: recheck.recheck_id,
          expected_candidate_hash: candidate.candidate_hash,
          outcome: "NEEDS_MORE_WORK",
          reason: recheck.reason,
        },
      }),
    ).toBe(false);
  });
  it("preserves exact append-only history while allowing availability changes", () => {
    const before = candidateData();
    before.plans[0]!.candidates[0]!.recheck = recheck;
    const after = JSON.parse(JSON.stringify(before)) as typeof before;
    after.output_verified = false;
    after.plans[0]!.candidates[0]!.output_verified = false;
    expect(revisionPreservesHistory(before, after)).toBe(true);
    expect(revisionPreservesHistory(before, { ...after, plans: [] })).toBe(false);
    const changedPlan = JSON.parse(JSON.stringify(after)) as typeof after;
    changedPlan.plans[0]!.plan.instruction = "rewritten";
    expect(revisionPreservesHistory(before, changedPlan)).toBe(false);
    const changedApproval = JSON.parse(JSON.stringify(after)) as typeof after;
    changedApproval.plans[0]!.approval = null;
    expect(revisionPreservesHistory(before, changedApproval)).toBe(false);
    const changedCandidate = JSON.parse(JSON.stringify(after)) as typeof after;
    changedCandidate.plans[0]!.candidates[0]!.candidate.change_summary = "rewritten";
    expect(revisionPreservesHistory(before, changedCandidate)).toBe(false);
    const changedRecheck = JSON.parse(JSON.stringify(after)) as typeof after;
    changedRecheck.plans[0]!.candidates[0]!.recheck = null;
    expect(revisionPreservesHistory(before, changedRecheck)).toBe(false);
  });
  it("requires original selection order when reconciling a saved plan", () => {
    const data = JSON.parse(JSON.stringify(plannedData())) as ReturnType<typeof plannedData>;
    const frozen = data.plans[0]!.plan;
    frozen.notes = [...frozen.notes, { ...frozen.notes[0]!, note_id: `drn_${"a".repeat(32)}` }];
    frozen.affected_segments = [
      ...frozen.affected_segments,
      { ...frozen.affected_segments[0]!, segment_id: "seg_visual_2" },
    ];
    const command: PendingRevision = {
      kind: "create",
      command: {
        ...revisionIdentity(source),
        plan_id: frozen.plan_id,
        note_ids: frozen.notes.map((note) => note.note_id),
        affected_segment_ids: frozen.affected_segments.map((segment) => segment.segment_id),
        instruction: frozen.instruction,
      },
    };
    expect(pendingRevisionMatches(data, command)).toBe(true);
    expect(
      pendingRevisionMatches(data, {
        ...command,
        command: { ...command.command, note_ids: [...command.command.note_ids].reverse() },
      }),
    ).toBe(false);
    expect(
      pendingRevisionMatches(data, {
        ...command,
        command: {
          ...command.command,
          affected_segment_ids: [...command.command.affected_segment_ids].reverse(),
        },
      }),
    ).toBe(false);
  });
  it("lists only distinct successful exports created after the explicit approval", () => {
    const entry = { plan, approval, candidates: [] };
    expect(eligibleRevisionCandidate(candidateJob, source, entry)).toBe(true);
    for (const job of [
      sourceJob,
      { ...candidateJob, status: "FAILED" as const },
      { ...candidateJob, assembly_version_id: source.assembly_version_id },
      { ...candidateJob, created_at: approval.created_at },
      { ...candidateJob, created_at: "invalid" },
      { ...candidateJob, episode_id: "other" },
      { ...candidateJob, output_sha256: null },
    ])
      expect(eligibleRevisionCandidate(job, source, entry)).toBe(false);
    expect(eligibleRevisionCandidate(candidateJob, source, { ...entry, approval: null })).toBe(
      false,
    );
    expect(eligibleRevisionCandidate(candidateJob, source, candidateData().plans[0]!)).toBe(false);
  });
  it("bounds meaningful Unicode without accepting NUL or unpaired surrogates", () => {
    expect(revisionText("🙂".repeat(2000))).toBe(true);
    for (const value of ["", "  ", "\0", "\ud800", "🙂".repeat(2001)])
      expect(revisionText(value)).toBe(false);
  });
});

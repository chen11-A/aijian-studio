import { beforeEach, describe, expect, it, vi } from "vitest";
import { revisionIdentity, type PendingRevision } from "./draftReviewRevision";
import {
  parsePendingRevision,
  readPendingRevision,
  readSetAsideRevisions,
  revisionRecoveryKey,
  setAsidePendingRevision,
  setAsideRevisionKey,
} from "./draftReviewRevisionRecovery";
import {
  approval,
  candidate,
  plan,
  recheck,
  source,
  sourceJob,
} from "./draftReviewRevision.testFixtures";
const create: PendingRevision = {
  kind: "create",
  command: {
    ...revisionIdentity(source),
    plan_id: plan.plan_id,
    note_ids: [plan.notes[0]!.note_id],
    affected_segment_ids: [plan.affected_segments[0]!.segment_id],
    instruction: plan.instruction,
  },
};
const key = revisionRecoveryKey(sourceJob);
beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});
describe("manual revision pending journal", () => {
  it("recognizes every closed command and refuses extra/transmitted fields", () => {
    const commands: PendingRevision[] = [
      create,
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
    for (const command of commands) {
      expect(parsePendingRevision(command)).toEqual(command);
      expect(parsePendingRevision({ ...command, actor_id: "renderer" })).toBeUndefined();
      expect(
        parsePendingRevision({
          ...command,
          command: { ...command.command, output_path: "/private/path" },
        }),
      ).toBeUndefined();
    }
  });
  it("rejects duplicate IDs, oversized lists, stale/invalid identities and blank commands", () => {
    for (const patch of [
      { plan_id: "invalid" },
      { output_bytes: 0 },
      { output_sha256: "bad" },
      { note_ids: [plan.notes[0]!.note_id, plan.notes[0]!.note_id] },
      { affected_segment_ids: [] },
      { instruction: " " },
      { instruction: "\0" },
      { instruction: "\ud800" },
      { instruction: "a".repeat(2001) },
      {
        note_ids: Array.from(
          { length: 51 },
          (_, index) => `drn_${index.toString(16).padStart(32, "0")}`,
        ),
      },
    ])
      expect(
        parsePendingRevision({ ...create, command: { ...create.command, ...patch } }),
      ).toBeUndefined();
  });
  it("distinguishes empty from corrupt/unavailable, preserving journal content", () => {
    expect(readPendingRevision(key)).toBeNull();
    localStorage.setItem(key, JSON.stringify(create));
    expect(readPendingRevision(key)).toEqual(create);
    localStorage.setItem(key, "invalid-json");
    expect(readPendingRevision(key)).toBeUndefined();
    expect(localStorage.getItem(key)).toBe("invalid-json");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("unavailable");
    });
    expect(readPendingRevision(key)).toBeUndefined();
  });
  it("explicitly sets aside exact original evidence before clearing active recovery", () => {
    localStorage.setItem(key, JSON.stringify(create));
    expect(setAsidePendingRevision(sourceJob, create)).toBe(true);
    expect(readPendingRevision(key)).toBeNull();
    const archived = readSetAsideRevisions(sourceJob)!;
    expect(archived).toHaveLength(1);
    expect(archived[0]!.pending).toEqual(create);
    expect(archived[0]!.source.output_sha256).toBe(source.output_sha256);
    const originalTime = archived[0]!.set_aside_at;
    localStorage.setItem(key, JSON.stringify(create));
    expect(setAsidePendingRevision(sourceJob, create)).toBe(true);
    expect(readSetAsideRevisions(sourceJob)).toHaveLength(1);
    expect(readSetAsideRevisions(sourceJob)![0]!.set_aside_at).toBe(originalTime);
  });
  it("archive write/readback or active-clear failure never silently discards original intent", () => {
    localStorage.setItem(key, JSON.stringify(create));
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    expect(setAsidePendingRevision(sourceJob, create)).toBe(false);
    expect(readPendingRevision(key)).toEqual(create);
    vi.restoreAllMocks();
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(setAsidePendingRevision(sourceJob, create)).toBe(false);
    expect(readPendingRevision(key)).toEqual(create);
    expect(readSetAsideRevisions(sourceJob)).toHaveLength(1);
    vi.restoreAllMocks();
    expect(setAsidePendingRevision(sourceJob, create)).toBe(true);
    expect(readSetAsideRevisions(sourceJob)).toHaveLength(1);
  });
  it("corrupt aside evidence is preserved and blocks replacement rather than overwritten", () => {
    localStorage.setItem(key, JSON.stringify(create));
    const asideKey = setAsideRevisionKey(sourceJob);
    localStorage.setItem(asideKey, "corrupt");
    expect(readSetAsideRevisions(sourceJob)).toBeUndefined();
    expect(setAsidePendingRevision(sourceJob, create)).toBe(false);
    expect(localStorage.getItem(asideKey)).toBe("corrupt");
    expect(readPendingRevision(key)).toEqual(create);
  });
  it("isolates recovery by exact original file rather than only export ID", () => {
    expect(revisionRecoveryKey({ ...sourceJob, output_sha256: "a".repeat(64) })).not.toBe(key);
    expect(revisionRecoveryKey({ ...sourceJob, output_bytes: 101 })).not.toBe(key);
    expect(
      revisionRecoveryKey({ ...sourceJob, assembly_content_hash: `sha256:${"a".repeat(64)}` }),
    ).not.toBe(key);
  });
});

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDraftReviewRevision } from "./useDraftReviewRevision";
import {
  revisionIdentity,
  type DraftReviewRevisionData,
  type DraftReviewRevisionGateway,
  type DraftReviewRevisionResult,
  type PendingRevision,
} from "./adapters/draftReviewRevision";
import {
  readPendingRevision,
  readSetAsideRevisions,
  revisionRecoveryKey,
} from "./adapters/draftReviewRevisionRecovery";
import {
  candidateData,
  plan,
  plannedData,
  requestId,
  revisionData,
  revisionScope,
  source,
  sourceJob,
} from "./adapters/draftReviewRevision.testFixtures";
const command: PendingRevision = {
  kind: "create",
  command: {
    ...revisionIdentity(source),
    plan_id: plan.plan_id,
    note_ids: plan.notes.map((note) => note.note_id),
    affected_segment_ids: plan.affected_segments.map((segment) => segment.segment_id),
    instruction: plan.instruction,
  },
};
const found = (data: DraftReviewRevisionData): DraftReviewRevisionResult => ({
  kind: "FOUND",
  receipt: { data, request_id: requestId },
});
function gateway(data = revisionData()): DraftReviewRevisionGateway {
  return {
    listDraftReviewRevisionPlans: vi.fn(async () => found(data)),
    getDraftReviewRevisionScope: vi.fn(async () => ({
      kind: "FOUND" as const,
      receipt: { data: revisionScope(), request_id: requestId },
    })),
    createDraftReviewRevisionPlan: vi.fn(async () => found(plannedData())),
    approveDraftReviewRevisionPlan: vi.fn(async () => found(data)),
    attachDraftReviewRevisionCandidate: vi.fn(async () => found(data)),
    recheckDraftReviewRevisionCandidate: vi.fn(async () => found(data)),
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe("manual revision hook recovery and lifetime", () => {
  it("writes durable original command before sending and clears only exact readback", async () => {
    const bridge = gateway();
    vi.mocked(bridge.createDraftReviewRevisionPlan).mockImplementation(async () => {
      expect(readPendingRevision(revisionRecoveryKey(sourceJob))).toEqual(command);
      return found(plannedData());
    });
    const { result } = renderHook(() => useDraftReviewRevision(sourceJob, bridge));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    await act(async () => {
      expect(await result.current.submit(command)).toBe(true);
    });
    expect(result.current.confirmed).toEqual(command);
    expect(result.current.pending).toBeNull();
  });
  it("unknown mutation retains ID, blocks replacements and never auto resends on reopen", async () => {
    const bridge = gateway();
    vi.mocked(bridge.createDraftReviewRevisionPlan).mockResolvedValue({ kind: "REMOTE_UNKNOWN" });
    const view = renderHook(() => useDraftReviewRevision(sourceJob, bridge));
    await waitFor(() => expect(view.result.current.data).not.toBeNull());
    await act(async () => {
      expect(await view.result.current.submit(command)).toBe(false);
    });
    expect(view.result.current.pending).toEqual(command);
    await act(async () => {
      expect(
        await view.result.current.submit({
          ...command,
          command: { ...command.command, plan_id: `drp_${"f".repeat(32)}` },
        } as PendingRevision),
      ).toBe(false);
    });
    expect(bridge.createDraftReviewRevisionPlan).toHaveBeenCalledTimes(1);
    view.unmount();
    const reopened = renderHook(() => useDraftReviewRevision(sourceJob, bridge));
    await waitFor(() => expect(reopened.result.current.data).not.toBeNull());
    expect(reopened.result.current.pending).toEqual(command);
    expect(bridge.createDraftReviewRevisionPlan).toHaveBeenCalledTimes(1);
    vi.mocked(bridge.listDraftReviewRevisionPlans).mockResolvedValue(found(plannedData()));
    await act(async () => {
      await reopened.result.current.load();
    });
    expect(reopened.result.current.pending).toBeNull();
    expect(reopened.result.current.confirmed).toEqual(command);
    expect(bridge.createDraftReviewRevisionPlan).toHaveBeenCalledTimes(1);
  });
  it("explicit retry preserves original ID/content and single-flight prevents repeated click", async () => {
    const bridge = gateway();
    const flight = deferred<DraftReviewRevisionResult>();
    vi.mocked(bridge.createDraftReviewRevisionPlan).mockImplementation(() => flight.promise);
    const { result } = renderHook(() => useDraftReviewRevision(sourceJob, bridge));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    let submission!: Promise<boolean>;
    act(() => {
      submission = result.current.submit(command);
    });
    await act(async () => {
      expect(await result.current.submit(command)).toBe(false);
    });
    expect(bridge.createDraftReviewRevisionPlan).toHaveBeenCalledTimes(1);
    await act(async () => {
      flight.resolve({ kind: "REMOTE_UNKNOWN" });
      await submission;
    });
    vi.mocked(bridge.createDraftReviewRevisionPlan).mockResolvedValue(found(plannedData()));
    await act(async () => {
      expect(await result.current.submit(command)).toBe(true);
    });
    expect(bridge.createDraftReviewRevisionPlan).toHaveBeenNthCalledWith(
      2,
      sourceJob.project_id,
      sourceJob.episode_id,
      sourceJob.operation_id,
      command.command,
    );
  });
  it("storage failure sends nothing; malformed pending never gets overwritten", async () => {
    const bridge = gateway();
    const { result } = renderHook(() => useDraftReviewRevision(sourceJob, bridge));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    await act(async () => {
      expect(await result.current.submit(command)).toBe(false);
    });
    expect(bridge.createDraftReviewRevisionPlan).not.toHaveBeenCalled();
    expect(result.current.pending).toBeUndefined();
    vi.restoreAllMocks();
    localStorage.setItem(revisionRecoveryKey(sourceJob), "corrupt");
    await act(async () => {
      await result.current.load();
    });
    await act(async () => {
      expect(await result.current.submit(command)).toBe(false);
    });
    expect(localStorage.getItem(revisionRecoveryKey(sourceJob))).toBe("corrupt");
  });
  it("mismatched success and post-commit-like definite errors retain original recovery intent", async () => {
    const bridge = gateway();
    vi.mocked(bridge.createDraftReviewRevisionPlan).mockResolvedValue(
      found({ ...plannedData(), source: { ...source, output_bytes: 101 } }),
    );
    const { result } = renderHook(() => useDraftReviewRevision(sourceJob, bridge));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    await act(async () => {
      expect(await result.current.submit(command)).toBe(false);
    });
    expect(result.current.pending).toEqual(command);
    expect(result.current.confirmed).toBeNull();
    vi.mocked(bridge.createDraftReviewRevisionPlan).mockResolvedValue({
      kind: "DEFINITE_SERVER_ERROR",
      status: 409,
      code: "DRAFT_REVISION_HISTORY_CORRUPT",
      request_id: requestId,
    });
    await act(async () => {
      expect(await result.current.submit(command)).toBe(false);
    });
    expect(result.current.pending).toEqual(command);
    expect(result.current.confirmed).toBeNull();
    expect(readPendingRevision(revisionRecoveryKey(sourceJob))).toEqual(command);
  });
  it("preserves trusted history and pauses new submissions on omitted or rewritten events", async () => {
    const original = candidateData();
    const bridge = gateway(original);
    const { result } = renderHook(() => useDraftReviewRevision(sourceJob, bridge));
    await waitFor(() => expect(result.current.reliable).toBe(true));
    vi.mocked(bridge.listDraftReviewRevisionPlans).mockResolvedValue(found(revisionData()));
    await act(async () => {
      await result.current.load();
    });
    expect(result.current.data?.plans).toHaveLength(1);
    expect(result.current.reliable).toBe(false);
    await act(async () => {
      expect(await result.current.submit(command)).toBe(false);
    });
    expect(bridge.createDraftReviewRevisionPlan).not.toHaveBeenCalled();
    const changed = JSON.parse(JSON.stringify(original)) as DraftReviewRevisionData;
    changed.plans[0]!.plan.instruction = "rewritten immutable plan";
    vi.mocked(bridge.listDraftReviewRevisionPlans).mockResolvedValue(found(changed));
    await act(async () => {
      await result.current.load();
    });
    expect(result.current.data?.plans[0]?.plan.instruction).toBe(plan.instruction);
    expect(result.current.reliable).toBe(false);
    vi.mocked(bridge.listDraftReviewRevisionPlans).mockResolvedValue(
      found({ ...original, output_verified: false }),
    );
    await act(async () => {
      await result.current.load();
    });
    expect(result.current.reliable).toBe(true);
    expect(result.current.data?.output_verified).toBe(false);
  });
  it("cannot confirm a new pending event when its receipt omits earlier immutable evidence", async () => {
    const bridge = gateway(plannedData());
    const second = {
      kind: "create" as const,
      command: { ...command.command, plan_id: `drp_${"f".repeat(32)}` },
    };
    vi.mocked(bridge.createDraftReviewRevisionPlan).mockResolvedValue(
      found({
        ...revisionData(),
        plans: [
          { plan: { ...plan, plan_id: second.command.plan_id }, approval: null, candidates: [] },
        ],
      }),
    );
    const { result } = renderHook(() => useDraftReviewRevision(sourceJob, bridge));
    await waitFor(() => expect(result.current.reliable).toBe(true));
    await act(async () => {
      expect(await result.current.submit(second)).toBe(false);
    });
    expect(result.current.pending).toEqual(second);
    expect(result.current.confirmed).toBeNull();
    expect(result.current.data?.plans[0]?.plan.plan_id).toBe(plan.plan_id);
  });
  it("explicit archival preserves unknown command and permits only separately initiated work", async () => {
    const bridge = gateway();
    vi.mocked(bridge.createDraftReviewRevisionPlan).mockResolvedValue({ kind: "REMOTE_UNKNOWN" });
    const { result } = renderHook(() => useDraftReviewRevision(sourceJob, bridge));
    await waitFor(() => expect(result.current.reliable).toBe(true));
    await act(async () => {
      await result.current.submit(command);
    });
    expect(result.current.pending).toEqual(command);
    await act(async () => {
      expect(await result.current.putAside()).toBe(true);
    });
    expect(result.current.pending).toBeNull();
    expect(result.current.reliable).toBe(true);
    expect(readSetAsideRevisions(sourceJob)![0]!.pending).toEqual(command);
    expect(bridge.createDraftReviewRevisionPlan).toHaveBeenCalledTimes(1);
    vi.mocked(bridge.listDraftReviewRevisionPlans).mockResolvedValue(found(plannedData()));
    await act(async () => {
      await result.current.load();
    });
    expect(result.current.setAside).toHaveLength(1);
    expect(bridge.createDraftReviewRevisionPlan).toHaveBeenCalledTimes(1);
  });
  it("late older success cannot erase a newer active recovery command", async () => {
    const bridge = gateway();
    const flight = deferred<DraftReviewRevisionResult>();
    vi.mocked(bridge.createDraftReviewRevisionPlan).mockReturnValue(flight.promise);
    const { result } = renderHook(() => useDraftReviewRevision(sourceJob, bridge));
    await waitFor(() => expect(result.current.reliable).toBe(true));
    let submission!: Promise<boolean>;
    act(() => {
      submission = result.current.submit(command);
    });
    const newer = {
      ...command,
      command: {
        ...command.command,
        plan_id: `drp_${"f".repeat(32)}`,
        instruction: "另一个窗口的新提交",
      },
    };
    localStorage.setItem(revisionRecoveryKey(sourceJob), JSON.stringify(newer));
    await act(async () => {
      flight.resolve(found(plannedData()));
      await submission;
    });
    expect(readPendingRevision(revisionRecoveryKey(sourceJob))).toEqual(newer);
    expect(result.current.pending).toEqual(newer);
    expect(result.current.confirmed).toBeNull();
  });
  it("ignores a stale late response after source identity changes", async () => {
    const bridge = gateway();
    const old = deferred<DraftReviewRevisionResult>();
    vi.mocked(bridge.listDraftReviewRevisionPlans).mockReturnValueOnce(old.promise);
    const nextJob = { ...sourceJob, operation_id: `dmp_${"f".repeat(32)}` };
    const nextSource = { ...source, operation_id: nextJob.operation_id };
    vi.mocked(bridge.listDraftReviewRevisionPlans).mockResolvedValue(
      found({ ...revisionData(), source: nextSource }),
    );
    vi.mocked(bridge.getDraftReviewRevisionScope).mockResolvedValue({
      kind: "FOUND",
      receipt: { data: { ...revisionScope(), source: nextSource }, request_id: requestId },
    });
    const { result, rerender } = renderHook(({ job }) => useDraftReviewRevision(job, bridge), {
      initialProps: { job: sourceJob },
    });
    rerender({ job: nextJob });
    await waitFor(() =>
      expect(result.current.data?.source.operation_id).toBe(nextJob.operation_id),
    );
    await act(async () => {
      old.resolve(found(plannedData()));
    });
    expect(result.current.data?.source.operation_id).toBe(nextJob.operation_id);
  });
});

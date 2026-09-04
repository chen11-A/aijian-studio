import { describe, expect, test, vi } from "vitest";

import {
  createLocalApiClient,
  type SourceManifestResponse,
  type SourceManifestReviewClient,
  type SourceManifestPreparedReview,
  type SourceManifestSubmissionReceipt,
  type SourceManifestSignoffReceipt,
  type SourceManifestDecisionReceipt,
} from "./api-client";
import {
  createSourceManifestReviewController,
  type SourceManifestReviewInput,
  type SourceManifestReviewContext,
} from "./source-manifest-review";

const projectId = `prj_${"a".repeat(32)}`;
const versionId = `ver_${"b".repeat(32)}`;
const artifactId = `art_${"c".repeat(32)}`;
const contentHash = `sha256:${"d".repeat(64)}`;
const requestId = "88ed7974-adc3-4e35-a5c8-38b9674fc45c";
const submissionId = `sub_${"e".repeat(32)}`;
const now = Date.parse("2026-09-04T07:00:00Z");
const input = (
  intent: "submit" | "confirm_baseline" | "copy_draft" = "copy_draft",
): SourceManifestReviewInput =>
  intent === "confirm_baseline"
    ? {
        intent,
        project_id: projectId,
        version_id: versionId,
        content_hash: contentHash,
        expected_revision: 3,
        rationale: "确认来源基线",
      }
    : {
        intent,
        project_id: projectId,
        version_id: versionId,
        content_hash: contentHash,
        expected_revision: 3,
      };

function manifest(inReview = false): SourceManifestResponse {
  const result: SourceManifestResponse = {
    request_id: requestId,
    data: {
      project_id: projectId,
      head: {
        artifact_id: artifactId,
        latest_version_id: versionId,
        review_version_id: null,
        review_submission_id: null,
        accepted_version_id: null,
        revision: 3,
        review_evidence_revision: 1,
        updated_at: new Date(now).toISOString(),
      },
      latest_version: {
        id: versionId,
        artifact_id: artifactId,
        version_number: 1,
        schema_version: "1.0.0",
        content_hash: contentHash,
        content: {
          scope_type: "full_work",
          documents: [
            {
              source_document_id: `src_${"6".repeat(32)}`,
              filename: "synthetic.txt",
              media_type: "text/plain",
              encoding: "utf-8",
              byte_size: 0,
              chapter_count: 0,
              raw_sha256: "0".repeat(64),
              normalized_sha256: "0".repeat(64),
              import_order: 0,
              blocks: [],
            },
          ],
          exclusions: [],
        },
        parent_version_id: null,
        change_summary: "Synthetic source",
        created_at: new Date(now).toISOString(),
      },
      review_version: null,
      accepted_version: null,
    },
  };
  if (inReview) {
    result.data.head.review_version_id = versionId;
    result.data.head.review_submission_id = submissionId;
    result.data.review_version = structuredClone(result.data.latest_version);
  }
  return result;
}

function copiedManifest(): SourceManifestResponse {
  const result = manifest();
  result.data.latest_version.id = `ver_${"1".repeat(32)}`;
  result.data.latest_version.parent_version_id = versionId;
  result.data.latest_version.version_number = 2;
  result.data.head.latest_version_id = result.data.latest_version.id;
  result.data.head.revision = 4;
  return result;
}

function prepared(action: "submit" | "signoff" | "decision"): SourceManifestPreparedReview {
  const reportId = `rpt_${"f".repeat(32)}`;
  return {
    request_id: requestId,
    data: {
      confirmation_token: "synthetic-main-only-confirmation-secret",
      report: {
        id: reportId,
        artifact_id: artifactId,
        version_id: versionId,
        gate: "G1",
        submission_id: action === "submit" ? null : submissionId,
        policy_code: "g1.source-manifest",
        policy_version: "1",
        head_revision: 3,
        review_evidence_revision: 1,
        report: {
          ready: true,
          blocking: [],
          policy_code: "g1.source-manifest",
          policy_version: "1",
          policy_snapshot_hash:
            "sha256:d9b44c6cb3464ff85eb7a546286691af0cf92e536d361fc8d5985aaf4320420c",
        },
        report_hash: "sha256:8369949613bef69a80963393f43ccf81ab7e87bbc3781ca6a73115e8b4eec3a6",
        created_at: new Date(now).toISOString(),
        expires_at: new Date(now + 300_000).toISOString(),
      },
      challenge: {
        id: `chg_${"2".repeat(32)}`,
        artifact_id: artifactId,
        version_id: versionId,
        gate: "G1",
        action,
        readiness_report_id: reportId,
        head_revision: action === "decision" ? 4 : 3,
        review_evidence_revision: 1,
        created_at: new Date(now).toISOString(),
        expires_at: new Date(now + 300_000).toISOString(),
        consumed_at: null,
      },
    },
  };
}

function submitted(): SourceManifestSubmissionReceipt {
  return {
    request_id: requestId,
    data: {
      head: {
        ...manifest(true).data.head,
        accepted_version_id: null,
        review_version_id: versionId,
        revision: 4,
        review_evidence_revision: 2,
      },
      submission: {
        id: submissionId,
        artifact_id: artifactId,
        version_id: versionId,
        gate: "G1",
        readiness_report_id: prepared("submit").data.report.id,
        supersedes_submission_id: null,
        submitted_by_actor_id: "local-user",
        submitted_at: new Date(now).toISOString(),
      },
    },
  };
}

function signed(): SourceManifestSignoffReceipt {
  return {
    request_id: requestId,
    data: {
      head: {
        ...manifest(true).data.head,
        accepted_version_id: null,
        review_version_id: versionId,
        revision: 4,
      },
      signoffs: ["writer", "producer"].map((role, i) => ({
        id: `sig_${String(i + 3).repeat(32)}`,
        artifact_id: artifactId,
        version_id: versionId,
        submission_id: submissionId,
        gate: "G1",
        role,
        actor_id: "local-user",
        review_evidence_revision: 1,
        readiness_report_id: prepared("signoff").data.report.id,
        self_review: true,
        supersedes_signoff_id: null,
        signed_at: new Date(now).toISOString(),
      })),
    },
  };
}

function decided(): SourceManifestDecisionReceipt {
  return {
    request_id: requestId,
    data: {
      head: {
        ...manifest().data.head,
        review_version_id: null,
        revision: 5,
        accepted_version_id: versionId,
      },
      decision: {
        id: `dec_${"5".repeat(32)}`,
        artifact_id: artifactId,
        version_id: versionId,
        submission_id: submissionId,
        gate: "G1",
        decision: "approved",
        readiness_report_id: prepared("signoff").data.report.id,
        actor_id: "local-user",
        actor_role: "producer",
        self_review: true,
        rationale: "确认来源基线",
        decided_at: new Date(now).toISOString(),
      },
    },
  };
}

function mockClient(inReview = false) {
  return {
    getSourceManifestForReview: vi.fn<SourceManifestReviewClient["getSourceManifestForReview"]>(
      async () => ({ kind: "SUCCEEDED", receipt: manifest(inReview) }),
    ),
    copySourceManifestDraft: vi.fn<SourceManifestReviewClient["copySourceManifestDraft"]>(
      async () => ({ kind: "SUCCEEDED", receipt: copiedManifest() }),
    ),
    prepareSourceManifestSubmit: vi.fn<SourceManifestReviewClient["prepareSourceManifestSubmit"]>(
      async () => ({ kind: "SUCCEEDED", receipt: prepared("submit") }),
    ),
    submitSourceManifestReview: vi.fn<SourceManifestReviewClient["submitSourceManifestReview"]>(
      async () => ({ kind: "SUCCEEDED", receipt: submitted() }),
    ),
    prepareSourceManifestSignoff: vi.fn<SourceManifestReviewClient["prepareSourceManifestSignoff"]>(
      async () => ({ kind: "SUCCEEDED", receipt: prepared("signoff") }),
    ),
    signoffSourceManifestReview: vi.fn<SourceManifestReviewClient["signoffSourceManifestReview"]>(
      async () => ({ kind: "SUCCEEDED", receipt: signed() }),
    ),
    prepareSourceManifestDecision: vi.fn<
      SourceManifestReviewClient["prepareSourceManifestDecision"]
    >(async () => ({ kind: "SUCCEEDED", receipt: prepared("decision") })),
    decideSourceManifestReview: vi.fn<SourceManifestReviewClient["decideSourceManifestReview"]>(
      async () => ({ kind: "SUCCEEDED", receipt: decided() }),
    ),
  } satisfies SourceManifestReviewClient;
}

describe("source review confirmation boundary", () => {
  test("does not reinterpret a B1 snapshot identity mismatch as an ordinary state change", async () => {
    for (const mutate of [
      (value: SourceManifestResponse) => {
        value.data.project_id = `prj_${"7".repeat(32)}`;
      },
      (value: SourceManifestResponse) => {
        value.data.latest_version.content_hash = `sha256:${"7".repeat(64)}`;
      },
      (value: SourceManifestResponse) => {
        value.data.head.revision += 1;
      },
    ]) {
      const client = mockClient();
      const value = manifest();
      mutate(value);
      client.getSourceManifestForReview.mockResolvedValueOnce({
        kind: "SUCCEEDED",
        receipt: value,
      });
      expect(
        (
          await createSourceManifestReviewController(client, () => now).run(input(), {
            confirm: () => true,
          })
        ).kind,
      ).toBe("REMOTE_UNKNOWN");
      expect(client.copySourceManifestDraft).not.toHaveBeenCalled();
    }
  });

  test.each(["submit", "signoff", "decision"] as const)(
    "rejects cross-step %s report/challenge rebinding",
    async (action) => {
      const client = mockClient(action !== "submit");
      const value = prepared(action);
      if (action === "decision") {
        value.data.report.id = `rpt_${"7".repeat(32)}`;
        value.data.challenge.readiness_report_id = value.data.report.id;
        client.prepareSourceManifestDecision.mockResolvedValueOnce({
          kind: "SUCCEEDED",
          receipt: value,
        });
      } else if (action === "signoff") {
        value.data.report.review_evidence_revision += 1;
        client.prepareSourceManifestSignoff.mockResolvedValueOnce({
          kind: "SUCCEEDED",
          receipt: value,
        });
      } else {
        value.data.challenge.version_id = `ver_${"7".repeat(32)}`;
        client.prepareSourceManifestSubmit.mockResolvedValueOnce({
          kind: "SUCCEEDED",
          receipt: value,
        });
      }
      const result = await createSourceManifestReviewController(client, () => now).run(
        input(action === "submit" ? "submit" : "confirm_baseline"),
        { confirm: () => true },
      );
      expect(result).toMatchObject({
        kind: "REMOTE_UNKNOWN",
        completed_actions: action === "decision" ? ["signoff"] : [],
      });
      expect(client.decideSourceManifestReview).not.toHaveBeenCalled();
      if (action === "submit") expect(client.submitSourceManifestReview).not.toHaveBeenCalled();
      if (action === "signoff") expect(client.signoffSourceManifestReview).not.toHaveBeenCalled();
    },
  );

  test.each(["submit", "signoff", "decision"] as const)(
    "does not record a %s receipt with broken cross-step revision or rationale",
    async (action) => {
      const client = mockClient(action !== "submit");
      if (action === "submit") {
        const value = submitted();
        value.data.head.review_evidence_revision += 1;
        client.submitSourceManifestReview.mockResolvedValueOnce({
          kind: "SUCCEEDED",
          receipt: value,
        });
      } else if (action === "signoff") {
        const value = signed();
        value.data.head.revision += 1;
        client.signoffSourceManifestReview.mockResolvedValueOnce({
          kind: "SUCCEEDED",
          receipt: value,
        });
      } else {
        const value = decided();
        value.data.decision.rationale = "different";
        client.decideSourceManifestReview.mockResolvedValueOnce({
          kind: "SUCCEEDED",
          receipt: value,
        });
      }
      const result = await createSourceManifestReviewController(client, () => now).run(
        input(action === "submit" ? "submit" : "confirm_baseline"),
        { confirm: () => true },
      );
      expect(result).toMatchObject({
        kind: "REMOTE_UNKNOWN",
        completed_actions: action === "decision" ? ["signoff"] : [],
      });
      if (action === "signoff") expect(client.prepareSourceManifestDecision).not.toHaveBeenCalled();
    },
  );

  test.each(["signoff", "decision"] as const)(
    "rechecks cancellation across the %s confirmation helper await",
    async (action) => {
      const client = mockClient(true);
      const cancel = new AbortController();
      const result = await createSourceManifestReviewController(client, () => now).run(
        input("confirm_baseline"),
        {
          signal: cancel.signal,
          confirm: (data) => {
            if (data.action === action)
              queueMicrotask(() => queueMicrotask(() => queueMicrotask(() => cancel.abort())));
            return true;
          },
        },
      );
      expect(result).toMatchObject({
        kind: "CANCELLED",
        completed_actions: action === "decision" ? ["signoff"] : [],
      });
      expect(client.decideSourceManifestReview).not.toHaveBeenCalled();
      if (action === "signoff") expect(client.signoffSourceManifestReview).not.toHaveBeenCalled();
    },
  );

  test("rechecks expiry after the helper await and preserves signoff when the later challenge expires", async () => {
    const client = mockClient();
    let time = now;
    const result = await createSourceManifestReviewController(client, () => time).run(
      input("submit"),
      {
        confirm: () => {
          queueMicrotask(() =>
            queueMicrotask(() =>
              queueMicrotask(() => {
                time = now + 300_000;
              }),
            ),
          );
          return true;
        },
      },
    );
    expect(result.kind).toBe("EXPIRED");
    expect(client.submitSourceManifestReview).not.toHaveBeenCalled();
    const review = mockClient(true);
    time = now;
    const value = prepared("decision");
    value.data.challenge.expires_at = new Date(now + 1_000).toISOString();
    review.prepareSourceManifestDecision.mockImplementationOnce(async () => {
      time = now + 1_001;
      return { kind: "SUCCEEDED", receipt: value };
    });
    const confirm = vi.fn<NonNullable<SourceManifestReviewContext["confirm"]>>(() => true);
    const partial = await createSourceManifestReviewController(review, () => time).run(
      input("confirm_baseline"),
      { confirm },
    );
    expect(partial).toMatchObject({
      kind: "EXPIRED",
      phase: "confirm_decision",
      completed_actions: ["signoff"],
    });
    expect(confirm).toHaveBeenCalledOnce();
    expect(review.decideSourceManifestReview).not.toHaveBeenCalled();
  });

  test("a cancelled prepare-decision result leaves only the already verified signoff", async () => {
    const client = mockClient(true);
    const cancel = new AbortController();
    client.prepareSourceManifestDecision.mockImplementationOnce(async () => {
      cancel.abort();
      return { kind: "SUCCEEDED", receipt: prepared("decision") };
    });
    const result = await createSourceManifestReviewController(client, () => now).run(
      input("confirm_baseline"),
      { signal: cancel.signal, confirm: () => true },
    );
    expect(result).toMatchObject({ kind: "CANCELLED", completed_actions: ["signoff"] });
    expect(client.decideSourceManifestReview).not.toHaveBeenCalled();
  });

  test.each([
    ["submit", "getSourceManifestForReview", "preflight"],
    ["submit", "prepareSourceManifestSubmit", "prepare_submit"],
    ["submit", "submitSourceManifestReview", "submit"],
    ["copy_draft", "copySourceManifestDraft", "copy_draft"],
    ["confirm_baseline", "prepareSourceManifestSignoff", "prepare_signoff"],
    ["confirm_baseline", "signoffSourceManifestReview", "signoff"],
    ["confirm_baseline", "prepareSourceManifestDecision", "prepare_decision"],
    ["confirm_baseline", "decideSourceManifestReview", "decision"],
  ] as const)(
    "stops %s at failed %s, preserves completed work, and releases its lock",
    async (intent, method, phase) => {
      for (const kind of ["REMOTE_UNKNOWN", "INVALID_INPUT", "DEFINITE_SERVER_ERROR"] as const) {
        const client = mockClient(intent === "confirm_baseline");
        if (kind === "DEFINITE_SERVER_ERROR")
          client[method].mockResolvedValueOnce({
            kind,
            status: 401,
            code: "SIDECAR_AUTH_REQUIRED",
            request_id: requestId,
          });
        else client[method].mockResolvedValueOnce({ kind });
        const controller = createSourceManifestReviewController(client, () => now);
        const result = await controller.run(input(intent), { confirm: () => true });
        const partial =
          method === "prepareSourceManifestDecision" || method === "decideSourceManifestReview";
        expect(result).toMatchObject({
          kind,
          phase,
          completed_actions: partial ? ["signoff"] : [],
        });
        if (kind === "DEFINITE_SERVER_ERROR")
          expect(result.error).toEqual({
            status: 401,
            code: "SIDECAR_AUTH_REQUIRED",
            request_id: requestId,
          });
        const path =
          intent === "submit"
            ? ([
                "getSourceManifestForReview",
                "prepareSourceManifestSubmit",
                "submitSourceManifestReview",
              ] as const)
            : intent === "copy_draft"
              ? (["getSourceManifestForReview", "copySourceManifestDraft"] as const)
              : ([
                  "getSourceManifestForReview",
                  "prepareSourceManifestSignoff",
                  "signoffSourceManifestReview",
                  "prepareSourceManifestDecision",
                  "decideSourceManifestReview",
                ] as const);
        const stoppedIndex = (path as readonly string[]).indexOf(method);
        path.forEach((name, index) =>
          expect(client[name]).toHaveBeenCalledTimes(index <= stoppedIndex ? 1 : 0),
        );
        expect((await controller.run(input(), { confirm: () => false })).kind).toBe("CANCELLED");
      }
    },
  );

  test("maps only verified precondition failure to STATE_CHANGED and rebuilds safe error fields", async () => {
    const client = mockClient();
    client.copySourceManifestDraft.mockResolvedValueOnce(
      Object.assign(
        {
          kind: "DEFINITE_SERVER_ERROR" as const,
          status: 412,
          code: "PRECONDITION_FAILED" as const,
          request_id: requestId,
        },
        { message: "synthetic raw secret", details: { confirmation_token: "synthetic" } },
      ),
    );
    const result = await createSourceManifestReviewController(client, () => now).run(input(), {
      confirm: () => true,
    });
    expect(result).toMatchObject({
      kind: "STATE_CHANGED",
      phase: "copy_draft",
      completed_actions: [],
      error: { status: 412, code: "PRECONDITION_FAILED", request_id: requestId },
    });
    expect(JSON.stringify(result)).not.toMatch(/synthetic|message|details|confirmation_token/);
  });

  test("unexpected client exceptions are UNKNOWN without exposing the exception or retaining a lock", async () => {
    const client = mockClient();
    client.getSourceManifestForReview.mockRejectedValueOnce(
      new Error("synthetic secret exception"),
    );
    const controller = createSourceManifestReviewController(client, () => now);
    const result = await controller.run(input(), { confirm: () => true });
    expect(result).toMatchObject({
      kind: "REMOTE_UNKNOWN",
      phase: "preflight",
      completed_actions: [],
    });
    expect(JSON.stringify(result)).not.toContain("synthetic secret");
    expect((await controller.run(input(), { confirm: () => false })).kind).toBe("CANCELLED");
  });

  test("a cancelled approval retains the completed signoff, and an unknown approval is not called rejected", async () => {
    const client = mockClient(true);
    const controller = createSourceManifestReviewController(client, () => now);
    const cancelled = await controller.run(input("confirm_baseline"), {
      confirm: (data) => data.action === "signoff",
    });
    expect(cancelled).toMatchObject({
      kind: "CANCELLED",
      phase: "confirm_decision",
      completed_actions: ["signoff"],
      receipts: [{ action: "signoff", head_revision: 4 }],
    });
    expect(client.decideSourceManifestReview).not.toHaveBeenCalled();
    client.decideSourceManifestReview.mockResolvedValueOnce({ kind: "REMOTE_UNKNOWN" });
    const unknown = await controller.run(input("confirm_baseline"), { confirm: () => true });
    expect(unknown).toMatchObject({
      kind: "REMOTE_UNKNOWN",
      phase: "decision",
      completed_actions: ["signoff"],
    });
    expect(unknown.receipts).toHaveLength(1);
    expect(JSON.stringify(unknown)).not.toMatch(/approved|rejected/);
    expect(client.signoffSourceManifestReview).toHaveBeenCalledTimes(2);
    expect(client.decideSourceManifestReview).toHaveBeenCalledOnce();
  });

  test("main cancellation before starting, after GET, and after prepare prevents further requests", async () => {
    const client = mockClient();
    const initial = new AbortController();
    initial.abort();
    const controller = createSourceManifestReviewController(client, () => now);
    expect(
      (await controller.run(input(), { signal: initial.signal, confirm: () => true })).kind,
    ).toBe("CANCELLED");
    expect(client.getSourceManifestForReview).not.toHaveBeenCalled();
    const duringGet = new AbortController();
    client.getSourceManifestForReview.mockImplementationOnce(async () => {
      duringGet.abort();
      return { kind: "SUCCEEDED", receipt: manifest() };
    });
    expect(
      (await controller.run(input("submit"), { signal: duringGet.signal, confirm: () => true }))
        .kind,
    ).toBe("CANCELLED");
    expect(client.prepareSourceManifestSubmit).not.toHaveBeenCalled();
    const duringPrepare = new AbortController();
    const confirm = vi.fn(() => true);
    client.prepareSourceManifestSubmit.mockImplementationOnce(async () => {
      duringPrepare.abort();
      return { kind: "SUCCEEDED", receipt: prepared("submit") };
    });
    expect(
      (await controller.run(input("submit"), { signal: duringPrepare.signal, confirm })).kind,
    ).toBe("CANCELLED");
    expect(confirm).not.toHaveBeenCalled();
    expect(client.submitSourceManifestReview).not.toHaveBeenCalled();
  });

  test("cancel during a bounded signoff POST waits for its verified outcome before stopping approval", async () => {
    const client = mockClient(true);
    const cancel = new AbortController();
    client.signoffSourceManifestReview.mockImplementationOnce(async () => {
      cancel.abort();
      return { kind: "SUCCEEDED", receipt: signed() };
    });
    const result = await createSourceManifestReviewController(client, () => now).run(
      input("confirm_baseline"),
      { signal: cancel.signal, confirm: () => true },
    );
    expect(result).toMatchObject({
      kind: "CANCELLED",
      phase: "prepare_decision",
      completed_actions: ["signoff"],
    });
    expect(client.prepareSourceManifestDecision).not.toHaveBeenCalled();
  });

  test.each(["submit", "copy_draft", "confirm_baseline"] as const)(
    "a terminal %s POST keeps a verified success even if main cancels in flight",
    async (intent) => {
      const client = mockClient(intent === "confirm_baseline");
      const cancel = new AbortController();
      if (intent === "submit")
        client.submitSourceManifestReview.mockImplementationOnce(async () => {
          cancel.abort();
          return { kind: "SUCCEEDED", receipt: submitted() };
        });
      else if (intent === "copy_draft")
        client.copySourceManifestDraft.mockImplementationOnce(async () => {
          cancel.abort();
          return { kind: "SUCCEEDED", receipt: copiedManifest() };
        });
      else
        client.decideSourceManifestReview.mockImplementationOnce(async () => {
          cancel.abort();
          return { kind: "SUCCEEDED", receipt: decided() };
        });
      const result = await createSourceManifestReviewController(client, () => now).run(
        input(intent),
        { signal: cancel.signal, confirm: () => true },
      );
      expect(result).toMatchObject({
        kind: "SUCCEEDED",
        completed_actions: intent === "confirm_baseline" ? ["signoff", "decision"] : [intent],
      });
    },
  );

  test("unknown in-flight consume stays UNKNOWN after main cancellation", async () => {
    const client = mockClient();
    const cancel = new AbortController();
    client.submitSourceManifestReview.mockImplementationOnce(async () => {
      cancel.abort();
      return { kind: "REMOTE_UNKNOWN" };
    });
    expect(
      await createSourceManifestReviewController(client, () => now).run(input("submit"), {
        signal: cancel.signal,
        confirm: () => true,
      }),
    ).toMatchObject({ kind: "REMOTE_UNKNOWN", phase: "submit", completed_actions: [] });
    expect(client.submitSourceManifestReview).toHaveBeenCalledOnce();
  });

  test("a pending confirmation responds promptly to main cancellation and ignores late true", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      const client = mockClient();
      const cancel = new AbortController();
      const add = vi.spyOn(cancel.signal, "addEventListener");
      const remove = vi.spyOn(cancel.signal, "removeEventListener");
      let resolve!: (value: boolean) => void;
      let callbackSignal!: AbortSignal;
      const controller = createSourceManifestReviewController(client);
      const pending = controller.run(input("submit"), {
        signal: cancel.signal,
        confirm: (_data, signal) => {
          callbackSignal = signal;
          return new Promise((done) => {
            resolve = done;
          });
        },
      });
      await vi.advanceTimersByTimeAsync(0);
      cancel.abort();
      await expect(pending).resolves.toMatchObject({ kind: "CANCELLED", completed_actions: [] });
      expect(callbackSignal.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      expect(add).toHaveBeenCalledOnce();
      expect(remove).toHaveBeenCalledOnce();
      resolve(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(client.submitSourceManifestReview).not.toHaveBeenCalled();
      expect((await controller.run(input(), { confirm: () => false })).kind).toBe("CANCELLED");
    } finally {
      vi.useRealTimers();
    }
  });

  test.each(["report", "challenge"] as const)(
    "confirmation expires at the earlier %s expiry and never consumes a late answer",
    async (earlier) => {
      vi.useFakeTimers();
      vi.setSystemTime(now);
      try {
        const client = mockClient();
        const ready = prepared("submit");
        ready.data[earlier].expires_at = new Date(now + 1_000).toISOString();
        client.prepareSourceManifestSubmit.mockResolvedValueOnce({
          kind: "SUCCEEDED",
          receipt: ready,
        });
        let resolve!: (value: boolean) => void;
        const pending = createSourceManifestReviewController(client).run(input("submit"), {
          confirm: () =>
            new Promise((done) => {
              resolve = done;
            }),
        });
        await vi.advanceTimersByTimeAsync(1_000);
        await expect(pending).resolves.toMatchObject({
          kind: "EXPIRED",
          phase: "confirm_submit",
          completed_actions: [],
        });
        resolve(true);
        await vi.advanceTimersByTimeAsync(0);
        expect(client.submitSourceManifestReview).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  test("expiry before confirmation, at approval, and after signoff never creates a later POST", async () => {
    const client = mockClient();
    const ready = prepared("submit");
    ready.data.report.expires_at = new Date(now - 1).toISOString();
    client.prepareSourceManifestSubmit.mockResolvedValueOnce({ kind: "SUCCEEDED", receipt: ready });
    const confirm = vi.fn(() => true);
    expect(
      (
        await createSourceManifestReviewController(client, () => now).run(input("submit"), {
          confirm,
        })
      ).kind,
    ).toBe("EXPIRED");
    expect(confirm).not.toHaveBeenCalled();
    let clock = now;
    expect(
      (
        await createSourceManifestReviewController(client, () => clock).run(input("submit"), {
          confirm: () => {
            clock = now + 300_000;
            return true;
          },
        })
      ).kind,
    ).toBe("EXPIRED");
    expect(client.submitSourceManifestReview).not.toHaveBeenCalled();
    const reviewClient = mockClient(true);
    clock = now;
    reviewClient.signoffSourceManifestReview.mockImplementationOnce(async () => {
      clock = now + 300_000;
      return { kind: "SUCCEEDED", receipt: signed() };
    });
    const partial = await createSourceManifestReviewController(reviewClient, () => clock).run(
      input("confirm_baseline"),
      { confirm: () => true },
    );
    expect(partial).toMatchObject({
      kind: "EXPIRED",
      phase: "prepare_decision",
      completed_actions: ["signoff"],
    });
    expect(reviewClient.prepareSourceManifestDecision).not.toHaveBeenCalled();
  });

  test("composes the real B1 client with synthetic fetch for the full signoff and decision sequence", async () => {
    const responses = [
      manifest(true),
      prepared("signoff"),
      signed(),
      prepared("decision"),
      decided(),
    ];
    const revisions = [3, 3, 4, 4, 5];
    let index = 0;
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => {
      const position = index++;
      return Response.json(responses[position], {
        headers: { ETag: `"revision-${revisions[position]}"` },
      });
    });
    const client = createLocalApiClient(fetcher, {
      origin: "http://127.0.0.1:43123",
      token: "s".repeat(43),
    });
    const result = await createSourceManifestReviewController(client, () => now).run(
      input("confirm_baseline"),
      { confirm: () => true },
    );
    expect(result).toMatchObject({ kind: "SUCCEEDED", completed_actions: ["signoff", "decision"] });
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(fetcher.mock.calls.map(([url]) => url.replace(/^.*source-manifest/, ""))).toEqual([
      "",
      `/versions/${versionId}:prepare-signoff`,
      `/versions/${versionId}/signoffs`,
      `/versions/${versionId}:prepare-decision`,
      `/versions/${versionId}/decisions`,
    ]);
    expect(JSON.parse(fetcher.mock.calls[3]![1]!.body as string)).toEqual({
      decision: "approved",
      readiness_report_id: prepared("signoff").data.report.id,
      rationale: "确认来源基线",
    });
  });

  test("copy success has a safe new-version receipt and no automatic follow-up", async () => {
    const client = mockClient();
    const confirm = vi.fn<NonNullable<SourceManifestReviewContext["confirm"]>>(() => true);
    const result = await createSourceManifestReviewController(client, () => now).run(input(), {
      confirm,
    });
    expect(result).toMatchObject({
      kind: "SUCCEEDED",
      phase: "copy_draft",
      completed_actions: ["copy_draft"],
      identity: { version_id: versionId },
      receipts: [{ version_id: copiedManifest().data.latest_version.id, head_revision: 4 }],
    });
    expect(confirm.mock.calls[0]![0]).toMatchObject({
      action: "copy_draft",
      report_id: null,
      report_hash: null,
      rationale: null,
    });
    expect(client.prepareSourceManifestSubmit).not.toHaveBeenCalled();
    expect(client.prepareSourceManifestSignoff).not.toHaveBeenCalled();
    expect(client.copySourceManifestDraft).toHaveBeenCalledOnce();
  });

  test.each([false, undefined, "truthy", "throw", "reject"])(
    "requires literal true, not %s",
    async (answer) => {
      const client = mockClient();
      const confirm: NonNullable<SourceManifestReviewContext["confirm"]> = () => {
        if (answer === "throw") throw new Error("synthetic secret");
        if (answer === "reject") return Promise.reject(new Error("synthetic secret"));
        return answer as boolean | undefined;
      };
      const result = await createSourceManifestReviewController(client, () => now).run(input(), {
        confirm,
      });
      expect(result).toMatchObject({ kind: "CANCELLED", completed_actions: [], receipts: [] });
      expect(JSON.stringify(result)).not.toContain("synthetic secret");
      expect(client.copySourceManifestDraft).not.toHaveBeenCalled();
    },
  );

  test("missing confirmation defaults to refusal", async () => {
    const client = mockClient();
    expect((await createSourceManifestReviewController(client, () => now).run(input())).kind).toBe(
      "CANCELLED",
    );
    expect(client.copySourceManifestDraft).not.toHaveBeenCalled();
  });

  test("rejects strict business JSON before any client call, including renderer-supplied main context", async () => {
    const client = mockClient();
    const controller = createSourceManifestReviewController(client, () => now);
    const invalid: unknown[] = [
      null,
      [],
      {},
      { ...input(), intent: "approve" },
      { ...input(), project_id: "../outside" },
      { ...input(), version_id: "bad" },
      { ...input(), content_hash: "bad" },
      { ...input(), expected_revision: 0 },
      { ...input(), expected_revision: 1.2 },
      { ...input(), expected_revision: Number.MAX_SAFE_INTEGER },
      { ...input(), expected_revision: "3" },
      { ...input(), confirm: () => true },
      { ...input(), artifact_id: artifactId },
      { ...input(), rationale: "extra" },
      { ...input("confirm_baseline"), rationale: "" },
      { ...input("confirm_baseline"), rationale: " untrimmed " },
      { ...input("confirm_baseline"), rationale: 5 },
      { ...input("confirm_baseline"), rationale: "😀".repeat(1001) },
    ];
    const missing = { ...input() } as Partial<SourceManifestReviewInput>;
    delete missing.content_hash;
    invalid.push(missing);
    for (const value of invalid) {
      expect(await controller.run(value)).toEqual({
        kind: "INVALID_INPUT",
        phase: "input",
        identity: null,
        completed_actions: [],
        receipts: [],
      });
    }
    expect(client.getSourceManifestForReview).not.toHaveBeenCalled();
    client.getSourceManifestForReview.mockResolvedValueOnce({ kind: "REMOTE_UNKNOWN" });
    expect(
      (await controller.run({ ...input("confirm_baseline"), rationale: "😀".repeat(1000) })).kind,
    ).toBe("REMOTE_UNKNOWN");
    expect(client.getSourceManifestForReview).toHaveBeenCalledOnce();
  });

  test("copies business input and never lets display DTO or raw prepared response mutation change consumption", async () => {
    const client = mockClient(true);
    let resolve!: (
      value: Awaited<ReturnType<SourceManifestReviewClient["getSourceManifestForReview"]>>,
    ) => void;
    client.getSourceManifestForReview.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const raw = input("confirm_baseline");
    const sourcePrepared = prepared("signoff");
    client.prepareSourceManifestSignoff.mockResolvedValueOnce({
      kind: "SUCCEEDED",
      receipt: sourcePrepared,
    });
    const resultPromise = createSourceManifestReviewController(client, () => now).run(raw, {
      confirm: (data) => {
        data.project_id = "changed";
        data.version_id = "changed";
        data.head_revision = 999;
        data.rationale = "changed";
        data.report_id = "changed";
        sourcePrepared.data.confirmation_token = "changed";
        sourcePrepared.data.report.id = "changed";
        return true;
      },
    });
    Object.assign(raw, {
      intent: "copy_draft",
      project_id: "changed",
      version_id: "changed",
      rationale: "changed",
    });
    resolve({ kind: "SUCCEEDED", receipt: manifest(true) });
    const result = await resultPromise;
    expect(result).toMatchObject({
      kind: "SUCCEEDED",
      identity: { project_id: projectId, version_id: versionId },
      completed_actions: ["signoff", "decision"],
    });
    expect(client.signoffSourceManifestReview.mock.calls[0]![1]).toEqual(prepared("signoff"));
    expect(client.prepareSourceManifestDecision.mock.calls[0]![2]).toBe("确认来源基线");
    expect(client.decideSourceManifestReview.mock.calls[0]![2]).toBe("确认来源基线");
  });

  test("uses only whitelisted confirmation and receipt fields, with explicit single-account self-review text", async () => {
    const client = mockClient(true);
    const confirm = vi.fn<NonNullable<SourceManifestReviewContext["confirm"]>>(() => true);
    const result = await createSourceManifestReviewController(client, () => now).run(
      input("confirm_baseline"),
      { confirm },
    );
    for (const [data, signal] of confirm.mock.calls) {
      expect(Object.keys(data).sort()).toEqual(
        [
          "project_id",
          "version_id",
          "content_hash",
          "gate",
          "action",
          "head_revision",
          "review_evidence_revision",
          "report_id",
          "report_hash",
          "rationale",
          "title",
          "description",
          "account_notice",
        ].sort(),
      );
      expect(data.account_notice).toContain("同一 local-user");
      expect(data.account_notice).toContain("不代表两个独立人类");
      expect(signal.aborted).toBe(true);
    }
    expect(
      JSON.stringify({ result, confirmations: confirm.mock.calls.map(([data]) => data) }),
    ).not.toMatch(/"(?:confirmation_token|challenge|report|content|credentials|message|details)":/);
    expect(JSON.stringify(result)).not.toContain("synthetic-main-only-confirmation-secret");
  });

  test("keeps one project lock across calls, allows another project, and releases after cancellation", async () => {
    const client = mockClient();
    client.getSourceManifestForReview.mockImplementation(async (identity) => {
      const receipt = manifest();
      receipt.data.project_id = identity.project_id;
      return { kind: "SUCCEEDED", receipt };
    });
    const controller = createSourceManifestReviewController(client, () => now);
    let resolve!: (value: boolean) => void;
    const first = controller.run(input(), {
      confirm: () =>
        new Promise((done) => {
          resolve = done;
        }),
    });
    await Promise.resolve();
    await Promise.resolve();
    const sameProject = await controller.run(input(), { confirm: () => true });
    expect(sameProject).toMatchObject({ kind: "BUSY", phase: "input", completed_actions: [] });
    expect(client.getSourceManifestForReview).toHaveBeenCalledOnce();
    expect(
      (
        await controller.run(
          { ...input(), project_id: `prj_${"7".repeat(32)}` },
          { confirm: () => false },
        )
      ).kind,
    ).toBe("CANCELLED");
    resolve(false);
    await expect(first).resolves.toMatchObject({ kind: "CANCELLED" });
    expect((await controller.run(input(), { confirm: () => true })).kind).toBe("SUCCEEDED");
    expect(client.copySourceManifestDraft).toHaveBeenCalledOnce();
  });

  test("refuses inapplicable draft/review/accepted states without manufacturing another action", async () => {
    const reviewed = mockClient(true);
    const confirm = vi.fn(() => true);
    expect(
      (
        await createSourceManifestReviewController(reviewed, () => now).run(input("submit"), {
          confirm,
        })
      ).kind,
    ).toBe("STATE_CHANGED");
    expect(reviewed.prepareSourceManifestSubmit).not.toHaveBeenCalled();
    const draft = mockClient();
    expect(
      (
        await createSourceManifestReviewController(draft, () => now).run(
          input("confirm_baseline"),
          { confirm },
        )
      ).kind,
    ).toBe("STATE_CHANGED");
    expect(draft.prepareSourceManifestSignoff).not.toHaveBeenCalled();
    const accepted = manifest();
    accepted.data.head.accepted_version_id = versionId;
    accepted.data.accepted_version = accepted.data.latest_version;
    draft.getSourceManifestForReview.mockResolvedValueOnce({
      kind: "SUCCEEDED",
      receipt: accepted,
    });
    expect(
      (
        await createSourceManifestReviewController(draft, () => now).run(input("submit"), {
          confirm,
        })
      ).kind,
    ).toBe("STATE_CHANGED");
    expect(confirm).not.toHaveBeenCalled();
  });

  test("rechecks cancellation immediately before POST even across the confirmation helper await", async () => {
    const client = mockClient();
    const cancel = new AbortController();
    const result = await createSourceManifestReviewController(client, () => now).run(
      input("submit"),
      {
        signal: cancel.signal,
        confirm: () => {
          queueMicrotask(() => queueMicrotask(() => queueMicrotask(() => cancel.abort())));
          return true;
        },
      },
    );
    expect(result).toMatchObject({ kind: "CANCELLED", completed_actions: [] });
    expect(client.submitSourceManifestReview).not.toHaveBeenCalled();
  });

  test("submits only after a separate safe confirmation and then stops", async () => {
    const client = mockClient();
    const confirm = vi.fn<NonNullable<SourceManifestReviewContext["confirm"]>>(() => true);
    const result = await createSourceManifestReviewController(client, () => now).run(
      input("submit"),
      { confirm },
    );
    expect(result).toMatchObject({
      kind: "SUCCEEDED",
      phase: "submit",
      completed_actions: ["submit"],
    });
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm.mock.calls[0]![0]).toMatchObject({
      action: "submit",
      project_id: projectId,
      version_id: versionId,
      content_hash: contentHash,
    });
    expect(result.receipts[0]).toMatchObject({
      head_revision: 4,
      review_evidence_revision: 2,
      review_submission_id: submissionId,
    });
    expect(client.prepareSourceManifestSignoff).not.toHaveBeenCalled();
    expect(client.copySourceManifestDraft).not.toHaveBeenCalled();
  });

  test("signs then separately approves against the same report and immutable rationale", async () => {
    const client = mockClient(true);
    const confirm = vi.fn<NonNullable<SourceManifestReviewContext["confirm"]>>(() => true);
    const result = await createSourceManifestReviewController(client, () => now).run(
      input("confirm_baseline"),
      { confirm },
    );
    expect(result).toMatchObject({
      kind: "SUCCEEDED",
      phase: "decision",
      completed_actions: ["signoff", "decision"],
    });
    expect(confirm.mock.calls.map((call) => call[0].action)).toEqual(["signoff", "decision"]);
    expect(client.prepareSourceManifestDecision).toHaveBeenCalledWith(
      expect.objectContaining({ expected_revision: 4, review_evidence_revision: 1 }),
      prepared("signoff").data.report,
      "确认来源基线",
    );
    expect(client.decideSourceManifestReview).toHaveBeenCalledWith(
      expect.objectContaining({ expected_revision: 4 }),
      prepared("decision"),
      "确认来源基线",
    );
    expect(result.receipts.map((receipt) => receipt.report_hash)).toEqual([
      prepared("signoff").data.report.report_hash,
      prepared("signoff").data.report.report_hash,
    ]);
  });

  test("a never-settling copy confirmation actively expires and aborts at five minutes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      const client = mockClient();
      let signal: AbortSignal | undefined;
      const confirm = vi.fn((_data: unknown, activeSignal: AbortSignal) => {
        signal = activeSignal;
        return new Promise<boolean>(() => {});
      });
      let result: unknown = "pending";
      void createSourceManifestReviewController(client)
        .run(input(), { confirm })
        .then((value) => {
          result = value;
        });
      await vi.advanceTimersByTimeAsync(300_000);
      expect(result).toMatchObject({ kind: "EXPIRED", completed_actions: [] });
      expect(signal!.aborted).toBe(true);
      expect(client.copySourceManifestDraft).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test("an explicit refusal never sends the copy POST", async () => {
    const client = mockClient();
    const confirm = vi.fn(() => false);
    const result = await createSourceManifestReviewController(client).run(input(), { confirm });
    expect(result.kind).toBe("CANCELLED");
    expect(client.copySourceManifestDraft).not.toHaveBeenCalled();
  });
});

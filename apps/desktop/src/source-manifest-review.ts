import type {
  SourceManifestPreparedReview,
  SourceManifestResponse,
  SourceManifestReviewClient,
  SourceManifestReviewErrorCode,
  SourceManifestReviewIdentity,
  SourceManifestReviewResult,
  SourceManifestReviewTarget,
} from "./api-client";
import { hasOnlyKeys, isRecord } from "./api-contract-guards";

export type SourceManifestReviewInput = SourceManifestReviewIdentity &
  ({ intent: "submit" | "copy_draft" } | { intent: "confirm_baseline"; rationale: string });

export type SourceManifestReviewAction = "submit" | "signoff" | "decision" | "copy_draft";
export type SourceManifestReviewPhase =
  | "input"
  | "preflight"
  | "prepare_submit"
  | "confirm_submit"
  | "submit"
  | "prepare_signoff"
  | "confirm_signoff"
  | "signoff"
  | "prepare_decision"
  | "confirm_decision"
  | "decision"
  | "confirm_copy_draft"
  | "copy_draft";
export type SourceManifestReviewKind =
  | "SUCCEEDED"
  | "CANCELLED"
  | "EXPIRED"
  | "BUSY"
  | "INVALID_INPUT"
  | "STATE_CHANGED"
  | "DEFINITE_SERVER_ERROR"
  | "REMOTE_UNKNOWN";

export type SourceManifestReviewConfirmation = {
  project_id: string;
  version_id: string;
  content_hash: string;
  gate: "G1";
  action: SourceManifestReviewAction;
  head_revision: number;
  review_evidence_revision: number;
  report_id: string | null;
  report_hash: string | null;
  rationale: string | null;
  title: string;
  description: string;
  account_notice: string;
};

/** This context is provided by trusted main code, not renderer business JSON. */
export type SourceManifestReviewContext = {
  confirm?: (
    data: SourceManifestReviewConfirmation,
    signal: AbortSignal,
  ) => boolean | undefined | Promise<boolean | undefined>;
  signal?: AbortSignal;
};

export type SourceManifestReviewSafeReceipt = {
  action: SourceManifestReviewAction;
  request_id: string;
  project_id: string;
  artifact_id: string;
  version_id: string;
  content_hash: string;
  head_revision: number;
  review_evidence_revision: number;
  latest_version_id: string;
  review_version_id: string | null;
  review_submission_id: string | null;
  accepted_version_id: string | null;
  report_id: string | null;
  report_hash: string | null;
};

type SafeServerError = { status: number; code: SourceManifestReviewErrorCode; request_id: string };
export type SourceManifestReviewOperationResult = {
  kind: SourceManifestReviewKind;
  phase: SourceManifestReviewPhase;
  identity: SourceManifestReviewIdentity | null;
  completed_actions: SourceManifestReviewAction[];
  receipts: SourceManifestReviewSafeReceipt[];
  error?: SafeServerError;
};

const COPY_CONFIRMATION_MS = 5 * 60_000;
const ACCOUNT_NOTICE =
  "同一 local-user 账户以 writer/producer 角色操作，允许自审；不代表两个独立人类的审批。";
const ACTION_TEXT = {
  submit: { title: "送审来源版本", description: "仅将当前精确来源版本送审；不会自动签署或批准。" },
  signoff: {
    title: "签署来源基线",
    description: "以当前账户的 writer 和 producer 角色签署该报告；批准仍需另行确认。",
  },
  decision: { title: "批准来源基线", description: "使用刚才已签署的同一报告批准当前来源基线。" },
  copy_draft: {
    title: "复制为新草稿",
    description: "仅复制当前精确来源版本为新草稿；不会自动送审、签署或批准。",
  },
};

function snapshotInput(value: unknown): SourceManifestReviewInput | null {
  if (!isRecord(value)) return null;
  const keys = ["intent", "project_id", "version_id", "content_hash", "expected_revision"];
  if (value.intent === "confirm_baseline") keys.push("rationale");
  if (
    !hasOnlyKeys(value, keys) ||
    !keys.every((key) => Object.hasOwn(value, key)) ||
    (value.intent !== "submit" &&
      value.intent !== "confirm_baseline" &&
      value.intent !== "copy_draft") ||
    typeof value.project_id !== "string" ||
    !/^prj_[0-9a-f]{32}$/.test(value.project_id) ||
    typeof value.version_id !== "string" ||
    !/^ver_[0-9a-f]{32}$/.test(value.version_id) ||
    typeof value.content_hash !== "string" ||
    !/^sha256:[0-9a-f]{64}$/.test(value.content_hash) ||
    typeof value.expected_revision !== "number" ||
    !Number.isSafeInteger(value.expected_revision) ||
    value.expected_revision < 1 ||
    value.expected_revision >= Number.MAX_SAFE_INTEGER
  )
    return null;
  const identity = {
    project_id: value.project_id,
    version_id: value.version_id,
    content_hash: value.content_hash,
    expected_revision: value.expected_revision,
  };
  if (value.intent !== "confirm_baseline") return { intent: value.intent, ...identity };
  if (
    typeof value.rationale !== "string" ||
    value.rationale !== value.rationale.trim() ||
    value.rationale.length === 0 ||
    [...value.rationale].length > 1000
  )
    return null;
  return { intent: "confirm_baseline", ...identity, rationale: value.rationale };
}

function targetFromManifest(
  identity: SourceManifestReviewIdentity,
  current: SourceManifestResponse,
): SourceManifestReviewTarget | null {
  const { head, latest_version: version } = current.data;
  if (
    current.data.project_id !== identity.project_id ||
    version.id !== identity.version_id ||
    version.content_hash !== identity.content_hash ||
    head.latest_version_id !== identity.version_id ||
    head.artifact_id !== version.artifact_id ||
    head.revision !== identity.expected_revision
  )
    return null;
  return {
    project_id: identity.project_id,
    version_id: identity.version_id,
    content_hash: identity.content_hash,
    expected_revision: identity.expected_revision,
    artifact_id: head.artifact_id,
    version_number: version.version_number,
    review_evidence_revision: head.review_evidence_revision,
    review_version_id: head.review_version_id ?? null,
    review_submission_id: head.review_submission_id,
    accepted_version_id: head.accepted_version_id ?? null,
  };
}

function confirmationData(
  action: SourceManifestReviewAction,
  target: SourceManifestReviewTarget,
  prepared?: SourceManifestPreparedReview,
  rationale?: string,
): SourceManifestReviewConfirmation {
  return {
    project_id: target.project_id,
    version_id: target.version_id,
    content_hash: target.content_hash,
    gate: "G1",
    action,
    head_revision: target.expected_revision,
    review_evidence_revision: target.review_evidence_revision,
    report_id: prepared?.data.report.id ?? null,
    report_hash: prepared?.data.report.report_hash ?? null,
    rationale: rationale ?? null,
    title: ACTION_TEXT[action].title,
    description: ACTION_TEXT[action].description,
    account_notice: ACCOUNT_NOTICE,
  };
}

function safeReceipt(
  action: SourceManifestReviewAction,
  target: SourceManifestReviewTarget,
  head: SourceManifestResponse["data"]["head"],
  requestId: string,
  prepared?: SourceManifestPreparedReview,
): SourceManifestReviewSafeReceipt {
  return {
    action,
    request_id: requestId,
    project_id: target.project_id,
    artifact_id: head.artifact_id,
    version_id: target.version_id,
    content_hash: target.content_hash,
    head_revision: head.revision,
    review_evidence_revision: head.review_evidence_revision,
    latest_version_id: head.latest_version_id,
    review_version_id: head.review_version_id ?? null,
    review_submission_id: head.review_submission_id,
    accepted_version_id: head.accepted_version_id ?? null,
    report_id: prepared?.data.report.id ?? null,
    report_hash: prepared?.data.report.report_hash ?? null,
  };
}

function preparedMatches(
  prepared: SourceManifestPreparedReview,
  target: SourceManifestReviewTarget,
  action: "submit" | "signoff" | "decision",
  signedReport?: SourceManifestPreparedReview["data"]["report"],
): boolean {
  const { report, challenge } = prepared.data;
  return (
    report.artifact_id === target.artifact_id &&
    report.version_id === target.version_id &&
    report.gate === "G1" &&
    report.submission_id === (action === "submit" ? null : target.review_submission_id) &&
    report.head_revision === target.expected_revision - (action === "decision" ? 1 : 0) &&
    report.review_evidence_revision === target.review_evidence_revision &&
    challenge.artifact_id === target.artifact_id &&
    challenge.version_id === target.version_id &&
    challenge.gate === "G1" &&
    challenge.action === action &&
    challenge.head_revision === target.expected_revision &&
    challenge.review_evidence_revision === target.review_evidence_revision &&
    challenge.readiness_report_id === report.id &&
    (!signedReport ||
      (report.id === signedReport.id &&
        report.report_hash === signedReport.report_hash &&
        report.expires_at === signedReport.expires_at &&
        report.head_revision === signedReport.head_revision &&
        report.review_evidence_revision === signedReport.review_evidence_revision))
  );
}

function headAdvanced(
  head: SourceManifestResponse["data"]["head"],
  target: SourceManifestReviewTarget,
  action: "submit" | "signoff" | "decision",
  submissionId: string | null,
): boolean {
  return (
    head.artifact_id === target.artifact_id &&
    head.latest_version_id === target.version_id &&
    head.revision === target.expected_revision + 1 &&
    head.review_evidence_revision ===
      target.review_evidence_revision + (action === "submit" ? 1 : 0) &&
    head.review_version_id === (action === "decision" ? null : target.version_id) &&
    head.review_submission_id === submissionId &&
    head.accepted_version_id ===
      (action === "decision" ? target.version_id : target.accepted_version_id)
  );
}

/** Keep this instance alive across IPC calls so its project lock survives each invocation. */
export function createSourceManifestReviewController(
  client: SourceManifestReviewClient,
  clock: () => number = Date.now,
) {
  const busyProjects = new Set<string>();

  function stopReason(
    signal?: AbortSignal,
    deadline = Number.POSITIVE_INFINITY,
  ): "CANCELLED" | "EXPIRED" | null {
    if (signal?.aborted) return "CANCELLED";
    const timestamp = clock();
    return !Number.isFinite(timestamp) || Number.isNaN(deadline) || timestamp >= deadline
      ? "EXPIRED"
      : null;
  }

  function confirm(
    data: SourceManifestReviewConfirmation,
    deadline: number,
    callback: SourceManifestReviewContext["confirm"],
    signal?: AbortSignal,
  ): Promise<"CONFIRMED" | "CANCELLED" | "EXPIRED"> {
    const stopped = stopReason(signal, deadline);
    if (stopped) return Promise.resolve(stopped);
    const confirmation = new AbortController();
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result: "CONFIRMED" | "CANCELLED" | "EXPIRED") => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", cancel);
        confirmation.abort();
        resolve(stopReason(signal, deadline) ?? result);
      };
      const cancel = () => finish("CANCELLED");
      const timer = setTimeout(() => finish("EXPIRED"), Math.max(0, deadline - clock()));
      signal?.addEventListener("abort", cancel, { once: true });
      try {
        Promise.resolve(callback?.(data, confirmation.signal)).then(
          (accepted) => finish(accepted === true ? "CONFIRMED" : "CANCELLED"),
          () => finish("CANCELLED"),
        );
      } catch {
        finish("CANCELLED");
      }
    });
  }

  return {
    async run(
      rawInput: unknown,
      context: SourceManifestReviewContext = {},
    ): Promise<SourceManifestReviewOperationResult> {
      const input = snapshotInput(rawInput);
      const identity =
        input === null
          ? null
          : {
              project_id: input.project_id,
              version_id: input.version_id,
              content_hash: input.content_hash,
              expected_revision: input.expected_revision,
            };
      const { confirm: callback, signal } = context;
      let phase: SourceManifestReviewPhase = "input";
      const receipts: SourceManifestReviewSafeReceipt[] = [];
      const finish = (
        kind: SourceManifestReviewKind,
        error?: SafeServerError,
      ): SourceManifestReviewOperationResult => ({
        kind,
        phase,
        identity,
        completed_actions: receipts.map((receipt) => receipt.action),
        receipts: receipts.slice(),
        ...(error ? { error } : {}),
      });
      const failure = (
        result: Exclude<SourceManifestReviewResult<unknown>, { kind: "SUCCEEDED" }>,
      ) =>
        result.kind === "DEFINITE_SERVER_ERROR"
          ? finish(
              result.code === "PRECONDITION_FAILED" ? "STATE_CHANGED" : "DEFINITE_SERVER_ERROR",
              { status: result.status, code: result.code, request_id: result.request_id },
            )
          : finish(result.kind);
      const ask = async (
        action: "submit" | "signoff" | "decision",
        target: SourceManifestReviewTarget,
        prepared: SourceManifestPreparedReview,
        rationale?: string,
      ) => {
        phase =
          action === "submit"
            ? "confirm_submit"
            : action === "signoff"
              ? "confirm_signoff"
              : "confirm_decision";
        const deadline = Math.min(
          Date.parse(prepared.data.report.expires_at),
          Date.parse(prepared.data.challenge.expires_at),
          clock() + COPY_CONFIRMATION_MS,
        );
        const confirmed = await confirm(
          confirmationData(action, target, prepared, rationale),
          deadline,
          callback,
          signal,
        );
        if (confirmed !== "CONFIRMED") return confirmed;
        return stopReason(signal, deadline) ?? deadline;
      };
      if (input === null || identity === null) return finish("INVALID_INPUT");
      const initialStop = stopReason(signal);
      if (initialStop) return finish(initialStop);
      if (busyProjects.has(input.project_id)) return finish("BUSY");
      busyProjects.add(input.project_id);
      try {
        phase = "preflight";
        const current = await client.getSourceManifestForReview(identity);
        if (current.kind !== "SUCCEEDED") return failure(current);
        const preflightStop = stopReason(signal);
        if (preflightStop) return finish(preflightStop);
        const target = targetFromManifest(identity, current.receipt);
        if (target === null) return finish("REMOTE_UNKNOWN");
        if (input.intent === "submit") {
          if (
            target.review_version_id === target.version_id ||
            target.accepted_version_id === target.version_id
          )
            return finish("STATE_CHANGED");
          phase = "prepare_submit";
          const ready = await client.prepareSourceManifestSubmit(target);
          if (ready.kind !== "SUCCEEDED") return failure(ready);
          const prepared = structuredClone(ready.receipt);
          if (!preparedMatches(prepared, target, "submit")) return finish("REMOTE_UNKNOWN");
          const permit = await ask("submit", target, prepared);
          if (typeof permit !== "number") return finish(permit);
          const beforeSubmit = stopReason(signal, permit);
          if (beforeSubmit) return finish(beforeSubmit);
          phase = "submit";
          const submitted = await client.submitSourceManifestReview(target, prepared);
          if (submitted.kind !== "SUCCEEDED") return failure(submitted);
          if (
            !headAdvanced(
              submitted.receipt.data.head,
              target,
              "submit",
              submitted.receipt.data.submission.id,
            ) ||
            submitted.receipt.data.submission.readiness_report_id !== prepared.data.report.id
          )
            return finish("REMOTE_UNKNOWN");
          receipts.push(
            safeReceipt(
              "submit",
              target,
              submitted.receipt.data.head,
              submitted.receipt.request_id,
              prepared,
            ),
          );
          return finish("SUCCEEDED");
        }
        if (input.intent === "confirm_baseline") {
          if (
            target.review_version_id !== target.version_id ||
            target.review_submission_id === null ||
            target.accepted_version_id === target.version_id
          )
            return finish("STATE_CHANGED");
          phase = "prepare_signoff";
          const ready = await client.prepareSourceManifestSignoff(target);
          if (ready.kind !== "SUCCEEDED") return failure(ready);
          const signing = structuredClone(ready.receipt);
          if (!preparedMatches(signing, target, "signoff")) return finish("REMOTE_UNKNOWN");
          const signoffPermit = await ask("signoff", target, signing, input.rationale);
          if (typeof signoffPermit !== "number") return finish(signoffPermit);
          const beforeSignoff = stopReason(signal, signoffPermit);
          if (beforeSignoff) return finish(beforeSignoff);
          phase = "signoff";
          const signed = await client.signoffSourceManifestReview(target, signing);
          if (signed.kind !== "SUCCEEDED") return failure(signed);
          if (
            !headAdvanced(
              signed.receipt.data.head,
              target,
              "signoff",
              target.review_submission_id,
            ) ||
            signed.receipt.data.signoffs.some(
              (item) =>
                item.readiness_report_id !== signing.data.report.id ||
                item.review_evidence_revision !== target.review_evidence_revision,
            )
          )
            return finish("REMOTE_UNKNOWN");
          receipts.push(
            safeReceipt(
              "signoff",
              target,
              signed.receipt.data.head,
              signed.receipt.request_id,
              signing,
            ),
          );
          // The report survives signoff; only the head revision advances. Never re-prepare signoff.
          const signedTarget = { ...target, expected_revision: signed.receipt.data.head.revision };
          phase = "prepare_decision";
          const beforeDecision = stopReason(signal, Date.parse(signing.data.report.expires_at));
          if (beforeDecision) return finish(beforeDecision);
          const readyDecision = await client.prepareSourceManifestDecision(
            signedTarget,
            signing.data.report,
            input.rationale,
          );
          if (readyDecision.kind !== "SUCCEEDED") return failure(readyDecision);
          const deciding = structuredClone(readyDecision.receipt);
          if (!preparedMatches(deciding, signedTarget, "decision", signing.data.report))
            return finish("REMOTE_UNKNOWN");
          const decisionPermit = await ask("decision", signedTarget, deciding, input.rationale);
          if (typeof decisionPermit !== "number") return finish(decisionPermit);
          const beforeConsumeDecision = stopReason(signal, decisionPermit);
          if (beforeConsumeDecision) return finish(beforeConsumeDecision);
          phase = "decision";
          const decided = await client.decideSourceManifestReview(
            signedTarget,
            deciding,
            input.rationale,
          );
          if (decided.kind !== "SUCCEEDED") return failure(decided);
          if (
            !headAdvanced(decided.receipt.data.head, signedTarget, "decision", null) ||
            decided.receipt.data.decision.readiness_report_id !== signing.data.report.id ||
            decided.receipt.data.decision.rationale !== input.rationale
          )
            return finish("REMOTE_UNKNOWN");
          receipts.push(
            safeReceipt(
              "decision",
              signedTarget,
              decided.receipt.data.head,
              decided.receipt.request_id,
              deciding,
            ),
          );
          return finish("SUCCEEDED");
        }
        phase = "confirm_copy_draft";
        const deadline = clock() + COPY_CONFIRMATION_MS;
        const confirmed = await confirm(
          confirmationData("copy_draft", target),
          deadline,
          callback,
          signal,
        );
        if (confirmed !== "CONFIRMED") return finish(confirmed);
        const stopped = stopReason(signal, deadline);
        if (stopped) return finish(stopped);
        phase = "copy_draft";
        const copied = await client.copySourceManifestDraft(target);
        if (copied.kind !== "SUCCEEDED") return failure(copied);
        const copiedTarget = {
          ...target,
          version_id: copied.receipt.data.latest_version.id,
          content_hash: copied.receipt.data.latest_version.content_hash,
        };
        receipts.push(
          safeReceipt(
            "copy_draft",
            copiedTarget,
            copied.receipt.data.head,
            copied.receipt.request_id,
          ),
        );
        return finish("SUCCEEDED");
      } catch {
        return finish("REMOTE_UNKNOWN");
      } finally {
        busyProjects.delete(input.project_id);
      }
    },
  };
}

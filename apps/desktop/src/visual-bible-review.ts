import {
  visualReviewInput,
  visualActionOutcomeMatches,
  visualLocalReviewActorMatches,
  visualEnvironmentEvidenceMatches,
  type VisualContent,
  type VisualAction,
  type VisualGateway,
  type VisualIdentity,
  type VisualOperation,
  type VisualPrepared,
  type VisualResult,
  type VisualTicket,
} from "@aijian/contracts/visual-bible";
import {
  validVisualIdentity,
  visualCanonical,
  visualHash,
  type VisualHttpClient,
} from "./visual-bible-client";
import { isRecord, hasOnlyKeys } from "./api-contract-guards";
import type { LocalApiClient } from "./api-client";

export function validVisualTicket(v: unknown): v is VisualTicket {
  if (
    !isRecord(v) ||
    !hasOnlyKeys(v, [
      "project_id",
      "version_id",
      "content_hash",
      "expected_revision",
      "challenge_id",
      "report_id",
      "report_hash",
      "input",
    ]) ||
    Object.keys(v).length !== 8
  )
    return false;
  return (
    validVisualIdentity({
      project_id: v.project_id,
      version_id: v.version_id,
      content_hash: v.content_hash,
      expected_revision: v.expected_revision,
    }) &&
    typeof v.challenge_id === "string" &&
    /^chg_[0-9a-f]{32}$/.test(v.challenge_id) &&
    typeof v.report_id === "string" &&
    /^rpt_[0-9a-f]{32}$/.test(v.report_id) &&
    typeof v.report_hash === "string" &&
    /^sha256:[0-9a-f]{64}$/.test(v.report_hash) &&
    visualReviewInput(v.input)
  );
}
export function visualOperationMatches(ticket: VisualTicket, data: VisualOperation): boolean {
  const payload =
    ticket.input.action === "submit"
      ? {}
      : ticket.input.action === "signoff"
        ? { roles: ticket.input.roles }
        : {
            decision: ticket.input.decision,
            rationale: ticket.input.rationale,
            actor_role: "producer",
          };
  const expectedHash = visualHash({
    ...payload,
    _actor_id: data.actor_id,
    _actor_roles: data.actor_roles,
    _policy_snapshot_hash: data.policy_snapshot_hash,
  });
  return (
    visualLocalReviewActorMatches(data) &&
    data.project_id === ticket.project_id &&
    data.content_hash === ticket.content_hash &&
    data.challenge.id === ticket.challenge_id &&
    data.challenge.version_id === ticket.version_id &&
    data.challenge.head_revision === ticket.expected_revision &&
    data.report.id === ticket.report_id &&
    data.report.report_hash === ticket.report_hash &&
    data.challenge.action === ticket.input.action &&
    data.action_payload_hash === expectedHash &&
    visualActionOutcomeMatches(ticket.input, data)
  );
}
export function createVisualReviewController(
  client: VisualHttpClient & Partial<Pick<LocalApiClient, "getProjectCreativeLibraryVersion">>,
  now: () => number = Date.now,
) {
  const tokens = new Map<
    string,
    { ticket: VisualTicket; prepared: VisualPrepared; origin: object }
  >();
  const busy = new Set<string>();
  async function evidenceMatches(content: VisualContent, report: Record<string, unknown>) {
    if (content.schema_version === "1.0.0")
      return visualEnvironmentEvidenceMatches(content, null, report);
    const basis = await client.getProjectCreativeLibraryVersion?.(
      content.project_id,
      content.creative_library_version_id,
    );
    return (
      basis?.kind === "FOUND" &&
      basis.receipt.data.project_id === content.project_id &&
      basis.receipt.data.version_id === content.creative_library_version_id &&
      basis.receipt.data.content_hash === content.creative_library_content_hash &&
      visualHash(basis.receipt.data.content) === basis.receipt.data.content_hash &&
      visualEnvironmentEvidenceMatches(content, basis.receipt.data.content, report)
    );
  }
  return {
    async prepare(
      identity: VisualIdentity,
      input: VisualAction,
      origin: object,
    ): Promise<VisualResult<VisualTicket>> {
      if (!validVisualIdentity(identity) || !visualReviewInput(input))
        throw new Error("Invalid G5 review request");
      if (busy.has(identity.project_id)) return { kind: "REMOTE_UNKNOWN" };
      busy.add(identity.project_id);
      try {
        for (const [id, value] of tokens)
          if (Date.parse(value.prepared.challenge.expires_at) <= now()) tokens.delete(id);
        if (tokens.size >= 64) return { kind: "REMOTE_UNKNOWN" };
        const current = await client.getVisualBibleVersion(
          identity.project_id,
          identity.version_id,
        );
        if (current.kind !== "FOUND") return current;
        if (
          current.data.version.content_hash !== identity.content_hash ||
          current.data.head.revision !== identity.expected_revision
        )
          return { kind: "REMOTE_UNKNOWN" };
        const prepared = await client.prepareVisualAction(identity, input);
        if (prepared.kind !== "FOUND") return prepared;
        const p = prepared.data;
        if (
          p.challenge.artifact_id !== current.data.head.artifact_id ||
          p.report.report.content_hash !== identity.content_hash ||
          !(await evidenceMatches(current.data.version.content, p.report.report)) ||
          Date.parse(p.challenge.expires_at) <= now() ||
          (p.report.report.ready !== true &&
            !(input.action === "decision" && input.decision === "rejected"))
        )
          return { kind: "REMOTE_UNKNOWN" };
        const ticket: VisualTicket = {
          ...identity,
          challenge_id: p.challenge.id,
          report_id: p.report.id,
          report_hash: p.report.report_hash,
          input: JSON.parse(JSON.stringify(input)) as VisualAction,
        };
        tokens.set(ticket.challenge_id, { ticket, prepared: p, origin });
        return { kind: "FOUND", data: ticket, request_id: prepared.request_id };
      } finally {
        busy.delete(identity.project_id);
      }
    },
    async confirm(
      ticket: VisualTicket,
      origin: object,
      signal: AbortSignal,
      confirm: (detail: string, signal: AbortSignal) => Promise<boolean>,
    ): Promise<VisualResult<VisualOperation>> {
      if (!validVisualTicket(ticket)) throw new Error("Invalid G5 confirmation ticket");
      const slot = tokens.get(ticket.challenge_id);
      if (
        !slot ||
        slot.origin !== origin ||
        visualCanonical(slot.ticket) !== visualCanonical(ticket) ||
        Date.parse(slot.prepared.challenge.expires_at) <= now() ||
        signal.aborted ||
        busy.has(ticket.project_id)
      )
        return { kind: "CANCELLED" };
      // One-shot trusted capability: a cancelled/unknown operation requires read-only recovery.
      tokens.delete(ticket.challenge_id);
      busy.add(ticket.project_id);
      try {
        const read = await client.getVisualBibleVersion(ticket.project_id, ticket.version_id);
        if (read.kind !== "FOUND") return read;
        if (
          read.data.version.content_hash !== ticket.content_hash ||
          read.data.head.revision !== ticket.expected_revision ||
          !(await evidenceMatches(read.data.version.content, slot.prepared.report.report)) ||
          signal.aborted
        )
          return { kind: "CANCELLED" };
        const detail = [
          `作品：${ticket.project_id}`,
          `版本：${ticket.version_id}`,
          `内容 hash：${ticket.content_hash}`,
          `G5 动作：${ticket.input.action}；决定：${ticket.input.decision ?? "无"}`,
          `报告：${ticket.report_id}；hash：${ticket.report_hash}`,
          `理由：${ticket.input.rationale ?? "无"}`,
          "当前 local-user 以 continuity_reviewer/producer 角色自审；不是两个独立人类。",
          "请核对身份、全部服装、场景、道具（空清单表示本版无独立道具）、9:16安全区、权利声明和技术检查。此操作不生成、编码、发布或收费。",
          ...(read.data.version.content.schema_version === "1.1.0"
            ? [
                "本次还审核精确设定版本中的完整世界文本、明确选中的地点状态/天气/时间/连续性及其原件。空状态/参考清单只批准空范围。",
              ]
            : []),
          JSON.stringify(read.data.version.content, null, 2),
          JSON.stringify(slot.prepared.report.report, null, 2),
        ].join("\n");
        if (
          !(await confirm(detail, signal)) ||
          signal.aborted ||
          Date.parse(slot.prepared.challenge.expires_at) <= now()
        )
          return { kind: "CANCELLED" };
        const result = await client.confirmVisualAction(
          {
            project_id: ticket.project_id,
            version_id: ticket.version_id,
            content_hash: ticket.content_hash,
            expected_revision: ticket.expected_revision,
          },
          ticket.input,
          slot.prepared,
        );
        return result.kind === "FOUND" && !visualOperationMatches(ticket, result.data)
          ? { kind: "REMOTE_UNKNOWN" }
          : result;
      } finally {
        busy.delete(ticket.project_id);
      }
    },
  };
}
export type VisualReviewController = ReturnType<typeof createVisualReviewController>;
export type VisualReviewPublicClient = Pick<
  VisualGateway,
  "prepareVisualReview" | "confirmVisualReview"
>;

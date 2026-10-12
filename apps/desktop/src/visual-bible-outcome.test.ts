import { describe, it, expect } from "vitest";
import fixture from "./visual-bible.testFixtures.json";
import {
  visualOperationData,
  type VisualOperation,
  type VisualAction,
  type VisualTicket,
} from "@aijian/contracts/visual-bible";
import { visualHash } from "./visual-bible-client";
import { visualOperationMatches } from "./visual-bible-review";

function outcome(action: "decision" | "signoff") {
  const data = structuredClone(fixture.submitted) as VisualOperation;
  const input: VisualAction = {
    action,
    roles: action === "signoff" ? ["producer", "continuity_reviewer"] : [],
    decision: action === "decision" ? "approved" : null,
    rationale: action === "decision" ? "exact original rationale" : null,
    readiness_report_id: data.report.id,
  };
  data.challenge.action = action;
  data.submission = null;
  data.report.submission_id = "sub_" + "a".repeat(32);
  if (action === "decision")
    data.decision = {
      id: "dec_" + "a".repeat(32),
      artifact_id: data.head.artifact_id,
      version_id: data.challenge.version_id,
      submission_id: data.report.submission_id,
      gate: "G5",
      decision: "approved",
      readiness_report_id: data.report.id,
      actor_id: data.actor_id,
      actor_role: "producer",
      self_review: true,
      rationale: input.rationale!,
      decided_at: data.challenge.consumed_at!,
    };
  else
    data.signoffs = [...input.roles].reverse().map((role, i) => ({
      id: "sig_" + String(i).repeat(32),
      artifact_id: data.head.artifact_id,
      version_id: data.challenge.version_id,
      submission_id: data.report.submission_id!,
      gate: "G5",
      role,
      actor_id: data.actor_id,
      review_evidence_revision: data.report.review_evidence_revision,
      readiness_report_id: data.report.id,
      self_review: true,
      supersedes_signoff_id: null,
      signed_at: data.challenge.consumed_at!,
    }));
  data.action_payload_hash = visualHash({
    ...(action === "decision"
      ? { decision: input.decision, rationale: input.rationale, actor_role: "producer" }
      : { roles: input.roles }),
    _actor_id: data.actor_id,
    _actor_roles: data.actor_roles,
    _policy_snapshot_hash: data.policy_snapshot_hash,
  });
  const ticket: VisualTicket = {
    project_id: data.project_id,
    version_id: data.challenge.version_id,
    content_hash: data.content_hash,
    expected_revision: data.challenge.head_revision,
    challenge_id: data.challenge.id,
    report_id: data.report.id,
    report_hash: data.report.report_hash,
    input,
  };
  return { data, ticket };
}

describe("native exact G5 action outcome", () => {
  it.each([
    "decision",
    "rationale",
    "missing-role",
    "different-role-set",
    "wrong-actor",
    "wrong-actor-roles",
  ])("refuses a structurally valid %s contradiction", (fault) => {
    const { data, ticket } = outcome(
      fault === "missing-role" || fault === "different-role-set" ? "signoff" : "decision",
    );
    expect(visualOperationData(data, ticket.project_id, ticket.version_id)).toBe(true);
    expect(visualOperationMatches(ticket, data)).toBe(true);
    if (fault === "decision") data.decision!.decision = "rejected";
    if (fault === "rationale") data.decision!.rationale = "another rationale";
    if (fault === "missing-role") data.signoffs.pop();
    if (fault === "different-role-set") ticket.input.roles = ["producer"];
    if (fault === "different-role-set")
      data.action_payload_hash = visualHash({
        roles: ticket.input.roles,
        _actor_id: data.actor_id,
        _actor_roles: data.actor_roles,
        _policy_snapshot_hash: data.policy_snapshot_hash,
      });
    if (fault === "wrong-actor") {
      data.actor_id = "different-user";
      data.decision!.actor_id = data.actor_id;
    }
    if (fault === "wrong-actor-roles") data.actor_roles = ["writer"];
    if (fault === "wrong-actor" || fault === "wrong-actor-roles")
      data.action_payload_hash = visualHash({
        decision: ticket.input.decision,
        rationale: ticket.input.rationale,
        actor_role: "producer",
        _actor_id: data.actor_id,
        _actor_roles: data.actor_roles,
        _policy_snapshot_hash: data.policy_snapshot_hash,
      });
    expect(visualOperationData(data, ticket.project_id, ticket.version_id)).toBe(true);
    expect(visualOperationMatches(ticket, data)).toBe(false);
  });
});

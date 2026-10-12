import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  VisualRead,
  VisualWrite,
  VisualIndex,
  VisualPrepared,
  VisualOperation,
  VisualInspection,
} from "@aijian/contracts/visual-bible";
const fixture = JSON.parse(
  readFileSync(join(process.cwd(), "src/visual-bible.testFixtures.json"), "utf8"),
) as {
  project_id: string;
  request_id: string;
  save_request: VisualWrite;
  saved: VisualRead;
  index: VisualIndex;
  prepared_submit: VisualPrepared;
  pending_submit: VisualOperation;
  submitted: VisualOperation;
  inspection: VisualInspection;
};
import { createVisualBibleClient, visualHash } from "./visual-bible-client";
import { visualReadData, visualOperationData } from "@aijian/contracts/visual-bible";
const p = fixture.project_id,
  v = fixture.saved.version.id,
  id = fixture.request_id;
const response = (data: unknown, status = 200) => ({
  status,
  payload: { data, request_id: id },
  requestId: id,
});
describe("G5 canonical HTTP contract", () => {
  it("verifies real persisted shape/hash and reads the exact historical operation", async () => {
    expect(visualReadData(fixture.saved, p)).toBe(true);
    expect(visualOperationData(fixture.submitted, p, v)).toBe(true);
    const http = vi.fn().mockResolvedValue(response(fixture.submitted));
    const client = createVisualBibleClient(http, {});
    const read = await client.readVisualReviewOperation(p, v, fixture.submitted.challenge.id);
    expect(read.kind).toBe("FOUND");
    expect(http).toHaveBeenCalledTimes(1);
    expect(http.mock.calls[0]?.[0]).toBe(
      `/api/v1/projects/${p}/visual-bible/versions/${v}/review-operations/${fixture.submitted.challenge.id}`,
    );
  });
  it.each([
    "hash",
    "scope",
    "operation",
    "old-schema",
    "bad-request-id",
    "extra",
    "wrong-result-revision",
    "recomputed-body-scope",
    "recomputed-body-extra",
    "recomputed-policy-snapshot",
    "recomputed-actor",
    "recomputed-roles",
  ])("keeps %s receipts unknown", async (fault) => {
    const data = structuredClone(fixture.submitted);
    let requestId = id;
    if (fault === "hash") data.report.report_hash = "sha256:" + "0".repeat(64);
    if (fault === "scope") data.project_id = "prj_" + "0".repeat(32);
    if (fault === "operation") data.challenge.id = "chg_" + "0".repeat(32);
    if (fault === "old-schema") data.report.policy_version = "0";
    if (fault === "bad-request-id") requestId = "different";
    if (fault === "extra") Object.assign(data, { approved: true });
    if (fault === "wrong-result-revision") data.result_revision = 123;
    if (fault === "recomputed-body-scope") data.report.report.version_id = "ver_" + "0".repeat(32);
    if (fault === "recomputed-body-extra") Object.assign(data.report.report, { approved: true });
    if (fault === "recomputed-policy-snapshot") {
      data.policy_snapshot_hash = "sha256:" + "0".repeat(64);
      data.report.report.policy_snapshot_hash = data.policy_snapshot_hash;
    }
    if (fault === "recomputed-actor") {
      data.actor_id = "different-user";
      data.submission!.submitted_by_actor_id = data.actor_id;
    }
    if (fault === "recomputed-roles") data.actor_roles = ["writer"];
    if (fault === "recomputed-actor" || fault === "recomputed-roles")
      data.action_payload_hash = visualHash({
        _actor_id: data.actor_id,
        _actor_roles: data.actor_roles,
        _policy_snapshot_hash: data.policy_snapshot_hash,
      });
    if (fault.startsWith("recomputed")) data.report.report_hash = visualHash(data.report.report);
    const http = vi.fn().mockResolvedValue({ ...response(data), requestId });
    expect(
      (
        await createVisualBibleClient(http, {}).readVisualReviewOperation(
          p,
          v,
          fixture.submitted.challenge.id,
        )
      ).kind,
    ).toBe("REMOTE_UNKNOWN");
    expect(http).toHaveBeenCalledTimes(1);
  });
  it("does not resend an unknown save and only recovers the original input hash", async () => {
    const payload = fixture.save_request as VisualWrite,
      key = "vbsave_" + "a".repeat(32);
    const http = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        response({
          idempotency_key_hash: visualHash({ value: key }),
          request_hash: visualHash({ project_id: p, actor_id: "local-user", payload }),
          result: fixture.saved,
        }),
      );
    const client = createVisualBibleClient(http, {});
    expect((await client.saveVisualBible(p, key, payload)).kind).toBe("REMOTE_UNKNOWN");
    expect((await client.getVisualSaveOperation(p, key, payload)).kind).toBe("FOUND");
    expect(http.mock.calls.map((x) => (x[1] as RequestInit).method ?? "GET")).toEqual([
      "POST",
      "GET",
    ]);
  });
  it("rejects a changed source content even if the server recomputes its hash", async () => {
    const data = structuredClone(fixture.saved);
    data.version.content.change_reason = "rewritten";
    data.version.content_hash = visualHash(data.version.content);
    const http = vi.fn().mockResolvedValue(response(data, 201));
    expect(
      (
        await createVisualBibleClient(http, {}).saveVisualBible(
          p,
          "vbsave_" + "a".repeat(32),
          fixture.save_request as VisualWrite,
        )
      ).kind,
    ).toBe("REMOTE_UNKNOWN");
  });
});

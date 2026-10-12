import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  VisualRead,
  VisualPrepared,
  VisualOperation,
  VisualTicket,
} from "@aijian/contracts/visual-bible";
import { createVisualBibleClient } from "./visual-bible-client";
import { createVisualReviewController } from "./visual-bible-review";
const f = JSON.parse(
  readFileSync(join(process.cwd(), "src/visual-bible.testFixtures.json"), "utf8"),
) as {
  saved: VisualRead;
  prepared_submit: VisualPrepared;
  submitted: VisualOperation;
  request_id: string;
};
const found = <T>(data: T) => ({ kind: "FOUND" as const, data, request_id: f.request_id });
function setup() {
  const read = vi.fn().mockResolvedValue(found(f.saved));
  const prepare = vi.fn().mockResolvedValue(found(f.prepared_submit));
  const write = vi.fn().mockResolvedValue({ kind: "REMOTE_UNKNOWN" });
  const client = {
    ...createVisualBibleClient(vi.fn(), {}),
    getVisualBibleVersion: read,
    prepareVisualAction: prepare,
    confirmVisualAction: write,
  };
  let clock = Date.parse(f.prepared_submit.challenge.created_at) + 1;
  const controller = createVisualReviewController(client, () => clock);
  const origin = {};
  const identity = {
    project_id: f.saved.project_id,
    version_id: f.saved.version.id,
    content_hash: f.saved.version.content_hash,
    expected_revision: f.saved.head.revision,
  };
  const input = {
    action: "submit" as const,
    roles: [],
    decision: null,
    rationale: null,
    readiness_report_id: null,
  };
  const ticket = async () => {
    const result = await controller.prepare(identity, input, origin);
    if (result.kind !== "FOUND") throw new Error("prepare failed");
    return result.data;
  };
  return {
    controller,
    origin,
    read,
    prepare,
    write,
    ticket,
    expire: () => {
      clock = Date.parse(f.prepared_submit.challenge.expires_at);
    },
  };
}
describe("trusted G5 human confirmation capability", () => {
  it("keeps tokens out of renderer tickets and makes UNKNOWN one-shot", async () => {
    const s = setup(),
      ticket = await s.ticket(),
      dialog = vi.fn().mockResolvedValue(true);
    expect(JSON.stringify(ticket)).not.toContain(f.prepared_submit.confirmation_token);
    expect(
      (await s.controller.confirm(ticket, s.origin, new AbortController().signal, dialog)).kind,
    ).toBe("REMOTE_UNKNOWN");
    expect(s.write).toHaveBeenCalledTimes(1);
    expect(
      (await s.controller.confirm(ticket, s.origin, new AbortController().signal, dialog)).kind,
    ).toBe("CANCELLED");
    expect(s.write).toHaveBeenCalledTimes(1);
    expect(dialog.mock.calls[0]?.[0]).toContain(f.saved.version.content_hash);
    expect(dialog.mock.calls[0]?.[0]).toContain("不是两个独立人类");
  });
  it.each(["origin", "changed-ticket", "expired", "aborted", "changed-head", "cancel-dialog"])(
    "never writes after %s",
    async (fault) => {
      const s = setup(),
        ticket: VisualTicket = await s.ticket(),
        abort = new AbortController();
      if (fault === "changed-ticket") ticket.expected_revision += 1;
      if (fault === "expired") s.expire();
      if (fault === "aborted") abort.abort();
      if (fault === "changed-head")
        s.read.mockResolvedValue(
          found({ ...f.saved, head: { ...f.saved.head, revision: f.saved.head.revision + 1 } }),
        );
      const dialog = vi.fn().mockResolvedValue(fault !== "cancel-dialog");
      expect(
        (
          await s.controller.confirm(
            ticket,
            fault === "origin" ? {} : s.origin,
            abort.signal,
            dialog,
          )
        ).kind,
      ).toBe("CANCELLED");
      expect(s.write).not.toHaveBeenCalled();
    },
  );
  it("a navigation abort while the dialog is open refuses its late approval", async () => {
    const s = setup(),
      ticket = await s.ticket(),
      abort = new AbortController();
    const dialog = vi.fn(async () => {
      abort.abort();
      return true;
    });
    expect((await s.controller.confirm(ticket, s.origin, abort.signal, dialog)).kind).toBe(
      "CANCELLED",
    );
    expect(s.write).not.toHaveBeenCalled();
  });
});

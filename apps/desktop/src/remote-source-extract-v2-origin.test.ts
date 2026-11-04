import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isSub2APIApprovalResponse,
  isSub2APIOperationResponse,
  isSub2APIQueueCommand,
} from "./remote-source-extract-v2-contract";

type Fixture = {
  mode: string;
  projectId: string;
  command: unknown;
  operation: { data: { scope: Record<string, unknown> }; request_id: string };
  approval: { data: { scope: Record<string, unknown> }; request_id: string };
};
// Generated from real Python stores in temporary synthetic projects, without a provider worker/vault.
const fixtures: Fixture[] = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures/sub2api-wire.json"), "utf8"),
);
describe("backend Sub2API scope through desktop exact guards", () => {
  it.each(fixtures)("accepts $mode operation and approval payloads", (fixture) => {
    expect(isSub2APIQueueCommand(fixture.command)).toBe(true);
    if (!isSub2APIQueueCommand(fixture.command)) throw new Error("invalid fixture command");
    expect(
      isSub2APIOperationResponse(
        fixture.operation,
        fixture.projectId,
        fixture.command,
        fixture.operation.request_id,
      ),
    ).toBe(true);
    expect(
      isSub2APIApprovalResponse(
        fixture.approval,
        fixture.projectId,
        fixture.command,
        fixture.approval.request_id,
      ),
    ).toBe(true);
  });
  it.each([undefined, null, "localhost", "INVALID"])("rejects unknown mode %s", (mode) => {
    const fixture = structuredClone(fixtures[0]!);
    if (!isSub2APIQueueCommand(fixture.command)) throw new Error("invalid fixture command");
    fixture.operation.data.scope.origin_mode = mode;
    fixture.approval.data.scope.origin_mode = mode;
    expect(
      isSub2APIOperationResponse(
        fixture.operation,
        fixture.projectId,
        fixture.command,
        fixture.operation.request_id,
      ),
    ).toBe(false);
    expect(
      isSub2APIApprovalResponse(
        fixture.approval,
        fixture.projectId,
        fixture.command,
        fixture.approval.request_id,
      ),
    ).toBe(false);
  });
  it("does not relax existing content/identity binding", () => {
    const fixture = structuredClone(fixtures[1]!);
    if (!isSub2APIQueueCommand(fixture.command)) throw new Error("invalid fixture command");
    fixture.operation.data.scope.origin_hash = `sha256:${"0".repeat(64)}`;
    expect(
      isSub2APIOperationResponse(
        fixture.operation,
        fixture.projectId,
        fixture.command,
        fixture.operation.request_id,
      ),
    ).toBe(false);
  });
});

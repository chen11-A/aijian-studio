import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  directorGateway,
  directorGenerate,
  directorOperation,
  directorStorage,
} from "../../test/officialDirectorFixture";
import {
  clearDirectorCommand,
  directorGenerationCommand,
  matchesDirectorCommand,
  persistDirectorCommand,
  readDirectorJournal,
  validDirectorCommand,
  type DirectorCommand,
} from "./officialDirectorJournal";
import {
  commitDirectorCommand,
  recoverDirectorCommand,
  sameDirectorInputs,
} from "./officialDirectorProposal";
import { directorOutcomeMessage, prepareDirectorAction } from "./officialDirectorAction";
import { officialDirectorBridge } from "./officialDirectorGateway";

beforeEach(() => vi.stubGlobal("crypto", webcrypto));
afterEach(() => {
  vi.unstubAllGlobals();
  delete window.aijianOfficialDirector;
});
function setup() {
  const operation = directorOperation();
  const fixture = directorGateway([operation]);
  const storage = directorStorage();
  const command = directorGenerationCommand(directorGenerate(operation));
  return {
    ...fixture,
    operation,
    storage,
    command,
    project: operation.project_id,
    episode: operation.episode_id,
  };
}
function decision(
  kind: "ADOPT" | "REJECT" = "ADOPT",
): Exclude<DirectorCommand, { kind: "GENERATE" }> {
  const operation = directorOperation();
  if (!operation.proposal) throw new Error("No fixture proposal");
  return {
    kind,
    operationId: operation.request.operation_id,
    versionId: operation.proposal.version_id,
    contentHash: operation.proposal.content_hash,
    reason: kind === "REJECT" ? "需保留长镜头节奏" : null,
  };
}
describe("official director journal and read-only recovery", () => {
  it("strictly validates bounded minimal journals without treating them as replayable requests", () => {
    expect(validDirectorCommand(decision())).toBe(true);
    expect(validDirectorCommand(decision("REJECT"))).toBe(true);
    expect(validDirectorCommand(null)).toBe(false);
    expect(validDirectorCommand({ ...decision(), extra: true })).toBe(false);
    expect(validDirectorCommand({ ...decision(), operationId: "not-an-id" })).toBe(false);
    expect(validDirectorCommand({ ...decision(), versionId: "different" })).toBe(false);
    expect(validDirectorCommand({ ...decision(), contentHash: "bad" })).toBe(false);
    expect(validDirectorCommand({ ...decision("REJECT"), reason: " " })).toBe(false);
    expect(validDirectorCommand({ ...decision("REJECT"), reason: "x".repeat(2001) })).toBe(false);
    expect(validDirectorCommand({ ...decision("REJECT"), reason: "a\0b" })).toBe(false);
    const { command } = setup();
    expect(validDirectorCommand(command)).toBe(true);
    expect(validDirectorCommand({ ...command, expectedRequest: "{broken" })).toBe(false);
    expect(validDirectorCommand({ ...command, expectedRequest: "[]" })).toBe(false);
    expect(validDirectorCommand({ ...command, expectedRequest: "x".repeat(1_000_001) })).toBe(
      false,
    );
  });
  it("preserves unreadable, competing and inaccessible storage and never silently replaces a pending operation", () => {
    const fixture = setup();
    const key = `aivora.official-director.pending.v1.${fixture.project}.${fixture.episode}`;
    expect(readDirectorJournal(null, fixture.project, fixture.episode).kind).toBe("BLOCKED");
    fixture.storage.setItem(key, "broken");
    expect(readDirectorJournal(fixture.storage, fixture.project, fixture.episode).kind).toBe(
      "BLOCKED",
    );
    expect(
      persistDirectorCommand(fixture.storage, fixture.project, fixture.episode, fixture.command),
    ).toBe(false);
    expect(fixture.storage.getItem(key)).toBe("broken");
    fixture.storage.setItem(key, "{}");
    expect(readDirectorJournal(fixture.storage, fixture.project, fixture.episode).kind).toBe(
      "BLOCKED",
    );
    fixture.storage.setItem(key, "x".repeat(1_000_501));
    expect(readDirectorJournal(fixture.storage, fixture.project, fixture.episode).kind).toBe(
      "BLOCKED",
    );
    fixture.storage.removeItem(key);
    expect(
      persistDirectorCommand(fixture.storage, fixture.project, fixture.episode, fixture.command),
    ).toBe(true);
    expect(
      persistDirectorCommand(fixture.storage, fixture.project, fixture.episode, decision()),
    ).toBe(false);
    expect(
      clearDirectorCommand(fixture.storage, fixture.project, fixture.episode, decision()),
    ).toBe(false);
    expect(
      clearDirectorCommand(
        {
          ...fixture.storage,
          removeItem: () => {
            throw new Error("denied");
          },
        },
        fixture.project,
        fixture.episode,
        fixture.command,
      ),
    ).toBe(false);
    expect(
      readDirectorJournal(
        {
          ...fixture.storage,
          getItem: () => {
            throw new Error("denied");
          },
        },
        fixture.project,
        fixture.episode,
      ).kind,
    ).toBe("BLOCKED");
    const empty = directorStorage();
    expect(
      persistDirectorCommand(
        {
          ...empty,
          setItem: () => {
            throw new Error("full");
          },
        },
        fixture.project,
        fixture.episode,
        fixture.command,
      ),
    ).toBe(false);
  });
  it("checks matching authority/options and exact reviewed proposal/decision receipts", () => {
    const fixture = setup();
    expect(matchesDirectorCommand(fixture.operation, fixture.command)).toBe(true);
    expect(
      matchesDirectorCommand(
        { ...fixture.operation, request: { ...fixture.operation.request, intent: "changed" } },
        fixture.command,
      ),
    ).toBe(false);
    expect(
      matchesDirectorCommand(
        {
          ...fixture.operation,
          request: {
            ...fixture.operation.request,
            operation_id: "323e4567-e89b-42d3-a456-426614174000",
          },
        },
        fixture.command,
      ),
    ).toBe(false);
    expect(matchesDirectorCommand(fixture.operation, decision())).toBe(false);
    const adopted = {
      ...fixture.operation,
      adoption: {
        actor_id: "local-user",
        adopted_at: "2026-10-08T12:00:00Z",
        proposal_version_id: decision().versionId,
        proposal_content_hash: decision().contentHash,
        storyboard_version_id: `ver_${"3".repeat(32)}`,
        storyboard_content_hash: `sha256:${"4".repeat(64)}`,
      },
    };
    expect(matchesDirectorCommand(adopted, decision())).toBe(true);
    expect(matchesDirectorCommand({ ...fixture.operation, proposal: null }, decision())).toBe(
      false,
    );
    const rejected = {
      ...fixture.operation,
      rejection: {
        actor_id: "local-user",
        rejected_at: "2026-10-08T12:00:00Z",
        reason: "需保留长镜头节奏",
      },
    };
    expect(matchesDirectorCommand(rejected, decision("REJECT"))).toBe(true);
    expect(
      matchesDirectorCommand(
        { ...rejected, rejection: { ...rejected.rejection, reason: "other" } },
        decision("REJECT"),
      ),
    ).toBe(false);
    expect(sameDirectorInputs(fixture.inputs, fixture.operation)).toBe(true);
    expect(sameDirectorInputs(null, fixture.operation)).toBe(false);
    expect(
      sameDirectorInputs(
        {
          ...fixture.inputs,
          storyboard_base: {
            version_id: `ver_${"3".repeat(32)}`,
            content_hash: `sha256:${"4".repeat(64)}`,
            head_revision: 2,
          },
        },
        fixture.operation,
      ),
    ).toBe(false);
  });
  it("recovers a confirmed operation through get only and refuses absent, wrong-scope or unconfirmed records", async () => {
    const fixture = setup();
    expect(
      (
        await recoverDirectorCommand(
          fixture.bridge,
          fixture.storage,
          fixture.project,
          fixture.episode,
        )
      ).kind,
    ).toBe("BLOCKED");
    persistDirectorCommand(fixture.storage, fixture.project, fixture.episode, fixture.command);
    vi.mocked(fixture.bridge.get).mockResolvedValueOnce({ kind: "UNKNOWN" });
    expect(
      (
        await recoverDirectorCommand(
          fixture.bridge,
          fixture.storage,
          fixture.project,
          fixture.episode,
        )
      ).kind,
    ).toBe("UNKNOWN");
    vi.mocked(fixture.bridge.get).mockResolvedValueOnce({
      kind: "OK",
      operation: { ...fixture.operation, episode_id: `ep_${"f".repeat(32)}` },
    });
    expect(
      (
        await recoverDirectorCommand(
          fixture.bridge,
          fixture.storage,
          fixture.project,
          fixture.episode,
        )
      ).kind,
    ).toBe("UNKNOWN");
    vi.mocked(fixture.bridge.get).mockRejectedValueOnce(new Error("read failed"));
    expect(
      (
        await recoverDirectorCommand(
          fixture.bridge,
          fixture.storage,
          fixture.project,
          fixture.episode,
        )
      ).kind,
    ).toBe("UNKNOWN");
    expect(readDirectorJournal(fixture.storage, fixture.project, fixture.episode).kind).toBe(
      "PENDING",
    );
    expect(
      (
        await recoverDirectorCommand(
          fixture.bridge,
          fixture.storage,
          fixture.project,
          fixture.episode,
        )
      ).kind,
    ).toBe("CONFIRMED");
    expect(readDirectorJournal(fixture.storage, fixture.project, fixture.episode).kind).toBe(
      "EMPTY",
    );
    expect(fixture.bridge.generate).not.toHaveBeenCalled();
    expect(fixture.bridge.adopt).not.toHaveBeenCalled();
    expect(fixture.bridge.reject).not.toHaveBeenCalled();
  });
  it("never transmits before journal persistence and live guard revalidation", async () => {
    const fixture = setup();
    const transmit = vi.fn(async () => ({ kind: "OK" as const, operation: fixture.operation }));
    const params = { ...fixture, guard: () => false, transmit };
    expect((await commitDirectorCommand(params)).kind).toBe("BLOCKED");
    let checks = 0;
    expect((await commitDirectorCommand({ ...params, guard: () => ++checks === 1 })).kind).toBe(
      "BLOCKED",
    );
    expect(transmit).not.toHaveBeenCalled();
    expect(readDirectorJournal(fixture.storage, fixture.project, fixture.episode).kind).toBe(
      "EMPTY",
    );
    const inaccessible = {
      ...fixture.storage,
      setItem: () => {
        throw new Error("full");
      },
    };
    expect(
      (await commitDirectorCommand({ ...params, storage: inaccessible, guard: () => true })).kind,
    ).toBe("BLOCKED");
    expect(transmit).not.toHaveBeenCalled();
  });
  it("keeps uncertain outcomes and does not resend even when the status read is still missing", async () => {
    const fixture = setup();
    const transmit = vi.fn(async () => ({ kind: "UNKNOWN" as const }));
    const params = { ...fixture, guard: () => true, transmit };
    expect((await commitDirectorCommand(params)).kind).toBe("UNKNOWN");
    expect((await commitDirectorCommand(params)).kind).toBe("BLOCKED");
    expect(transmit).toHaveBeenCalledTimes(1);
    vi.mocked(fixture.bridge.get).mockResolvedValue({ kind: "UNKNOWN" });
    expect(
      (
        await recoverDirectorCommand(
          fixture.bridge,
          fixture.storage,
          fixture.project,
          fixture.episode,
        )
      ).kind,
    ).toBe("UNKNOWN");
    expect(readDirectorJournal(fixture.storage, fixture.project, fixture.episode).kind).toBe(
      "PENDING",
    );
  });
  it("only closes a definite matching NOT_SENT and verifies OK by immutable readback", async () => {
    const fixture = setup();
    let result = await commitDirectorCommand({
      ...fixture,
      guard: () => true,
      transmit: async () => ({
        kind: "NOT_SENT",
        code: "CANCELLED",
        operationId: fixture.command.operationId,
      }),
    });
    expect(result.kind).toBe("NOT_SENT");
    expect(readDirectorJournal(fixture.storage, fixture.project, fixture.episode).kind).toBe(
      "EMPTY",
    );
    result = await commitDirectorCommand({
      ...fixture,
      guard: () => true,
      transmit: async () => ({ kind: "OK", operation: fixture.operation }),
    });
    expect(result.kind).toBe("CONFIRMED");
    expect(fixture.bridge.get).toHaveBeenCalledTimes(1);
    result = await commitDirectorCommand({
      ...fixture,
      guard: () => true,
      transmit: async () => ({
        kind: "NOT_SENT",
        code: "CANCELLED",
        operationId: "323e4567-e89b-42d3-a456-426614174000",
      }),
    });
    expect(result.kind).toBe("UNKNOWN");
  });
  it("clears a definite decision failure while keeping an ambiguous decision and its reason", async () => {
    const fixture = setup();
    const params = { ...fixture, command: decision("REJECT"), guard: () => true };
    expect(
      (
        await commitDirectorCommand({
          ...params,
          transmit: async () => ({ kind: "ERROR", code: "SHOT_PLAN_SCRIPT_STALE" }),
        })
      ).kind,
    ).toBe("REJECTED");
    expect(readDirectorJournal(fixture.storage, fixture.project, fixture.episode).kind).toBe(
      "EMPTY",
    );
    expect(
      (
        await commitDirectorCommand({
          ...params,
          transmit: async () => {
            throw new Error("lost decision");
          },
        })
      ).kind,
    ).toBe("UNKNOWN");
    expect(readDirectorJournal(fixture.storage, fixture.project, fixture.episode)).toEqual({
      kind: "PENDING",
      command: decision("REJECT"),
    });
  });
});
describe("narrow native director actions", () => {
  it("requires complete native methods and never substitutes an HTTP gateway", () => {
    expect(officialDirectorBridge()).toBeNull();
    const fixture = setup();
    window.aijianOfficialDirector = fixture.bridge;
    expect(officialDirectorBridge()).toBe(fixture.bridge);
    window.aijianOfficialDirector = {
      ...fixture.bridge,
      reject: undefined,
    } as unknown as typeof fixture.bridge;
    expect(officialDirectorBridge()).toBeNull();
  });
  it("validates generation bounds and decision readiness before constructing a mutation", async () => {
    const fixture = setup();
    const args = {
      kind: "GENERATE" as const,
      bridge: fixture.bridge,
      projectId: fixture.project,
      episodeId: fixture.episode,
      preparation: fixture.inputs,
      model: "fixture-model",
      intent: "设计镜头",
      count: 1000,
      pacing: "SLOW" as const,
      reason: "驳回理由",
      operation: fixture.operation,
    };
    expect(prepareDirectorAction(args)?.command.kind).toBe("GENERATE");
    for (const patch of [
      { preparation: null },
      { model: "" },
      { intent: " " },
      { intent: "x".repeat(4001) },
      { count: 0 },
      { count: 1001 },
      { count: 1.1 },
    ])
      expect(prepareDirectorAction({ ...args, ...patch })).toBeNull();
    const adopt = prepareDirectorAction({ ...args, kind: "ADOPT" });
    expect(adopt?.command.kind).toBe("ADOPT");
    await adopt?.transmit();
    expect(fixture.bridge.adopt).toHaveBeenCalledTimes(1);
    const reject = prepareDirectorAction({ ...args, kind: "REJECT" });
    await reject?.transmit();
    expect(fixture.bridge.reject).toHaveBeenCalledTimes(1);
    expect(prepareDirectorAction({ ...args, kind: "REJECT", reason: " " })).toBeNull();
    expect(prepareDirectorAction({ ...args, kind: "ADOPT", preparation: null })).toBeNull();
    expect(
      prepareDirectorAction({
        ...args,
        kind: "ADOPT",
        operation: { ...fixture.operation, status: "INVALID" },
      }),
    ).toBeNull();
  });
  it("labels outcomes truthfully without treating UNKNOWN or invalid output as generation success", () => {
    const operation = directorOperation();
    expect(directorOutcomeMessage({ kind: "BLOCKED", message: "blocked" })).toBe("blocked");
    expect(directorOutcomeMessage({ kind: "NOT_SENT", code: "CANCELLED" })).toContain("未发送");
    expect(directorOutcomeMessage({ kind: "REJECTED", code: "STALE" })).toContain("STALE");
    expect(directorOutcomeMessage({ kind: "UNKNOWN" })).toContain("不会自动重发");
    expect(directorOutcomeMessage({ kind: "CONFIRMED", operation })).toContain("待审阅提案");
    for (const [status, text] of [
      ["INVALID", "未通过校验"],
      ["REMOTE_UNKNOWN", "发送结果未知"],
      ["NOT_SENT", "未发送"],
    ] as const)
      expect(
        directorOutcomeMessage({ kind: "CONFIRMED", operation: { ...operation, status } }),
      ).toContain(text);
    expect(
      directorOutcomeMessage({
        kind: "CONFIRMED",
        operation: {
          ...operation,
          rejection: { actor_id: "user", rejected_at: "2026-10-08T10:00:00Z", reason: "理由" },
        },
      }),
    ).toContain("人工驳回");
  });
});

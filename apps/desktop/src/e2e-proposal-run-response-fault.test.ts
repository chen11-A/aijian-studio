import { describe, expect, test, vi } from "vitest";

import {
  createE2EProposalRunResponseFault,
  shouldEnableE2EProposalRunResponseFault,
} from "./e2e-proposal-run-response-fault";

const proposalRunUrl =
  "http://127.0.0.1:43129/api/v1/projects/prj_11111111111111111111111111111111/proposal-runs";

describe("proposal run E2E response fault", () => {
  test("is available only to an unpackaged isolated E2E profile", () => {
    expect(
      shouldEnableE2EProposalRunResponseFault({
        isPackaged: false,
        hasIsolatedUserDataProfile: true,
        mode: "after-commit-once",
      }),
    ).toBe(true);
    expect(
      shouldEnableE2EProposalRunResponseFault({
        isPackaged: true,
        hasIsolatedUserDataProfile: true,
        mode: "after-commit-once",
      }),
    ).toBe(false);
    expect(
      shouldEnableE2EProposalRunResponseFault({
        isPackaged: false,
        hasIsolatedUserDataProfile: false,
        mode: "after-commit-once",
      }),
    ).toBe(false);
    expect(
      shouldEnableE2EProposalRunResponseFault({
        isPackaged: false,
        hasIsolatedUserDataProfile: true,
        mode: "anything-else",
      }),
    ).toBe(false);
  });

  test("loses exactly the first fresh proposal-run response after the server returns it", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ committed: true }, { status: 201 }))
      .mockResolvedValueOnce(Response.json({ replayed: true }, { status: 200 }));
    const faulted = createE2EProposalRunResponseFault(fetcher, true);

    await expect(faulted(proposalRunUrl, { method: "POST" })).rejects.toThrow(
      "simulated response loss after proposal run commit",
    );
    const replay = await faulted(proposalRunUrl, { method: "POST" });

    expect(replay.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  test("never loses unrelated, failed, replayed, or disabled responses", async () => {
    const responses = [
      Response.json({}, { status: 201 }),
      Response.json({}, { status: 409 }),
      Response.json({}, { status: 200 }),
      Response.json({}, { status: 201 }),
    ];
    const fetcher = vi.fn(async () => responses.shift()!);
    const faulted = createE2EProposalRunResponseFault(fetcher, true);

    await expect(
      faulted("http://127.0.0.1:43129/api/v1/projects", { method: "POST" }),
    ).resolves.toHaveProperty("status", 201);
    await expect(faulted(proposalRunUrl, { method: "POST" })).resolves.toHaveProperty(
      "status",
      409,
    );
    await expect(faulted(proposalRunUrl, { method: "POST" })).resolves.toHaveProperty(
      "status",
      200,
    );
    await expect(
      createE2EProposalRunResponseFault(fetcher, false)(proposalRunUrl, { method: "POST" }),
    ).resolves.toHaveProperty("status", 201);
  });
});

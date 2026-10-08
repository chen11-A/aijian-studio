import { describe, expect, test, vi } from "vitest";

import {
  createE2EFakeTimelineRunResponseFault,
  shouldEnableE2EFakeTimelineRunResponseFault,
} from "./e2e-fake-timeline-run-response-fault";

const fakeTimelineRunUrl =
  "http://127.0.0.1:43129/api/v1/projects/prj_11111111111111111111111111111111/fake-timeline-runs";

describe("fake timeline run E2E response fault", () => {
  test("is available only to an unpackaged isolated E2E profile with the exact mode", () => {
    expect(
      shouldEnableE2EFakeTimelineRunResponseFault({
        isPackaged: false,
        hasIsolatedUserDataProfile: true,
        mode: "after-201-once",
      }),
    ).toBe(true);
    expect(
      shouldEnableE2EFakeTimelineRunResponseFault({
        isPackaged: true,
        hasIsolatedUserDataProfile: true,
        mode: "after-201-once",
      }),
    ).toBe(false);
    expect(
      shouldEnableE2EFakeTimelineRunResponseFault({
        isPackaged: false,
        hasIsolatedUserDataProfile: false,
        mode: "after-201-once",
      }),
    ).toBe(false);
    expect(
      shouldEnableE2EFakeTimelineRunResponseFault({
        isPackaged: false,
        hasIsolatedUserDataProfile: true,
        mode: "after-commit-once",
      }),
    ).toBe(false);
    expect(
      shouldEnableE2EFakeTimelineRunResponseFault({
        isPackaged: false,
        hasIsolatedUserDataProfile: true,
        mode: undefined,
      }),
    ).toBe(false);
  });

  test("loses exactly the first fresh fake-timeline-run response after the server returns 201", async () => {
    const body = { data: { created: true } };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json(body, { status: 201 }))
      .mockResolvedValueOnce(Response.json({ replayed: true }, { status: 200 }))
      .mockResolvedValueOnce(Response.json({ created: "again" }, { status: 201 }));
    const init = { method: "POST", body: JSON.stringify({ frozen: true }) };
    const faulted = createE2EFakeTimelineRunResponseFault(fetcher, true);

    await expect(faulted(fakeTimelineRunUrl, init)).rejects.toEqual(
      new TypeError("simulated response loss after fake timeline run create"),
    );
    const replay = await faulted(fakeTimelineRunUrl, { method: "POST" });
    const laterFresh = await faulted(fakeTimelineRunUrl, { method: "POST" });

    expect(replay.status).toBe(200);
    expect(laterFresh.status).toBe(201);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[0]?.[1]).toBe(init);
  });

  test("never loses unrelated, failed, replayed, or disabled responses", async () => {
    const responses = [
      Response.json({}, { status: 201 }),
      Response.json({}, { status: 201 }),
      Response.json({}, { status: 201 }),
      Response.json({}, { status: 201 }),
      Response.json({}, { status: 409 }),
      Response.json({}, { status: 200 }),
      Response.json({}, { status: 201 }),
    ];
    const fetcher = vi.fn(async () => responses.shift()!);
    const faulted = createE2EFakeTimelineRunResponseFault(fetcher, true);

    await expect(
      faulted("http://127.0.0.1:43129/api/v1/projects", { method: "POST" }),
    ).resolves.toHaveProperty("status", 201);
    await expect(
      faulted(
        "http://127.0.0.1:43129/api/v1/projects/prj_11111111111111111111111111111111/proposal-runs",
        { method: "POST" },
      ),
    ).resolves.toHaveProperty("status", 201);
    await expect(faulted(fakeTimelineRunUrl, { method: "GET" })).resolves.toHaveProperty(
      "status",
      201,
    );
    await expect(
      faulted(`${fakeTimelineRunUrl}?extra=1`, { method: "POST" }),
    ).resolves.toHaveProperty("status", 201);
    await expect(faulted(fakeTimelineRunUrl, { method: "POST" })).resolves.toHaveProperty(
      "status",
      409,
    );
    await expect(faulted(fakeTimelineRunUrl, { method: "POST" })).resolves.toHaveProperty(
      "status",
      200,
    );
    await expect(
      createE2EFakeTimelineRunResponseFault(fetcher, false)(fakeTimelineRunUrl, { method: "POST" }),
    ).resolves.toHaveProperty("status", 201);
  });

  test("never matches another origin or a non-canonical project path", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({}, { status: 201 }));
    const faulted = createE2EFakeTimelineRunResponseFault(fetcher, true);

    await expect(
      faulted(
        "https://127.0.0.1:43129/api/v1/projects/prj_11111111111111111111111111111111/fake-timeline-runs",
        { method: "POST" },
      ),
    ).resolves.toHaveProperty("status", 201);
    await expect(
      faulted(
        "http://localhost:43129/api/v1/projects/prj_11111111111111111111111111111111/fake-timeline-runs",
        { method: "POST" },
      ),
    ).resolves.toHaveProperty("status", 201);
    await expect(
      faulted(
        "http://127.0.0.1:43129/api/v1/projects/prj_11111111111111111111111111111111/fake-timeline-runs#frag",
        { method: "POST" },
      ),
    ).resolves.toHaveProperty("status", 201);
    await expect(
      faulted("http://127.0.0.1:43129/api/v1/projects/not-canonical/fake-timeline-runs", {
        method: "POST",
      }),
    ).resolves.toHaveProperty("status", 201);
  });
});

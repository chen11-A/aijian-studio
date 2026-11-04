import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  impactCanonical,
  impactOperation,
  impactReport,
  IMPACT_CHANNELS,
  type ScriptImpactGateway,
} from "@aijian/contracts/script-confirmation-impact";
import { createLocalApiClient } from "./api-client";
import { registerScriptConfirmationImpactHandlers } from "./script-confirmation-impact-ipc";

const f = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "../../packages/contracts/fixtures/script-confirmation-impact.json"),
    "utf8",
  ),
);
const envelope = (data: unknown) => ({ data, request_id: f.request_id });
const response = (data: unknown, status = 200, requestId = f.request_id) =>
  new Response(JSON.stringify(envelope(data)), {
    status,
    headers: { "Content-Type": "application/json", "X-Request-ID": requestId },
  });
const session = { origin: "http://127.0.0.1:43219", token: "t".repeat(43) };

describe("immutable script confirmation source facts", () => {
  it("accepts actual closed backend bytes and canonical hash, including original uppercase UUID", () => {
    expect(impactReport(f.report, f.project_id)).toBe(true);
    expect(
      impactOperation(f.operation, f.project_id, f.episode_id, f.operation_id, f.payload),
    ).toBe(true);
    expect(
      `sha256:${createHash("sha256").update(impactCanonical(f.report.assessment)).digest("hex")}`,
    ).toBe(f.report.assessment_hash);
  });
  it("authenticates three GETs and sends full original input without any actor override", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(f.page))
      .mockResolvedValueOnce(response(f.report))
      .mockResolvedValueOnce(response(f.operation));
    const client = createLocalApiClient(fetcher, session);
    expect((await client.listScriptConfirmationImpacts(f.project_id)).kind).toBe("FOUND");
    expect((await client.getScriptConfirmationImpact(f.project_id, f.report.report_id)).kind).toBe(
      "FOUND",
    );
    expect(
      (
        await client.getEpisodeScriptConfirmationOperation(
          f.project_id,
          f.episode_id,
          f.operation_id,
          f.payload,
        )
      ).kind,
    ).toBe("FOUND");
    for (const [url, init] of fetcher.mock.calls) {
      expect(url).toContain(session.origin);
      expect(init.method).toBe("GET");
      expect(init.headers).toMatchObject({
        Authorization: `Bearer ${session.token}`,
        Origin: "app://aijian",
      });
      expect(init.body).toBeUndefined();
      expect(url).not.toContain("actor");
    }
    const originalUrl = new URL(String(fetcher.mock.calls[2]![0]));
    expect(originalUrl.pathname).toContain(f.operation_id);
    expect(originalUrl.searchParams.get("expected_content_hash")).toBe(
      f.payload.expected_content_hash,
    );
    expect(originalUrl.searchParams.get("expected_head_revision")).toBe(
      String(f.payload.expected_head_revision),
    );
  });
  it.each([401, 403, 404, 409, 422, 500])(
    "original GET %s remains UNKNOWN and never POSTs",
    async (status) => {
      const fetcher = vi.fn().mockResolvedValue(response({ missing: true }, status));
      expect(
        await createLocalApiClient(fetcher, session).getEpisodeScriptConfirmationOperation(
          f.project_id,
          f.episode_id,
          f.operation_id,
          f.payload,
        ),
      ).toEqual({ kind: "REMOTE_UNKNOWN" });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0]![1].method).toBe("GET");
    },
  );
  it.each([
    "hash",
    "actor",
    "input",
    "uuid",
    "extra",
    "foreign-edge",
    "weakest-path",
    "schema",
    "missing-report",
  ])("rejects bad original evidence: %s", async (kind) => {
    const data = structuredClone(f.operation);
    if (kind === "hash") data.lookup.report.assessment_hash = `sha256:${"0".repeat(64)}`;
    if (kind === "actor") data.lookup.confirmation.actor_id = "another-actor";
    if (kind === "input") data.payload.expected_head_revision += 1;
    if (kind === "uuid") data.operation_id = f.operation_id.toLowerCase();
    if (kind === "extra") data.actor_id = "local-user";
    if (kind === "foreign-edge")
      data.lookup.report.assessment.targets[0].reasons[0].edges[0].project_id = `prj_${"f".repeat(32)}`;
    if (kind === "weakest-path")
      data.lookup.report.assessment.targets[0].reasons[0].effective_impact = "advisory";
    if (kind === "schema") data.lookup.report.assessment.schema_version = "0.9.0";
    if (kind === "missing-report") data.lookup.report = null;
    const fetcher = vi.fn().mockResolvedValue(response(data));
    expect(
      await createLocalApiClient(fetcher, session).getEpisodeScriptConfirmationOperation(
        f.project_id,
        f.episode_id,
        f.operation_id,
        f.payload,
      ),
    ).toEqual({ kind: "REMOTE_UNKNOWN" });
  });
  it("rejects a response request-id mismatch and oversized original body", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(f.operation, 200, "00000000-0000-4000-8000-000000000000"))
      .mockResolvedValueOnce(
        new Response("{}", {
          headers: { "Content-Length": String(17 * 1024 * 1024), "X-Request-ID": f.request_id },
        }),
      );
    const client = createLocalApiClient(fetcher, session);
    expect(
      (
        await client.getEpisodeScriptConfirmationOperation(
          f.project_id,
          f.episode_id,
          f.operation_id,
          f.payload,
        )
      ).kind,
    ).toBe("REMOTE_UNKNOWN");
    expect(
      (
        await client.getEpisodeScriptConfirmationOperation(
          f.project_id,
          f.episode_id,
          f.operation_id,
          f.payload,
        )
      ).kind,
    ).toBe("REMOTE_UNKNOWN");
  });
  it("IPC admits only canonical arguments in the authorized top frame", async () => {
    const handlers = new Map<string, (event: boolean, ...args: unknown[]) => Promise<unknown>>();
    const client: ScriptImpactGateway = {
      listScriptConfirmationImpacts: vi.fn(),
      getScriptConfirmationImpact: vi.fn(),
      getEpisodeScriptConfirmationOperation: vi.fn(),
    };
    registerScriptConfirmationImpactHandlers<boolean>(
      (channel, handler) => handlers.set(channel, handler),
      () => client,
      (event) => event,
    );
    await expect(
      handlers.get(IMPACT_CHANNELS.operation)!(
        false,
        f.project_id,
        f.episode_id,
        f.operation_id,
        f.payload,
      ),
    ).rejects.toThrow("top frame");
    await expect(
      handlers.get(IMPACT_CHANNELS.operation)!(true, f.project_id, f.episode_id, f.operation_id, {
        ...f.payload,
        actor_id: "local-user",
      }),
    ).rejects.toThrow("arguments");
    await expect(
      handlers.get(IMPACT_CHANNELS.operation)!(
        true,
        f.project_id,
        f.episode_id,
        f.operation_id,
        f.payload,
        "local-user",
      ),
    ).rejects.toThrow("arguments");
    await handlers.get(IMPACT_CHANNELS.operation)!(
      true,
      f.project_id,
      f.episode_id,
      f.operation_id,
      f.payload,
    );
    expect(client.getEpisodeScriptConfirmationOperation).toHaveBeenCalledExactlyOnceWith(
      f.project_id,
      f.episode_id,
      f.operation_id,
      f.payload,
    );
    expect(client.listScriptConfirmationImpacts).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi } from "vitest";
import fixture from "./invalidation-consumer.testFixture.json";
import { createLocalApiClient } from "./api-client";
import { registerInvalidationConsumerHandler } from "./invalidation-operation-ipc";
import { invalidationConsumerResponse } from "@aijian/contracts/invalidation-consumer";
const identity = fixture.identity;
function client(payload: unknown = fixture.response, requestId = fixture.response.request_id) {
  const http = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "X-Request-ID": requestId },
    }),
  );
  return {
    http,
    api: createLocalApiClient(http, { origin: "http://127.0.0.1:43123", token: "x".repeat(43) }),
  };
}
describe("native exact affected-version inspection", () => {
  it("reads the real persisted projection once by saved path and assessment", async () => {
    expect(invalidationConsumerResponse(fixture.response, identity)).toBe(true);
    const { api, http } = client();
    expect(await api.inspectInvalidationConsumer(identity)).toEqual(fixture.response);
    expect(http.mock.calls[0]?.[0]).toBe(
      `http://127.0.0.1:43123/api/v1/projects/${identity.project_id}/invalidation-operations/${identity.operation_id}/paths/${identity.path_id}/consumer`,
    );
    expect(http).toHaveBeenCalledTimes(1);
    expect(http.mock.calls[0]?.[1]?.method).toBeUndefined();
  });
  it.each([
    "project",
    "path",
    "version",
    "assessment",
    "shot-source",
    "episode-spelling",
    "extra",
    "request-id",
  ])("rejects %s contradictions without another request", async (fault) => {
    const response = structuredClone(fixture.response);
    if (fault === "project") response.data.project_id = "prj_" + "0".repeat(32);
    if (fault === "path") response.data.path_id = "ivp_" + "0".repeat(32);
    if (fault === "version") response.data.version_id = "ver_" + "0".repeat(32);
    if (fault === "assessment") response.data.assessment_hash = "sha256:" + "0".repeat(64);
    if (fault === "shot-source")
      response.data.shots[0]!.storyboard_version_id = "ver_" + "0".repeat(32);
    if (fault === "episode-spelling") response.data.episode.position = "01";
    if (fault === "extra") Object.assign(response.data, { approved: true });
    const { api, http } = client(
      response,
      fault === "request-id" ? "11111111-1111-4111-8111-111111111111" : response.request_id,
    );
    await expect(api.inspectInvalidationConsumer(identity)).rejects.toThrow("unknown");
    expect(http).toHaveBeenCalledTimes(1);
  });
  it("authorizes first, rejects expanded IPC arguments, and forwards the one exact identity", async () => {
    let handler!: (e: object, ...args: unknown[]) => Promise<unknown>;
    const inspect = vi.fn().mockResolvedValue(fixture.response);
    const authorized = vi.fn(() => ({ inspectInvalidationConsumer: inspect }));
    registerInvalidationConsumerHandler((channel, listener) => {
      expect(channel).toBe("invalidation-operations:inspect-consumer");
      handler = listener;
    }, authorized);
    for (const args of [
      [],
      [identity, "extra"],
      [{ ...identity, asset_path: "/tmp/forbidden" }],
      [{ ...identity, version_id: "latest" }],
    ])
      await expect(handler({}, ...args)).rejects.toThrow("exact saved path");
    expect(inspect).not.toHaveBeenCalled();
    expect(authorized).toHaveBeenCalledTimes(4);
    expect(await handler({}, identity)).toEqual(fixture.response);
    expect(inspect).toHaveBeenCalledWith(identity);
    registerInvalidationConsumerHandler(
      (_channel, listener) => {
        handler = listener;
      },
      () => {
        throw new Error("unauthorized sender");
      },
    );
    await expect(handler({}, identity, "extra")).rejects.toThrow("unauthorized sender");
  });
});

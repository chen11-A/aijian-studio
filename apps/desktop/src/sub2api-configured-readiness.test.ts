import { describe, expect, it, vi } from "vitest";
import { createLocalApiClient } from "./api-client";
import { isSub2APIConfiguredReadinessResponse } from "./sub2api-configured-readiness-contract";

const connectionId = `pcn_${"a".repeat(32)}`;
const modelId = "synthetic-text-model";
const requestId = "00000000-0000-4000-8000-000000000001";
function receipt(originMode: unknown) {
  return {
    data: {
      connection_id: connectionId,
      connection_revision: 1,
      origin_mode: originMode,
      model_id: modelId,
      credential_status: "CONFIGURED",
      runtime_status: "WAITING_FOR_EXPLICIT_APPROVAL",
      local_preconditions_met: true,
      reasons: [] as string[],
      provider_observation: "NOT_CHECKED",
      model_entitlement: "UNKNOWN",
    },
    request_id: requestId,
  };
}

describe("Sub2API configured readiness wire contract", () => {
  it.each(["PUBLIC_HTTPS", "LOCAL_LOOPBACK_HTTP"])(
    "accepts backend %s mode without calling the provider",
    async (mode) => {
      const body = receipt(mode);
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify(body), {
          headers: { "Content-Type": "application/json", "X-Request-ID": requestId },
        }),
      );
      const client = createLocalApiClient(fetcher, {
        origin: "http://127.0.0.1:8000",
        token: "t".repeat(43),
      });
      expect(await client.readSub2APIConfiguredReadiness(connectionId, modelId)).toEqual({
        kind: "READ",
        receipt: body,
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0]?.[0]).toBe(
        `http://127.0.0.1:8000/api/v1/provider-connections/${connectionId}/sub2api-configured-readiness?model_id=${modelId}`,
      );
    },
  );

  it("allows null only for a non-Sub2API diagnostic", () => {
    const body = receipt(null);
    body.data.local_preconditions_met = false;
    body.data.reasons = ["NOT_SUB2API"];
    expect(isSub2APIConfiguredReadinessResponse(body, connectionId, modelId, requestId)).toBe(true);
    body.data.reasons = ["CONNECTION_DISABLED"];
    expect(isSub2APIConfiguredReadinessResponse(body, connectionId, modelId, requestId)).toBe(
      false,
    );
  });

  it.each([undefined, "localhost", "UNKNOWN", false, null])(
    "rejects missing or invalid Sub2API origin mode %s",
    (mode) => {
      expect(
        isSub2APIConfiguredReadinessResponse(receipt(mode), connectionId, modelId, requestId),
      ).toBe(false);
    },
  );

  it("keeps exact identity and no-provider-observation requirements", () => {
    const valid = receipt("PUBLIC_HTTPS");
    for (const data of [
      { ...valid.data, connection_id: `pcn_${"b".repeat(32)}` },
      { ...valid.data, model_id: "another-model" },
      { ...valid.data, provider_observation: "SUCCEEDED" },
      { ...valid.data, model_entitlement: "AVAILABLE" },
      { ...valid.data, api_key: "should-not-be-returned" },
      { ...valid.data, reasons: ["NOT_SUB2API"], local_preconditions_met: false },
    ])
      expect(
        isSub2APIConfiguredReadinessResponse({ ...valid, data }, connectionId, modelId, requestId),
      ).toBe(false);
  });
});

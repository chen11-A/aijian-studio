// Independent original finding retained in evidence; native mutation boundary regression.
import { describe, it, expect, vi } from "vitest";
import { createLocalApiClient } from "./api-client";
const project = `prj_${"1".repeat(32)}`,
  episode = `ep_${"2".repeat(32)}`;
const payload = {
  version_id: `ver_${"3".repeat(32)}`,
  expected_content_hash: `sha256:${"4".repeat(64)}`,
  expected_head_revision: 1,
  confirm: true as const,
};
const operation = "11111111-1111-4111-8111-111111111111";
async function submit(status: number, code: string) {
  const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const fetcher = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        error: { code, message: "Controlled POST error", details: {}, retryable: false },
        request_id: requestId,
      }),
      { status, headers: { "Content-Type": "application/json", "X-Request-ID": requestId } },
    ),
  );
  const client = createLocalApiClient(fetcher, {
    origin: "http://127.0.0.1:43219",
    token: "t".repeat(43),
  });
  const result = await client.createEpisodeScriptConfirmation(project, episode, operation, payload);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]![1].method).toBe("POST");
  return result;
}
describe("original confirmation mutation error attribution", () => {
  it.each([
    [404, "SCRIPT_CONFIRMATION_OPERATION_UNKNOWN"],
    [401, "SOME_OTHER_ERROR"],
    [403, "SOME_OTHER_ERROR"],
    [409, "SOME_OTHER_ERROR"],
    [404, "SCRIPT_CONFIRMATION_NOT_FOUND"],
    [422, "SCRIPT_CONFIRMATION_CONFLICT"],
    [409, "SIDECAR_AUTH_REQUIRED"],
  ])("unattributed %s/%s remains unknown", async (status, code) => {
    expect((await submit(status, code)).kind).toBe("REMOTE_UNKNOWN");
  });
  it.each([
    [401, "SIDECAR_AUTH_REQUIRED"],
    [403, "SIDECAR_REQUEST_REJECTED"],
    [404, "SCRIPT_NOT_FOUND"],
    [409, "SCRIPT_CONFIRMATION_CONFLICT"],
    [422, "SCRIPT_CONFIRMATION_INPUT_REJECTED"],
    [422, "VALIDATION_ERROR"],
    [428, "PRECONDITION_REQUIRED"],
  ])("actual rejection %s/%s remains attributable", async (status, code) => {
    expect(await submit(status, code)).toMatchObject({
      kind: "DEFINITE_SERVER_ERROR",
      status,
      code,
    });
  });
});

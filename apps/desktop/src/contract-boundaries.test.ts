import { describe, expect, test } from "vitest";

import { isHealthResponse } from "./health-contract";
import { isCreateProviderConnectionInput } from "./provider-connection-contract";
import { canonicalLoopbackOrigin } from "./sidecar-origin";
import { isTaskQueueResponse } from "./task-queue-contract";

const requestId = "e6225937-1243-427b-bc98-56eda28e9dd3";
const projectId = `prj_${"1".repeat(32)}`;

describe("privileged contract boundaries", () => {
  test("rejects malformed nested health payloads", () => {
    expect(isHealthResponse({ data: null, request_id: requestId })).toBe(false);
  });

  test("rejects an unparseable provider URL before privileged fetch", () => {
    expect(
      isCreateProviderConnectionInput({
        provider_kind: "OLLAMA",
        display_name: "坏地址",
        base_url: "http://[",
        enabled: true,
        models: [{ model_id: "qwen-local", capabilities: ["TEXT"] }],
      }),
    ).toBe(false);
  });

  test("rejects malformed task response layers and task items", () => {
    expect(isTaskQueueResponse({}, projectId)).toBe(false);
    expect(
      isTaskQueueResponse(
        {
          data: {
            project_id: `prj_${"2".repeat(32)}`,
            summary: { total: 0, attention: 0, active: 0, completed: 0 },
            tasks: [],
          },
          request_id: requestId,
        },
        projectId,
      ),
    ).toBe(false);
    expect(
      isTaskQueueResponse(
        {
          data: {
            project_id: projectId,
            summary: { total: 1, attention: 0, active: 1, completed: 0 },
            tasks: [null],
          },
          request_id: requestId,
        },
        projectId,
      ),
    ).toBe(false);
  });

  test("accepts only a canonical sidecar origin", () => {
    expect(canonicalLoopbackOrigin("http://127.0.0.1:43123")).toBe("http://127.0.0.1:43123");
    expect(() => canonicalLoopbackOrigin("not-a-url")).toThrow("canonical loopback");
    expect(() => canonicalLoopbackOrigin("http://localhost:43123")).toThrow("canonical loopback");
  });
});

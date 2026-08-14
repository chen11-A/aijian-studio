import { describe, expect, test } from "vitest";

import { isHealthResponse } from "./health-contract";
import {
  isInvalidationOperationDetailResponse,
  isInvalidationOperationListResponse,
} from "./invalidation-report-contract";
import { isCreateProviderConnectionInput } from "./provider-connection-contract";
import { canonicalLoopbackOrigin } from "./sidecar-origin";
import { isTaskQueueResponse } from "./task-queue-contract";

const requestId = "e6225937-1243-427b-bc98-56eda28e9dd3";
const projectId = `prj_${"1".repeat(32)}`;
const operationId = `invop_${"2".repeat(32)}`;

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

  test("rejects malformed invalidation report list and detail payloads", () => {
    expect(isInvalidationOperationListResponse({}, projectId)).toBe(false);
    expect(
      isInvalidationOperationListResponse(
        {
          data: { project_id: `prj_${"3".repeat(32)}`, operations: [] },
          request_id: requestId,
        },
        projectId,
      ),
    ).toBe(false);
    expect(
      isInvalidationOperationDetailResponse(
        {
          data: {
            operation: {
              operation_id: operationId,
              project_id: projectId,
              changed_artifact_id: `art_${"4".repeat(32)}`,
              old_accepted_version_id: `ver_${"5".repeat(32)}`,
              new_accepted_version_id: `ver_${"6".repeat(32)}`,
              gate_decision_id: `dec_${"7".repeat(32)}`,
              created_at: "2026-08-03T12:00:00Z",
              affected_version_count: 0,
              independent_path_count: 0,
              impact_counts: { blocking: 0, render_only: 0, advisory: 0 },
              strongest_effective_impact: null,
            },
            affected_versions: [],
          },
          request_id: requestId,
        },
        projectId,
        `invop_${"9".repeat(32)}`,
      ),
    ).toBe(false);
  });

  test("accepts only a canonical sidecar origin", () => {
    expect(canonicalLoopbackOrigin("http://127.0.0.1:43123")).toBe("http://127.0.0.1:43123");
    expect(() => canonicalLoopbackOrigin("not-a-url")).toThrow("canonical loopback");
    expect(() => canonicalLoopbackOrigin("http://localhost:43123")).toThrow("canonical loopback");
  });
});

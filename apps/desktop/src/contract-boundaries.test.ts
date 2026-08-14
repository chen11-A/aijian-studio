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
const laterOperationId = `invop_${"a".repeat(32)}`;

function zeroImpactOperation(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
}

function populatedOperation(overrides: Record<string, unknown> = {}) {
  return {
    operation_id: operationId,
    project_id: projectId,
    changed_artifact_id: `art_${"4".repeat(32)}`,
    old_accepted_version_id: `ver_${"5".repeat(32)}`,
    new_accepted_version_id: `ver_${"6".repeat(32)}`,
    gate_decision_id: `dec_${"7".repeat(32)}`,
    created_at: "2026-08-03T12:00:00Z",
    affected_version_count: 2,
    independent_path_count: 3,
    impact_counts: { blocking: 1, render_only: 1, advisory: 1 },
    strongest_effective_impact: "blocking",
    ...overrides,
  };
}

function validDetailPayload(overrides: {
  operation?: Record<string, unknown>;
  affected_versions?: unknown[];
} = {}) {
  const operation = populatedOperation(overrides.operation);
  const affectedVersions =
    overrides.affected_versions ??
    [
      {
        affected_artifact_id: `art_${"8".repeat(32)}`,
        affected_version_id: `ver_${"1".repeat(32)}`,
        strongest_effective_impact: "advisory",
        general_stale: false,
        general_blocked: false,
        render_blocked: false,
        paths: [
          {
            impact_id: `invimp_${"2".repeat(32)}`,
            path_ordinal: 0,
            dependency_path: [`dep_${"3".repeat(32)}`],
            path_relationships: ["mentions"],
            path_impacts: ["advisory"],
            effective_impact: "advisory",
          },
        ],
      },
      {
        affected_artifact_id: `art_${"9".repeat(32)}`,
        affected_version_id: `ver_${"a".repeat(32)}`,
        strongest_effective_impact: "blocking",
        general_stale: true,
        general_blocked: true,
        render_blocked: true,
        paths: [
          {
            impact_id: `invimp_${"b".repeat(32)}`,
            path_ordinal: 1,
            dependency_path: [`dep_${"c".repeat(32)}`],
            path_relationships: ["derived_from"],
            path_impacts: ["blocking"],
            effective_impact: "blocking",
          },
          {
            impact_id: `invimp_${"d".repeat(32)}`,
            path_ordinal: 2,
            dependency_path: [`dep_${"e".repeat(32)}`, `dep_${"f".repeat(32)}`],
            path_relationships: ["references", "derived_from"],
            // T04 least-restrictive edge algebra: min(render_only, blocking) = render_only.
            path_impacts: ["render_only", "blocking"],
            effective_impact: "render_only",
          },
        ],
      },
    ];
  return {
    data: {
      operation,
      affected_versions: affectedVersions,
    },
    request_id: requestId,
  };
}

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
            operation: zeroImpactOperation(),
            affected_versions: [],
          },
          request_id: requestId,
        },
        projectId,
        `invop_${"9".repeat(32)}`,
      ),
    ).toBe(false);
  });

  test("accepts well-formed invalidation list and detail payloads", () => {
    expect(
      isInvalidationOperationListResponse(
        {
          data: {
            project_id: projectId,
            operations: [
              zeroImpactOperation({ created_at: "2026-08-03T11:00:00Z" }),
              populatedOperation({
                operation_id: laterOperationId,
                created_at: "2026-08-03T12:00:00Z",
              }),
            ],
          },
          request_id: requestId,
        },
        projectId,
      ),
    ).toBe(true);
    expect(
      isInvalidationOperationDetailResponse(validDetailPayload(), projectId, operationId),
    ).toBe(true);
    expect(
      isInvalidationOperationDetailResponse(
        {
          data: { operation: zeroImpactOperation(), affected_versions: [] },
          request_id: requestId,
        },
        projectId,
        operationId,
      ),
    ).toBe(true);
  });

  test("rejects empty, timezone-less, and invalid-calendar event timestamps", () => {
    const baseList = (created_at: string) => ({
      data: {
        project_id: projectId,
        operations: [zeroImpactOperation({ created_at })],
      },
      request_id: requestId,
    });

    expect(isInvalidationOperationListResponse(baseList(""), projectId)).toBe(false);
    expect(isInvalidationOperationListResponse(baseList("not-a-timestamp"), projectId)).toBe(
      false,
    );
    // Timezone-less ISO string must fail closed at the desktop boundary.
    expect(
      isInvalidationOperationListResponse(baseList("2026-08-03T12:00:00"), projectId),
    ).toBe(false);
    expect(
      isInvalidationOperationListResponse(baseList("2026-02-30T12:00:00Z"), projectId),
    ).toBe(false);
    expect(
      isInvalidationOperationListResponse(baseList("2026-08-03T12:00:00+08:00"), projectId),
    ).toBe(true);
  });

  test("rejects nondeterministic list order and duplicate operation ids", () => {
    const older = zeroImpactOperation({
      operation_id: operationId,
      created_at: "2026-08-03T12:00:00Z",
    });
    const newer = populatedOperation({
      operation_id: laterOperationId,
      created_at: "2026-08-03T13:00:00Z",
    });
    expect(
      isInvalidationOperationListResponse(
        {
          data: { project_id: projectId, operations: [newer, older] },
          request_id: requestId,
        },
        projectId,
      ),
    ).toBe(false);
    expect(
      isInvalidationOperationListResponse(
        {
          data: {
            project_id: projectId,
            operations: [
              zeroImpactOperation({ operation_id: operationId }),
              zeroImpactOperation({ operation_id: operationId }),
            ],
          },
          request_id: requestId,
        },
        projectId,
      ),
    ).toBe(false);
  });

  test("orders list operations by absolute event instant, not lexical timestamp text", () => {
    // 05:00Z then 12:00+08:00 (= 04:00 UTC) is lexically ascending but absolutely backwards.
    expect(
      isInvalidationOperationListResponse(
        {
          data: {
            project_id: projectId,
            operations: [
              zeroImpactOperation({
                operation_id: operationId,
                created_at: "2026-08-03T05:00:00Z",
              }),
              zeroImpactOperation({
                operation_id: laterOperationId,
                created_at: "2026-08-03T12:00:00+08:00",
              }),
            ],
          },
          request_id: requestId,
        },
        projectId,
      ),
    ).toBe(false);

    // Equivalent instants with different offset spellings break ties on operation_id.
    expect(
      isInvalidationOperationListResponse(
        {
          data: {
            project_id: projectId,
            operations: [
              zeroImpactOperation({
                operation_id: operationId,
                created_at: "2026-08-03T12:00:00Z",
              }),
              zeroImpactOperation({
                operation_id: laterOperationId,
                created_at: "2026-08-03T20:00:00+08:00",
              }),
            ],
          },
          request_id: requestId,
        },
        projectId,
      ),
    ).toBe(true);
    expect(
      isInvalidationOperationListResponse(
        {
          data: {
            project_id: projectId,
            operations: [
              zeroImpactOperation({
                operation_id: laterOperationId,
                created_at: "2026-08-03T12:00:00Z",
              }),
              zeroImpactOperation({
                operation_id: operationId,
                created_at: "2026-08-03T20:00:00+08:00",
              }),
            ],
          },
          request_id: requestId,
        },
        projectId,
      ),
    ).toBe(false);

    // Genuinely ascending pair mixing Z and numeric offset must still pass.
    expect(
      isInvalidationOperationListResponse(
        {
          data: {
            project_id: projectId,
            operations: [
              zeroImpactOperation({
                operation_id: operationId,
                created_at: "2026-08-03T12:00:00+08:00",
              }),
              zeroImpactOperation({
                operation_id: laterOperationId,
                created_at: "2026-08-03T05:00:00Z",
              }),
            ],
          },
          request_id: requestId,
        },
        projectId,
      ),
    ).toBe(true);
  });

  test("rejects incoherent zero/nonzero impact count fields", () => {
    expect(
      isInvalidationOperationListResponse(
        {
          data: {
            project_id: projectId,
            operations: [
              zeroImpactOperation({
                independent_path_count: 0,
                strongest_effective_impact: "blocking",
              }),
            ],
          },
          request_id: requestId,
        },
        projectId,
      ),
    ).toBe(false);
    expect(
      isInvalidationOperationListResponse(
        {
          data: {
            project_id: projectId,
            operations: [
              populatedOperation({
                impact_counts: { blocking: 0, render_only: 0, advisory: 3 },
                strongest_effective_impact: "blocking",
              }),
            ],
          },
          request_id: requestId,
        },
        projectId,
      ),
    ).toBe(false);
    expect(
      isInvalidationOperationListResponse(
        {
          data: {
            project_id: projectId,
            operations: [
              populatedOperation({
                affected_version_count: 0,
                independent_path_count: 3,
              }),
            ],
          },
          request_id: requestId,
        },
        projectId,
      ),
    ).toBe(false);
  });

  test("rejects path effective_impact that disagrees with T04 edge algebra", () => {
    const payload = validDetailPayload({
      affected_versions: [
        {
          affected_artifact_id: `art_${"9".repeat(32)}`,
          affected_version_id: `ver_${"a".repeat(32)}`,
          strongest_effective_impact: "blocking",
          general_stale: true,
          general_blocked: true,
          render_blocked: true,
          paths: [
            {
              impact_id: `invimp_${"b".repeat(32)}`,
              path_ordinal: 0,
              dependency_path: [`dep_${"e".repeat(32)}`, `dep_${"f".repeat(32)}`],
              path_relationships: ["references", "derived_from"],
              // Least restrictive edge is advisory; claiming blocking must fail.
              path_impacts: ["advisory", "blocking"],
              effective_impact: "blocking",
            },
          ],
        },
      ],
      operation: {
        affected_version_count: 1,
        independent_path_count: 1,
        impact_counts: { blocking: 1, render_only: 0, advisory: 0 },
        strongest_effective_impact: "blocking",
      },
    });
    expect(isInvalidationOperationDetailResponse(payload, projectId, operationId)).toBe(false);
  });

  test("rejects group flags and strongest that disagree with nested paths", () => {
    const wrongFlags = validDetailPayload({
      affected_versions: [
        {
          affected_artifact_id: `art_${"9".repeat(32)}`,
          affected_version_id: `ver_${"a".repeat(32)}`,
          strongest_effective_impact: "blocking",
          general_stale: false,
          general_blocked: false,
          render_blocked: false,
          paths: [
            {
              impact_id: `invimp_${"b".repeat(32)}`,
              path_ordinal: 0,
              dependency_path: [`dep_${"c".repeat(32)}`],
              path_relationships: ["derived_from"],
              path_impacts: ["blocking"],
              effective_impact: "blocking",
            },
          ],
        },
      ],
      operation: {
        affected_version_count: 1,
        independent_path_count: 1,
        impact_counts: { blocking: 1, render_only: 0, advisory: 0 },
        strongest_effective_impact: "blocking",
      },
    });
    expect(isInvalidationOperationDetailResponse(wrongFlags, projectId, operationId)).toBe(false);

    const wrongStrongest = validDetailPayload({
      affected_versions: [
        {
          affected_artifact_id: `art_${"9".repeat(32)}`,
          affected_version_id: `ver_${"a".repeat(32)}`,
          strongest_effective_impact: "advisory",
          general_stale: false,
          general_blocked: false,
          render_blocked: false,
          paths: [
            {
              impact_id: `invimp_${"b".repeat(32)}`,
              path_ordinal: 0,
              dependency_path: [`dep_${"c".repeat(32)}`],
              path_relationships: ["derived_from"],
              path_impacts: ["render_only"],
              effective_impact: "render_only",
            },
          ],
        },
      ],
      operation: {
        affected_version_count: 1,
        independent_path_count: 1,
        impact_counts: { blocking: 0, render_only: 1, advisory: 0 },
        strongest_effective_impact: "render_only",
      },
    });
    expect(isInvalidationOperationDetailResponse(wrongStrongest, projectId, operationId)).toBe(
      false,
    );
  });

  test("rejects duplicate groups, impact ids, and non-contiguous global ordinals", () => {
    const duplicateGroup = validDetailPayload({
      affected_versions: [
        {
          affected_artifact_id: `art_${"9".repeat(32)}`,
          affected_version_id: `ver_${"a".repeat(32)}`,
          strongest_effective_impact: "blocking",
          general_stale: true,
          general_blocked: true,
          render_blocked: true,
          paths: [
            {
              impact_id: `invimp_${"b".repeat(32)}`,
              path_ordinal: 0,
              dependency_path: [`dep_${"c".repeat(32)}`],
              path_relationships: ["derived_from"],
              path_impacts: ["blocking"],
              effective_impact: "blocking",
            },
          ],
        },
        {
          affected_artifact_id: `art_${"9".repeat(32)}`,
          affected_version_id: `ver_${"a".repeat(32)}`,
          strongest_effective_impact: "advisory",
          general_stale: false,
          general_blocked: false,
          render_blocked: false,
          paths: [
            {
              impact_id: `invimp_${"d".repeat(32)}`,
              path_ordinal: 1,
              dependency_path: [`dep_${"e".repeat(32)}`],
              path_relationships: ["mentions"],
              path_impacts: ["advisory"],
              effective_impact: "advisory",
            },
          ],
        },
      ],
      operation: {
        affected_version_count: 2,
        independent_path_count: 2,
        impact_counts: { blocking: 1, render_only: 0, advisory: 1 },
        strongest_effective_impact: "blocking",
      },
    });
    expect(isInvalidationOperationDetailResponse(duplicateGroup, projectId, operationId)).toBe(
      false,
    );

    const duplicateImpactId = validDetailPayload({
      affected_versions: [
        {
          affected_artifact_id: `art_${"8".repeat(32)}`,
          affected_version_id: `ver_${"1".repeat(32)}`,
          strongest_effective_impact: "advisory",
          general_stale: false,
          general_blocked: false,
          render_blocked: false,
          paths: [
            {
              impact_id: `invimp_${"b".repeat(32)}`,
              path_ordinal: 0,
              dependency_path: [`dep_${"3".repeat(32)}`],
              path_relationships: ["mentions"],
              path_impacts: ["advisory"],
              effective_impact: "advisory",
            },
          ],
        },
        {
          affected_artifact_id: `art_${"9".repeat(32)}`,
          affected_version_id: `ver_${"a".repeat(32)}`,
          strongest_effective_impact: "blocking",
          general_stale: true,
          general_blocked: true,
          render_blocked: true,
          paths: [
            {
              impact_id: `invimp_${"b".repeat(32)}`,
              path_ordinal: 1,
              dependency_path: [`dep_${"c".repeat(32)}`],
              path_relationships: ["derived_from"],
              path_impacts: ["blocking"],
              effective_impact: "blocking",
            },
          ],
        },
      ],
      operation: {
        affected_version_count: 2,
        independent_path_count: 2,
        impact_counts: { blocking: 1, render_only: 0, advisory: 1 },
        strongest_effective_impact: "blocking",
      },
    });
    expect(isInvalidationOperationDetailResponse(duplicateImpactId, projectId, operationId)).toBe(
      false,
    );

    const nonContiguousOrdinals = validDetailPayload({
      affected_versions: [
        {
          affected_artifact_id: `art_${"9".repeat(32)}`,
          affected_version_id: `ver_${"a".repeat(32)}`,
          strongest_effective_impact: "blocking",
          general_stale: true,
          general_blocked: true,
          render_blocked: true,
          paths: [
            {
              impact_id: `invimp_${"b".repeat(32)}`,
              path_ordinal: 0,
              dependency_path: [`dep_${"c".repeat(32)}`],
              path_relationships: ["derived_from"],
              path_impacts: ["blocking"],
              effective_impact: "blocking",
            },
            {
              impact_id: `invimp_${"d".repeat(32)}`,
              path_ordinal: 2,
              dependency_path: [`dep_${"e".repeat(32)}`],
              path_relationships: ["mentions"],
              path_impacts: ["advisory"],
              effective_impact: "advisory",
            },
          ],
        },
      ],
      operation: {
        affected_version_count: 1,
        independent_path_count: 2,
        impact_counts: { blocking: 1, render_only: 0, advisory: 1 },
        strongest_effective_impact: "blocking",
      },
    });
    expect(
      isInvalidationOperationDetailResponse(nonContiguousOrdinals, projectId, operationId),
    ).toBe(false);
  });

  test("rejects unsorted groups/paths and operation totals that disagree with nested paths", () => {
    const unsortedGroups = validDetailPayload({
      affected_versions: [
        {
          affected_artifact_id: `art_${"9".repeat(32)}`,
          affected_version_id: `ver_${"a".repeat(32)}`,
          strongest_effective_impact: "blocking",
          general_stale: true,
          general_blocked: true,
          render_blocked: true,
          paths: [
            {
              impact_id: `invimp_${"b".repeat(32)}`,
              path_ordinal: 1,
              dependency_path: [`dep_${"c".repeat(32)}`],
              path_relationships: ["derived_from"],
              path_impacts: ["blocking"],
              effective_impact: "blocking",
            },
          ],
        },
        {
          affected_artifact_id: `art_${"8".repeat(32)}`,
          affected_version_id: `ver_${"1".repeat(32)}`,
          strongest_effective_impact: "advisory",
          general_stale: false,
          general_blocked: false,
          render_blocked: false,
          paths: [
            {
              impact_id: `invimp_${"2".repeat(32)}`,
              path_ordinal: 0,
              dependency_path: [`dep_${"3".repeat(32)}`],
              path_relationships: ["mentions"],
              path_impacts: ["advisory"],
              effective_impact: "advisory",
            },
          ],
        },
      ],
      operation: {
        affected_version_count: 2,
        independent_path_count: 2,
        impact_counts: { blocking: 1, render_only: 0, advisory: 1 },
        strongest_effective_impact: "blocking",
      },
    });
    expect(isInvalidationOperationDetailResponse(unsortedGroups, projectId, operationId)).toBe(
      false,
    );

    const unsortedPaths = validDetailPayload({
      affected_versions: [
        {
          affected_artifact_id: `art_${"9".repeat(32)}`,
          affected_version_id: `ver_${"a".repeat(32)}`,
          strongest_effective_impact: "blocking",
          general_stale: true,
          general_blocked: true,
          render_blocked: true,
          paths: [
            {
              impact_id: `invimp_${"d".repeat(32)}`,
              path_ordinal: 1,
              dependency_path: [`dep_${"e".repeat(32)}`],
              path_relationships: ["mentions"],
              path_impacts: ["advisory"],
              effective_impact: "advisory",
            },
            {
              impact_id: `invimp_${"b".repeat(32)}`,
              path_ordinal: 0,
              dependency_path: [`dep_${"c".repeat(32)}`],
              path_relationships: ["derived_from"],
              path_impacts: ["blocking"],
              effective_impact: "blocking",
            },
          ],
        },
      ],
      operation: {
        affected_version_count: 1,
        independent_path_count: 2,
        impact_counts: { blocking: 1, render_only: 0, advisory: 1 },
        strongest_effective_impact: "blocking",
      },
    });
    expect(isInvalidationOperationDetailResponse(unsortedPaths, projectId, operationId)).toBe(
      false,
    );

    const wrongTotals = validDetailPayload({
      operation: {
        impact_counts: { blocking: 2, render_only: 0, advisory: 1 },
        strongest_effective_impact: "blocking",
      },
    });
    expect(isInvalidationOperationDetailResponse(wrongTotals, projectId, operationId)).toBe(false);
  });

  test("accepts only a canonical sidecar origin", () => {
    expect(canonicalLoopbackOrigin("http://127.0.0.1:43123")).toBe("http://127.0.0.1:43123");
    expect(() => canonicalLoopbackOrigin("not-a-url")).toThrow("canonical loopback");
    expect(() => canonicalLoopbackOrigin("http://localhost:43123")).toThrow("canonical loopback");
  });
});

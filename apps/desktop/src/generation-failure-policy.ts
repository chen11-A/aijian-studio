import { canonicalLoopbackOrigin } from "./sidecar-origin";

import type {
  GenerationFailurePolicy,
  ConfigureGenerationFailurePolicy,
  GenerationFailurePolicyResult,
} from "@aijian/contracts/generation-failure-policy";
const project = /^prj_[0-9a-f]{32}$/;

export function parseGenerationFailureConfiguration(
  value: unknown,
): ConfigureGenerationFailurePolicy {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Invalid failure policy");
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).length !== 2 ||
    !Object.hasOwn(row, "expected_revision") ||
    !Object.hasOwn(row, "failure_limit") ||
    !Number.isSafeInteger(row.expected_revision) ||
    (row.expected_revision as number) < 0 ||
    (row.expected_revision as number) > Number.MAX_SAFE_INTEGER - 1 ||
    !Number.isInteger(row.failure_limit) ||
    (row.failure_limit as number) < 0 ||
    (row.failure_limit as number) > 1000
  )
    throw new Error("Invalid failure policy");
  return row as ConfigureGenerationFailurePolicy;
}

export async function generationFailurePolicy(
  fetcher: typeof fetch,
  session: { token: string; origin: string },
  projectId: string,
  update?: ConfigureGenerationFailurePolicy,
): Promise<GenerationFailurePolicyResult> {
  if (!project.test(projectId)) throw new Error("Invalid failure policy project");
  let response: Response;
  try {
    response = await fetcher(
      `${canonicalLoopbackOrigin(session.origin)}/api/v1/projects/${projectId}/generation-failure-policy`,
      {
        method: update ? "PUT" : "GET",
        headers: {
          Authorization: `Bearer ${session.token}`,
          Origin: "app://aijian",
          "Content-Type": "application/json",
        },
        ...(update ? { body: JSON.stringify(parseGenerationFailureConfiguration(update)) } : {}),
      },
    );
  } catch {
    return { kind: "FAILED", code: update ? "WRITE_UNCONFIRMED" : "UNAVAILABLE" };
  }
  if (!response.ok)
    return {
      kind: "FAILED",
      code:
        response.status === 404
          ? "PROJECT_NOT_FOUND"
          : response.status === 409
            ? "POLICY_CHANGED"
            : update
              ? "WRITE_UNCONFIRMED"
              : "UNAVAILABLE",
    };

  let value: unknown;
  try {
    value = await response.json();
  } catch {
    return { kind: "FAILED", code: update ? "WRITE_UNCONFIRMED" : "UNAVAILABLE" };
  }

  if (typeof value !== "object" || value === null)
    return { kind: "FAILED", code: update ? "WRITE_UNCONFIRMED" : "UNAVAILABLE" };
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).length !== 4 ||
    !Object.keys(row).every((key) =>
      ["state", "revision", "failure_limit", "scope"].includes(key),
    ) ||
    row.scope !== "GROK_VIDEO_SUBMIT_FAILURES" ||
    !Number.isSafeInteger(row.revision) ||
    (row.state === "UNCONFIGURED"
      ? row.revision !== 0 || row.failure_limit !== null
      : row.state !== "CONFIGURED" ||
        (row.revision as number) < 1 ||
        !Number.isInteger(row.failure_limit) ||
        (row.failure_limit as number) < 0 ||
        (row.failure_limit as number) > 1000)
  )
    return { kind: "FAILED", code: update ? "WRITE_UNCONFIRMED" : "UNAVAILABLE" };
  if (
    update &&
    (row.state !== "CONFIGURED" ||
      row.revision !== update.expected_revision + 1 ||
      row.failure_limit !== update.failure_limit)
  ) {
    return { kind: "FAILED", code: "WRITE_UNCONFIRMED" };
  }
  return { kind: "POLICY", policy: row as GenerationFailurePolicy };
}

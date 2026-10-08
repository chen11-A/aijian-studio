import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const root = "C:/Users/Administrator/.codex/worktrees/c19-trim-211c9e8-qa-20260923";
const baseline = "C:/Users/Administrator/Documents/AIVORA/management/manager-handoffs/release-snapshots/20260924-project01-contracts-2/files/packages/contracts/openapi.json";
const contractPath = root + "/packages/contracts/openapi.json";
const generatedPath = root + "/packages/contracts/src/generated.ts";
const methods = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);
function operations(api) {
  return Object.entries(api.paths).flatMap(([path, item]) =>
    Object.entries(item).filter(([method]) => methods.has(method))
      .map(([method, value]) => [path + " " + method, value]));
}

test("AC05 generated contract adds the four V2 endpoints and preserves PROJECT operations", () => {
  const old = JSON.parse(readFileSync(baseline, "utf8"));
  const api = JSON.parse(readFileSync(contractPath, "utf8"));
  const oldOps = new Map(operations(old));
  const newOps = new Map(operations(api));
  expect(Object.keys(api.paths)).toHaveLength(44);
  expect(newOps.size).toBe(51);
  for (const [key, value] of oldOps) expect(newOps.get(key)).toEqual(value);
  expect([...newOps.keys()].filter((key) => !oldOps.has(key)).sort()).toEqual([
    "/api/v1/projects/{project_id}/sub2api-source-extract-runs post",
    "/api/v1/projects/{project_id}/sub2api-source-extract-runs/{run_id}/approval get",
    "/api/v1/projects/{project_id}/sub2api-source-extract-runs/{run_id}/approval post",
    "/api/v1/projects/{project_id}/sub2api-source-extract-runs/{run_id}/operation get",
  ]);
  expect(Object.keys(api.components.schemas)).toHaveLength(228);
  expect(Object.keys(old.components.schemas).every((key) => key in api.components.schemas)).toBe(true);
  const generated = readFileSync(generatedPath, "utf8");
  for (const operationId of [
    "createSub2APISourceExtractRun", "getSub2APISourceExtractApproval",
    "approveSub2APISourceExtractCall", "getSub2APISourceExtractOperation",
  ]) expect(generated).toContain(operationId);
});

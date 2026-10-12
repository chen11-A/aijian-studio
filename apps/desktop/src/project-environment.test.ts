import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import {
  isCreateProjectCreativeLibraryVersionRequest,
  isProjectCreativeLibraryVersionResponse,
} from "./project-creative-library-contract";

const fixture = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "../../packages/contracts/fixtures/project-environment.json"),
    "utf8",
  ),
);
const project = fixture.request.content.project_id;
test("native strict validator accepts backend canonical environment fixture and all old character fields", () => {
  expect(isCreateProjectCreativeLibraryVersionRequest(fixture.request, project)).toBe(true);
  expect(
    isProjectCreativeLibraryVersionResponse(fixture.response, project, fixture.response.request_id),
  ).toBe(true);
  const wrong = structuredClone(fixture.response);
  wrong.data.content.scene_variants[0].weather = "changed";
  expect(isProjectCreativeLibraryVersionResponse(wrong, project, wrong.request_id)).toBe(false);
  expect(
    isProjectCreativeLibraryVersionResponse(
      fixture.response,
      `prj_${"0".repeat(32)}`,
      fixture.response.request_id,
    ),
  ).toBe(false);
});
test.each([
  { variant_id: "wrong" },
  { ordinal: true },
  { ordinal: 2 },
  { scene_id: `loc_${"f".repeat(32)}` },
  { name: " " },
  { view: "x".repeat(241) },
  { state: "\ud800" },
  { approved: true },
])("native rejects unsafe or orphan state %j", (change) => {
  const request = structuredClone(fixture.request);
  Object.assign(request.content.scene_variants[0], change);
  expect(isCreateProjectCreativeLibraryVersionRequest(request, project)).toBe(false);
});
test.each([
  { reference_id: "wrong" },
  { ordinal: true },
  { scene_id: null, variant_id: `scv_${"1".repeat(32)}` },
  { scene_id: `loc_${"f".repeat(32)}` },
  { variant_id: `scv_${"f".repeat(32)}` },
  { asset_id: "wrong" },
  { asset_sha256: `sha256:${"a".repeat(64)}` },
  { label: " " },
  { label: "\ud800" },
  { approved: true },
])("native rejects wrong environment reference %j", (change) => {
  const request = structuredClone(fixture.request);
  Object.assign(request.content.environment_references[2], change);
  expect(isCreateProjectCreativeLibraryVersionRequest(request, project)).toBe(false);
});
test("native preserves character reference validation and rejects duplicate environment identities", () => {
  const wrong = structuredClone(fixture.request);
  wrong.content.references[0].costume_id = `cst_${"0".repeat(32)}`;
  expect(isCreateProjectCreativeLibraryVersionRequest(wrong, project)).toBe(false);
  const duplicate = structuredClone(fixture.request);
  duplicate.content.scene_variants.push({ ...duplicate.content.scene_variants[0], ordinal: 2 });
  expect(isCreateProjectCreativeLibraryVersionRequest(duplicate, project)).toBe(false);
  const duplicateRef = structuredClone(fixture.request);
  duplicateRef.content.environment_references.push({
    ...duplicateRef.content.environment_references[0],
    ordinal: 4,
  });
  expect(isCreateProjectCreativeLibraryVersionRequest(duplicateRef, project)).toBe(false);
});

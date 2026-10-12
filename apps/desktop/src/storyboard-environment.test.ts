import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import {
  isCreateEpisodeStoryboardVersionRequest,
  isEpisodeStoryboardVersionResponse,
} from "./episode-storyboard-contract";

const fixture = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "../../packages/contracts/fixtures/storyboard-environment.json"),
    "utf8",
  ),
);
const project = fixture.request.content.project_id;
const episode = fixture.request.content.episode_id;
test("native accepts backend canonical environment choices without changing original planning", () => {
  expect(isCreateEpisodeStoryboardVersionRequest(fixture.request, project, episode)).toBe(true);
  expect(
    isEpisodeStoryboardVersionResponse(
      fixture.response,
      project,
      episode,
      fixture.response.request_id,
    ),
  ).toBe(true);
  const wrong = structuredClone(fixture.response);
  wrong.data.content.shots[0].environment_binding.reference_ids = [];
  expect(isEpisodeStoryboardVersionResponse(wrong, project, episode, wrong.request_id)).toBe(false);
  expect(
    isEpisodeStoryboardVersionResponse(
      fixture.response,
      project,
      `ep_${"f".repeat(32)}`,
      fixture.response.request_id,
    ),
  ).toBe(false);
});
test.each([
  "missing",
  "variant",
  "reference",
  "duplicate",
  "extra",
  "no-location",
  "no-library",
  "g5",
  "old-schema",
  "unicode",
])("native refuses environment fault %s", (fault) => {
  const request = structuredClone(fixture.request);
  const content = request.content,
    shot = content.shots[0],
    binding = shot.environment_binding;
  if (fault === "missing") delete shot.environment_binding;
  else if (fault === "variant") binding.variant_id = "invalid";
  else if (fault === "reference") binding.reference_ids = ["invalid"];
  else if (fault === "duplicate") binding.reference_ids.push(binding.reference_ids[0]);
  else if (fault === "extra") binding.approved = true;
  else if (fault === "no-location") shot.location_id = null;
  else if (fault === "no-library") content.creative_library_version_id = null;
  else if (fault === "g5")
    content.visual_bible_pin = {
      version_id: `ver_${"e".repeat(32)}`,
      content_hash: `sha256:${"e".repeat(64)}`,
    };
  else if (fault === "old-schema") content.schema_version = "1.3.0";
  else shot.coverage_notes = "\ud800";
  expect(isCreateEpisodeStoryboardVersionRequest(request, project, episode)).toBe(false);
});

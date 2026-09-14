import { describe, expect, test } from "vitest";

import type { ProjectData, SourceDocumentResponse, SourceManifestResponse } from "./api/studio";
import { prepareFakeTimelineRun } from "./fake-timeline-run-preflight";

const projectId = `prj_${"1".repeat(32)}`;
const sourceId = `src_${"2".repeat(32)}`;
const versionId = `ver_${"3".repeat(32)}`;
const project = { id: projectId } as ProjectData;
const source = { data: { id: sourceId, project_id: projectId } } as SourceDocumentResponse;
const manifest = {
  data: {
    project_id: projectId,
    head: { accepted_version_id: versionId },
    accepted_version: {
      id: versionId,
      content: { scope_type: "full_work", documents: [{ source_document_id: sourceId }] },
    },
  },
} as SourceManifestResponse;

describe("fake timeline development preflight", () => {
  test("permits only the accepted manifest membership for the current project and source", () => {
    expect(prepareFakeTimelineRun(project, source, manifest)).toEqual({
      kind: "ready",
      input: { source_manifest_version_id: versionId, source_document_id: sourceId },
    });
  });

  test("fails closed for no accepted manifest, project drift, or a source outside the accepted set", () => {
    expect(
      prepareFakeTimelineRun(project, source, {
        ...manifest,
        data: { ...manifest.data, head: { accepted_version_id: null }, accepted_version: null },
      } as SourceManifestResponse),
    ).toEqual({ kind: "unavailable", reason: "accepted-manifest-required" });
    expect(
      prepareFakeTimelineRun({ ...project, id: `prj_${"4".repeat(32)}` }, source, {
        ...manifest,
        data: { ...manifest.data, project_id: `prj_${"4".repeat(32)}` },
      } as SourceManifestResponse),
    ).toEqual({ kind: "unavailable", reason: "source-project-mismatch" });
    expect(
      prepareFakeTimelineRun(project, source, {
        ...manifest,
        data: {
          ...manifest.data,
          accepted_version: {
            ...manifest.data.accepted_version!,
            content: { scope_type: "full_work", documents: [] },
          },
        },
      } as SourceManifestResponse),
    ).toEqual({ kind: "unavailable", reason: "source-not-in-accepted-manifest" });
  });
});

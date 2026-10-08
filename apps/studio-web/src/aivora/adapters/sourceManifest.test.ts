import { describe, expect, it, vi } from "vitest";
import type { SourceManifestReviewCapability, SourceManifestResponse } from "../../api/studio";
import { createSourceReviewRunner, sourceReviewIdentity } from "./sourceManifest";

const identity = {
  project_id: "prj_0123456789abcdef0123456789abcdef",
  version_id: "ver_0123456789abcdef0123456789abcdef",
  content_hash: `sha256:${"a".repeat(64)}`,
  expected_revision: 2,
};
const manifest = {
  data: {
    project_id: identity.project_id,
    head: {
      latest_version_id: identity.version_id,
      artifact_id: "artifact",
      review_version_id: null,
      accepted_version_id: null,
      revision: 2,
    },
    latest_version: {
      id: identity.version_id,
      artifact_id: "artifact",
      content_hash: identity.content_hash,
    },
    review_version: null,
    accepted_version: null,
  },
} as unknown as SourceManifestResponse;

describe("source manifest adapter", () => {
  it("preserves validated identity and leaves an unknown bridge result locked", async () => {
    expect(sourceReviewIdentity(manifest, identity.project_id)).toEqual(identity);
    const capability = {
      submit: vi.fn().mockRejectedValue(new Error("bridge")),
      confirmBaseline: vi.fn(),
      copyDraft: vi.fn(),
    } as unknown as SourceManifestReviewCapability;
    const runner = createSourceReviewRunner(capability);
    await expect(runner.run("submit", identity, "")).resolves.toMatchObject({
      kind: "REMOTE_UNKNOWN",
    });
    expect(runner.isLocked(identity.project_id)).toBe(true);
    expect(await runner.run("submit", identity, "")).toBeNull();
    runner.clear(identity.project_id);
    expect(runner.isLocked(identity.project_id)).toBe(false);
    expect(capability.submit).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, test } from "vitest";

import type { SourceManifestResponse, StoryBibleVersionResponse } from "../../api/studio";
import {
  createInitialStoryWorkshopMachine,
  mockPrepareG2Package,
  mockSaveDraft,
  mockVerifySources,
  updateDraft,
  upsertDisposition,
} from "./story-workshop-model";

const manifest = {
  data: {
    head: {
      accepted_version_id: "ver_source",
    },
  },
} as SourceManifestResponse;

const story = {
  id: "ver_story",
  content_hash: "sha256:story",
  content: {
    title: "雾城来信",
    logline: "记者追查旧信。",
    source_scope: {
      source_manifest_version_id: "ver_source",
    },
  },
} as StoryBibleVersionResponse["data"]["version"];

describe("story workshop mock state machine", () => {
  test("enforces G1/G2 action order before preparing a package", () => {
    const initial = createInitialStoryWorkshopMachine({
      manifest,
      story,
      storyRole: "latest",
    });

    expect(mockSaveDraft(initial, { ifMatch: initial.etag })).toMatchObject({
      ok: false,
      status: 409,
      code: "SOURCE_VERIFICATION_REQUIRED",
    });

    const verified = mockVerifySources(initial);
    expect(verified.ok).toBe(true);
    if (!verified.ok) throw new Error("expected verified machine");

    const saved = mockSaveDraft(updateDraft(verified.machine, { title: "本地草稿标题" }), {
      ifMatch: verified.machine.etag,
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) throw new Error("expected saved machine");

    const disposed = upsertDisposition(saved.machine, {
      target_type: "question",
      target_id: "qst_1",
      decision: "deferred",
      note: "稍后复核",
    });
    expect(disposed.dispositions).toHaveLength(1);

    const prepared = mockPrepareG2Package(disposed, { ifMatch: disposed.etag });
    expect(prepared).toMatchObject({
      ok: false,
      status: 503,
      code: "TRUSTED_BACKEND_MISSING",
      machine: { readyPackagePrepared: true },
    });
  });

  test("returns an expired response when the draft ETag no longer matches", () => {
    const initial = createInitialStoryWorkshopMachine({ manifest, story, storyRole: "latest" });
    const verified = mockVerifySources(initial);
    if (!verified.ok) throw new Error("expected verified machine");

    const result = mockSaveDraft(updateDraft(verified.machine, { notes: "本地修改" }), {
      ifMatch: "sha256:older",
    });

    expect(result).toMatchObject({
      ok: false,
      status: 412,
      code: "ETAG_EXPIRED",
    });
  });

  test("keeps unavailable G1 state blocked instead of fabricating canon", () => {
    const initial = createInitialStoryWorkshopMachine({
      manifest: {
        ...manifest,
        data: {
          ...manifest.data,
          head: { ...manifest.data.head, accepted_version_id: null },
        },
      },
      story,
      storyRole: "latest",
    });

    expect(initial.unavailable).toBe("g1_not_accepted");
    expect(mockVerifySources(initial)).toMatchObject({
      ok: false,
      status: 409,
      code: "G1_NOT_ACCEPTED",
    });
    expect(mockVerifySources(initial, { unavailable: true })).toMatchObject({
      ok: false,
      status: 503,
      code: "STORY_WORKSHOP_UNAVAILABLE",
    });
  });
});

import { describe, expect, it, vi } from "vitest";
import fixture from "../../../packages/contracts/fixtures/visual-environment-g5.json";
import {
  visualContent,
  visualReport,
  visualEnvironmentEvidenceMatches,
  visualEnvironmentChoicesWithinScope,
  type VisualRead,
  type VisualPrepared,
} from "@aijian/contracts/visual-bible";
import { createVisualBibleClient, visualHash } from "./visual-bible-client";
import { createVisualReviewController } from "./visual-bible-review";
import { isCreateEpisodeStoryboardVersionRequest } from "./episode-storyboard-contract";
const found = <T>(data: T) => ({ kind: "FOUND" as const, data, request_id: fixture.request_id });
function setup() {
  const saved = structuredClone(fixture.saved) as VisualRead;
  const prepared = structuredClone(fixture.prepared_submit) as VisualPrepared;
  const read = vi.fn().mockResolvedValue(found(saved));
  const library = vi.fn().mockResolvedValue({
    kind: "FOUND",
    receipt: { data: fixture.library, request_id: fixture.request_id },
  });
  const prepare = vi.fn().mockResolvedValue(found(prepared));
  const write = vi.fn().mockResolvedValue({ kind: "REMOTE_UNKNOWN" });
  const client = {
    ...createVisualBibleClient(vi.fn(), {}),
    getVisualBibleVersion: read,
    getProjectCreativeLibraryVersion: library,
    prepareVisualAction: prepare,
    confirmVisualAction: write,
  };
  const controller = createVisualReviewController(
    client,
    () => Date.parse(prepared.challenge.created_at) + 1,
  );
  const identity = {
    project_id: saved.project_id,
    version_id: saved.version.id,
    content_hash: saved.version.content_hash,
    expected_revision: saved.head.revision,
  };
  const input = {
    action: "submit" as const,
    roles: [],
    decision: null,
    rationale: null,
    readiness_report_id: null,
  };
  return { controller, identity, input, saved, prepared, library, write, origin: {} };
}
describe("explicit environment G5 native source correlation", () => {
  it("native accepts closed storyboard1.5 without relaxing legacy1.4 environment rejection", () => {
    const p = fixture.saved.project_id,
      e = fixture.board_request.content.episode_id;
    expect(isCreateEpisodeStoryboardVersionRequest(fixture.board_request, p, e)).toBe(true);
    expect(
      isCreateEpisodeStoryboardVersionRequest(
        {
          ...fixture.board_request,
          content: { ...fixture.board_request.content, schema_version: "1.4.0" },
        },
        p,
        e,
      ),
    ).toBe(false);
  });
  it("accepts actual closed new and legacy contracts while refusing legacy scope expansion", () => {
    expect(visualContent(fixture.saved.version.content, fixture.saved.project_id)).toBe(true);
    expect(visualReport(fixture.prepared_submit.report)).toBe(true);
    expect(
      visualContent(
        {
          ...fixture.legacy_saved.version.content,
          environment_scope: fixture.saved.version.content.environment_scope,
        },
        fixture.saved.project_id,
      ),
    ).toBe(false);
    expect(
      visualEnvironmentChoicesWithinScope(
        fixture.board_request.content,
        fixture.legacy_saved.version.content,
      ),
    ).toBe(false);
    expect(
      visualEnvironmentChoicesWithinScope(
        fixture.board_request.content,
        fixture.saved.version.content,
      ),
    ).toBe(true);
    const bad = structuredClone(fixture.prepared_submit.report);
    bad.policy_version = "1";
    bad.report.policy_version = "1";
    expect(visualReport(bad)).toBe(false);
  });
  it("shows actual pinned world/state/refs in trusted confirmation and UNKNOWN remains one shot", async () => {
    const s = setup();
    const ticket = await s.controller.prepare(s.identity, s.input, s.origin);
    expect(ticket.kind).toBe("FOUND");
    if (ticket.kind !== "FOUND") throw Error("ticket");
    const dialog = vi.fn().mockResolvedValue(true);
    expect(
      (await s.controller.confirm(ticket.data, s.origin, new AbortController().signal, dialog))
        .kind,
    ).toBe("REMOTE_UNKNOWN");
    expect(dialog.mock.calls[0]?.[0]).toContain("雨后凌晨");
    expect(dialog.mock.calls[0]?.[0]).toContain(fixture.library.version_id);
    expect(dialog.mock.calls[0]?.[0]).toContain("空状态/参考清单只批准空范围");
    expect(s.library).toHaveBeenCalledTimes(2);
    expect(s.write).toHaveBeenCalledTimes(1);
    expect(
      (await s.controller.confirm(ticket.data, s.origin, new AbortController().signal, dialog))
        .kind,
    ).toBe("CANCELLED");
    expect(s.write).toHaveBeenCalledTimes(1);
  });
  it.each(["world", "state", "reference", "declaration", "policy"])(
    "rejects rehashed foreign %s projection before a trusted ticket",
    async (fault) => {
      const s = setup(),
        report = s.prepared.report.report;
      const projection = report.environment_projection as {
        world: Record<string, string>;
        states: Record<string, unknown>[];
        references: Record<string, unknown>[];
        declaration: Record<string, unknown>;
      };
      if (fault === "world") projection.world.rules = "foreign";
      if (fault === "state") projection.states[0]!.continuity = "foreign";
      if (fault === "reference") projection.references[0]!.asset_sha256 = "f".repeat(64);
      if (fault === "declaration") projection.declaration.scene_variant_ids = [];
      if (fault === "policy") report.policy_version = "1";
      s.prepared.report.report_hash = visualHash(report);
      expect((await s.controller.prepare(s.identity, s.input, s.origin)).kind).toBe(
        "REMOTE_UNKNOWN",
      );
      expect(s.write).not.toHaveBeenCalled();
      expect(
        visualEnvironmentEvidenceMatches(s.saved.version.content, fixture.library.content, report),
      ).toBe(false);
    },
  );
  it("a wrong exact library after prepare refuses confirm without opening a dialog", async () => {
    const s = setup();
    const ticket = await s.controller.prepare(s.identity, s.input, s.origin);
    if (ticket.kind !== "FOUND") throw Error("ticket");
    s.library.mockResolvedValue({
      kind: "FOUND",
      receipt: {
        data: { ...fixture.library, version_id: "ver_" + "f".repeat(32) },
        request_id: fixture.request_id,
      },
    });
    const dialog = vi.fn().mockResolvedValue(true);
    expect(
      (await s.controller.confirm(ticket.data, s.origin, new AbortController().signal, dialog))
        .kind,
    ).toBe("CANCELLED");
    expect(dialog).not.toHaveBeenCalled();
    expect(s.write).not.toHaveBeenCalled();
  });
});

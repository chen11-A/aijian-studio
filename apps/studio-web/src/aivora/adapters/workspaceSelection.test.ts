import { describe, expect, it } from "vitest";
import {
  persistWorkspaceSelection,
  readWorkspaceSelection,
  withEpisodeCreateMarker,
  withWorkspaceSelection,
  persistDraftReviewSelection,
} from "./workspaceSelection";

const projectA = "prj_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const projectB = "prj_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const episodeA = "ep_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
function memory(initial?: string, throws = false) {
  let value = initial ?? null;
  return {
    getItem: () => {
      if (throws) throw new Error("blocked");
      return value;
    },
    setItem: (_key: string, next: string) => {
      if (throws) throw new Error("blocked");
      value = next;
    },
    value: () => value,
  };
}

describe("workspace selection persistence", () => {
  it("restores review cursors for two projects and episodes while preserving creation markers", () => {
    const storage = memory();
    const old = { selection: null, createMarkers: { [projectA]: "UNKNOWN" as const } };
    expect(persistWorkspaceSelection(storage, old)).toBe(true);
    for (const [p, e, op] of [
      [projectA, episodeA, `dmp_${"1".repeat(32)}`],
      [projectA, `ep_${"b".repeat(32)}`, `dmp_${"2".repeat(32)}`],
      [projectB, episodeA, `dmp_${"3".repeat(32)}`],
    ] as const)
      expect(persistDraftReviewSelection(storage, p, e, op)).toBe(true);
    // The existing model may retain an older snapshot. It must not erase newer cursors.
    expect(persistWorkspaceSelection(storage, old)).toBe(true);
    const read = readWorkspaceSelection(storage);
    expect(read.kind).toBe("READY");
    if (read.kind !== "READY") throw Error("unreadable");
    expect(read.snapshot.reviewOperations).toEqual({
      [`${projectA}/${episodeA}`]: `dmp_${"1".repeat(32)}`,
      [`${projectA}/ep_${"b".repeat(32)}`]: `dmp_${"2".repeat(32)}`,
      [`${projectB}/${episodeA}`]: `dmp_${"3".repeat(32)}`,
    });
    expect(read.snapshot.createMarkers).toEqual(old.createMarkers);
    expect(persistDraftReviewSelection(storage, projectA, episodeA, "")).toBe(true);
    expect(readWorkspaceSelection(storage)).toMatchObject({
      kind: "READY",
      snapshot: { reviewOperations: { [`${projectB}/${episodeA}`]: `dmp_${"3".repeat(32)}` } },
    });
  });
  it("preserves corrupt cursor records and rejects noncanonical or unavailable writes", () => {
    const bad = JSON.stringify({
      version: 1,
      selection: null,
      createMarkers: {},
      reviewOperations: { bad: "bad" },
    });
    const storage = memory(bad);
    expect(readWorkspaceSelection(storage)).toEqual({ kind: "CORRUPT" });
    expect(persistDraftReviewSelection(storage, projectA, episodeA, `dmp_${"1".repeat(32)}`)).toBe(
      false,
    );
    expect(storage.value()).toBe(bad);
    expect(persistWorkspaceSelection(storage, { selection: null, createMarkers: {} })).toBe(false);
    expect(persistDraftReviewSelection(memory(), projectA, episodeA, "not-operation")).toBe(false);
    expect(persistDraftReviewSelection(memory(), "bad-project", episodeA, "")).toBe(false);
    expect(persistDraftReviewSelection(memory(undefined, true), projectA, episodeA, "")).toBe(
      false,
    );
  });
  it("stores only canonical opaque IDs and project-scoped markers", () => {
    const storage = memory();
    const snapshot = withEpisodeCreateMarker(
      withWorkspaceSelection(
        { selection: null, createMarkers: {} },
        { projectId: projectA, episodeId: episodeA },
      ),
      projectA,
      "UNKNOWN",
    );
    expect(persistWorkspaceSelection(storage, snapshot)).toBe(true);
    expect(readWorkspaceSelection(storage)).toEqual({ kind: "READY", snapshot });
    expect(storage.value()).not.toContain("title");
  });
  it("preserves other markers when an invalid marker operation is rejected", () => {
    const snapshot = {
      selection: { projectId: projectA, episodeId: episodeA },
      createMarkers: { [projectA]: "UNKNOWN", [projectB]: "PENDING" },
    } as const;
    expect(withEpisodeCreateMarker(snapshot, "not-a-project", null)).toEqual(snapshot);
    expect(
      withWorkspaceSelection(snapshot, {
        projectId: projectA,
        episodeId: "not-an-episode",
      } as never),
    ).toEqual(snapshot);
  });
  it("reports corrupt and unavailable reads without treating them as first use", () => {
    expect(
      readWorkspaceSelection(
        memory(
          '{"version":1,"selection":{"projectId":"' +
            projectA +
            '","episodeId":"' +
            episodeA +
            '","title":"bad"},"createMarkers":{}}',
        ),
      ),
    ).toEqual({ kind: "CORRUPT" });
    expect(
      readWorkspaceSelection(memory('{"version":1,"selection":null,"createMarkers":[] }')),
    ).toEqual({ kind: "CORRUPT" });
    expect(readWorkspaceSelection(memory(undefined, true))).toEqual({ kind: "UNAVAILABLE" });
    expect(readWorkspaceSelection(memory())).toEqual({
      kind: "READY",
      snapshot: { selection: null, createMarkers: {} },
    });
  });
});

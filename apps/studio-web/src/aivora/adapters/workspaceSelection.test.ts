import { describe, expect, it } from "vitest";
import {
  persistWorkspaceSelection,
  readWorkspaceSelection,
  withEpisodeCreateMarker,
  withWorkspaceSelection,
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

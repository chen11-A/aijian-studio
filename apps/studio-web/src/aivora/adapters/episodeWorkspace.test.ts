import { describe, expect, it } from "vitest";
import type { EpisodeCapability, StudioTransport } from "../../api/studio";
import {
  createEpisodeWorkspace,
  listEpisodeWorkspace,
  readEpisodeWorkspace,
} from "./episodeWorkspace";

const projectId = "prj_abc";
const episode = {
  id: "ep_abc",
  project_id: projectId,
  title: "真实剧集",
  position: "1",
  revision: "1",
  target_duration_seconds: null,
  is_default: false,
  created_at: "2026-09-14T00:00:00Z",
  updated_at: "2026-09-14T00:00:00Z",
};
function transport(episodes?: EpisodeCapability): StudioTransport {
  return { episodes } as StudioTransport;
}

describe("episode workspace adapter", () => {
  it("uses the desktop capability for list and explicit detail reads", async () => {
    const list = async () => ({ data: [episode], request_id: "list" });
    const get = async (actualProjectId: string, id: string) => ({
      data: { ...episode, project_id: actualProjectId, id },
      request_id: "get",
    });
    const capability = { list, get, create: async () => ({ kind: "REMOTE_UNKNOWN" as const }) };

    await expect(listEpisodeWorkspace(transport(capability), projectId)).resolves.toMatchObject({
      kind: "SUCCEEDED",
      receipt: { data: [{ id: "ep_abc" }] },
    });
    await expect(
      readEpisodeWorkspace(transport(capability), projectId, "ep_detail"),
    ).resolves.toMatchObject({
      kind: "SUCCEEDED",
      receipt: { data: { project_id: projectId, id: "ep_detail" } },
    });
  });

  it("does not substitute a browser fallback when the bridge is incomplete", async () => {
    await expect(listEpisodeWorkspace(transport(), projectId)).resolves.toEqual({
      kind: "UNAVAILABLE",
    });
    await expect(readEpisodeWorkspace(transport(), projectId, "ep")).resolves.toEqual({
      kind: "UNAVAILABLE",
    });
    await expect(createEpisodeWorkspace(transport(), projectId, { title: "x" })).resolves.toEqual({
      kind: "UNAVAILABLE",
    });
  });

  it("preserves definitive and unknown create outcomes without retrying", async () => {
    let calls = 0;
    const capability: EpisodeCapability = {
      list: async () => ({ data: [], request_id: "list" }),
      get: async () => ({ data: episode, request_id: "get" }),
      create: async () => {
        calls += 1;
        return {
          kind: "DEFINITE_SERVER_ERROR",
          status: 409,
          code: "EPISODE_CREATE_CONFLICT",
          request_id: "conflict",
        };
      },
    };
    await expect(
      createEpisodeWorkspace(transport(capability), projectId, { title: "x" }),
    ).resolves.toMatchObject({
      kind: "DEFINITE_SERVER_ERROR",
      status: 409,
    });
    expect(calls).toBe(1);
  });
});

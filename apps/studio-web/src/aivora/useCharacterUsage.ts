import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { components } from "@aijian/contracts";
import { createStudioTransport } from "../api/studio";
import {
  readStoryboard,
  STORYBOARD_EPISODE_ID,
  STORYBOARD_PROJECT_ID,
} from "./adapters/episodeStoryboard";
import type { StoryboardRead } from "./adapters/episodeStoryboard";

export type CharacterUsageEpisode = Pick<
  components["schemas"]["EpisodeData"],
  "id" | "project_id" | "title"
>;
export type CharacterUsageRow = { episode: CharacterUsageEpisode; result: StoryboardRead };
type UsageState = {
  scope: string;
  kind: "LOADING" | "READY" | "UNAVAILABLE" | "INVALID_SCOPE" | "WAITING";
  rows: CharacterUsageRow[];
};
export function useCharacterUsage(
  projectId: string,
  episodes: readonly CharacterUsageEpisode[],
  episodeListReady: boolean,
) {
  const gateway = useMemo(() => {
    const transport = createStudioTransport();
    return typeof transport.getEpisodeStoryboard === "function"
      ? { getEpisodeStoryboard: transport.getEpisodeStoryboard }
      : null;
  }, []);
  const scope = JSON.stringify([projectId, episodeListReady, episodes]);
  const currentEpisodes = useRef(episodes);
  currentEpisodes.current = episodes;
  const epoch = useRef(0);
  const [state, setState] = useState<UsageState>({ scope, kind: "LOADING", rows: [] });
  const read = useCallback(async () => {
    const request = ++epoch.current;
    const snapshot = currentEpisodes.current.map((episode) => ({ ...episode }));
    const set = (kind: UsageState["kind"], rows: CharacterUsageRow[] = []) => {
      if (request === epoch.current) setState({ scope, kind, rows });
    };
    if (!episodeListReady) {
      set("WAITING");
      return;
    }
    if (
      !STORYBOARD_PROJECT_ID.test(projectId) ||
      snapshot.some(
        (episode) => episode.project_id !== projectId || !STORYBOARD_EPISODE_ID.test(episode.id),
      ) ||
      new Set(snapshot.map((episode) => episode.id)).size !== snapshot.length
    ) {
      set("INVALID_SCOPE");
      return;
    }
    if (!gateway) {
      set("UNAVAILABLE");
      return;
    }
    set("LOADING");
    const rows: CharacterUsageRow[] = [];
    for (let offset = 0; offset < snapshot.length; offset += 4) {
      const batch = await Promise.all(
        snapshot.slice(offset, offset + 4).map(async (episode) => ({
          episode,
          result: await readStoryboard(gateway, projectId, episode.id),
        })),
      );
      if (request !== epoch.current) return;
      rows.push(...batch);
      set("LOADING", [...rows]);
    }
    set("READY", rows);
  }, [projectId, scope, episodeListReady, gateway]);
  useEffect(() => {
    void read();
    return () => {
      epoch.current += 1;
    };
  }, [read]);
  return {
    state: state.scope === scope ? state : { scope, kind: "LOADING" as const, rows: [] },
    refresh: read,
  };
}

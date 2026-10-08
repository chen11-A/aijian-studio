import { useEffect, useMemo, useState } from "react";
import { createStudioTransport } from "../api/studio";
import {
  sameStoryboardJson,
  validStoryboardVersion,
  type StoryboardGateway,
  type StoryboardVersion,
} from "./adapters/episodeStoryboard";

export type AssemblyStoryboardGateway = Partial<
  Pick<StoryboardGateway, "getEpisodeStoryboard" | "getEpisodeStoryboardVersion">
>;
type Source =
  | { state: "ready"; version: StoryboardVersion }
  | { state: "loading" | "empty" | "error"; version: null };
const loading: Source = { state: "loading", version: null };

/** Reads saved sources only. Late replies cannot retarget a different episode or pin. */
export function useAssemblyStoryboardSources(
  projectId: string,
  episodeId: string,
  versionId: string | undefined,
  supplied?: AssemblyStoryboardGateway,
) {
  const transport = useMemo(createStudioTransport, []);
  const gateway = supplied ?? transport;
  const [refresh, setRefresh] = useState(0);
  const key = `${projectId}/${episodeId}/${versionId ?? ""}/${refresh}`;
  const [snapshot, setSnapshot] = useState<{ key: string; latest: Source; pinned: Source }>();
  useEffect(() => {
    let active = true;
    async function readLatest(): Promise<Source> {
      try {
        const result = await gateway.getEpisodeStoryboard?.(projectId, episodeId);
        if (result?.kind === "EMPTY") return { state: "empty", version: null };
        if (
          result?.kind === "FOUND" &&
          validStoryboardVersion(result.receipt.data, projectId, episodeId)
        )
          return { state: "ready", version: result.receipt.data };
      } catch {
        /* Keep existing references when a source is unavailable. */
      }
      return { state: "error", version: null };
    }
    async function readPinned(): Promise<Source> {
      if (!versionId) return { state: "empty", version: null };
      try {
        const result = await gateway.getEpisodeStoryboardVersion?.(projectId, episodeId, versionId);
        if (
          result?.kind === "FOUND" &&
          result.receipt.data.version_id === versionId &&
          validStoryboardVersion(result.receipt.data, projectId, episodeId)
        )
          return { state: "ready", version: result.receipt.data };
      } catch {
        /* Exact source identity is never replaced with a latest-version fallback. */
      }
      return { state: "error", version: null };
    }
    void Promise.all([readLatest(), readPinned()]).then(([latest, pinned]) => {
      if (
        latest.state === "ready" &&
        pinned.state === "ready" &&
        (latest.version.version_number < pinned.version.version_number ||
          (latest.version.version_id === pinned.version.version_id &&
            (latest.version.version_number !== pinned.version.version_number ||
              latest.version.content_hash !== pinned.version.content_hash ||
              !sameStoryboardJson(latest.version.content, pinned.version.content))))
      )
        latest = { state: "error", version: null };
      if (active) setSnapshot({ key, latest, pinned });
    });
    return () => {
      active = false;
    };
  }, [gateway, projectId, episodeId, versionId, key]);
  return {
    latest: snapshot?.key === key ? snapshot.latest : loading,
    pinned: snapshot?.key === key ? snapshot.pinned : loading,
    refresh: () => setRefresh((value) => value + 1),
  };
}

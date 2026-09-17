import type {
  CreateEpisodeInput,
  EpisodeCreateResult,
  EpisodeListResponse,
  EpisodeResponse,
  StudioTransport,
} from "../../api/studio";

export type EpisodeListOutcome =
  { kind: "SUCCEEDED"; receipt: EpisodeListResponse } | { kind: "UNAVAILABLE" } | { kind: "ERROR" };
export type EpisodeReadOutcome =
  { kind: "SUCCEEDED"; receipt: EpisodeResponse } | { kind: "UNAVAILABLE" } | { kind: "ERROR" };

export async function listEpisodeWorkspace(
  transport: StudioTransport,
  projectId: string,
): Promise<EpisodeListOutcome> {
  if (!transport.episodes) return { kind: "UNAVAILABLE" };
  try {
    return { kind: "SUCCEEDED", receipt: await transport.episodes.list(projectId) };
  } catch {
    return { kind: "ERROR" };
  }
}

export async function readEpisodeWorkspace(
  transport: StudioTransport,
  projectId: string,
  episodeId: string,
): Promise<EpisodeReadOutcome> {
  if (!transport.episodes) return { kind: "UNAVAILABLE" };
  try {
    return { kind: "SUCCEEDED", receipt: await transport.episodes.get(projectId, episodeId) };
  } catch {
    return { kind: "ERROR" };
  }
}

export async function createEpisodeWorkspace(
  transport: StudioTransport,
  projectId: string,
  input: CreateEpisodeInput,
): Promise<EpisodeCreateResult | { kind: "UNAVAILABLE" }> {
  if (!transport.episodes) return { kind: "UNAVAILABLE" };
  return transport.episodes.create(projectId, input);
}

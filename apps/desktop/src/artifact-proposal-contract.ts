import type { ArtifactProposalResponse } from "@aijian/contracts/artifact-proposal";

import type { LocalApiClient } from "./api-client";

export {
  isArtifactProposalResponse,
  type ArtifactProposalResponse,
} from "@aijian/contracts/artifact-proposal";

export const ARTIFACT_PROPOSAL_CHANNELS = Object.freeze({ get: "proposals:get" } as const);

type ProposalClient = Pick<LocalApiClient, "getArtifactProposal">;
type ProposalInvoke = (channel: string, projectId: string, proposalId: string) => Promise<unknown>;

export function createArtifactProposalPreload(invoke: ProposalInvoke): {
  getArtifactProposal(projectId: string, proposalId: string): Promise<ArtifactProposalResponse>;
} {
  return {
    getArtifactProposal: (projectId, proposalId) =>
      invoke(
        ARTIFACT_PROPOSAL_CHANNELS.get,
        projectId,
        proposalId,
      ) as Promise<ArtifactProposalResponse>,
  };
}

export function registerArtifactProposalHandlers<TEvent>(
  handle: (
    channel: string,
    listener: (event: TEvent, projectId: string, proposalId: string) => Promise<unknown>,
  ) => void,
  clientFor: (event: TEvent) => ProposalClient,
): void {
  handle(ARTIFACT_PROPOSAL_CHANNELS.get, (event, projectId, proposalId) =>
    clientFor(event).getArtifactProposal(projectId, proposalId),
  );
}

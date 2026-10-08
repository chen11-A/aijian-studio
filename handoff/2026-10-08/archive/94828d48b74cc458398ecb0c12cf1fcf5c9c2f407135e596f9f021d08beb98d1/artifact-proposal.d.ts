import type { components } from "./generated.js";
export type ArtifactProposalResponse = components["schemas"]["ArtifactProposalResponse"];
export declare function isArtifactProposalResponse(value: unknown, expectedProjectId: string, expectedProposalId: string): value is ArtifactProposalResponse;

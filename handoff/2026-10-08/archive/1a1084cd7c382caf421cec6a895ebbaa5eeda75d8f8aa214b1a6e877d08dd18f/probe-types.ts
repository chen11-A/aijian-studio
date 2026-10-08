import type { components } from '@aijian/contracts';
import type { ArtifactProposalResponse } from '@aijian/contracts/artifact-proposal';
import type { InvalidationOperationResponse, InvalidationOperationPageQuery,
  InvalidationOperationPageResponse } from '@aijian/contracts/invalidation-operation';
type Root = components['schemas']['ArtifactProposalResponse'];
const root: Root | null = null;
const artifact: ArtifactProposalResponse | null = root;
const detail: InvalidationOperationResponse | null = null;
const query: InvalidationOperationPageQuery = { limit: 1 };
const page: InvalidationOperationPageResponse | null = null;
void [artifact, detail, query, page];

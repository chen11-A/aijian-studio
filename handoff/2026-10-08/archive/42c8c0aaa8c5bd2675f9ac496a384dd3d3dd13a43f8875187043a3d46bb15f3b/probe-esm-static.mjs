import assert from 'node:assert/strict';
import { default as generatedRuntime } from '@aijian/contracts';
import { isArtifactProposalResponse } from '@aijian/contracts/artifact-proposal';
import { validateInvalidationOperationPageQuery,
  isInvalidationOperationPageResponse, isInvalidationOperationResponse
} from '@aijian/contracts/invalidation-operation';
assert.equal(typeof generatedRuntime, 'object');
for (const symbol of [isArtifactProposalResponse, validateInvalidationOperationPageQuery,
  isInvalidationOperationPageResponse, isInvalidationOperationResponse]) {
  assert.equal(typeof symbol, 'function');
}
process.stdout.write(JSON.stringify({state:'ESM_STATIC_NAMED_IMPORT_PASS',
  root:'default as generatedRuntime (root has no runtime named symbols)',
  named:['isArtifactProposalResponse','validateInvalidationOperationPageQuery',
    'isInvalidationOperationPageResponse','isInvalidationOperationResponse']})+'\n');

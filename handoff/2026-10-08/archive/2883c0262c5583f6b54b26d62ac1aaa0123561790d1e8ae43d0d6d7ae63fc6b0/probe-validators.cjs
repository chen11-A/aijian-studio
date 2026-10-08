const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');
const sampleSha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').toUpperCase();
const path = require('node:path');
const app = process.argv[2];
assert.ok(app);
const load = createRequire(path.join(app, 'dist', 'api-client.js'));
const { isArtifactProposalResponse } = load('@aijian/contracts/artifact-proposal');
const { validateInvalidationOperationPageQuery, isInvalidationOperationPageResponse,
  isInvalidationOperationResponse } = load('@aijian/contracts/invalidation-operation');
const id = (prefix, char) => `${prefix}_${char.repeat(32)}`;
const project = id('prj', '1');
const proposal = id('prp', '2');
const operation = id('ivo', '7');
const request_id = 'e6225937-1243-427b-bc98-56eda28e9dd3';
const proposalResponse = { data: {
  project_id: project, proposal_id: proposal, producer_attempt_id: id('att', '3'),
  proposal_hash: `sha256:${'4'.repeat(64)}`, created_at: '2026-08-11T09:00:00Z',
  proposal: { schema_version: '1.0.0', proposal_id: proposal, project_id: project,
    target_artifact_type: 'SourceExtraction', payload: { summary: 'evidence' },
    payload_hash: `sha256:${'5'.repeat(64)}`, source_spans: [{
      source_span_id: id('spn','6'), source_document_id: id('src','7'),
      source_block_id: id('srcb','8'), start_byte: 0, end_byte: 12,
      claim: 'The letter is unsigned.', quote_hash: `sha256:${'9'.repeat(64)}`,
    }], claims: [], diff: [], dependencies: [], impacts: [],
    cost: { currency: 'USD', estimated_micros: 0, actual_micros: 0 },
    confidence_basis_points: 9200, capability_losses: [],
    qc: [{ check_id: 'source.evidence', status: 'PASS', details: 'Evidence bound' }],
    producer_agent_run_id: id('agr','b'), producer_skill_run_id: id('skr','c'),
  },
}, request_id };
assert.equal(isArtifactProposalResponse(proposalResponse, project, proposal), true);
const detached = structuredClone(proposalResponse);
detached.data.proposal.project_id = id('prj','d');
assert.equal(isArtifactProposalResponse(detached, project, proposal), false);
assert.deepEqual(validateInvalidationOperationPageQuery({limit: 1, cursor: null}), {limit: 1, cursor: null});
assert.throws(() => validateInvalidationOperationPageQuery({limit: 0}));
const data = { operation_id: operation, project_id: project,
  changed_artifact_id: id('art','8'), old_accepted_version_id: id('ver','9'),
  new_accepted_version_id: id('ver','a'), gate_decision_id: id('dec','b'),
  assessment_hash: `sha256:${'c'.repeat(64)}`, created_at: '2026-09-03T09:00:00Z',
  paths: [] };
const detail = { data, request_id };
assert.equal(isInvalidationOperationResponse(detail, project, operation), true);
assert.equal(isInvalidationOperationResponse(detail, id('prj','d'), operation), false);
const page = { data: { items: [{
  operation_id: operation, project_id: project, changed_artifact_id: data.changed_artifact_id,
  old_accepted_version_id: data.old_accepted_version_id,
  new_accepted_version_id: data.new_accepted_version_id,
  gate_decision_id: data.gate_decision_id, assessment_hash: data.assessment_hash,
  created_at: data.created_at, reason_path_count: 0,
}], next_cursor: operation }, request_id };
assert.equal(isInvalidationOperationPageResponse(page, project, {limit:1}), true);
assert.equal(isInvalidationOperationPageResponse(page, project, {}), false);
process.stdout.write(JSON.stringify({state:'FOUR_VALIDATORS_VALID_INVALID_PASS',
  validators:['isArtifactProposalResponse','validateInvalidationOperationPageQuery',
  'isInvalidationOperationPageResponse','isInvalidationOperationResponse'], vectors:8, sampleSha256:{ proposalValid:sampleSha(proposalResponse), proposalInvalid:sampleSha(detached), queryValid:sampleSha({limit:1,cursor:null}), queryInvalid:sampleSha({limit:0}), pageValid:sampleSha(page), pageInvalidQuery:sampleSha({page,query:{}}), detailValid:sampleSha(detail), detailInvalidProject:sampleSha({detail,project:id('prj','d')}) }})+'\n');

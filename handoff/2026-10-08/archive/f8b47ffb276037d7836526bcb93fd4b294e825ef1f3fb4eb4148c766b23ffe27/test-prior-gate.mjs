import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { validateAttempt02Prior } from '../../attempt02-prior-gate.mjs';
import { validateAttempt03Prior } from '../../attempt03-prior-gate.mjs';

const owned = resolve(import.meta.dirname, '../..');
const evidence = join(owned, 'evidence');
const first = join(evidence, 'qa02-bm-click-2026-09-24T03-47-31.678Z-13852');
const secondId = 'qa02-submit-attempt02-20260924T044400Z-mgr02b';
const secondExec = join(evidence, 'attempt02-execution-20260924T044400Z-mgr02b');
const inputText = readFileSync('C:/Users/Administrator/Documents/AIVORA/production/inputs/20260924/离别30秒剧本.md', 'utf8');
const inputHash = '466f23b789b47fa1231b0891e80385a13e530b02de2f74481c4e98f5732de008';
const firstLedgerHash = '8c2f15cfc225421736e52c4d4ad4060ba81be5295f3686d634bd420d1a0726b0';
const secondLedgerHash = '7de19a96766f29cca2360beec2071a66cf10c4c6332e8e5d5df9750f81489940';
const secondApprovalHash = '57013b9a15986e84877859782fb0d878c8a8e474b11b088527f7650d0223f713';
const secondReviewHash = 'c487ba05cfe68db64ed23d1ba731c51278e685141aba1111269ea66e7ed97d6f';
const parse = (path) => JSON.parse(readFileSync(path, 'utf8'));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const firstProof = {
  firstResult: parse(join(first, 'result.json')),
  firstNative: parse(join(first, 'native-bm-click.json')),
  readbacks: parse(join(first, 'post-send-authoritative-readbacks.json')),
  firstPostclose: parse(join(evidence, 'm1-layout07-native-submit-20260924T040958Z', 'postclose.json')),
  focusReview: parse(join(evidence, 'focus-launch-20260924T042032Z-mgr02c', 'focus-probe-review.json')),
  inputText, inputHash, firstLedgerHash,
};
const firstSummary = validateAttempt02Prior(firstProof);
const secondLedgerPath = join(evidence,
  `bm-click-short-submit-569e8b63a2545d7178e18b22348330b10d8e5b628410b4e45732e4b3ccffc21f-attempt02-${secondId}.ledger.json`);
assert.equal(sha(readFileSync(secondLedgerPath)), secondLedgerHash);
assert.equal(sha(readFileSync(join(owned, 'attempt02-approval-20260924T044400Z-mgr02b.json'))),
  secondApprovalHash);
assert.equal(sha(readFileSync(join(secondExec, 'attempt02-review.json'))), secondReviewHash);
const secondProof = {
  secondApproval: parse(join(owned, 'attempt02-approval-20260924T044400Z-mgr02b.json')),
  secondResult: parse(join(evidence, secondId, 'result.json')),
  secondLedger: parse(secondLedgerPath),
  secondReview: parse(join(secondExec, 'attempt02-review.json')),
  secondOuter: parse(join(secondExec, 'run.json')),
  secondOs: parse(join(secondExec, 'postrun-os-check.json')),
  secondAudit: parse(join(secondExec, 'postrun-hash-audit.json')),
  firstLedgerHash, secondLedgerHash, secondApprovalHash, inputHash,
};
assert.equal(secondProof.secondReview.files.length, 22);
for (const file of secondProof.secondReview.files) {
  const bytes = readFileSync(file.path);
  assert.equal(bytes.length, file.bytes, `${file.path} byte count`);
  assert.equal(sha(bytes), file.sha256.toLowerCase(), `${file.path} hash`);
}
const secondSummary = validateAttempt03Prior(secondProof);
const mutations = [
  ['second_native_probe_present', (x) => { x.secondResult.probe = { code: 0 }; }],
  ['second_native_action_true', (x) => { x.secondReview.native_action_attempted = true; }],
  ['second_electron_launched', (x) => { x.secondReview.electron_launch_reached = true; }],
  ['second_ledger_outcome_changed', (x) => { x.secondLedger.outcome = 'SUCCEEDED'; }],
  ['second_profile_not_empty', (x) => { x.secondOs.profile_root_items = ['SingletonLock']; }],
  ['second_hash_drift', (x) => { x.secondAudit.hash_mismatches = ['changed']; }],
  ['first_ledger_mismatch', (x) => { x.firstLedgerHash = '0'.repeat(64); }],
];
const rejected = [];
for (const [name, change] of mutations) {
  const altered = structuredClone(secondProof);
  change(altered);
  assert.throws(() => validateAttempt03Prior(altered), undefined, `${name} accepted`);
  rejected.push(name);
}
const report = { status: 'PASS', scope: 'OFFLINE_PRIOR_ATTEMPT_EVIDENCE_ONLY',
  attempt01: firstSummary, attempt02: secondSummary,
  attempt02_sealed_file_count: secondProof.secondReview.files.length,
  rejected_mutations: rejected, electron_launched: false,
  new_attempt_ledger_created: false, native_send_attempted: false };
writeFileSync(join(import.meta.dirname, 'prior-gate-test.json'), JSON.stringify(report, null, 2));
process.stdout.write(`${JSON.stringify(report)}\n`);

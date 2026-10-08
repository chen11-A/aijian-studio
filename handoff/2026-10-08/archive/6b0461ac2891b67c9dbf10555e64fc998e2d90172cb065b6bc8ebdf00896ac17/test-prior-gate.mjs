import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { validateAttempt02Prior } from '../../attempt02-prior-gate.mjs';

const owned = resolve(import.meta.dirname, '../..');
const first = join(owned, 'evidence', 'qa02-bm-click-2026-09-24T03-47-31.678Z-13852');
const parse = (path) => JSON.parse(readFileSync(path, 'utf8'));
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const original = {
  firstResult: parse(join(first, 'result.json')),
  firstNative: parse(join(first, 'native-bm-click.json')),
  readbacks: parse(join(first, 'post-send-authoritative-readbacks.json')),
  firstPostclose: parse(join(owned, 'evidence', 'm1-layout07-native-submit-20260924T040958Z', 'postclose.json')),
  focusReview: parse(join(owned, 'evidence', 'focus-launch-20260924T042032Z-mgr02c', 'focus-probe-review.json')),
  inputText: readFileSync('C:/Users/Administrator/Documents/AIVORA/production/inputs/20260924/离别30秒剧本.md', 'utf8'),
  inputHash: '466f23b789b47fa1231b0891e80385a13e530b02de2f74481c4e98f5732de008',
  firstLedgerHash: '8c2f15cfc225421736e52c4d4ad4060ba81be5295f3686d634bd420d1a0726b0',
};
const expected = {
  firstResult: '4b06250b4bf5c452c617af3881513240fb1d8c5879dceb1d545f654f1a52e67a',
  firstNative: '0e5bac5241530e0910857e017a4e4b151ed3cfebd79ff5dcda546d0cf36525dd',
  readbacks: '18d6e542dabc3333d2eafe8bc990d624134b63b3781a030bce859d326b621039',
  firstPostclose: '78ab83d726b00380604f048f7c575180a0b4a545e747366f85eb845690502a5d',
  focusReview: 'f5814700a90bcfd77e5c4a34a1edce42e461bcbda46b059e66341d8983c0ec7d',
  firstLedger: original.firstLedgerHash,
};
const paths = {
  firstResult: join(first, 'result.json'),
  firstNative: join(first, 'native-bm-click.json'),
  readbacks: join(first, 'post-send-authoritative-readbacks.json'),
  firstPostclose: join(owned, 'evidence', 'm1-layout07-native-submit-20260924T040958Z', 'postclose.json'),
  focusReview: join(owned, 'evidence', 'focus-launch-20260924T042032Z-mgr02c', 'focus-probe-review.json'),
  firstLedger: join(owned, 'evidence', 'bm-click-short-submit-569e8b63a2545d7178e18b22348330b10d8e5b628410b4e45732e4b3ccffc21f.ledger.json'),
};
for (const [key, path] of Object.entries(paths)) {
  assert.equal(sha(path), expected[key], `${key} hash mismatch`);
}
const passed = validateAttempt02Prior(original);
const mutations = [
  ['native_action_true', (x) => { x.firstNative.native_action_attempted = true; }],
  ['send_nonnull', (x) => { x.firstNative.send = { api_return: 1 }; }],
  ['review_version_present', (x) => { x.readbacks[11].value.manifest.data.head.review_version_id = 'ver_changed'; }],
  ['readback_text_changed', (x) => { x.readbacks[3].value.sourceText.data.normalized_text += 'x'; }],
  ['abnormal_close', (x) => { x.firstPostclose.normal_close = false; }],
  ['focus_call_occurred', (x) => { x.focusReview.focus_call_count = 1; }],
  ['old_ledger_changed', (x) => { x.firstLedgerHash = '0'.repeat(64); }],
];
const rejected = [];
for (const [name, mutate] of mutations) {
  const altered = structuredClone(original);
  mutate(altered);
  assert.throws(() => validateAttempt02Prior(altered), undefined, `${name} accepted`);
  rejected.push(name);
}
const report = { status: 'PASS', scope: 'OFFLINE_PRIOR_EVIDENCE_GATE_ONLY',
  baseline: passed, rejected_mutations: rejected, verified_sha256: expected,
  electron_launched: false, profile_created: false, native_send_attempted: false };
writeFileSync(join(import.meta.dirname, 'prior-gate-test.json'), JSON.stringify(report, null, 2));
process.stdout.write(`${JSON.stringify(report)}\n`);

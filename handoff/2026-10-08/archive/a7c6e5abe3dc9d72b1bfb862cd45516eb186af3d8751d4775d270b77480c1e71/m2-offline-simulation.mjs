import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { runM2Once } from './m2-once-flow.mjs';

const frozen = Buffer.from('\uFEFF离别\r\nA\u0301\rB', 'utf8');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const normalized = '离别\nÁ\nB';
const h = Object.freeze({ project_id: 'prj_' + '1'.repeat(32), project_name: 'simulation',
  source_document_id: 'src_' + '2'.repeat(32),
  source_manifest_version_id: 'ver_' + '3'.repeat(32),
  accepted_version_id: 'ver_' + '3'.repeat(32), latest_version_id: 'ver_' + '3'.repeat(32),
  source_manifest_content_hash: 'sha256:' + '4'.repeat(64),
  source_text_sha256: hash(frozen), input_sha256: hash(frozen) });
const source = { project: { data: { id: h.project_id, name: h.project_name } },
  manifest: { data: { project_id: h.project_id,
    head: { accepted_version_id: h.accepted_version_id,
      latest_version_id: h.latest_version_id },
    accepted_version: { id: h.accepted_version_id,
      content_hash: h.source_manifest_content_hash,
      content: { documents: [{ source_document_id: h.source_document_id,
        raw_sha256: h.source_text_sha256,
        normalized_sha256: hash(Buffer.from(normalized)), byte_size: frozen.length }] } },
    latest_version: { id: h.latest_version_id } } },
  source: { data: { id: h.source_document_id, project_id: h.project_id,
    raw_sha256: h.source_text_sha256, byte_size: frozen.length } },
  sourceText: { data: { id: h.source_document_id, project_id: h.project_id,
    raw_sha256: h.source_text_sha256, normalized_text: normalized,
    normalized_sha256: hash(Buffer.from(normalized)) } } };
const clips = [1, 2, 3].map((index) =>
  ({ clip_id: `clip-${index}`, duration_frames: 125 }));
const timeline = (revision, order) => ({ data: {
  project_id: h.project_id, version_id: `ver_${String(revision).repeat(32)}`,
  content_hash: `sha256:${String(revision).repeat(64)}`, total_duration_frames: 375,
  timeline: { revision, width: 1080, height: 1920,
    sequence_timebase: { frame_rate: { num: 25, den: 1 } },
    clips: order.map((index) => clips[index]), assets: [1, 2, 3],
    media_package: { media_package_id: 'fmp_' + '6'.repeat(32) } } } });
const original = timeline(1, [0, 1, 2]);
const edited = timeline(2, [1, 0, 2]);
const operationId = '11111111-1111-4111-8111-111111111111';
const receipt = { data: { status: 'SUCCEEDED', project_id: h.project_id,
  operation_id: operationId, timeline_version_id: edited.data.version_id,
  timeline_content_hash: edited.data.content_hash, timeline_revision: 2,
  purpose: 'DEVELOPMENT_EVIDENCE', export_id: 'dex_' + '7'.repeat(32),
  output: { duration_frames: 375, width: 1080, height: 1920,
    frame_rate_num: 25, frame_rate_den: 1, byte_length: 100,
    sha256: 'sha256:' + '8'.repeat(64) } } };

function fakeDriver(failAt = null) {
  const calls = [];
  let timelineReads = 0;
  const step = (name, result) => async () => {
    calls.push(name);
    if (failAt === name) throw new Error(`${name} simulated ambiguous result`);
    return result;
  };
  return { calls,
    open: step('open'), sessionIdentity: step('sessionIdentity', { pid: 123 }),
    capture: step('capture'),
    readSource: step('readSource', source),
    readFrozenSourceBytes: step('readFrozenSourceBytes', frozen),
    prepareFake: step('prepareFake'),
    submitFakeOnce: step('submitFakeOnce', { operation_id: operationId,
      task_id: 'task_1', attempt_id: 'att_' + '9'.repeat(32) }),
    waitTaskAndMedia: step('waitTaskAndMedia', { task_id: 'task_1',
      status: 'SUCCEEDED', output_version_id: original.data.version_id }),
    readTimeline: async () => { calls.push('readTimeline'); return ++timelineReads === 1 ? original : edited; },
    verifyPackage: step('verifyPackage', { manifest_hash_match: true,
      preview_hashes_match: true, source_binding_match: true }),
    reorderFirstOnce: step('reorderFirstOnce'), prepareExport: step('prepareExport'),
    exportOnce: step('exportOnce', { operation_id: operationId, receipt }),
    verifyFileAndPlayback: step('verifyFileAndPlayback', { file_hash_match: true,
      ffprobe_match: true, playback_ended: true }),
    close: step('close'), closedIdentity: step('closedIdentity',
      { normal_close: true, singleton_lock_absent: true }),
    verifyPostcloseProvenance: step('verifyPostcloseProvenance',
      { verified: { kind: 'SQLITE_READ_ONLY_PROVENANCE' } }) };
}

const cases = [
  ['success', null, 'M2_DEVELOPMENT_MP4_PASS', 'verifyFileAndPlayback'],
  ['fake_unknown', 'submitFakeOnce', 'M2_FAIL_OR_UNKNOWN', 'submitFakeOnce'],
  ['reorder_unknown', 'reorderFirstOnce', 'M2_FAIL_OR_UNKNOWN', 'reorderFirstOnce'],
  ['export_unknown', 'exportOnce', 'M2_FAIL_OR_UNKNOWN', 'exportOnce'],
  ['playback_unknown', 'verifyFileAndPlayback', 'M2_FAIL_OR_UNKNOWN',
    'verifyFileAndPlayback'],
];
for (const [name, failure, expected, lastAction] of cases) {
  const driver = fakeDriver(failure);
  const events = [];
  const result = await runM2Once(driver, h, async (event, payload) => {
    events.push({ event, payload });
  });
  assert.equal(result.kind, expected, name);
  assert.equal(driver.calls.filter((item) => item === 'submitFakeOnce').length, 1, name);
  assert.ok(driver.calls.includes(lastAction), name);
  assert.equal(driver.calls.filter((item) => item === 'close').length, 1, name);
  assert.equal(driver.calls.filter((item) => item === 'verifyPostcloseProvenance').length,
    name === 'success' ? 1 : 0, name);
  assert.equal(driver.calls.filter((item) => item === 'exportOnce').length,
    ['success', 'export_unknown', 'playback_unknown'].includes(name) ? 1 : 0, name);
  if (failure) assert.ok(!driver.calls.includes('verifyFileAndPlayback') ||
    failure === 'verifyFileAndPlayback', name);
  assert.ok(events.some((item) => item.event === 'normal_close'), name);
  assert.equal(events.at(-1).event, name === 'success' ? 'postclose_provenance' : 'normal_close', name);
  process.stdout.write(`${name}: ${result.kind}; actions=${driver.calls.join(',')}\n`);
}

for (const [name, mutate, rawEvent] of [
  ['source_body_tampered', (driver) => {
    const altered = structuredClone(source);
    altered.sourceText.data.normalized_text = '正文被改写';
    driver.readSource = async () => altered;
  }, 'source_get_raw'],
  ['timeline_format_invalid', (driver) => {
    driver.readTimeline = async () => ({ data: { ...original.data,
      total_duration_frames: 374 } });
  }, 'initial_timeline_get_raw'],
]) {
  const driver = fakeDriver();
  mutate(driver);
  const events = [];
  const result = await runM2Once(driver, h, async (event, payload) => {
    events.push({ event, payload });
  });
  assert.equal(result.kind, 'M2_FAIL_OR_UNKNOWN', name);
  const rawIndex = events.findIndex((item) => item.event === rawEvent);
  const stopIndex = events.findIndex((item) => item.event === 'stopped');
  assert.ok(rawIndex >= 0 && stopIndex > rawIndex, `${name} lost raw GET before rejection`);
  assert.ok(events.some((item) => item.event === 'normal_close'), name);
  process.stdout.write(`${name}: raw GET recorded before semantic rejection; normal close\n`);
}

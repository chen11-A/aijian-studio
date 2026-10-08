import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { verifySource, verifyTaskOutput } from './m2-once-flow.mjs';
import { readPostcloseProvenance, verifyProvenanceRows } from './m2-provenance.mjs';
import { playbackProbeInPage } from './m2-media-events.mjs';
import { verifyApprovedScripts } from './run-m2-native-once.draft.mjs';

const work = dirname(fileURLToPath(import.meta.url));
const sha = (value) => createHash('sha256').update(value).digest('hex');
const frozen = Buffer.from('\uFEFF离别\r\nA\u0301\rB', 'utf8');
const normalized = '离别\nÁ\nB';
const rawHash = sha(frozen);
const normalizedHash = sha(Buffer.from(normalized));
const h = { project_id: 'prj_' + '1'.repeat(32), project_name: 'offline',
  source_document_id: 'src_' + '2'.repeat(32),
  accepted_version_id: 'ver_' + '3'.repeat(32),
  latest_version_id: 'ver_' + '3'.repeat(32),
  source_manifest_content_hash: 'sha256:' + '4'.repeat(64),
  source_text_sha256: rawHash, input_sha256: rawHash };
const readback = { project: { data: { id: h.project_id, name: h.project_name } },
  manifest: { data: { project_id: h.project_id,
    head: { accepted_version_id: h.accepted_version_id,
      latest_version_id: h.latest_version_id },
    accepted_version: { id: h.accepted_version_id,
      content_hash: h.source_manifest_content_hash,
      content: { documents: [{ source_document_id: h.source_document_id,
        raw_sha256: rawHash, normalized_sha256: normalizedHash,
        byte_size: frozen.length }] } },
    latest_version: { id: h.latest_version_id } } },
  source: { data: { project_id: h.project_id, id: h.source_document_id,
    raw_sha256: rawHash, byte_size: frozen.length } },
  sourceText: { data: { project_id: h.project_id, id: h.source_document_id,
    raw_sha256: rawHash, normalized_sha256: normalizedHash,
    normalized_text: normalized } } };

assert.equal(verifySource(readback, h, frozen).normalized_sha256, normalizedHash);
process.stdout.write('BOM/CRLF/NFC normalized full-text success\n');
const changedText = structuredClone(readback);
changedText.sourceText.data.normalized_text = '正文被改写';
assert.throws(() => verifySource(changedText, h, frozen), /SOURCE_TEXT/);
process.stdout.write('tampered body with unchanged declared hash: SOURCE_TEXT rejected\n');

const fake = { task_id: 'task_' + '5'.repeat(32),
  attempt_id: 'att_' + '6'.repeat(32) };
const initialVersion = 'ver_' + '7'.repeat(32);
const editedVersion = 'ver_' + '8'.repeat(32);
const original = { data: { version_id: initialVersion,
  content_hash: 'sha256:' + 'a'.repeat(64) } };
const edited = { data: { version_id: editedVersion,
  content_hash: 'sha256:' + 'b'.repeat(64) } };
const task = { task_id: fake.task_id, status: 'SUCCEEDED',
  output_version_id: initialVersion };
verifyTaskOutput(task, fake, original);
assert.throws(() => verifyTaskOutput({ ...task, output_version_id: null }, fake), /TASK_UNKNOWN/);
assert.throws(() => verifyTaskOutput({ ...task, output_version_id: editedVersion },
  fake, original), /TASK_TIMELINE_IDENTITY/);
process.stdout.write('missing/mismatched task output version: rejected before package read\n');

const artifactId = 'art_' + '9'.repeat(32);
const rows = { source_heads: [{ accepted_version_id: h.accepted_version_id,
  latest_version_id: h.accepted_version_id }], versions: [
  { version_id: initialVersion, artifact_id: artifactId,
    parent_version_id: null, producer_attempt_id: fake.attempt_id,
    content_hash: original.data.content_hash, project_id: h.project_id,
    artifact_type: 'timeline' },
  { version_id: editedVersion, artifact_id: artifactId,
    parent_version_id: initialVersion, producer_attempt_id: null,
    content_hash: edited.data.content_hash, project_id: h.project_id,
    artifact_type: 'timeline' },
], dependencies: [{ dependency_id: 'dep_' + 'c'.repeat(32),
  downstream_artifact_id: artifactId, downstream_version_id: initialVersion,
  upstream_version_id: h.accepted_version_id, upstream_artifact_type: 'source_manifest',
  upstream_project_id: h.project_id, relationship: 'derived_from', impact: 'blocking' }] };
assert.equal(verifyProvenanceRows(rows, original, edited, h, fake, task).kind,
  'SQLITE_READ_ONLY_PROVENANCE');
const wrongEdge = structuredClone(rows);
wrongEdge.dependencies[0].upstream_version_id = 'ver_' + 'd'.repeat(32);
assert.throws(() => verifyProvenanceRows(wrongEdge, original, edited, h, fake, task),
  /TIMELINE_DEPENDENCY/);
const wrongParent = structuredClone(rows);
wrongParent.versions[1].parent_version_id = 'ver_' + 'e'.repeat(32);
assert.throws(() => verifyProvenanceRows(wrongParent, original, edited, h, fake, task),
  /TIMELINE_DEPENDENCY/);
const wrongHead = structuredClone(rows);
wrongHead.source_heads[0].accepted_version_id = 'ver_' + 'e'.repeat(32);
assert.throws(() => verifyProvenanceRows(wrongHead, original, edited, h, fake, task),
  /TIMELINE_DEPENDENCY/);
process.stdout.write('wrong derived_from/parent/accepted head: postclose provenance rejected\n');
const fixtureRoot = join(work, 'synthetic-postclose-sqlite-fixture-v2');
const fixturePath = join(fixtureRoot, 'workspace.sqlite3');
if (!existsSync(fixturePath)) {
  mkdirSync(fixtureRoot, { recursive: true });
  const db = new DatabaseSync(fixturePath);
  try {
    db.exec(`CREATE TABLE artifacts (artifact_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL, artifact_type TEXT NOT NULL);
      CREATE TABLE artifact_versions (version_id TEXT PRIMARY KEY,
      artifact_id TEXT NOT NULL, parent_version_id TEXT, content_hash TEXT NOT NULL,
      producer_attempt_id TEXT);
      CREATE TABLE artifact_dependencies (dependency_id TEXT PRIMARY KEY,
      downstream_artifact_id TEXT NOT NULL, downstream_version_id TEXT NOT NULL,
      upstream_artifact_id TEXT NOT NULL, upstream_version_id TEXT NOT NULL,
      relationship TEXT NOT NULL, impact TEXT NOT NULL);
      CREATE TABLE artifact_heads (artifact_id TEXT PRIMARY KEY,
      accepted_version_id TEXT, latest_version_id TEXT NOT NULL);`);
    const upstreamId = 'art_' + 'f'.repeat(32);
    db.prepare('INSERT INTO artifacts VALUES (?, ?, ?)').run(artifactId, h.project_id, 'timeline');
    db.prepare('INSERT INTO artifacts VALUES (?, ?, ?)').run(upstreamId, h.project_id,
      'source_manifest');
    db.prepare('INSERT INTO artifact_heads VALUES (?, ?, ?)').run(upstreamId,
      h.accepted_version_id, h.accepted_version_id);
    for (const row of rows.versions)
      db.prepare('INSERT INTO artifact_versions VALUES (?, ?, ?, ?, ?)')
        .run(row.version_id, row.artifact_id, row.parent_version_id,
          row.content_hash, row.producer_attempt_id);
    db.prepare('INSERT INTO artifact_dependencies VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(rows.dependencies[0].dependency_id, artifactId, initialVersion,
        upstreamId, h.accepted_version_id, 'derived_from', 'blocking');
  } finally { db.close(); }
}
const fixtureHashBefore = sha(readFileSync(fixturePath));
const databaseReadback = readPostcloseProvenance(fixtureRoot, original, edited, h);
assert.equal(verifyProvenanceRows(databaseReadback.raw_rows, original, edited, h, fake, task)
  .kind, 'SQLITE_READ_ONLY_PROVENANCE');
assert.equal(sha(readFileSync(fixturePath)), fixtureHashBefore);
process.stdout.write('synthetic workspace SQLite mode=ro/query_only: schema query pass, DB bytes unchanged\n');

class FakeVideo {
  constructor({ readyState = 2, seekEvent = true, hangPlay = false,
    endEvent = true, initialTime = 0 } = {}) {
    this.readyState = readyState;
    this.seekEvent = seekEvent;
    this.hangPlay = hangPlay;
    this.endEvent = endEvent;
    this.time = initialTime;
    this.duration = 15;
    this.videoWidth = 1080;
    this.videoHeight = 1920;
    this.ended = false;
    this.listeners = new Map();
    this.pauseCount = 0;
  }
  addEventListener(name, fn) {
    const listeners = this.listeners.get(name) ?? new Set();
    listeners.add(fn); this.listeners.set(name, listeners);
  }
  removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
  emit(name) { for (const fn of [...(this.listeners.get(name) ?? [])]) fn(); }
  listenerCount() { return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0); }
  get currentTime() { return this.time; }
  set currentTime(value) { this.time = value; if (this.seekEvent) this.emit('seeked'); }
  play() {
    if (this.hangPlay) return new Promise(() => {});
    this.time += 0.4;
    if (this.time >= 14.5) {
      this.ended = true;
      if (this.endEvent) this.emit('ended');
    }
    return Promise.resolve();
  }
  pause() { this.pauseCount += 1; }
}
const oldDocument = globalThis.document;
try {
  let active = null;
  globalThis.document = { createElement: () => ({ getContext: () => ({
    drawImage() {}, getImageData() {
      return { data: [Math.floor(active.currentTime), 20, 30, 255] };
    },
  }) }) };
  active = new FakeVideo();
  const playback = await playbackProbeInPage(active,
    { eventMs: 25, playMs: 25, endedMs: 25, sampleMs: 1 });
  assert.equal(playback.ended, true);
  assert.equal(active.listenerCount(), 0);
  process.stdout.write('bounded playback fixture: metadata/seek/frame/ended success\n');
  for (const [name, video, expected] of [
    ['loadedmetadata', new FakeVideo({ readyState: 0 }), /loadedmetadata timeout/],
    ['seeked', new FakeVideo({ initialTime: 1, seekEvent: false }), /seeked timeout/],
    ['play', new FakeVideo({ hangPlay: true }), /play timeout/],
    ['ended', new FakeVideo({ endEvent: false }), /ended timeout/],
  ]) {
    active = video;
    await assert.rejects(playbackProbeInPage(video,
      { eventMs: 20, playMs: 20, endedMs: 20, sampleMs: 1 }), expected);
    assert.equal(video.listenerCount(), 0, `${name} leaked listener`);
    assert.ok(video.pauseCount >= 1, `${name} did not pause in finally`);
    process.stdout.write(`${name} absent/hung: bounded rejection and listener cleanup\n`);
  }
} finally { globalThis.document = oldDocument; }

const hashFile = (name) => sha(readFileSync(join(work, name)));
const approval = { runner_sha256: hashFile('run-m2-native-once.draft.mjs'),
  flow_sha256: hashFile('m2-once-flow.mjs'),
  driver_sha256: hashFile('m2-electron-driver.mjs'),
  provenance_sha256: hashFile('m2-provenance.mjs'),
  media_events_sha256: hashFile('m2-media-events.mjs') };
verifyApprovedScripts(approval);
assert.throws(() => verifyApprovedScripts({ ...approval,
  provenance_sha256: '0'.repeat(64) }), /provenance_sha256 changed/);
assert.throws(() => verifyApprovedScripts({ ...approval,
  media_events_sha256: '0'.repeat(64) }), /media_events_sha256 changed/);
process.stdout.write('approval binds provenance/media helper bytes; drift rejected\n');

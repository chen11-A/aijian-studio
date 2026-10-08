import assert from 'node:assert/strict';

export class M2Stop extends Error {
  constructor(code, detail) { super(`${code}: ${detail}`); this.code = code; }
}
const requireValue = (ok, code, detail) => { if (!ok) throw new M2Stop(code, detail); };
const data = (response, label) => {
  requireValue(response && typeof response === 'object' && response.data,
    'READBACK_UNKNOWN', `${label} response missing`);
  return response.data;
};

export function verifySource(readback, handoff) {
  const project = data(readback.project, 'project');
  const manifest = data(readback.manifest, 'source manifest');
  const source = data(readback.source, 'source');
  const sourceText = data(readback.sourceText, 'source text');
  requireValue(project.id === handoff.project_id && project.name === handoff.project_name,
    'SOURCE_IDENTITY', 'project identity changed');
  requireValue(manifest.project_id === handoff.project_id, 'SOURCE_IDENTITY', 'manifest project changed');
  requireValue(manifest.accepted_version?.id === handoff.accepted_version_id &&
    manifest.latest_version?.id === handoff.latest_version_id &&
    manifest.accepted_version.id === manifest.latest_version.id &&
    manifest.head?.accepted_version_id === handoff.accepted_version_id &&
    manifest.head?.latest_version_id === handoff.latest_version_id,
  'SOURCE_NOT_ACCEPTED', 'accepted and latest manifest versions differ');
  requireValue(manifest.accepted_version.content_hash === handoff.source_manifest_content_hash,
    'SOURCE_IDENTITY', 'manifest content hash changed');
  const documents = manifest.accepted_version.content.documents;
  requireValue(Array.isArray(documents) &&
    documents.some((item) => item.source_document_id === handoff.source_document_id &&
      item.raw_sha256 === handoff.source_text_sha256),
  'SOURCE_IDENTITY', 'selected document is absent from accepted manifest');
  requireValue(source.project_id === handoff.project_id && source.id === handoff.source_document_id,
    'SOURCE_IDENTITY', 'source object changed');
  requireValue(sourceText.project_id === handoff.project_id &&
    sourceText.id === handoff.source_document_id &&
    sourceText.raw_sha256 === handoff.source_text_sha256,
  'SOURCE_IDENTITY', 'source raw bytes changed');
  return { project, manifest, source, sourceText };
}

export function verifyTimeline(response, handoff, taskId, prior = null) {
  const value = data(response, 'timeline');
  const timeline = value.timeline;
  requireValue(value.project_id === handoff.project_id && timeline &&
    Number.isSafeInteger(timeline.revision) && timeline.revision > 0,
  'TIMELINE_IDENTITY', 'project/revision invalid');
  requireValue(value.total_duration_frames === 375 &&
    timeline.sequence_timebase?.frame_rate?.num === 25 &&
    timeline.sequence_timebase?.frame_rate?.den === 1 &&
    timeline.width === 1080 && timeline.height === 1920,
  'TIMELINE_FORMAT', 'expected 375 frames at 25 fps, 1080x1920');
  requireValue(Array.isArray(timeline.clips) && timeline.clips.length === 3 &&
    timeline.clips.every((clip) => clip.duration_frames === 125),
  'TIMELINE_FORMAT', 'expected three 125-frame clips');
  requireValue(timeline.media_package && Array.isArray(timeline.assets) &&
    timeline.assets.length >= 3, 'MEDIA_PACKAGE', 'package or assets missing');
  if (prior) {
    requireValue(value.version_id !== prior.data.version_id &&
      timeline.revision === prior.data.timeline.revision + 1 &&
      value.content_hash !== prior.data.content_hash,
    'REORDER_UNCONFIRMED', 'version, revision or hash did not change');
    const before = prior.data.timeline.clips.map((clip) => clip.clip_id);
    const after = timeline.clips.map((clip) => clip.clip_id);
    requireValue(after[0] === before[1] && after[1] === before[0] && after[2] === before[2],
      'REORDER_UNCONFIRMED', 'first two clips did not swap');
  }
  return { version_id: value.version_id, content_hash: value.content_hash,
    revision: timeline.revision, task_id: taskId };
}

export function verifyExport(response, handoff, edited, operationId) {
  const result = data(response, 'export');
  requireValue(result.status === 'SUCCEEDED' && result.project_id === handoff.project_id &&
    result.operation_id === operationId && result.timeline_version_id === edited.version_id &&
    result.timeline_content_hash === edited.content_hash &&
    result.timeline_revision === edited.revision && result.purpose === 'DEVELOPMENT_EVIDENCE',
  'EXPORT_IDENTITY', 'export receipt does not bind edited timeline');
  const out = result.output;
  requireValue(out && out.duration_frames === 375 && out.width === 1080 &&
    out.height === 1920 && out.frame_rate_num === 25 && out.frame_rate_den === 1 &&
    Number.isSafeInteger(out.byte_length) && out.byte_length > 0 &&
    /^sha256:[0-9a-f]{64}$/.test(out.sha256),
  'EXPORT_FORMAT', 'output metadata invalid');
  return result;
}

// The driver has no retrying mutation methods. A thrown error after a click is UNKNOWN.
export async function runM2Once(driver, handoff, record) {
  let stage = 'LAUNCH';
  try {
    await driver.open();
    await record('opened', await driver.sessionIdentity());
    stage = 'SOURCE';
    const source = await driver.readSource(handoff);
    verifySource(source, handoff);
    await record('source_readback', source);
    await driver.capture('source-accepted');
    stage = 'FAKE_PREPARE';
    await driver.prepareFake(handoff);
    await record('fake_prepared', { project_id: handoff.project_id,
      source_document_id: handoff.source_document_id });
    await driver.capture('fake-prepared');
    stage = 'FAKE_SUBMIT';
    await record('fake_dispatch_intent', { maximum_clicks: 1 });
    const fake = await driver.submitFakeOnce(handoff);
    requireValue(fake.operation_id && fake.task_id, 'FAKE_UNKNOWN',
      'original operation or accepted task missing');
    await record('fake_operation', fake);
    await driver.capture('fake-submitted');
    stage = 'TASK_AND_MEDIA';
    const task = await driver.waitTaskAndMedia(handoff, fake);
    requireValue(task.task_id === fake.task_id && task.status === 'SUCCEEDED',
      'TASK_UNKNOWN', 'original task did not reach success');
    const original = await driver.readTimeline(handoff);
    verifyTimeline(original, handoff, fake.task_id);
    const packageAudit = await driver.verifyPackage(original, handoff, fake);
    requireValue(packageAudit.manifest_hash_match && packageAudit.preview_hashes_match &&
      packageAudit.source_binding_match, 'MEDIA_PACKAGE', 'package verification incomplete');
    await record('task_timeline', { task, timeline: original, packageAudit });
    await driver.capture('task-media-timeline');
    stage = 'REORDER';
    await record('reorder_intent', { clip_id: original.data.timeline.clips[0].clip_id,
      expected_revision: original.data.timeline.revision, maximum_actions: 1 });
    await driver.reorderFirstOnce(original);
    const editedResponse = await driver.readTimeline(handoff);
    const edited = verifyTimeline(editedResponse, handoff, fake.task_id, original);
    await record('timeline_reordered', editedResponse);
    await driver.capture('timeline-reordered');
    stage = 'EXPORT';
    await driver.prepareExport(edited);
    await record('export_dispatch_intent', { ...edited, maximum_clicks: 1 });
    const exportOperation = await driver.exportOnce(edited);
    requireValue(exportOperation.operation_id && exportOperation.receipt,
      'EXPORT_UNKNOWN', 'original operation or success receipt missing');
    const exportResult = verifyExport(exportOperation.receipt, handoff, edited,
      exportOperation.operation_id);
    await record('export_operation', exportOperation);
    await driver.capture('export-succeeded');
    stage = 'PLAYBACK';
    const media = await driver.verifyFileAndPlayback(exportResult);
    requireValue(media.file_hash_match && media.ffprobe_match && media.playback_ended,
      'PLAYBACK_UNKNOWN', 'file/probe/actual playback incomplete');
    await record('media_verified', media);
    await driver.capture('playback-ended');
    return { kind: 'M2_DEVELOPMENT_MP4_PASS', edited, export_id: exportResult.export_id,
      output: exportResult.output, media };
  } catch (error) {
    const result = { kind: 'M2_FAIL_OR_UNKNOWN', stage,
      code: error instanceof M2Stop ? error.code : 'UNEXPECTED_UNKNOWN',
      message: String(error?.message ?? error) };
    await record('stopped', result);
    return result;
  } finally {
    await driver.close();
    const closed = await driver.closedIdentity();
    await record('normal_close', closed);
    requireValue(closed.normal_close === true && closed.singleton_lock_absent === true,
      'CLOSE_UNKNOWN', 'Electron close or profile lock release not confirmed');
  }
}

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const hash = (text) => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');

// Verifies the immutable first attempt and separate focus capability receipt.
export function validateAttempt02Prior({ firstResult, firstNative, readbacks,
  firstPostclose, focusReview, inputText, inputHash, firstLedgerHash }) {
  assert.equal(hash(inputText), inputHash, 'frozen short text changed');
  assert.equal(firstResult.status, 'STOP_OR_UNKNOWN');
  assert.equal(firstResult.normal_close, true);
  assert.equal(firstResult.post_readback_count, 12);
  assert.equal(firstResult.native_send ?? null, null);
  assert.equal(firstResult.probe?.code, 1);
  assert.equal(firstNative.status, 'STOP_BEFORE_NATIVE_SEND');
  assert.equal(firstNative.native_action_attempted, false);
  assert.equal(firstNative.send, null);
  assert.equal(firstNative.read_only, false);
  assert.equal(firstNative.main_pid, firstResult.main_pid);
  const identity = firstResult.authoritative_identity;
  assert.ok(identity, 'first independent bridge identity missing');
  assert.equal(firstNative.expected_project_id, identity.project_id);
  assert.equal(firstNative.expected_version_id, identity.version_id);
  assert.equal(firstNative.expected_content_hash, identity.content_hash);
  assert.equal(firstNative.expected_revision, identity.expected_revision);
  assert.equal(firstNative.identity?.project_id, identity.project_id);
  assert.equal(firstNative.identity?.version_id, identity.version_id);
  assert.equal(firstNative.identity?.content_hash, identity.content_hash);
  assert.equal(firstNative.identity?.revision, identity.expected_revision);
  assert.equal(firstNative.identity?.action, 'submit');
  assert.ok(firstNative.dialog?.handle > 0 && firstNative.owner?.handle > 0);
  assert.notEqual(firstNative.stability?.before_send?.foreground_handle,
    firstNative.dialog.handle, 'first attempt foreground was the dialog');
  assert.match(firstNative.error ?? '', /foreground gate failed/);
  assert.ok(Array.isArray(readbacks) && readbacks.length === 12,
    'first authoritative readback count');
  for (const [index, item] of readbacks.entries()) {
    assert.equal(item.attempt, index + 1, `readback order ${index + 1}`);
    assert.equal(item.error ?? null, null, `readback ${index + 1} error`);
    const data = item.value;
    assert.equal(data?.project?.data?.id, identity.project_id);
    assert.equal(data.project.data.name, firstResult.project_name);
    assert.equal(data.manifest?.data?.project_id, identity.project_id);
    assert.equal(data.manifest.data.latest_version?.id, identity.version_id);
    assert.equal(data.manifest.data.latest_version.content_hash, identity.content_hash);
    assert.equal(data.manifest.data.head.revision, identity.expected_revision);
    assert.equal(data.manifest.data.head.review_version_id ?? null, null);
    assert.equal(data.manifest.data.head.review_submission_id ?? null, null);
    assert.equal(data.manifest.data.head.accepted_version_id ?? null, null);
    assert.equal(data.sourceText?.data?.project_id, identity.project_id);
    assert.equal(data.sourceText.data.raw_sha256, inputHash);
    assert.equal(data.sourceText.data.normalized_sha256, inputHash);
    assert.equal(data.sourceText.data.normalized_text, inputText);
  }
  assert.equal(firstPostclose.normal_close, true);
  assert.equal(firstPostclose.readback_count, 12);
  assert.equal(firstPostclose.readback_errors, 0);
  assert.equal(firstPostclose.readbacks_with_review_version, 0);
  assert.equal(firstPostclose.readbacks_with_submission_id, 0);
  assert.equal(firstPostclose.git_status_equal, true);
  assert.deepEqual(firstPostclose.hash_mismatches, []);
  assert.deepEqual(firstPostclose.related_processes, []);
  assert.deepEqual(firstPostclose.profile_lock_paths, []);
  assert.equal(firstPostclose.main_pid_present, false);
  assert.equal(firstPostclose.wrapper_pid_present, false);
  assert.equal(firstPostclose.product_count, 27);
  assert.equal(firstPostclose.qa_count, 6);
  assert.equal(firstPostclose.dist_count, 73);
  assert.equal(focusReview.status, 'ALREADY_FOCUSED_NO_CALL');
  assert.equal(focusReview.focus_call_count, 0);
  assert.equal(focusReview.source_action_attempted, false);
  assert.equal(focusReview.normal_close, true);
  assert.equal(focusReview.postcheck_status, 'PASS');
  assert.equal(focusReview.focus_recovery_tested, false);
  assert.equal(focusReview.native_dialog_foreground_tested, false);
  assert.equal(focusReview.old_ledger_sha256.toLowerCase(), firstLedgerHash);
  assert.equal(focusReview.product_count, 27);
  assert.equal(focusReview.qa_count, 6);
  assert.equal(focusReview.dist_count, 73);
  return { first_project_id: identity.project_id, first_version_id: identity.version_id,
    first_native_send_attempted: false, first_readback_count: 12,
    focus_probe_status: focusReview.status, focus_probe_focus_calls: 0 };
}

import assert from 'node:assert/strict';

// Offline proof that attempt02 stopped before Electron and never reached source actions.
export function validateAttempt03Prior({ secondApproval, secondResult, secondLedger,
  secondReview, secondOuter, secondOs, secondAudit, firstLedgerHash,
  secondLedgerHash, secondApprovalHash, inputHash }) {
  const id = 'qa02-submit-attempt02-20260924T044400Z-mgr02b';
  assert.equal(secondApproval.kind, 'QA02_SOURCE_SUBMIT_ATTEMPT02');
  assert.equal(secondApproval.approved_by, 'MGR02');
  assert.equal(secondApproval.attempt_id, id);
  assert.equal(secondApproval.attempt_number, 2);
  assert.equal(secondApproval.input_sha256, inputHash);
  assert.equal(secondApproval.first_ledger_sha256, firstLedgerHash);
  assert.equal(secondResult.id, id);
  assert.equal(secondResult.approval_sha256, secondApprovalHash);
  assert.equal(secondResult.first_ledger_sha256, firstLedgerHash);
  assert.equal(secondResult.status, 'STOP_OR_UNKNOWN');
  assert.equal(secondResult.errors?.length, 1);
  assert.match(secondResult.errors[0].message, /prelaunch: recent user input/);
  assert.deepEqual(secondResult.cases, []);
  assert.equal(secondResult.prelaunch?.idle_ms, 10672);
  assert.ok(secondResult.prelaunch.idle_ms < 60000);
  assert.equal(secondResult.prelaunch.foreground?.handle, 0);
  assert.deepEqual(secondResult.prelaunch.related_processes, []);
  assert.equal(secondResult.main_pid ?? null, null);
  assert.equal(secondResult.probe ?? null, null);
  assert.equal(secondResult.native_send ?? null, null);
  assert.equal(secondResult.post_readback_count ?? 0, 0);
  assert.equal(secondResult.normal_close ?? null, null);
  assert.equal(secondResult.postcheck_status, 'FAIL');
  assert.equal(secondResult.first_ledger_unchanged, true);
  assert.deepEqual(secondResult.postclose_related_processes, []);
  assert.deepEqual(secondResult.profile_root_lock_names, []);
  assert.deepEqual(secondResult.postclose_hash_mismatches, []);
  assert.equal(secondResult.postclose_git_status_equal, true);
  assert.equal(secondOuter.code, 1);
  assert.equal(secondOuter.spawn_error, null);
  assert.equal(secondOuter.child_pid, secondLedger.process_pid);
  assert.equal(secondLedger.attempt_number, 2);
  assert.equal(secondLedger.attempt_id, id);
  assert.equal(secondLedger.approval_sha256, secondApprovalHash);
  assert.equal(secondLedger.first_ledger_sha256, firstLedgerHash);
  assert.equal(secondLedger.input_sha256, inputHash);
  assert.equal(secondLedger.action, 'submit');
  assert.equal(secondLedger.outcome, 'UNCONSUMED_OR_UNKNOWN_UNTIL_AUTHORITATIVE_READBACK');
  assert.equal(secondReview.classification, 'STOP_BEFORE_ELECTRON_IDLE_GATE');
  assert.equal(secondReview.attempt_id, id);
  assert.equal(secondReview.new_ledger_sha256, secondLedgerHash);
  assert.equal(secondReview.project_created, false);
  assert.equal(secondReview.electron_launch_reached, false);
  assert.equal(secondReview.native_sender_started, false);
  assert.equal(secondReview.native_action_attempted, false);
  assert.equal(secondReview.new_authoritative_get_count, 0);
  assert.equal(secondReview.new_review_version_id, null);
  assert.equal(secondReview.new_review_submission_id, null);
  assert.equal(secondReview.new_ledger_created, true);
  assert.equal(secondReview.profile_created, true);
  assert.deepEqual(secondReview.profile_root_items, []);
  assert.equal(secondReview.profile_lock_count, 0);
  assert.equal(secondReview.normal_close_applicable, false);
  assert.equal(secondReview.c19_related_process_count, 0);
  assert.equal(secondReview.first_ledger_unchanged, true);
  assert.equal(secondReview.git_status_equal, true);
  assert.deepEqual(secondReview.hash_mismatches, []);
  assert.equal(secondReview.product_count, 27);
  assert.equal(secondReview.qa_count, 6);
  assert.equal(secondReview.dist_count, 73);
  assert.deepEqual(secondOs.related_processes, []);
  assert.equal(secondOs.profile_exists, true);
  assert.deepEqual(secondOs.profile_root_items ?? [], []);
  assert.deepEqual(secondOs.profile_lock_names ?? [], []);
  assert.equal(secondOs.first_ledger_sha256.toLowerCase(), firstLedgerHash);
  assert.equal(secondAudit.head_matches_approval, true);
  assert.equal(secondAudit.git_status_equal, true);
  assert.deepEqual(secondAudit.hash_mismatches, []);
  assert.equal(secondAudit.product_count, 27);
  assert.equal(secondAudit.qa_count, 6);
  assert.equal(secondAudit.dist_count, 73);
  return { attempt01_ledger_sha256: firstLedgerHash,
    attempt02_ledger_sha256: secondLedgerHash,
    attempt02_classification: secondReview.classification,
    attempt02_electron_launched: false, attempt02_native_action_attempted: false,
    attempt02_authoritative_get_count: 0 };
}

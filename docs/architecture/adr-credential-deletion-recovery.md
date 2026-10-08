# ADR: Recoverable provider credential deletion

Date: 2026-10-08

## Decision

Migration 39 adds a private, irreversible `cleanup_pending` flag. DELETE first
checks foreign-key safety, disables the connection and advances its revision in
one short transaction. Metadata and every rotation outcome remain listable until
cleanup finishes. A repeated DELETE resumes this state without another revision
increment. Metadata edits and new rotations cannot reactivate the connection.
The existing public API shapes and error codes remain unchanged.

Cleanup includes the legacy connection-id slot, the current credential reference,
and every historical candidate reference, regardless of rotation outcome. Each
slot must be deleted and read back as absent before metadata/history are removed.
Vault failure, readback uncertainty, interruption or database commit uncertainty
never produces a successful DELETE response. Retained metadata permits recovery
after restart and after partial cleanup.
If the final database commit succeeds but its acknowledgement is lost, metadata
may already be absent; that uncertain result requires readback rather than an
automatic retry. All credential removals have already been verified at that point.

## Concurrency and latency

The desktop sidecar already holds the exclusive process-lifetime workspace-owner
lock before starting its API or provider workers. Within that owner, all provider
credential writes and cleanup use a shared per-database, per-provider lock. Lock
acquisition is bounded to five seconds and fails closed. Deletion admission is
committed before waiting for this lock, so an already-admitted rotation may finish
its vault write but cannot pass its revision CAS. Its recorded candidate remains a
cleanup target. A writer that has not been admitted cannot write after cleanup.

No SQLite transaction is held during an operating-system vault call. A stalled
vault prompt can hold only that provider's lock; it cannot hold SQLite's workspace
writer lock or block credential work for another provider. The vault interface
does not promise a cancellable call deadline. An in-flight call is never abandoned
while another writer proceeds on the same provider. A competing DELETE times out
with cleanup-required and preserves its durable disabled retry target.

This coordination applies to the existing single-owner local desktop contract.
Multi-process server credential mutation requires a separate distributed design;
it is not enabled by this change. Foreign-key references are checked before any
credential is touched and again before final metadata deletion.

## Verification

Regression coverage uses temporary SQLite databases and fake credentials only:
multiple rotations, every rotation outcome, failed/ineffective cleanup, partial
cleanup and restart, FK rejection, stale mutation rejection, simultaneous admitted
rotation and deletion, bounded provider-lock contention, and unrelated workspace
writes during a stalled vault call. No real OS vault or provider is used.

# Phase 0 Async Media Fault Matrix Acceptance (T06B)

Date: 2026-08-15
Branch: `codex/f06-remote-media-fault-matrix`
Scope: deterministic Fake Provider / harness for async `IMAGE`, `VIDEO`, and
`SPEECH`/TTS operations (F06 remote-media slice / T06B). Complements T06A text matrix.

## Behavior accepted

### Typed async media boundary

- `MediaProviderRequest` covers `image.generate` / `video.generate` /
  `speech.synthesize` with strict capability↔operation validation, deterministic
  request fingerprint, idempotency identity, and provider account identity.
- `FakeAsyncMediaProvider` issues deterministic `provider_request_id` /
  `provider_job_id` values offline (no network, credentials, or media binaries).
- `AsyncMediaAttemptHarness` reuses the shared workflow state machine:
  `RUNNING` → `SUBMIT_INTENT` → `SUBMITTING` → `WAITING_REMOTE` on accepted submit.

### Submit-time fault matrix (all three capabilities)

| Fault | Acceptance certainty | Code | Retryable | Ledger disposition |
| --- | --- | --- | --- | --- |
| `http_401` | `CONFIRMED_NOT_ACCEPTED` | `AUTH_ERROR` | no | `NON_RETRYABLE` → attempt/node `FAILED` |
| `http_429` | `CONFIRMED_NOT_ACCEPTED` | `RATE_LIMITED` | yes | `SAFE_LOCAL_RETRY`; typed `retry_after_seconds=2` |
| `http_500` / `502` / `503` / `504` | `CONFIRMED_NOT_ACCEPTED` | `REMOTE_UNAVAILABLE` | yes | `SAFE_LOCAL_RETRY` |
| `moderation` | `CONFIRMED_NOT_ACCEPTED` | `REFUSED` | no | `NON_RETRYABLE`; usage omitted |
| `dispatch_ambiguous` | `DISPATCH_AMBIGUOUS` | `REMOTE_UNKNOWN` | no | quarantine (`REMOTE_UNKNOWN` / `RECONCILIATION_REQUIRED`); **no auto-resubmit** |

### Async callback / result policy

| Case | Deterministic outcome |
| --- | --- |
| Duplicate `event_id` | `DUPLICATE_IGNORED`; no second finalization |
| Stale / lower `event_seq` or terminal state | `STALE_IGNORED`; cannot regress success/failure/cancel |
| Wrong provider job / account / request_id / provider_request_id | `QUARANTINED_MISMATCH` → `REMOTE_UNKNOWN`; redelivery is `DUPLICATE_IGNORED` |
| Success callback while local `SUBMITTING` | Promote `SUBMITTING` → `WAITING_REMOTE` with opaque callback job id, then `SUCCEEDED` |
| Success callback with URL/credential-shaped job/request ids | `QUARANTINED_MISMATCH`; ids never persisted on snapshot |
| Post-accept callback failure (even if marked retryable) | `NON_RETRYABLE` disposition; no local resubmit |
| Callback `media_kind` ≠ request capability | `QUARANTINED_MISMATCH` |
| High-seq `REJECTED_MISMATCH` while pre-submit | Records `event_id` only; does **not** advance seq watermark |
| Cancel requested, then success callback | **Completion wins** → `SUCCEEDED` (billable asset already produced) |
| Cancel requested, then cancel ack | `CANCELLED` |
| Result handle expired at materialization | `RESULT_EXPIRED` permanent failure; no signed URL logged, no silent redownload, no auto-regenerate |
| Max-attempt exhaustion after 429 | stays `FAILED`; `can_open_local_retry() is False`; no extra finalization |

### Secret / signed-URL non-leak

Tests pass `FAKE_MEDIA_SECRET_SENTINEL`, `FAKE_MEDIA_AUTH_HEADER_SENTINEL`, and
`FAKE_MEDIA_SIGNED_URL_SENTINEL` through the fake boundary, then assert absence from
submit failures, callback payloads, diagnostics, and harness error projections.
Opaque `asset_ref` / `content_hash` replace raw result URLs on the public contract.

### Text T06A compatibility

Existing text Fake Provider HTTP matrix and `public_provider_error_code("TIMEOUT") ==
"ProviderRetryableError"` remain unchanged. `RESULT_EXPIRED` is additive only.

## Commands and exact results

Focused media matrix:

```powershell
.\.venv\Scripts\python.exe -m pytest services/api/tests/test_fake_media_provider.py services/api/tests/test_media_provider_runtime.py -q --tb=line --basetemp=F:\UserData\Documents\ChatGPT\sp\aijian-wt-f06-remote-media\.pytest-basetemp-t06b-focus-final
```

Result: **117 passed** in 0.47s.

Full API test suite:

```powershell
.\.venv\Scripts\python.exe -m pytest services/api/tests -q --tb=line --basetemp=F:\UserData\Documents\ChatGPT\sp\aijian-wt-f06-remote-media\.pytest-basetemp-t06b-full-final
```

Result: **702 passed, 1 skipped** in 51.45s.

Static gates:

```powershell
.\.venv\Scripts\python.exe -m mypy
.\.venv\Scripts\python.exe -m ruff check services/api/src/aijian_api/media_provider_runtime.py services/api/src/aijian_api/fake_media_provider.py services/api/src/aijian_api/provider_runtime.py services/api/tests/test_fake_media_provider.py services/api/tests/test_media_provider_runtime.py
.\.venv\Scripts\python.exe -m ruff format --check services/api/src/aijian_api/media_provider_runtime.py services/api/src/aijian_api/fake_media_provider.py services/api/src/aijian_api/provider_runtime.py services/api/tests/test_fake_media_provider.py services/api/tests/test_media_provider_runtime.py
git diff --check
```

Results: mypy `Success: no issues found in 53 source files`; ruff check/format-check clean;
`git diff --check` clean (re-run at close).

## Test coverage map

| Area | File | What is proven |
| --- | --- | --- |
| Submit matrix × capability | `test_fake_media_provider.py` | 401/429/5xx/moderation/dispatch ambiguity; secret non-leak; deterministic IDs |
| Harness protocol + callbacks | `test_media_provider_runtime.py` | WAITING_REMOTE path; dedupe; stale; mismatch quarantine; cancel races; URL expiry; opaque identity; max attempts; no auto-resubmit |
| Shared error validation | `provider_runtime.py` + tests | `RESULT_EXPIRED` non-retryable; T06A codes preserved |

## Public contract

No OpenAPI / public HTTP API change. Media provider harness is internal runtime only.
Additive internal error code `RESULT_EXPIRED` does not alter public OpenAPI schemas.

## Remaining limitations (not F06 blockers)

- **P02 remains BLOCKED**: no live image/video/TTS spike, credentials, cost evidence, or
  vendor adapter.
- No production remote media executor, budget reservation, or provider reconciliation UI
  (F07 partial remains).
- K01 / Q03 walking-skeleton and kill-matrix work is still separate and not claimed here.

## F06 status conclusion

With T06A (text) and T06B (async media Fake Provider fault matrix) both evidenced in-repo,
Phase 0 **F06 Fake Provider / error / crash injection** backlog scope for deterministic
offline provider faults is **DONE**. Live provider spikes stay under P01/P02.

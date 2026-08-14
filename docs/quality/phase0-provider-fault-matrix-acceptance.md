# Phase 0 Provider Fault Matrix Acceptance (T06A)

Date: 2026-08-15
Branch: `codex/f06-provider-fault-matrix`
Scope: deterministic Fake Provider HTTP fault matrix for text `story.extract` only (F06 text slice / T06A).

## Behavior accepted

1. `FakeStoryExtractProvider` injects structured failures without network I/O:
   - `http_401` → `AUTH_ERROR`, non-retryable, `http_status=401`
   - `http_429` → `RATE_LIMITED`, retryable, `http_status=429`, typed `retry_after_seconds=2`
   - `http_500` / `http_502` / `http_503` / `http_504` → `REMOTE_UNAVAILABLE`, retryable
2. Existing faults remain available: `timeout`, `remote_unknown`, `refused`, `protocol_error`.
3. Failure results keep a deterministic `provider_request_id`, omit usage for HTTP faults, and never emit the sentinel secret `sk-fake-provider-sentinel-do-not-leak` or credential/header/body values.
4. `ProviderFailureError` validates classification and Retry-After bounds (`0..86400`, only on `RATE_LIMITED`).
5. `StoryExtractService` + `LocalExecutor` preserve codes through the Task Ledger:
   - 401 ends the node (`NON_RETRYABLE`, no requeue, no Story Bible artifact)
   - 429 / 5xx take `SAFE_LOCAL_RETRY`, persist `RATE_LIMITED` / `REMOTE_UNAVAILABLE`, no Story Bible artifact
   - `timeout` stays typed as provider code `TIMEOUT` and remains `SAFE_LOCAL_RETRY`, but the public/persisted Task Ledger / `StoryExtractTaskData.error_code` remains the pre-T06A value `ProviderRetryableError` via `public_provider_error_code` (not message-text matching)
   - `REMOTE_UNKNOWN` still quarantines without auto-resubmit

## Commands and exact results

Focused suite (provider + story extract + local executor):

```powershell
.\.venv\Scripts\python.exe -m pytest services/api/tests/test_fake_provider.py services/api/tests/test_provider_runtime.py services/api/tests/test_story_extract.py services/api/tests/test_local_executor.py -q --tb=line --basetemp=F:\UserData\Documents\ChatGPT\sp\aijian-wt-f06-provider-fault-matrix\.pytest-basetemp-t06a-r1-8e1f5f35
```

Result: **100 passed, 1 skipped** in 6.42s.

Full API test suite:

```powershell
.\.venv\Scripts\python.exe -m pytest services/api/tests -q --tb=line --basetemp=F:\UserData\Documents\ChatGPT\sp\aijian-wt-f06-provider-fault-matrix\.pytest-basetemp-t06a-full-9e1c9a4a
```

Result: **585 passed, 1 skipped** in 54.91s.

Static gates:

```powershell
.\.venv\Scripts\python.exe -m mypy
.\.venv\Scripts\python.exe -m ruff check services/api scripts
git diff --check
```

Results: mypy `Success: no issues found in 51 source files`; ruff `All checks passed!`; `git diff --check` clean.

## Test coverage map

| Area | File | What is proven |
| --- | --- | --- |
| Full Fake Provider matrix | `services/api/tests/test_fake_provider.py` | parameterized 401/429/5xx + legacy faults; secret non-leak; deterministic 429 Retry-After |
| Typed metadata validation | `services/api/tests/test_provider_runtime.py` | malformed Retry-After / status / classification rejected; `TIMEOUT` public code stays `ProviderRetryableError` |
| Workflow projection | `services/api/tests/test_story_extract.py` | 401 ends node; 429/5xx safe local retry with domain codes; timeout public code stays `ProviderRetryableError`; no Story Bible on failure |
| Executor classification | `services/api/tests/test_local_executor.py` | HTTP domain codes persist; timeout public/persisted code stays `ProviderRetryableError` |

## Remaining F06 limitation (T06B)

This acceptance does **not** cover remote image / video / TTS failure behavior, async callback faults, result URL expiry, or live provider spikes. F06 therefore remains **PARTIAL** until T06B lands.

## Public contract

No OpenAPI / public HTTP API change. Provider failure metadata stays inside the internal provider runtime and Task Ledger error codes.

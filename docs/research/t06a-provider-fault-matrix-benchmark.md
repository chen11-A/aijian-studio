# T06A Fake Provider HTTP Fault Matrix — OSS Benchmark

Status: research gate for **T06A** (text-provider HTTP 401 / 429+Retry-After / representative 5xx). No vendor code copied.
Author: implementer on `codex/f06-provider-fault-matrix`.
Observation clock: GitHub REST `GET /repos/{owner}/{repo}` at **2026-08-15** (workspace local date) via unauthenticated public API.
Workspace check: branch `codex/f06-provider-fault-matrix`, baseline `fd5f02d`, worktree clean at research start.

This note answers:

> How do mature SDKs classify HTTP 401, 429 (+ Retry-After), and 5xx, and which of those policies should Aijian’s deterministic Fake Provider boundary reuse for local Task Ledger retries?

## Evidence rules

- Technical claims use primary source or official docs.
- Star totals come from the public repository API at the clock above.
- **30-day star growth is `not verifiable`**: GitHub restricted public stargazer timelines (see prior Aijian notes and [GitHub changelog 2026-06-30](https://github.blog/changelog/2026-06-30-upcoming-access-restrictions-to-public-api-endpoints-and-ui-views/)). This document does not invent growth.

## Catalog (four required projects)

| # | Project | Repo | Stars | Default branch | Latest observed push | Source refs inspected |
| --- | --- | --- | ---: | --- | --- | --- |
| 1 | OpenAI Python SDK | [openai/openai-python](https://github.com/openai/openai-python) | 31,369 | `main` | 2026-08-14T16:09:18Z | [`src/openai/_constants.py`](https://raw.githubusercontent.com/openai/openai-python/main/src/openai/_constants.py), [`src/openai/_base_client.py`](https://raw.githubusercontent.com/openai/openai-python/main/src/openai/_base_client.py) (`_should_retry`, `_parse_retry_after_header`, `_calculate_retry_timeout`), [`src/openai/_exceptions.py`](https://raw.githubusercontent.com/openai/openai-python/main/src/openai/_exceptions.py) |
| 2 | Stripe Python SDK | [stripe/stripe-python](https://github.com/stripe/stripe-python) | 2,032 | `master` | 2026-08-14T16:43:42Z | [`stripe/_http_client.py`](https://raw.githubusercontent.com/stripe/stripe-python/master/stripe/_http_client.py) (`_should_retry`), [`stripe/_error.py`](https://raw.githubusercontent.com/stripe/stripe-python/master/stripe/_error.py); docs [error-handling](https://docs.stripe.com/error-handling?lang=python), [rate-limits](https://docs.stripe.com/rate-limits) |
| 3 | botocore | [boto/botocore](https://github.com/boto/botocore) | 1,637 | `develop` | 2026-08-13T19:14:29Z | [`botocore/retries/standard.py`](https://raw.githubusercontent.com/boto/botocore/develop/botocore/retries/standard.py) (`TransientRetryableChecker`, `ThrottledRetryableChecker`, `x-amz-retry-after`); docs [Boto3 retries](https://docs.aws.amazon.com/boto3/latest/guide/retries.html) |
| 4 | Temporal Python SDK | [temporalio/sdk-python](https://github.com/temporalio/sdk-python) | 1,162 | `main` | 2026-08-14T16:38:07Z | [`temporalio/exceptions.py`](https://raw.githubusercontent.com/temporalio/sdk-python/main/temporalio/exceptions.py) (`ApplicationError.non_retryable`, `next_retry_delay`); docs [Python error handling](https://docs.temporal.io/develop/python/best-practices/error-handling), [Retry policies](https://docs.temporal.io/encyclopedia/retry-policies) |

30-day star growth for all four: **not verifiable** (public stargazer timeline restricted; unauthenticated star history is not a reliable delta source).

## Observed policies

### 1. OpenAI Python SDK — **reuse classification shape**

| Status | Exception | Retry? | Retry-After |
| --- | --- | --- | --- |
| 401 | `AuthenticationError` (`status_code: Literal[401]`) | **No** (not in `_should_retry`) | N/A |
| 429 | `RateLimitError` | **Yes** | Parsed from `retry-after-ms` then `Retry-After` (seconds or HTTP-date); honored only when `0 < value <= MAX_RETRY_AFTER_DELAY` (120 s). Larger values suppress retry. |
| ≥500 | `InternalServerError` (and generic status errors) | **Yes** (`status_code >= 500`) | Same parser when present |
| Other | connection / 408 / 409 | Yes | exponential backoff + jitter when header absent |

Constants (source-confirmed): `DEFAULT_MAX_RETRIES = 2`, `INITIAL_RETRY_DELAY = 0.5`, `MAX_RETRY_DELAY = 8.0`, `MAX_RETRY_AFTER_DELAY = 120`.

### 2. Stripe Python SDK — **reuse 401 / 5xx; rewrite 429 auto-retry**

| Status | Exception | Retry? | Retry-After |
| --- | --- | --- | --- |
| 401 | `AuthenticationError` | **No** | N/A |
| 429 | `RateLimitError` | **Not by default** in `_should_retry` unless `Stripe-Should-Retry: true` (e.g. lock timeout) | **Not parsed** in `stripe/_http_client.py` (no `retry-after` match in source) |
| ≥500 | `APIError` path | **Yes** when `status_code >= 500` (subject to `Stripe-Should-Retry`) | N/A; client uses `INITIAL_DELAY=0.5`, `MAX_DELAY=5` exponential backoff |

Docs still recommend application-level backoff for rate limits. Aijian’s product requirement is that 429 **is** a safe local retry class for Fake Provider matrix tests, so Stripe’s default “don’t auto-retry ordinary 429” is **not** copied.

### 3. botocore standard retries — **reuse 5xx set; rewrite throttle identity**

| Class | Policy | Notes |
| --- | --- | --- |
| Transient HTTP | **500, 502, 503, 504** retryable | `TransientRetryableChecker._TRANSIENT_STATUS_CODES` |
| Throttling | Error-code driven (`TooManyRequestsException`, `Throttling`, …), not bare HTTP 429 alone in standard mode | Longer base delay than transient |
| Server delay | AWS header **`x-amz-retry-after`** (milliseconds), clamped relative to computed backoff | Not standard HTTP `Retry-After` |
| Auth | Client/config failures are not modeled as transient retries | Aligns with non-retryable 401 |

### 4. Temporal Python SDK — **reuse retryability flag shape**

- `ApplicationError(..., non_retryable=False, next_retry_delay=None)`:
  - permanent failures set `non_retryable=True` (auth / validation analogues);
  - transient failures remain retryable under the activity Retry Policy;
  - optional `next_retry_delay` is structured delay metadata, not message prose.
- Inference for Aijian: persist a **typed error code** plus **structured delay** on rate-limit failures; never auto-resubmit unknown remote acceptance (already covered by `REMOTE_UNKNOWN`).

## Decision for Aijian Studio

| Policy element | Decision | Rationale |
| --- | --- | --- |
| HTTP 401 → `AUTH_ERROR`, non-retryable, end node | **Reuse** (OpenAI/Stripe/Temporal permanent-failure pattern) | Credentials/config will not heal via local requeue |
| HTTP 429 → `RATE_LIMITED`, `SAFE_LOCAL_RETRY` | **Rewrite** (OpenAI + Temporal; reject Stripe default non-retry) | Phase 0 Fake Provider matrix and Task Ledger already model safe local retry with max attempts |
| Typed `retry_after_seconds` on 429 only, bounds `[0, 86400]` | **Rewrite** (OpenAI parse+cap idea; Temporal `next_retry_delay` shape; reject raw header/body passthrough) | Callers need structured metadata; Fake Provider does not sleep on the network path |
| HTTP 500/502/503/504 → `REMOTE_UNAVAILABLE`, retryable | **Reuse** (botocore transient set + OpenAI/Stripe ≥500) | Representative upstream outage matrix without inventing extra statuses |
| Pre-existing `timeout` typed as `TIMEOUT` but public/persisted `error_code` stays `ProviderRetryableError` | **Reuse** (Aijian Task Ledger / `StoryExtractTaskData` compatibility) | Typed provider classification stays strong; only the public surface keeps the historical class-name code via `public_provider_error_code` |
| No credential/header/body leakage; no fabricated usage on HTTP faults | **Reuse** existing Aijian provider boundary rules | Matches security model and current refused-only usage exception |
| Copy SDK retry loops / HTTP clients into Fake Provider | **Reject** | Boundary must stay deterministic and offline |

## Out of scope (T06B / later)

Remote image/video/TTS async failures, callback reordering, result URL expiry, and live provider spikes remain outside T06A. F06 stays **PARTIAL** until that remote-media matrix exists.

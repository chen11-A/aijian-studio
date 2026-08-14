# T06B Async Media Fake Provider Fault Matrix — OSS Benchmark

Status: research gate for **T06B** (async IMAGE / VIDEO / SPEECH submit faults, callback
ordering/dedupe, cancellation races, result URL expiry, no auto-resubmit on dispatch
ambiguity). No vendor code copied.
Author: implementer on `codex/f06-remote-media-fault-matrix`.
Observation clock: GitHub REST `GET /repos/{owner}/{repo}` at **2026-08-15** (workspace
local date) via unauthenticated public API.
Workspace check: branch `codex/f06-remote-media-fault-matrix`, baseline
`91cb6a629591721e4e7d19d36e1d098433961d30`.

This note answers:

> How do mature async-job, webhook, retry, and controller systems treat submission
> ambiguity, callback dedupe/order, cancellation races, and expiring results — and which
> policies should Aijian’s offline media Fake Provider harness reuse?

## Evidence rules

- Technical claims use primary source or official docs.
- Star totals come from the public repository API at the clock above.
- **30-day star growth is `not verifiable`**: GitHub restricted public stargazer timelines
  (see [GitHub changelog 2026-06-30](https://github.blog/changelog/2026-06-30-upcoming-access-restrictions-to-public-api-endpoints-and-ui-views/)).
  This document does not invent growth.

## Catalog (six projects)

| # | Project | Repo | Stars (2026-08-15) | Default / observed push | Source refs inspected |
| --- | --- | --- | ---: | --- | --- |
| 1 | Temporal server | [temporalio/temporal](https://github.com/temporalio/temporal) | 22,312 | `master`, pushed 2026-08-14T17:27:00Z | Docs [Retry policies](https://docs.temporal.io/encyclopedia/retry-policies), [Activity heartbeats & cancellation](https://docs.temporal.io/develop/python/cancellation); Python SDK [temporalio/exceptions.py](https://raw.githubusercontent.com/temporalio/sdk-python/main/temporalio/exceptions.py) (`ApplicationError.non_retryable`) |
| 2 | Temporal Python SDK | [temporalio/sdk-python](https://github.com/temporalio/sdk-python) | 1,162 | `main`, pushed 2026-08-14T17:22:14Z | Same exception surface; workflow/activity cancellation semantics in docs above |
| 3 | Stripe Python SDK | [stripe/stripe-python](https://github.com/stripe/stripe-python) | 2,032 | `master`, pushed 2026-08-14T17:03:23Z | Docs [Webhooks](https://docs.stripe.com/webhooks), [Event object idempotency](https://docs.stripe.com/api/events/object); source `stripe/_http_client.py` retry policy; webhook signature verification docs |
| 4 | OpenAI Python SDK | [openai/openai-python](https://github.com/openai/openai-python) | 31,370 | `main`, pushed 2026-08-14T16:09:18Z | [`src/openai/_base_client.py`](https://raw.githubusercontent.com/openai/openai-python/main/src/openai/_base_client.py) (`_should_retry`, Retry-After parse); async job patterns in Images/Video APIs docs (poll/retrieve, not auto-resubmit on unknown) |
| 5 | Celery | [celery/celery](https://github.com/celery/celery) | 28,787 | `main`, pushed 2026-08-13T14:19:13Z | Docs [Tasks / retry](https://docs.celeryq.dev/en/stable/userguide/tasks.html#retrying), [Canvas / chords](https://docs.celeryq.dev/en/stable/userguide/canvas.html); acks late / reject requeue semantics |
| 6 | Kubernetes | [kubernetes/kubernetes](https://github.com/kubernetes/kubernetes) | 124,514 | `master`, pushed 2026-08-14T00:41:27Z | Docs [Controllers](https://kubernetes.io/docs/concepts/architecture/controller/), [Garbage collection / owner refs](https://kubernetes.io/docs/concepts/architecture/garbage-collection/); level-triggered reconcile, resourceVersion concurrency |

Also cross-checked (not counted as a seventh primary row, already used in T06A):
[boto/botocore](https://github.com/boto/botocore) 1,637 stars — transient 500/502/503/504 and
throttle identity in `botocore/retries/standard.py`.

30-day star growth for all rows: **not verifiable** (public stargazer timeline restricted).

## Observed policies

### 1. Temporal — **reuse non-retryable flag + cancel/completion race shape**

| Topic | Observed policy |
| --- | --- |
| Permanent vs transient | `ApplicationError(non_retryable=True)` stops activity retries; transient errors honor Retry Policy max attempts |
| Cancel vs completion | Cancellation is cooperative; a completed activity result can still be recorded depending on timing; workflows must treat terminal outcomes as authoritative once accepted |
| Unknown remote | Does not invent success; durable event history is the source of truth before side effects retry |

**Decision:** **Reuse** typed non-retryable permanent faults and max-attempt exhaustion.
**Rewrite** cancel-vs-completion into one explicit product rule for media callbacks
(success while `CANCEL_REQUESTED` → `SUCCEEDED`, because the provider already produced a
potentially billable asset).

### 2. Stripe webhooks — **reuse event id dedupe; rewrite business ordering**

| Topic | Observed policy |
| --- | --- |
| Dedupe | Event `id` is unique; receivers must be idempotent on redelivery |
| Order | Delivery is **at-least-once** and **not strictly ordered**; apps must tolerate out-of-order events via object state / version checks |
| Secrets | Webhook signing secret validates authenticity; raw payloads are not logged as trust surface |

**Decision:** **Reuse** `event_id` idempotency and “never trust order alone”.
**Rewrite** ordering as monotonic `event_seq` plus terminal-state freeze (stale events cannot
regress `SUCCEEDED` / `FAILED` / `CANCELLED`).
**Reject** copying Stripe HTTP client auto-retry defaults into the Fake Provider.

### 3. OpenAI Python SDK — **reuse 401/429/5xx classification; rewrite async accept certainty**

| Status / case | Policy |
| --- | --- |
| 401 | Non-retryable authentication failure |
| 429 | Retryable; parse Retry-After when bounded |
| ≥500 | Retryable upstream failure |
| Transport after send | Client may not know whether the server accepted the request; application must not blindly create a second billable job without idempotency identity |

**Decision:** **Reuse** T06A HTTP matrix mapping for confirmed-not-accepted submits.
**Rewrite** post-dispatch timeout/transport loss as `REMOTE_UNKNOWN` with **no automatic
resubmit** (aligns with existing Aijian remote protocol, stronger than “SDK retries the HTTP
call”).

### 4. Celery — **reuse max retries; reject queue acks as product truth**

| Topic | Observed policy |
| --- | --- |
| Retry | Explicit `retry` / `max_retries`; late ack can redeliver |
| Dedupe | At-least-once delivery; task idempotency is application-owned |
| Result expiry | Result backends may expire results; expiry is not auto-regeneration of work |

**Decision:** **Reuse** “expiry ≠ regenerate work”.
**Reject** using broker redelivery semantics as the media Task Ledger truth (ledger remains
authoritative per ADR-0002).

### 5. Kubernetes controllers — **reuse level-triggered reconcile; rewrite for jobs**

| Topic | Observed policy |
| --- | --- |
| Reconcile | Controllers re-observe desired vs actual; duplicate events are normal |
| Concurrency | `resourceVersion` / UID identity prevents applying stale writes blindly |
| Ambiguity | Unknown state is requeued for observe, not “create another object unless identity says so” |

**Decision:** **Reuse** identity-gated apply (provider job id + request id + account).
**Rewrite** into callback mismatch quarantine (`REMOTE_UNKNOWN` / reconciliation) rather than
Kubernetes watch machinery.

## Decision table for Aijian Studio

| Policy element | Decision | Rationale |
| --- | --- | --- |
| One typed boundary for IMAGE/VIDEO/SPEECH ops | **Rewrite** (new media runtime, reuse error codes) | No production media executor yet; keep text path unchanged |
| 401 → `AUTH_ERROR` non-retryable | **Reuse** (OpenAI/Stripe/T06A) | Credentials do not heal via local requeue |
| 429 → `RATE_LIMITED` + typed Retry-After, safe local retry under max attempts | **Reuse** (T06A / OpenAI shape) | Matches Task Ledger `SAFE_LOCAL_RETRY` |
| 500/502/503/504 → `REMOTE_UNAVAILABLE` retryable | **Reuse** (botocore transient set) | Confirmed-not-accepted outage |
| Moderation/safety → `REFUSED` permanent, no invented usage | **Reuse** refused class; **rewrite** media-specific message/details | Permanent content policy failure |
| Dispatch ambiguity → `REMOTE_UNKNOWN`, quarantine, no auto-resubmit | **Reuse** existing attempt state machine | Prevents duplicate billable media jobs |
| Callback `event_id` dedupe | **Reuse** (Stripe) | At-least-once delivery |
| Stale/out-of-order callbacks cannot regress terminal/newer state | **Rewrite** (`event_seq` + terminal freeze) | Stricter than “last writer wins” |
| Wrong job/account/request callback | **Rewrite** → reject/quarantine | Identity fence before side effects |
| Cancel vs completion race | **Rewrite** documented: completion wins if success callback arrives in `CANCEL_REQUESTED` | Billable asset already exists remotely |
| Result URL expiry | **Rewrite** typed `RESULT_EXPIRED`, never log signed URL, never silent redownload, never auto-regenerate | Celery “expiry ≠ redo work”; security model |
| Copy vendor SDKs / real HTTP into Fake Provider | **Reject** | Offline deterministic harness only |

## Out of scope (still P02 / later)

Live image/video/TTS provider spikes, real credentials, cost evidence, protected CI live
jobs, and vendor-specific adapters remain **BLOCKED** under P02. This research only
supports the deterministic Fake Provider matrix for F06.

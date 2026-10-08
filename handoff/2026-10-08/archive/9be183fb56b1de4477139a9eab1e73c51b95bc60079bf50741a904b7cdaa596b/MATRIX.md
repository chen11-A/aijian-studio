# AC05 independent QA draft — not executed

Authority: wait for MGR04's final 34-file snapshot, MGR02's explicit c19 handoff, and exact post-sync hashes before collection or execution. Use only fresh temporary SQLite, an injected fake credential vault, and a mock Sub2API transport. Preserve the first raw output and exit code.

| Gate | Real path and assertion | Draft coverage |
| --- | --- | --- |
| Factory and scope | Accepted SourceManifest → real Sub2API factory → one task and frozen scope; exact replay returns same run; changed key/input conflicts | `_prepared` exact replay; changed-input case pending |
| No consent | Default runtime `run_once()` before persisted approval gives no claim, no consume, no transport call | Success test preapproval; add task/DB count after fixed snapshot |
| Consent | GET original scope, POST explicit boolean consent and integer one call; authentic factory `task_` ID accepted; wrong prefix rejected; wrong attempt/fingerprint and cross-project fail closed | `_approve` positive and wrong-prefix API negative; other binding cases pending |
| One dispatch | Real runtime/worker/invocation/proposal builder/store use exactly one transport mock call after durable consume; no retry | Success and UNKNOWN tests |
| Official response | v0.2.8 compatible `object`, `created`, `service_tier`, `reasoning_content`, usage token details; V2 proposal takes only message `content`, retains exact raw bytes/hash and unknown cost | Success test |
| Bad response | Unknown key, `tool_calls`, `function_call`, duplicate JSON key, NaN, excessive usage detail, bad body hash reject to UNKNOWN with no proposal or redispatch | Parametrized draft cases; >1 MiB and wrong id/model/content pending |
| Review and acceptance | Original operation GET refers to the persisted V2 proposal; proposal schema 2, correct source span/dependency; named human acceptance writes DRAFT; reopen reads same version/span | Success test; verify exact version/head readback after fixed snapshot |
| Recovery | Consume with no observation reads UNKNOWN, no second claim; pre-dispatch failure leaves no remote send | Timeout draft; crash injection pending |
| Legacy isolation | V1 local acceptance remains schema 1; CPA connection cannot enter Sub2API factory | Draft targeted cases added; CPA remote selection against Sub2API also covered by earlier QA01 first-package test |

Known boundaries: this is a source-informed draft against the author's frozen files and has **not** been imported, collected or run. It does not prove the final 34-file snapshot, actual provider capability, pricing, billing, desktop UI, or user acceptance. Token counts are not a charge receipt.

Contracts to confirm at handoff: final 34-file manifest and hashes; whether the sidecar route's default `sub2api_runtime_availability` must be injected for an isolated `TestClient`; final public proposal GET shape and DRAFT version readback; exact expected behavior for transport success with a malformed raw body; final V1/CPA fixture location after snapshot; and the permitted crash injection point for persisted consume without observation. Resolve these against the fixed checkout before running; keep failures raw rather than relaxing assertions.

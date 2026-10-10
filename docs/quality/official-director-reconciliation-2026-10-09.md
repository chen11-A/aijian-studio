# Official AI director source reconciliation, 2026-10-09

## Scope and source

Recovered the schema41 official-account AI director feature from the preserved
source snapshot and semantically integrated it onto tracked commit
`aee66fb2c91c7229e45667cbe1f0e5324c44872c` in an isolated checkout.
No existing shared file was overlaid blindly. Existing shot-plan domain modules
were byte-identical and retained. Existing API routes, OpenAPI schemas, generated
TypeScript definitions, production native transport limits and security checks
were preserved. This change does not enable live inference or approve release.

## Restored behavior

- Server-owned preparation from exact immutable script/production-brief and
  storyboard evidence, bounded generation options, complete source-lineage
  checks and trusted-desktop-only mutations
- Durable single-attempt intent, pessimistic REMOTE_UNKNOWN state, exact raw
  completion and provider response identity, strict typed-output admission,
  immutable proposal history and explicit human adoption/rejection
- Schema41 tables, foreign-key bindings, append-only review receipts and atomic
  migration; interruption coverage expanded to every schema41 statement
- Credential-free native renderer bridge exposing list/get/generate/adopt/reject;
  main-process orchestration checks sender, session, model, approved prompt and
  reservation before a provider request
- Independent retained AI/HUMAN director views, bounded inputs, proof/plan/
  operation-evidence panels, durable command journal, explicit review and
  navigation/recovery guards
- New shared guard exports, contract export/declaration metadata and existing
  mandatory coverage gates extended without reducing thresholds

## Checks actually performed on this reconciliation

Passed:

1. Python AST parsing for all changed/restored Python source and test files
2. Node 24 TypeScript syntax checks for restored native/adapter/hook modules,
   shared auth modules, native wiring and merged generated contracts
3. Source import resolution/symbol-presence scan for restored director modules
4. OpenAPI semantic preservation: every existing route/schema/root metadata
   unchanged, with 7 director paths and 19 director schemas added; all schema
   references resolve
5. Generated TypeScript semantic preservation: all 93 existing paths, 334 schemas
   and 109 operations unchanged; adds 7 paths, 19 schemas and 8 operations
6. Standard-library SQLite execution of actual SQL migrations 1 through 41 and
   foreign-key checks, plus schema41 rollback at all 13 statement boundaries
7. Real standard-library workflow state-transition checks: exact known response
   binds non-retryable review/failure; missing reconciliation/response, blank
   response, retryable disposition and automatic retry transitions are rejected
8. Git whitespace/error-marker check

The SQL check extracts migration definitions without importing the application's
third-party framework. It validates SQLite DDL/transaction behavior, not the
full StudioRepository initialization/runtime. Syntax/source scans are not type
checks or application execution. Historical checkpoint counts in the recovered
checkpoint document apply only to that frozen older source.

## Explicitly unrun

Pytest, Vitest, dependency-backed lint/format/type checks, canonical OpenAPI/type
regeneration and real UI/runtime tests remain unrun: project dependencies are
absent, and registry installation/network expansion is out of scope. Existing
and restored regression test files are included for later execution in the
proper environment. No build, packaging validation, app installation, provider
request, credential action, expenditure, GitHub write or CI action was performed.

## Parent integration notes

Director main/API/preload/contract additions must be merged additively after the
separately restored dialogue feature. Shared auth deltas are exported separately
for manual reconciliation with any newer auth fixes. Schema41 remains the
existing director migration; a new revision feature must use schema42 or later.
Final-schema assertions in recovery/migration tests should use SCHEMA_VERSION
when additional migrations are integrated; rollback expectations remain the
historical predecessor version.

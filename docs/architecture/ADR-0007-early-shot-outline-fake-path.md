# ADR-0007: Early ShotOutline development-Fake path

## Status and context

Route selected by the controller on 2026-09-04 under the user's delegation to
continue and choose the route. This is a technical planning decision, not human
approval of a source, creative work, ArtifactVersion, or Gate. O1 implements only
the closed content contract; independent candidate acceptance remains separate.

The formal [workflow](workflow-and-agents.md) requires approved screenplay and
visual predecessors before `ShotPlan` / G6A. The current SourceExtraction payload
is a source summary, not an eight-shot proposal. Reusing its name or treating a
model response as an accepted production artifact would obscure those boundaries.

## Decision

Use a closed, eight-shot `ShotOutline` proposal payload derived from one approved
concrete `SourceManifest` version. Its only purpose is `DEVELOPMENT_FAKE_ONLY`.
The O1 function validates the dependency's declaration; later repository-backed
work must prove actual acceptance, project ownership, source bytes, and quote
hashes. No O1 result claims those checks already happened.

All actual narrative text, invented flags, and source IDs reside in the payload's
central claim collection, so immutable content and its canonical hash cover the
creative proposal. Each shot contains only its identity, ordinal, planned duration,
and claim references. The existing ArtifactProposal envelope repeats the claims
for compatibility and must match completely, including order and strict types.
Each shot retains visual provenance; at least one genuinely factual claim must be
used somewhere in the proposal. Camera instructions are explicit inventions.

Reuse `ArtifactProposalV1`, `ProposalClaimV1`, `ProposalSourceSpanV1`,
`canonical_sha256`, and the existing `ProposalSchemaRegistry` protocol. A local
strict claim subclass narrowly adapts bounded JSON arrays to the inherited tuple
field. It creates no second source model, Agent framework, approval service, or
authority path. The [v1 specification](../specs/member-cli-shot-outline-v1.md)
defines the fields, pure validation entry point, tests, and future call site.

Future O2 will enable exact registration and the existing proposal-to-DRAFT
persistence chain; future O3 will reuse the review service for an artifact-specific
auxiliary G1A human-adoption policy. O1 is a dependency of both, not their substitute.
Only named-human review of exact versions may advance an accepted head, preserving
[ADR-0005](ADR-0005-agent-skill-proposal-boundary.md).

## Alternatives and tradeoffs

- Implement the complete story/script/visual predecessor chain before any shot
  suggestions: retained as the long-term formal-production route, but not selected
  as this development-Fake increment's prerequisite. It has broader scope than
  the bounded early-adaptation experiment.
- Reuse SourceExtraction or label these suggestions ShotPlan: rejected because
  it misrepresents both content semantics and formal Gate readiness.
- Store only claim IDs in payload and keep narrative solely in the envelope:
  rejected because the immutable DRAFT content/hash would not bind actual text.
- Permit arbitrary descriptions and approval flags: rejected because these are
  narrative or authority bypasses outside the closed schema.

The chosen route permits an early, testable adaptation boundary while adding an
explicit development-only artifact and a future auxiliary review policy. Mirrored
envelope claims require a strict canonical consistency check; that duplication
is a compatibility cost, not a second narrative source of truth.

## Consequences

O1 adds only its ADR, specification, Python contract, and contract tests. It does
not change old SourceExtraction, database migrations, built-in registration,
formal Gate behavior, application/UI, or dependencies. Test-private registration
proves schema compatibility only. Structural source linkage is not a proof of
semantic truth or end-to-end prompt-injection resistance.

This decision neither advances nor replaces G2–G6A, creates a formal ShotPlan,
invokes a provider/member CLI, nor approves any work. G1A, provider/process safety,
visible proposal review, persistence/recovery, Fake media, and K01 remain later
work requiring separate evidence and acceptance. Planned milliseconds are not
media output. Even a later 15-second Fake sample will not establish the roadmap's
full K01 UI/API flow or W8 exit criteria.

## Verification

The implementation lives in `services/api/src/aijian_api/shot_outline_contracts.py`
with tests in `services/api/tests/test_shot_outline_contracts.py`. The spec records
offline pytest, relevant regressions, directed line/branch coverage, Ruff, mypy,
Prettier, and diff checks. Evidence must distinguish behavioral RED/GREEN,
independent acceptance, integration, and actual user-visible delivery. No runtime
or media acceptance is inferred from this contract-only increment.

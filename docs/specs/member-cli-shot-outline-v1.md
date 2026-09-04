# ShotOutline v1 contract

## Purpose and boundary

This O1 contract is the first dependency of the selected early `ShotOutline` +
auxiliary G1A development-Fake route in [ADR-0007](../architecture/ADR-0007-early-shot-outline-fake-path.md).
It is not the formal `ShotPlan`, a production Gate, or an implemented CLI flow.
The filename reserves the future membership-CLI consumer; O1 invokes no CLI,
provider, model, application, database, or media process.

## Closed JSON payload

`ShotOutlinePayloadV1` has `extra="forbid"` and `strict=True`. All fields below
are required, including empty arrays; no narrative defaults are filled. It accepts
ordinary JSON-decoded dictionaries/lists via `model_validate(payload)` and emits
equivalent JSON via `model_dump(mode="json")`. Unknown fields at every level,
including approval flags and free-text shot fields, fail closed.

| Field                   | Required value or bound                                    |
| ----------------------- | ---------------------------------------------------------- |
| `schema_version`        | Exactly `"1.0.0"`                                          |
| `purpose`               | Exactly `"DEVELOPMENT_FAKE_ONLY"`                          |
| `claims`                | 1–256 unique claims, in significant array order            |
| `shots`                 | Exactly eight unique shots, ordered by ordinal 1 through 8 |
| Shot `shot_id`          | `sht_` followed by 32 lowercase hexadecimal characters     |
| Shot `ordinal`          | Strict integer 1–8, equal to its one-based array position  |
| Shot `duration_ms`      | Strict integer 1000–30000 inclusive                        |
| Shot `visual_claim_ids` | 1–16 valid `clm_` IDs                                      |
| Shot `audio_claim_ids`  | 0–8 valid `clm_` IDs                                       |
| Shot `camera_claim_ids` | 0–8 valid `clm_` IDs                                       |

Each reference array is individually unique; different fields/shots may reuse a
claim. Empty audio means this proposal makes no sound suggestion; empty camera
means no camera movement is specified. Duration is a text-planning suggestion,
not evidence that a clip, a complete film, or a 15-second export exists.

All free narrative text lives in `payload.claims`, not in shot descriptions,
dialogue, prompts, or other bypass fields. The local `ShotOutlineClaimV1` inherits
the existing `ProposalClaimV1` fields and semantics, with strict boundary checks:

- `claim_id`: `clm_` plus 32 lowercase hexadecimal characters.
- `text`: strict string, 1–2000 characters, not whitespace-only; meaningful
  leading/trailing whitespace is preserved rather than silently trimmed.
- `invented`: a real JSON boolean, never a coerced number/string.
- `source_span_ids`: 0–100 unique IDs, each `spn_` plus 32 lowercase hexadecimal
  characters. A factual (`invented=false`) claim must have at least one source.

The inherited source-reference field remains a tuple internally. A narrow local
before-validator converts only a JSON list of at most 100 items into that tuple;
Pydantic then strictly validates each string/ID. It does not coerce scalars,
accept generators/sets, or introduce a second SourceSpan model. All other new
collections are strict lists. The public payload validator itself enforces these
rules, including revalidation of constructed model instances.

## Structural provenance and the only business entry point

`validate_shot_outline_proposal(proposal: ArtifactProposalV1) -> ShotOutlinePayloadV1`
is implemented in `services/api/src/aijian_api/shot_outline_contracts.py`.
It accepts one complete proposal, never a separate payload, claim map, repository,
or database handle. It raises validation errors before returning a typed payload.

1. Revalidate the complete existing proposal from its Python field data, so an
   unchecked `model_construct`/`model_copy` cannot bypass IDs, byte ranges, factual
   evidence constraints, or the canonical payload hash.
2. Require target `ShotOutline` and exactly one `SourceManifest` dependency with
   a concrete `ver_` ID and `approval_required` equal to the boolean `true`.
3. Strictly validate payload and original envelope claims. Duplicate payload or
   envelope claim IDs and duplicate envelope span IDs are rejected.
4. Require canonical complete claim content **and array order** to match between
   payload and envelope. This includes text, invented flags, and source IDs;
   comparing IDs alone or Python's `false == 0` is insufficient. The envelope
   duplication exists solely for the established proposal protocol. Shots refer
   to the payload's one central narrative collection.
5. Every payload claim must be used by at least one shot, and every shot reference
   must resolve in this same payload/proposal. Every shot needs at least one
   visual claim with source references; that visual claim may be an explicitly
   invented adaptation suggestion. Separately, the whole outline must use at
   least one sourced factual claim. An unused factual appendix does not count.
6. All camera claims must be `invented=true`. All source references must resolve
   in the same proposal through the existing generic proposal validation.
7. Compare the validated payload's `canonical_sha256` to the proposal payload
   hash: normalization must not change narrative content. Changing narrative
   text, an invented flag, or a source ID changes content identity and requires
   a new valid hash; this is not an approval or persistence operation.

The dependency is only an **approval requirement declaration** in O1. The pure
function cannot prove that the version is currently accepted, belongs to this
project, or corresponds to the quoted bytes. Later repository transactions must
verify those facts and `quote_hash` against the actual source. A well-formed ID
alone conveys no authority. Source text that resembles instructions remains
plain data: this module never interprets text, opens files, issues commands,
contacts the network, writes records, or signs human decisions. Structural
provenance is not semantic truth, hallucination prevention, or an end-to-end
prompt-injection acceptance result.

## Integration handoff and acceptance

Tests register the payload only in a private `ProposalSchemaRegistry` and exercise
its existing `model_validate` / JSON dump path. O1 does not modify the built-in
registry or enable a new output target at runtime. Future O2 must call the full
proposal validator before the existing proposal-to-immutable-DRAFT write, and
carry the accepted dependency and byte/hash checks into that transaction. O3's
artifact-specific G1A review policy must validate the exact reviewed version;
neither step may replace existing run/project/revision/budget/QC checks.

Acceptance requires legal eight-shot JSON, factual plus invented audio/camera,
empty audio/camera, cross-shot reuse, stable canonical round trips, and changed
hashes for changed narrative. Negative tests cover size/ID/order/type bounds,
unknown or approval fields, narrative bypasses, duplicates, unknown/cross-proposal
references, unused claims, all-invented content, missing per-shot provenance,
envelope drift, wrong target/dependency, unchecked models, and hash tampering.
The new module's target is 100% lines and branches without exclusions. Existing
coverage gates are unchanged; independent review is still required.

From the repository root, using existing offline dependencies:

```powershell
uv run --offline --no-sync pytest services/api/tests/test_shot_outline_contracts.py -q -p no:cacheprovider
uv run --offline --no-sync pytest services/api/tests/test_agent_skill_contracts.py services/api/tests/test_agent_proposal_validator.py -q -p no:cacheprovider
uv run --offline --no-sync pytest services/api/tests/test_shot_outline_contracts.py --cov=aijian_api.shot_outline_contracts --cov-branch --cov-report=term-missing --cov-report=json:.aijian-dev/m3-shot-outline-o1/completion/coverage.json -q -p no:cacheprovider
uv run --offline --no-sync ruff check services/api/src/aijian_api/shot_outline_contracts.py services/api/tests/test_shot_outline_contracts.py
uv run --offline --no-sync ruff format --check services/api/src/aijian_api/shot_outline_contracts.py services/api/tests/test_shot_outline_contracts.py
uv run --offline --no-sync mypy
pnpm exec prettier --check docs/architecture/ADR-0007-early-shot-outline-fake-path.md docs/specs/member-cli-shot-outline-v1.md
git diff --check
```

Only one coverage writer runs at a time. O1 changes no old SourceExtraction,
formal Gate, database, dependency, or application behavior. Its contract pass is
not M3 integration, visible UI/CLI discovery, human G1A approval, media output,
K01's 20,000-character UI/API-to-1080p-MP4 flow, or the full W8 exit gate.

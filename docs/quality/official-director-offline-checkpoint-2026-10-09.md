# Official director offline checkpoint, 2026-10-09

> Historical source-checkpoint evidence recovered from the preserved schema41
> snapshot. These counts do not describe the reconciled aee66fb source. See
> [the reconciliation verification](official-director-reconciliation-2026-10-09.md)
> for checks actually performed on the recovered integration.

Schema41 adds a native official-account text proposal path to the original dark
blue storyboard route. The HUMAN template remains an independent offline
workflow. See [the exact execution and recovery contract](../architecture/official-ai-director-proposals.md).

## Verified on the frozen source

- Backend: 170 focused tests pass, including existing HUMAN regressions. All
  ten new backend modules have 100% measured line and branch coverage (730
  statements, 176 branches).
- Native transport/IPC: 112 focused tests pass. New director modules have 100%
  line/function and 97.83% branch coverage; the shared SSE transport has 100%
  line/function/branch coverage.
- UI: 56 focused tests pass. New director code has 100% line/function and
  93.42% branch coverage; journal/action/gateway/proposal adapters have 100% of
  all measured metrics.
- Isolated runtime packaging: all four checks pass, including actual ASAR
  Windows paths, exact declarations, production hash manifests, and rejection
  of undeclared/private/test/unsafe exports.
- Final production TypeScript checks for contracts, desktop and renderer pass.
  Desktop/renderer builds and targeted lint/format/whitespace checks pass.
  The existing large-chunk build advisory remains.
- All 54 existing migration regressions pass after updating the fresh-schema
  version marker to 41, asserting the three new director tables, and making
  historical schema40 retry checks expect the current schema. The rollback
  assertions still require the original schema39 dump to remain unchanged.
- Independently reviewed remote/domain/coverage regressions: 125 tests pass
  after correcting stale test fixture columns and revision usage. No provider
  security guard or coverage threshold was relaxed. The director ledger is
  now included in the mandatory 100% line/branch coverage gate.
- Actual hard-process exits around reserve, completion and adoption exercise
  rollback. These cases are included in the focused test counts. Counts from
  different reviews overlap and must not be added into a new aggregate total.

## Actual Linux Electron UI check

The exact Electron43.2 runtime was launched on the cloud Linux desktop with
its sandbox intact, using a new synthetic profile. No existing user workspace
or account data was opened. The original launcher, navigation, storyboard
editor and dark blue styling were preserved.

The explicitly named offline fixtures contain no live provider evidence:

- An eleven-shot adopted fixture loads its typed proposal and saved storyboard
  version2. The old seven-shot storyboard and its old script pin remain; the
  new storyboard pins the revised confirmed script and exact revised dialogue.
- A pending seven-shot fixture was adopted through the actual UI confirmation,
  native IPC and server transaction. The exact receipt was checked in SQLite.
  Renderer reload reads the new seven-shot storyboard and the same single
  receipt, with no duplicate adoption.
- The native generation action remains disabled without a connected account
  and selected available model. No sign-in or model request was made.
- A real native process restart preserves the synthetic UNKNOWN operation.
  Its read-only reconciliation retains the same single attempt. Independent
  manual shot creation/save succeeds while AI resubmission remains blocked.
- The cloud accelerated session produced a corrupted repaint after resizing.
  A software-rendered diagnostic session, still sandboxed, displayed the
  manual and UNKNOWN views normally at 980×680. This is a bounded Linux
  software-rendering layout check, not Windows graphics acceptance.

These checks establish native editing/read/decision persistence. They do not
turn a synthetic provider fixture into real inference or professional human
creative approval. Process-restart, platform acceptance, and creative quality
must be stated separately from a renderer reload or unit test.

## Broad repository checks remain separate

The initial restored broad Python run had 1,847 passes, 130 failures, seven
errors and six skips across 1,990 cases. After the old remote fixture defects
were repaired, the full rerun had 2,057 passes, 62 failures, seven errors and six
skips across 2,132 cases. Seven failed schema-expectation cases were corrected
after their modules had loaded in that run; the separate final 54-case migration
recheck passes. The other failed case identities also appeared in the restored
baseline. These observations do not constitute a green whole-repository run.

All ten new director modules retained 100% line/branch coverage in the actual
whole-repository run. Global Python coverage was 77.93% lines and 61.34% branches,
below the unchanged 90%/83.5% gate; six older critical modules also remain below
their mandatory 100% line/branch requirements.

The broad desktop run had 905 passes and one failure caused by a legacy fixture
requiring its locked Windows FFmpeg binary on Linux. A diagnostic run excluding
only that file passed 875 cases but still failed the existing aggregate coverage
gate. The gate was not lowered.

Restored broad lint had 4,060 errors, including historical archive/work files.
The broad Python type check had 48 existing errors in 15 files. A focused new
backend type check still reaches the existing
`source_extraction_routes.py:274` literal mismatch; no new director-module
type error was reported. Focused successes must not be described as a green
whole-repository CI result.

## Unverified and unavailable

- No completed OAuth grant, real account/model inference, model-produced
  creative quality, or real media generation was tested in this checkpoint.
- The stored model is the requested catalog model; a returned model identifier
  is not independently verified.
- The current adoptable rate path is 24fps or 25fps. Other brief delivery rates
  fail preparation before a provider call.
- Full professional assets, machine-readable continuity, budget enforcement,
  motion/animatic proof, media fulfillment and film-team gate approval remain
  outside this slice.
- Recent full-operation history is byte/count bounded with explicit partial
  metadata. Older records are readable by exact operation ID; a full paginated
  history browser is not implemented.
- Windows acceptance of this new source and a distributable/signed release
  remain separate verification stages. No installer download, artifact upload,
  Release, main merge, credential restoration, or extra-cost provider action
  is authorized by this document.

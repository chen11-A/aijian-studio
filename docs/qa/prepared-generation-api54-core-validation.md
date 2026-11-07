# API54 original full gate checkpoints

Fixed source: `b9c11891babece9dece5761c6b28b2e2e8d49d28`, branch `codex/aivora-prepared-generation-budget`, frozen worktree `/workspace/aivora-action-workflow-fixture-fix`. HEAD and clean state were verified after execution.

The original `pnpm test:py` ran all tests: **5330 passed, 6 skipped, 1981.80 seconds**. Its unchanged coverage checker then failed: line 92.03% meets 90%, but branch 83.25% (8515/10228) misses 83.5%. Overall exit is **1**, not a successful full gate. No coverage threshold, production include/exclude, assertion or timeout was changed.

Logs and stage receipts remain `/tmp/aivora-prepared-api-root-*`; the original full coverage JSON remains in the frozen worktree. Install, Python lint/format/mypy, contracts, all artifact builds and isolated shipping SDK45/old factories had passed before the full gate. Those checks do not override the failed coverage conclusion.

The later planned-reference, strict lineage-shape, cache/local and native image-sink changes have separate source hashes and results. They cannot borrow this full-test count or claim this gate passed. Meaningful actual route, source lifetime, unknown-state and cache regressions are being added; the eventual API source must run the original full gate again.

## Recovered original gate on fixed joint source

The later frozen joint source **b6ab07d7ee3ee0b9e34551924a180fc47fd643fc** ran the original complete `pnpm test:py`: **5390 passed, 6 skipped, 2017.85 seconds**. The unchanged checker passed: line **92.18%** (required 90%), branch **83.59%** (required 83.5%). The runner completed with exit 0, including every prior quality/build/shipping check and final generated-clean/HEAD verification.

Source branch: `codex/aivora-prepared-generation-coverage-validation`; frozen tree: `/workspace/aivora-audio-envelopes`; logs/receipts: `/tmp/aivora-prepared-api-coverage-root-*`. No production coverage threshold or exclude was changed. The failed b9 gate above remains a distinct retained result. This recovered count is not a sum of targeted runs, does not certify later native/pipeline changes or API55 cache/local work, and cannot be borrowed for their eventual final full gate.

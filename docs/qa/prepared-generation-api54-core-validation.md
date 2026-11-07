# API54 core full gate — failed coverage checkpoint

Fixed source: `b9c11891babece9dece5761c6b28b2e2e8d49d28`, branch `codex/aivora-prepared-generation-budget`, frozen worktree `/workspace/aivora-action-workflow-fixture-fix`. HEAD and clean state were verified after execution.

The original `pnpm test:py` ran all tests: **5330 passed, 6 skipped, 1981.80 seconds**. Its unchanged coverage checker then failed: line 92.03% meets 90%, but branch 83.25% (8515/10228) misses 83.5%. Overall exit is **1**, not a successful full gate. No coverage threshold, production include/exclude, assertion or timeout was changed.

Logs and stage receipts remain `/tmp/aivora-prepared-api-root-*`; the original full coverage JSON remains in the frozen worktree. Install, Python lint/format/mypy, contracts, all artifact builds and isolated shipping SDK45/old factories had passed before the full gate. Those checks do not override the failed coverage conclusion.

The later planned-reference, strict lineage-shape, cache/local and native image-sink changes have separate source hashes and results. They cannot borrow this full-test count or claim this gate passed. Meaningful actual route, source lifetime, unknown-state and cache regressions are being added; the eventual API source must run the original full gate again.

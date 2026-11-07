# Assembly fixture admission synchronization

The `ProWorkspace.assembly.test.tsx` BUSY/retry case recorded its mocked assembly call before awaiting the actual canonical record hash. That call count did not prove its input and deferred result resolver were ready. A controlled hold at this existing asynchronous boundary reproduced the CI `TypeError` from `complete()` without changing product code.

The same original case now releases the hold and waits for the validated deferred-result admission before completing. Its `finally` also releases the hold and awaits any actual pending call; a failed hash/selection assertion still rejects directly rather than being hidden by a missing readiness signal. No call means no managed pending result to release. Original timeouts, raw-hash/selection checks, eight BUSY attempts, explicit ninth retry, one assembly, zero cancellation, zero legacy assembly, and zero provider calls remain.

Evidence: `/tmp/assembly-fixture-admission-before.log` has the controlled undefined-input failure. `/tmp/assembly-fixture-full-final.log` records the final original eleven-case file. These are local fixture results, not a replacement for Linux/Windows full CI.

# Native generation sink review

Source: 084de7cd88ce62f0a73fe0449f1f44538601dd23, review branch codex/aivora-generation-sink-review.
Read-only review of ordinary fixed-reference regenerate, shot-frame and planned location on API schema 54. No product change or push. No new evidenced actionable finding.

Evidence:

- Own two concurrent-call probes using the original production factory and real compiler: same slot video => one fulfilled call, one rejection, exactly one arm and one StoryFilm submission; same stage still => one success and one CREATION_ATTEMPT_ALREADY_RESERVED, exactly one provider POST and zero image-unsent. Both preserve canonical project. 2 passed, exit 0, log /tmp/aivora-generation-sink-review-concurrency.log. Probe source retained /tmp/aivora-generation-sink-review-repro.test.ts, removed from review checkout.
- Registry/service/queue/sources suites: 28 passed, exit 0. Log /tmp/aivora-generation-sink-review-boundaries.log.
- Production execution selected tests: 9 passed, 13 unselected, exit 0, 8.48s. Includes same-path source change after arm, newer creative edit preserved/refused, issued take ordinal mapping, reordered/replaced queued takes, unknown reservation/observation ACK, actual signed Python planned location -> frame -> video, creative line/unproved reference refusal. Log /tmp/aivora-generation-sink-review-selected.log.
- Production still driver: 12 passed, exit 0. Includes original writer SHA vs late same-path replacement, observation ACK uncertainty, network uncertainty vs unsent. Log /tmp/aivora-generation-sink-review-still-writer.log.

Important inspected gates:

- film-generation-execution.ts:449-463 reserves stage once before await; :487 requires acknowledged owned reservation before unsent; :508-525 checks actual output against original writer SHA before lineage.
- film-generation-execution.ts:669-672 repeats duplicate-slot check after validation await and binds take synchronously; :694-712 checks current and sources around arm; :679-687 revalidates actual body and enters transport behind current predicate.
- film-generation-queued-dispatch.ts:27-42 verifies canonical inside original save queue, checks owner/account/retire synchronously just before dispatch, and releases queue without a project rewrite or waiting on provider HTTP.
- prepared_generation_store.py uses transaction-protected before_image/claim_video, exact body/account/project bindings, durable READABLE lineage; UNKNOWN and foreign holds are not silently discarded. Native lineage restore checks byte identities plus creator graph and forecast/body identity; selected API54 integration exercised these gates.

Not a claim of exhaustive race freedom. No schema55 or active/frozen tree inspected or edited. Pipeline/portrait/cache/local/old auto-source unenabled scope excluded as instructed. No full suite or coverage run.

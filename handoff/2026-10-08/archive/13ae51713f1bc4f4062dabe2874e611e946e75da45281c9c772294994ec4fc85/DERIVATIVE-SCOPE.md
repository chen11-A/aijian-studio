# QA03 v4 native main derivative source candidate

State: DRAFT_FOR_MGR01_EXACT_SCOPE_REVIEW_AND_MGR02_NEW_ONE_CALL_APPROVAL. Target and formal run-01 are absent.

Call ID: QA03-V4-NATIVE-MAIN-DERIVATIVE-01.
Scope: ONE_POST_G_PHYSICAL_COPY_PLUS_ONE_MAIN_REPLACEMENT_NO_BUILD.
Base: C:\Users\Administrator\Documents\Codex\2026-09-23\qa03-local-sub2api-source-v4-01 after the signed v4b G run.
New target: C:\Users\Administrator\Documents\Codex\2026-09-23\qa03-local-sub2api-native-source-v4-01.

The packet pins S result DAA2FCDD, G result 2CAD6E89, MGR04 G review 29EE14FF, MGR04 native-ready input 3F3B2526, owner main snapshot 51076243, and every post-G stage file/link through POST-G-BASE-MANIFEST.json. The base contains 14,466 regular files (source 13,870; deps 596) and 771 internal relative links. The new target preserves those counts and paths. Only source/apps/desktop/src/main.ts changes from A1359F9E to 51076243. OpenAPI 5DB5480A and generated.ts DE2B2F58 remain exactly the G outputs.

The one-call runner binds MGR02 approval to the exact PACKAGE hash, call ID, target and scope. It creates run-01/CLAIM before packet, runtime and source preflight. It verifies every base file and link, creates the new target, copies every file and link, replaces only main.ts from the pinned DEV07 snapshot, and verifies the complete target and unchanged base. It records a per-file/link copy log, target/source/input readbacks and first failure. If a pinned manifest is unavailable, the corresponding diagnostic remains UNKNOWN. A consumed claim is never retried or cleaned up.

This is a physical derivative source stage only. No TypeScript build, dist output, sidecar launch, Electron, API, DB, provider or product acceptance occurs here. A later separately reviewed build must use this single source and its generated contracts; QA02 native checks and a visible Electron window remain separate.

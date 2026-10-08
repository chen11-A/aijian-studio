# QA03 new composite v3 physical stage pickup

State: `PACKAGE_DRAFT_NOT_SIGNED_NOT_RUN`. This packet is for one physical copy only, after MGR01 scope review and an independent MGR02 signature matching the final `PACKAGE.json` SHA-256. It does not authorize generation, imports, a service, migration, API calls, Vault or provider calls.

- New target: `C:\Users\Administrator\Documents\Codex\2026-09-23\qa03-local-sub2api-source-01`. It must be absent before the one-time claim.
- Composite input: `COMPOSITION-INPUTS-v3.json` SHA-256 `648AC433988F82A97935BB2AB5F2A5F21388ED8EBC1CF1822978715B32C36912`, 24 selections with zero owner overlap. The selected DEV04 `studio.ts` is the frozen `.after` SHA-256 `E70D8E2ED484340DC656AB6D0E1952F097E49AC41BEC9C225F21CC941570F286`; never fall back to its live author file.
- Base: W0-v3 source manifest 13,681 regular files and 771 internal relative links; S2 selected backend 187 regular files, deps 596; 23 replacements, one addition and one QA-local exporter. Expected pre-generation target: 13,870 regular source files, 771 internal links and 596 dependency files.
- The script must hash all inputs before copy, check path/link containment and destination collisions, claim once, copy exact bytes, then hash all inputs and the entire target again. Any mismatch is RED. Preserve raw failure and do not retry the same claim.
- The old signed `qa03-local-sub2api-stage-01`, W0 source, S2 source, author trees, B31 and c19 are read-only inputs. This v3 stage is not same-version desktop consumer acceptance: MGR04 v3 predates DEV07's later sealed consumer candidate and DEV04 local write gate remains closed.
- Generation (two contracts outputs), schema-v33 API/DB behavior, P1/L1-L4, approval consumption, real Vault, provider and Electron are separate future packets.

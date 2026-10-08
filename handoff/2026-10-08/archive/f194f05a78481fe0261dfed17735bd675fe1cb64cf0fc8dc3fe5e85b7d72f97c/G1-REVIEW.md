# core153 G1 repo30 current-combination migration packet

State: READY_FOR_MGR02_ONE_SHOT_REVIEW; NOT RUN. Scope is synthetic QA SQLite only. No product DB, provider, tool discovery, encoder, MLT, Job, sidecar, or c19 write.

## Evidence reused and the new case

- The historical isolated `repo30-isolated-01/RESULT.json` SHA256 `40B1B3259ABE3B4AA9872024FF61D1E01446620FCCB2C44257D5A97FE67EB45C` reports `REPO30_ISOLATED_MIGRATION_PASS`. It covers fresh v0→30, v23/26/27/28/29→30, reopen, expected first-statement faults at v27/28/29/30, and too-new v31 rejection. Its closure SHA256 is `3D996986C7ED080B7994EF91ED17674E3E864C12F5402974AA1F6E90477605AE`.
- Current fixed core153 package has the same repository SHA256 `C21049176963798A3D0DE0748EAFD5FF41F0294C759939A31BDFD694C5C43DD8`; all 24 historical migration closure module hashes match current package entries. Current import-only receipt SHA256 `667EF18806313392923F154D390D9C6346A933EC5F25DCB2827C4B72D2D00C9B` proves only bounded consumer import. The old migration runner used a 25-file isolated closure and a different Python environment, so the new case checks the current 153+157 consumer combination.
- New case: copy the frozen historical `original-v26.sqlite3` (864256 bytes, SHA256 `7617BBA01736D72BCD7F5319788D1B950DAD7174068992AE239BC85A29BD1388`) into a fresh QA run profile. The source WAL is zero bytes; its stale SHM is not copied. Read the v26 logical table state, migrate with the pinned current repository through 27, 28, 29 and 30, read v30 integrity/FK/schema and all prior table row digests, then reopen without any migration step. The source DB and all 153+157 inputs are hash checked before and after.

## Per-version historical transaction assertion

Current `StudioRepository._initialize` begins, commits and rolls back each version separately. The historical expected fault at the first statement of each version is a PASS condition, not a new unexpected RED:

| Failed version | Committed `user_version` | Failed-version tables absent | Earlier versions |
| --- | ---: | --- | --- |
| 27 rights | 26 | decisions, heads | v26 rows intact |
| 28 export | 27 | operations, media inputs, subtitle inputs, outputs | v27 rights tables intact |
| 29 script confirmation | 28 | confirmations | v27–28 tables intact |
| 30 probe | 29 | probe evidence | v27–29 tables intact |

For each historical fault, the packet requires integrity `ok`, zero FK violations, failed-version tables absent and earlier tables present. The new runner does not inject or retry these faults. The historical result is version bound; new source drift invalidates reuse.

## Frozen launch contract

- `PACKET.json` SHA256 `04DFEA764D3B08F5CC950B13FF3D6454CA7C9B5123A355800DF6ABA4EBBCB843` binds current 153 source files, 157 dependency files, fixed Python, prior import receipt/packet, old migration closure/result, source v26 DB, table expectations and QA run root.
- `g1_once.py` SHA256 `203D1F45EAA4741001D1C32ABB0D17A9378A34020C586B91A611D171FF25B381` AST parses. It rejects import fallback, outside-DB connections, Python writes outside its run root, socket/process calls and unexpected mkdir during migration. A first unexpected error writes RED and stops.
- `launch_g1_once.ps1` SHA256 `1CCA52FBD537B14DDFC239491B8FCF41CE00914C26FFE4202AC092752947D3E1` parses with zero PowerShell errors. It clears inherited environment, sets only the eight pinned Windows/QA profile keys, uses fixed Python `-I -B`, QA cwd, hidden child window, and a 180-second limit. `LAUNCH-PACKET.json` SHA256 `783D9D55CEA532FFA1E98122BC520750DE2222B75B366130D45B216E8D50A6BD`.
- Empty `profile-01` has five directories and zero files, recorded in `PROFILE-PREPARED.json` SHA256 `678E695BD1C202F99FC611AB386A70319F939F126EAFB14BD1FC2D5D9F20A08F`. `GRANT.json`, `run-01` and `launch-01` are absent. Only MGR02's separate single-run grant may start this packet.

Allowed future writes are confined to QA `run-01` SQLite DB/WAL/SHM and evidence, and `launch-01` raw process evidence. A PASS would establish this local migration combination and logical reopen only; it would not establish rights, claim, lock, product UI, packaged or real export acceptance.

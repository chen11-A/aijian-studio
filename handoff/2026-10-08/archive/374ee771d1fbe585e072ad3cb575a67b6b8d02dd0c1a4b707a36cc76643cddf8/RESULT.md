# QA03 AC05 author-root contract generation

- Date: 2026-09-24.
- Author root: `C:\Users\Administrator\.codex\worktrees\s2-q1-g1-d00-default-deny-59f-20260923\sp`, HEAD `211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2`.
- Author-source authority: `C:\Users\Administrator\Documents\AIVORA\management\manager-handoffs\release-snapshots\20260924-ac05-handwritten-32\SNAPSHOT.json`, SHA256 `E8ABDE08DB5E1F14EFD6B71E7C075AF560FDEFAEDA7880453814C9CADA0C97FE`.
- Scope: generate only `packages/contracts/openapi.json` and `packages/contracts/src/generated.ts` in the author root. No c19 write, Electron, provider, network, product build, or native acceptance.

## Lock and generation

The official 32 paths, byte lengths and SHA256 matched the author root 32/32 before OpenAPI export, between the two commands, and after TypeScript generation. `candidate-32-pre.json` and `candidate-32-post.json` record the local values; comparison by path/bytes/SHA found zero differences. The frozen author allocation was DEV01 4, DEV02 1, DEV04 3, DEV05 11, DEV06 8, DEV07 5. The source store SHA was `6256FB8BB5F389BCA3BD1910DDA0875B88203A85FE46EDF6D91BDF98A6F2B7C9`. Git status was 81 lines before and after, with identical status-file SHA `C01B0F4705874C1447013F46E0C214221A30C4795EB060139C892EBF8304F4DB`.

The true old outputs were backed up byte-for-byte before generation: `openapi.old.json` SHA256 `E0D9F54AFA7CAA756B55B8BF39AAA28D68C4DCCDED57AAC6AF4440BE06E1403E` and `generated.old.ts` SHA256 `B3F9566E2458A245851691D8D8E930AFFF6515C8AEE7A8850A3A932CD01EDDDF`. `export_openapi.old.py` matches the current exporter SHA256 `C0707D4C719C347667113222FF7211AC4EA00132A89D6F4EB19A2159300F3F5E`.

1. `uv run python scripts/export_openapi.py`: exit 0; raw `export.stdout.txt`, `export.stderr.txt`, `export.exit.txt`. New `openapi.json`: 467103 bytes, SHA256 `DA0332EBD13ECF891D980DD882F4EA0DE4A749CB148949B4D732F6DB0B03A779`.
2. `pnpm exec openapi-typescript packages/contracts/openapi.json -o packages/contracts/src/generated.ts`: exit 0; raw `typescript.stdout.txt`, `typescript.stderr.txt`, `typescript.exit.txt`. New `generated.ts`: 277539 bytes, SHA256 `EF283C663DEAA7CE90FF997A08B5186166F594C926A62F99611BEC15F91C3BA2`.

`openapi-before-after.diff` and `generated-before-after.diff` preserve complete old-author-output to new-output diffs. Both `git diff --no-index` commands returned 1 because the outputs changed, with empty stderr. Their SHA256 values are respectively `548691BC6FC0AA5A337C3996855F0E750B63EF9E9334D2493E79549A88BB2262` and `FF470DF52EDAD424DB54985877369BBFBA068C3A9A9C9760AAFE41DDC872D265`.

## Semantic comparison

`semantic-diff.json` SHA256 `0842DB578EA1F7D4152430B8BABDABB9948BB5160C05E7641E7440EE44830526` compares the new OpenAPI with both the true old author output and the frozen PROJECT01 two-contract snapshot. Against PROJECT01: 41→44 paths, 47→51 operations, 215→228 schemas. New operations are `createSub2APISourceExtractRun`, `getSub2APISourceExtractApproval`, `approveSub2APISourceExtractCall`, and `getSub2APISourceExtractOperation`; 13 schemas were added. No old path, operation, or schema was removed; no existing operation body changed. Existing `ArtifactProposalData` and `SkillCatalogData` schemas changed for AC05. Against the true old author output, the difference additionally includes the previously generated PROJECT01 `updateProject` PATCH and `UpdateProjectRequest` schema.

This is a static generation and compatibility check. MGR04 can freeze a 34-item author package from the 32-source authority plus these two output SHA values. AC05 integration into c19 and runtime/provider acceptance remain separate gates.

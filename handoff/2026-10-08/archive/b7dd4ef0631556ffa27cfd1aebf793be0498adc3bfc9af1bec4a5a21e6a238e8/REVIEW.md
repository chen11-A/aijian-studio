# QA02 B31 desktop IPC v3: static review packet

Status: **STATIC PREPARED, NOT GRANTED, NOT RUN**. The v3 launcher must not be called until MGR01 reviews this exact packet and MGR02 writes an exact-scope single-run grant. The v1 and v2 RED evidence, attempt markers, grants, and profiles remain unchanged.

## Scope

Isolated B31 desktop TypeScript no-emit typecheck followed by one local IPC/API mock run. The mock uses synthetic identifiers, a canary API key, and a fake HTTP transport. It does not call the backend, provider, visible Electron, or C19 writer. Passing it would establish only this isolated gate, not native or full B31 acceptance.

## Frozen identity

- Packet: `B31-PACKET.json` SHA256 `4F2ADB717B2501C9596DCB37102C4824AEFEBF432286804690AA82EE43F9005F`.
- Approval ID proposed: `MGR02-B31-DESKTOP-IPC-TS-MOCK-V3-20260929-01`. Scope: `B31_DESKTOP_IPC_TS_MOCK_ISOLATED_V3`. One attempt: `run-01`; grant, attempt, and run are absent.
- Stage: 92 project + 286 toolchain files + 1 QA tsconfig = 379 physical files, no links. Stage manifest SHA `0E354622F6E09FC39EBA8B7167EA126934C6CC9C44135A364AC8D7B867F170D2`; toolchain manifest SHA `7361AC04BE46EC03B2B530F3F7006B8B11464386107C75CAA02F5C9BB1FA6BC2`.
- Source manifest SHA `B91EE1F989B73E23B4740224643B95F48517F006448DCFD375F91E67C11E35B9`; v2-to-v3 lineage SHA `9DBAAAB340EAE41F5F22AB96726C146DB5BE3808272B370CF5CA12B8B58B6B01`.
- Launcher SHA `1111264F21A63CF75C655D0D6C3EA6C5A88F45A539074B323DD862BB84729028`; runner SHA `6C04C3F1E4C9CAD00E0E3AA663294088EDDA30F252D1E4D337B1B3F9ACC8CF50`; loader policy SHA `94F3C9BBEF523E30D1D1FA4F319E4BBA916C23AD05F0030E86EDEF2BEB483232`.
- Python probe SHA `E16EE642FB64EC063AF5122368068FF74AA7D6C1D5883F5F235FEE096E3252AC`; Node probe SHA `E17D67443B35E597676D322D83018473E69B3E1A22FCB38C0EBA1EC3B2AB6D62`.

## Changes since v2 RED

The v2 mock failed before cases because its loader denied `@aijian/contracts/invalidation-operation`. A staged TS AST scan of all four roots and their recursively reachable runtime modules found 28 modules and 57 imports. The only runtime bare workspace imports are `@aijian/contracts/invalidation-operation` (SHA `1C6E5981A794E5F462E93BA262C79CC8A7AD8EE75AAA38E991BDF4DDE425636F`) and `@aijian/contracts/artifact-proposal` (SHA `687574B27677484885B6281DFDE64BA8505C93C25361AC0866D257F13571C7DF`). The loader policy resolves both to pinned, physical paths inside the QA stage and rejects unknown externals, unknown builtins, path escape, aliases, and unpinned modules. The closure evidence SHA is `824BBDB7281D1284D4279BC9BC520C3F0EAE302BB856452FA365D16D1AFE0BE2`; the exact policy static test accepted 57 edges and rejected 8 cases, evidence SHA `0927BBB69A1ACB80A932E030D57A531F9E27D119635CFDAF1BD7343F814D3988`.

The v2 run also wrote a Node compile cache file into its isolated profile. The v3 child environment has exactly nine variables, adding `NODE_DISABLE_COMPILE_CACHE=1`. A fixed Node 24.15.0 probe returned `compileCacheStatus.DISABLED` and left the new profile at four empty directories; evidence SHA `E261E996BABF726BA62497CF883DE304C6FE2D8A0B9A73E4E4C938D85A21BB90`. The launcher still rejects unexpected profile files in postflight.

## Static evidence and proposed run

- Fixed Python and Node consumer probes passed: 212 Python rows, 814 Node checks, 379 staged files; both stderr empty, profile 4 items before/after, no TS/mock run. Evidence `B31-V3-STATIC-CONSUMER.json` SHA `967D145905B119E5E63EE1C30D6C2B8F76A421854AFBB67097BCC6CCA49C3525`.
- Packet/order static check passed 12 hash mutation negatives; evidence `V3-PACKET-STATIC-NEGATIVE.json` SHA `2884F000BEBF392E8055B4C3E9051F449EA43C05C1C8143D3B2A14CEA8C0613B`.
- Syntax checks passed for the launcher, QA Python, and all QA JavaScript. No typecheck or mock was run in v3.
- Proposed single-run command after exact grant: `& .\launch_b31_v3_once.ps1` from this directory. It consumes an attempt marker before precheck, records raw stdout/stderr, PID, exit, timeout, and RED or receipt, and stops without retry on any failure.

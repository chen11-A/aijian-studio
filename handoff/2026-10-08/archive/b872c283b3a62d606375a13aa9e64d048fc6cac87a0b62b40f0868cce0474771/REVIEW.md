# QA02 B31 desktop IPC v4: exact-scope review

Status: **STATIC PREPARED, NOT GRANTED, NOT RUN**. MGR02 rejected v3 before signing because its attempt marker write lay outside controlled error capture and had no readback. The v3 packet stays unrun; the v1 and v2 RED evidence stays intact. The v4 launcher must not run before new MGR01 scope review and MGR02 exact-packet single-run grant.

## Scope and frozen identity

This is one isolated B31 desktop TypeScript no-emit typecheck and local IPC/API mock. The runner uses synthetic identifiers, a canary key, and fake HTTP transport. It cannot establish native Electron, backend, provider, billing, C19, or overall B31 acceptance.

- Packet `B31-PACKET.json`: SHA256 `2A59F06D382D2AA33C591130662A79189046256BBFFD682DDEDC543DEDC3B2A3`; scope `B31_DESKTOP_IPC_TS_MOCK_ISOLATED_V4`; proposed approval ID `MGR02-B31-DESKTOP-IPC-TS-MOCK-V4-20260929-01`; one run `run-01`.
- Stage has 92 project files, 286 toolchain files, and one QA tsconfig: 379 physical files, no links. Stage manifest SHA `3C510E806EEC14252E3BFFF5AA7519D07E090C7696A11568A6C19D3CBDA9AFB4`; toolchain manifest SHA `DC552D786D51FF209F7B6B4A86F27BDEB54755ECDC98002C2308F231A4A770BA`; v3 to v4 lineage SHA `DE89CEEE270238DD616F6B57DDC3A599CB1E3E18E172C25404CCCDF43B5BD0BB`.
- The 28-module/57-import static runtime closure is byte-identical to v3, SHA `824BBDB7281D1284D4279BC9BC520C3F0EAE302BB856452FA365D16D1AFE0BE2`. The exact loader policy SHA remains `94F3C9BBEF523E30D1D1FA4F319E4BBA916C23AD05F0030E86EDEF2BEB483232`; mock runner SHA remains `6C04C3F1E4C9CAD00E0E3AA663294088EDDA30F252D1E4D337B1B3F9ACC8CF50`.
- v4 launcher SHA `BE2B5B06033A6FEE56198F5E48E5CFB7498018EFCEA9A18243EAC9898CEC47F0`; fixed Python probe SHA `E16EE642FB64EC063AF5122368068FF74AA7D6C1D5883F5F235FEE096E3252AC`; Node probe SHA `C377C5B17F527E5DF302AC8CFF84EBCA3378AEEE8250A884B304119C3EA5279C`.

## Claim and shell changes

Before precheck, the launcher writes the attempt marker with CreateNew, flushes it to disk, disposes the stream, and checks exact byte and JSON readback plus SHA. All claim failures enter a dedicated catch that writes a CreateNew `B31-ATTEMPT-RED.json` with the raw error, verifies its readback, and stops without retry. If even RED persistence fails, the thrown error includes both the original claim and RED-write failures. The actual launcher claim block passed five QA-only fixture cases: successful claim, CreateNew collision, injected flush failure, injected dispose failure, and corrupt readback. Each failure left no run directory and a durable ATTEMPT-RED; evidence SHA `0E1C7F9AFE8A5A88164CE446E8C8FDFF8735AFB03CE60E9B9B64BC35B04326C3`.

The launcher requires this exact shell before claim: `C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe`, version `7.6.5`, SHA `362A356CE7F0940EC74F73A8FC2C990A2CC24A38A11C90BBD8ECA947110AD139`. A QA-only selfcheck verified ArgumentList with spaces and Chinese, nine-variable clean environment, hidden child, both streams, timeout tree kill and wait, with no profile files; evidence SHA `0FE37113EFF21DE9319DBE53830535C46A2FE24788C88C4DD59DE76EC6104610`. Child environment includes `NODE_DISABLE_COMPILE_CACHE=1`; Node 24 confirmed disabled with four empty profile directories before/after, evidence SHA `300575470921E033FC16CC1DBE631EF1535568E193467F3BBEA0BB1B2C510011`.

## Pre-run checks and invocation

- Exact loader policy static check: 57 accepted closure edges and eight denied cases; evidence SHA `FF412A0CAECB26531E7A96DADB7BB733497AE935EE4AF5DB8E245C97C40290E0`.
- Fixed Python/Node consumer probes: 212 Python source rows, 816 Node checks, all 379 staged files, zero stderr, profile four items before/after; evidence `B31-V4-STATIC-CONSUMER.json` SHA `BDB2C5C84C4C58E061DD048FD2D9BF3506337239A6746501AE35C9D361D2DA12`.
- Packet/order check: 14 pinned inputs and 14 hash mutation negatives; evidence SHA `23328CD725B8C554DCDA0169BAD3783A2C6147BBF1B84ADB83EF0A577DEED41F`. QA PowerShell, Python, and JavaScript syntax checks passed. Grant, attempt marker, ATTEMPT-RED, and `run-01` are absent.
- After exact grant only, invoke the packet's fixed command: `& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe' -NoProfile -NonInteractive -File '<this v4 directory>\launch_b31_v4_once.ps1'`. The packet stores the actual absolute launcher path. Any RED consumes the attempt and stops without retry.

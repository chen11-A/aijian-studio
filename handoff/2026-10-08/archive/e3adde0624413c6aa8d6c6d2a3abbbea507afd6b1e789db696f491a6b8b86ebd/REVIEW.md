# QA02 B31 desktop IPC v2 single-run static review

State: `STATIC_PREPARED_NOT_GRANTED_NOT_RUN`. No B31 TS typecheck or IPC mock has run in either v1 or v2. This is a new, physically independent QA-only stage and approval ID. The v1 grant and consumed PRECHECK RED remain unchanged.

## Cause and evidence preserved

V1's sole attempt stopped before child processes at `FILE_CHANGED:C:\Users\Administrator\Documents\Codex\2026-09-23\qa03-r2b2\candidate-source\services\api\src\aijian_api\__init__.py`. V1 ATTEMPT SHA `0B4A4DFB3B0F12949CE8505757C7E88C03F5F8ECFF5E97DBADDB3DC585EF55C2`, RED `2745441E4D9FCA8F74C393A9910388AFCC1192DA394D0E28E9A93D1C2817091F`, EXIT `41A4D316573A719F41B8ADE9960D291C360CF257D992DD87A60953ED5E558D73`. The fixed Python consumer reads the 56-byte file as SHA `333A85461A874678AC3C4FA0ABF4AE0F415BAAB2015384C85976E7EE42690D2A`, matching the immutable manifest. PowerShell `Get-FileHash` sees `F3F3A9D35E7679C36EFB52E4B85F4A8010E1533F1A343663857F239E5E47B10B`. This is a reader-view mismatch, not proven source drift. The independent v1 postflight SHA is `2955EE62AE9992F03BE72F03C1A9B95AF959F63322C6F3BB0AB92367B24FF472`; a read-only Node view audit of 803 non-Python inputs had zero mismatches, SHA `0EEBD858E1D2FE170E4BC9D8C538F10FD3800955D26696306088A2A2DE88FF00`.

## Exact v2 review inputs

| File | SHA-256 |
| --- | --- |
| `B31-PACKET.json` | `4D8E52A0FA2FB667BCAA82F7BD2DFB15362D45D2E23FCDC2020B019FC7045617` |
| `STAGE-MANIFEST.json` | `B04FA0918EA85947AEF7B163A14A53BFEE30019848F4A193CE38BBEEC32076CC` |
| `TOOLCHAIN-MANIFEST.json` | `8F9D5EA5EE4B1265AB8EFBB42DAD2F8BD7AF491886EE160A81E30FD7E5285647` |
| `V2-LINEAGE.json` | `BB1285EBFDD29292D6E74C78BED86F61228DA652869D1E7B6D260A9EB1FDA4B1` |
| `desktop_ipc_mock_once.cjs` | `38E31AA087AC0B5F4A3B4D463331DC4480A5BA5F32DA8CDF535283E2FEEACA9D` |
| `launch_b31_v2_once.ps1` | `B90954C3282FE89E571AC0C0644D526ACED41E9F22C9BF08A833269D6909D544` |
| `probe_python_sources.py` | `E16EE642FB64EC063AF5122368068FF74AA7D6C1D5883F5F235FEE096E3252AC` |
| `probe_node_sources.cjs` | `D9DFBDA6FB1724F20EA8071659C3246E3CB9FE553277857CB580169982E8EC4A` |
| `B31-V2-STATIC-CONSUMER.json` | `283C3B490566112399727BFF2F98E2329DB27253EE221A01EEED22AA79F235BD` |
| `B31-V2-STATIC-NEGATIVE.json` | `773CAA6590E9FBD79F9619A7F5C797EF5C136312AC6040DA55D03EFA53AB77BF` |

The source manifest remains MGR04's `B91EE1F989B73E23B4740224643B95F48517F006448DCFD375F91E67C11E35B9`. The new physical stage has 92 project files and 286 toolchain/type files, 379 files including its QA TypeScript config, with no links. Its source map includes all 14 DEV07 desktop selections; all 50 selected, 194 backend, six c19 baseline, eight references, and six supersession mappings remain bound to the same manifest. The runtime is pinned to Python SHA `F598FB950A86A895D8F9B4755FC9B38C48ADC7A15732A342E55C17A3C3499602` and Node SHA `3331E1FFE19874215472217C5E94F5A0C6D8E18C4AC7111D3937AA0AD5E9B4A5`.

## Consumer-specific gate

The launcher requires a new v2 grant, then exclusively creates `B31-ATTEMPT-USED.json` before any fallible packet/source/profile/hash/child preflight. All remaining work stays in one try/catch. A 30-second fixed `python -I -B -S` probe reads only the 212 selected/backend `.py` records; a separate 30-second Node probe reads non-`.py` manifest inputs, c19/reference inputs, the physical stage and toolchain, QA runner, and packet. Neither imports product modules or opens a database. Both run before and after the 120-second no-emit `tsc --listFiles` and the 60-second isolated IPC mock. The compiler file list must stay inside the QA stage. Every child has bounded process-tree kill, exit wait, and dual-stream drain; the first failure writes raw RED/EXIT/stdio and consumes the attempt. No PowerShell source-file hash precheck remains.

The mock is unchanged from v1 and unrun. It covers main/preload/handler channel agreement, top-level sender and payload rejection, metadata PATCH outcomes, single rotation POST, same-operation GET after uncertainty, receipt identity, and synthetic canary result exclusion. Only the authorized rotation request carries the canary; there is no real provider call.

## Static proof and limits

An isolated clean-environment static run of the exact probes passed: Python 212 `.py` rows, Node 808 read checks with 32 non-`.py` manifest rows, 92 project and 286 toolchain files, 379 stage files. Python AST, Node syntax, PowerShell parse, and v2 source-order/negative data checks passed; four packet mutations were rejected by the static predicate. `B31-GRANT.json`, `B31-ATTEMPT-USED.json`, and `run-01` are absent; profile remains four directories, zero files. MGR01 independent review and MGR02 new exact-hash single-run grant are required before execution. A TS/mock PASS would still not establish migration31, full backend behavior, Web UI, actual Electron/native packaging, provider behavior, or c19 integration.

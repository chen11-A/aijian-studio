# QA02 core154 reader G1 v2 static review

State: `STATIC_PREPARED_NOT_GRANTED_NOT_RUN`. This is an independent QA-only candidate. No product code or reader call was executed for v2. MGR01 source review and MGR02 separate signed single-run grant remain required before any G1 invocation.

## Why v2 exists

The original G1 one-shot stopped at `AUDIT_DLL_DENIED:('kernel32',)` while reading the first local synthetic DB; its `RED.json` SHA-256 is `11940F5A2C75D7CC2C0BB37F789CC6AA5D56858B48520E99860CCD4F7EC2A59F`. The original packet, common, runner, and launcher hashes remain respectively `3D74E377B9B2D54B796EB7087C2D0320948C74BD5704E255B1257E669622F90F`, `5AEF0F8DA91EBC73F5EDA689A490F5D4FFCE4E015ADD20F75091116B357251EB`, `23C02D0DF065B079A270A819F088F7B542AB88DDF0592482DD3DFDA2D60949DD`, and `57A53997230078CB6FC89BB5E682ECDC035AFEEF85E7F7C66756B3B114098CFF`.

Fixed source analysis predicts two `ctypes.dlopen('kernel32')` events in `no_decision`: CPython `ctypes.windll.kernel32` lazy import during `media_probe._is_remote_windows_path`, then explicit `ctypes.WinDLL` during `_open_windows_source`. The next nine DB cases predict one explicit load each; the final four predict zero. The exact per-case contract is `2, 1×9, 0×4`, total 11. The first event stack was **not captured by the old RED**; this prediction remains unverified at runtime. Any actual mismatch is a new RED and consumes the separate v2 one-shot.

## Frozen review inputs

| File | SHA-256 |
| --- | --- |
| `G1-PACKET.json` | `CFEBD32E60995FFB723E30C2C8BE249113BDCC2D60EB9DC9DFB79FB5433B2006` |
| `gate_common.py` | `C6583DE3D7BF88FBCE9A8E0952A546A08E0B5989E2C054D157F82E13BA6A8F2D` |
| `g1_behavior_once.py` | `96BCD287B84A81B504DD5A48D29EF49A915A0FF149A48CCDD808703D9EB19C40` |
| `launch_gate.ps1` | `55A3D2FD4E1CD7549405386ACAEED5130F540E694CC7C33F24EBFAAD9CDCBBB6` |
| `FIXTURES.json` | `15F7E3E894CDB9CEFD7E5B4BAED32DF1F67DB10CA3146600E628F1F01CC71AF7` |
| `CASES.json` | `4E596BBEF63D8285D6837E505F09FD2C48DF216AE43396D86CE7F8A0A07550E6` |
| `G1-STATIC-CLASSIFIER.json` | `9F2C9918551C988E2C5FD1A7BA23A55FAF79B7BD0DBD6F1EDA9B5C87FDA4CA39` |
| `G1-STATIC-INVENTORY.json` | `CBCD12B67BDB61C5E3CED8B2B15E86AC2298DD559BC4ED60A491B409C2B4C7EF` |
| `G1-STATIC-HASH-PROBE.json` | `2C8F6983AF32B2C771242EB6BA3443BDEB459CAD7117A8E13A11513353EA0544` |

The packet pins the accepted G0 receipt SHA-256 `C7B1FEC9A846A23935356BA1B5192C5EB97CFBD2F5344B5FA2229ACCC97D0156`, the exact 154 product and 157 dependency files, the fixed Python binary and `ctypes/__init__.py`, the clean eight-key environment, the separate empty profile, and the independent 13 fixture files. It binds a new scope and approval ID; no old grant applies.

The audit permits `kernel32` only in the active reader case window during BEHAVIOR: the first lazy stack has exact ctypes prefix and product tail with one to sixteen frozen importlib bridge frames, and each later explicit stack has exact four leading source frames. Other DLL names, phases, windows, stacks, extra events, and writes stop RED. It records every observed DLL event and stack in receipt or RED.

## Static checks and boundary

Python AST and PowerShell parse passed. Pure-data classifier checks passed 39 cases including wrong DLL, phase, window, stack, duplicate and budget cases; this did not import product code. Read-only hash inventory passed: 154/154 product files, 157/157 dependencies, 13 independent fixture files, pinned G0 and ctypes/Python hashes. The isolated `-I -B -S` hash probe passed with the empty profile. `G1-GRANT.json`, `G1-ATTEMPT-USED.json`, `g1-run-01`, and `g1-launch-01` are absent. No G1 behavior, DB readback, native Electron, provider, or legal clearance result is claimed.

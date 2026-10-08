# QA03 REL03 targeted frontend and contract QA, 2026-09-28

MGR02 granted a bounded c19 test window after MGR04 protected sync. QA03 independently verified immutable REL03 snapshot SHA256 `FF818539604AE69C0739BE3A5E3FAD1F77EC56120FF4F644BC33B1046E655568`, sync receipt SHA256 `97373084ED5F6BA642EEF7DF7F504410F84D8FA5CA2946198AE9C5B3FEB1E101`, all 32 c19 file SHA values, HEAD `211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2`, and status 110 before testing.

| Gate | Script SHA256 | Result | Raw stdout SHA256 |
| --- | --- | --- | --- |
| AC05 CONSUMED adapter, original RED repaired, journal lock, one POST, readback | `31808CADC36319EB025DD1C9B3A06A11B35E669870CDBFF60AB4E2AD391527BD` | 1/1 PASS, exit 0 | `0542D13A29D5261C015F74DB009D3B074C75673F8026878F6CF50F4A73D05F38` |
| AC05 real POST 200/CONSUMED desktop client classification and GET/POST/GET/GET | `DF8FCE2D0A572D2F27A02C11F233468E91FCCA7CECB684119390037EB0FFBECF` | 1/1 PASS, exit 0 | `F7966CADCAA89ECE1A34C25B7B8CBBAE432E2E04A4931213E83007D8E7E3C176` |
| AC05 real HTTP queue 201, normal approval, proposal/cost, acceptance/reopen, project isolation | `C97A1BF679F63C31AAAD2E67D804405B97D6AEEB9EDB6FA4B9E56F2D27BA563E` | 6/6 PASS, exit 0 | `026594FC59DAB13EE268BB7D4CF0870D51B58A31F8A6CB17B2B057DEAD40ED83` |
| P22 preferences revision, readback, unknown and invalid input | `594CF4D09CEF6055CCFFB28C418141A17A73E9450C443FD42DD0A5328E55F613` | 3/3 PASS, exit 0 | `F92C49037B16F9FE1880E0B98446219A8D975ACF83B52D3BC6093DF4DDC48C1A` |
| P17 asset selected version/rights, foreign project, invalid version/reference | `CFBAF07830F4C3D89B372D559C77546153B00FC18CD4DF644A6CBE63ABC67FFA` | 3/3 PASS, exit 0 | `CBE514E5469999E688C2A8B829252FB2C9A90C0CDE95749ACAE5BAD764560FB8` |

All five invocations used the external `vitest.config.mjs` alias to the same c19 source. AC05 inputs were QA01's actual sidecar captures: normal HTTP chain SHA256 `D3692859B9C9E2CF0F4E00669D96EAC81F2492735BB6F996D417CD5C85DB4C30` and POST CONSUMED race SHA256 `B8570FE14FCF774BAAB7688AF5E4887E5307102BD468AEB4E6DBFCC4078F1251`. Raw stdout/stderr and exit files for each gate are retained here.

Postflight: REL03 32/32 SHA unchanged, HEAD/status unchanged, c19 related processes 0. No c19 product source, dist, or build was written by QA03 in this window.

Limits: P22/P17 are isolated adapter-contract tests with in-memory test gateways, not native UI or backend persistence proof. The frozen panel source has explicit buttons for approval and operation GET; this run did not prove automatic read-only reconciliation after CONSUMED. Real project creation wording requires separately frozen `model.tsx` not in this REL03 package. Real provider calls, actual cost, installation, and whole-product acceptance remain untested here.

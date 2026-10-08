# QA03 AC05 real-response client QA, 2026-09-28

## Fixed input and provenance

- MGR02 owned the serial c19 test window. QA03 independently verified HEAD `211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2`, git status 87, the AC05 parent snapshot plus policy/store deltas 34/34, and the pause-to-resume source 90/dist 78 fingerprint with no hash drift. `snapshot-pre.json`, `before.json`, `drift-compare.json`, `pretest.json`, and `posttest-compare.json` preserve this evidence.
- QA01 captured responses from the real sidecar routes/factory/store in new isolated databases with an injected fake credential vault and one mocked Sub2API transport dispatch. Normal HTTP chain: `HTTP-CHAIN.run03.json` SHA256 `D3692859B9C9E2CF0F4E00669D96EAC81F2492735BB6F996D417CD5C85DB4C30`; actual approval POST 200/CONSUMED race: `HTTP-CHAIN.run04-race.json` SHA256 `B8570FE14FCF774BAAB7688AF5E4887E5307102BD468AEB4E6DBFCC4078F1251`. These are byte-identical copies of QA01's captured fixtures. QA01's clean capture raw, script, and DB evidence remain in its respective directories.
- Normal test `ac05-real-http.test.mjs` SHA256 `C97A1BF679F63C31AAAD2E67D804405B97D6AEEB9EDB6FA4B9E56F2D27BA563E`; race test `ac05-consumed-race.test.mjs` SHA256 `524D294BF6C2685D12BB4F799DB764BE5C69BBEAA54D77102D85BFB8B8902310`. The former is backed up as `ac05-real-http.test.before.mjs`; the old negative client test is backed up as `ac05-client.test.before.mjs`.

## Results

| Gate | Result | Raw |
| --- | --- | --- |
| Captured queue 201, pending operation, approval 200, consumed GET, V2 proposal/UNKNOWN cost, acceptance 201, exact draft reopen/ETag, cross-project receipt rejection | 1 file, 6/6 PASS, exit 0 | `positive.stdout.txt`, `positive.stderr.txt`, `positive.exit.txt`; stdout SHA256 `95E754DE0F512764447E2CFB2867F2081DEBD52963F91DB75AE8889B7A1010D9` |
| Actual approval POST 200/CONSUMED race, then readback and operation reconciliation | 1 file, 1/1 PASS, exit 0 | `race.stdout.txt`, `race.stderr.txt`, `race.exit.txt`; stdout SHA256 `D32A1F8F719CACB38360BF48C54819A7562DA8C936B1ABE78BC21980D8E990A9` |
| Postflight fingerprint | HEAD/status/source 90/dist 78 unchanged | `posttest.json` SHA256 `8B73971C551A2655E61229579B2EF5988E3B20BFE3F8556A42AF127AA30FDD1A`; `posttest-compare.json` SHA256 `7DE049F3D0FF4D441C0F2DEBBDABA6D353582C11742C9BD4CF918C3A66C02453` |

In the actual race fixture, the server's approval POST is HTTP 200 with `data.status=CONSUMED`. The current client classifies that POST result as `REMOTE_UNKNOWN`, then an explicit GET returns `FOUND/CONSUMED`; the following operation GET returns `PROPOSAL_READY` with cost still `UNKNOWN`. The test observed GET, POST, GET, GET: exactly one approval POST and no second dispatch by the client. It does not test the rendered wording or a fresh Electron session.

QA03 released c19 immediately after the targeted tests. No product source, dist, backend database, provider account, or native UI was changed or invoked by QA03. These results do not establish real paid provider behavior, UI acceptance, installation, or full product acceptance.

## Separate source-preview finding

During the QA01 window, read-only comparison found c19 `apps/studio-web/src/aivora/v2-story.css` SHA256 `79C6568149AC82D84C1D2FBD4702E60E400AEF32DD38ADFDD477DF86E54448B4` and its existing dist CSS still use the flex layout. The author candidate has a newer grid layout SHA256 `FCCB6ACC0476641B0BFBE0D47028D008CF2C0FBCA35956F2B053C5D49EA16523`. This fix needs MGR04's protected one-file sync, same-source Web build, then QA02's 1424×881 visual and Tab focus check. Old screenshots and dist are pre-fix evidence only.

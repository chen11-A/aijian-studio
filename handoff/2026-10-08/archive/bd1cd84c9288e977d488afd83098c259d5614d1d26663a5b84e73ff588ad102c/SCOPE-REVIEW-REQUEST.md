# MGR01 exact scope review request: schema33 direct SQL storage

State: `READY_FOR_MGR01_SCOPE_REVIEW_NO_GRANT_NO_RUN`. No `GRANT.json`, attempt marker, run directory or launch directory exists. This is a new QA call; the 31→33 migration grant was consumed and must not be reused.

## Frozen identity

- Scope: `ORIGIN_MODE_33_DIRECT_SQL_STORAGE_ONLY`
- Call ID: `QA01-ORIGIN33-SQL-STORAGE-20261008-01`
- Packet: `PACKET.json` SHA256 `8C7D6932001D5B53017F8C01F178088F399BEEB1841FA427D61558A65D6E8F12`
- Runner: `sql_storage_once.py` SHA256 `6E0121BA1D3DC02BE8D0F50C57EDC2326304705BEC58782A449BFC81E39C8A3E`
- Launcher: `launch_sql_storage_once.ps1` SHA256 `CDAD9B24244772FE9A6D943C569C980D48B70AB090B1A9944444C79C05CC3D23`
- Static review: `STATIC-REVIEW.json` SHA256 `B34A0C6A3BEAB904565E46EBA6148FACE0761C8CFDDFF48ACD513A0957EA5329`, Python AST and PowerShell parser passed; no gate cases executed.
- Seed: `seed-v33/workspace.sqlite3` SHA256 `EDD7F4D30BA06C585F86A35D30A6B01221B2FFCE613F13957DE33DE9D0CF3A9F`, byte-identical to the closed migration success DB; schema33, integrity `ok`, FK violations 0, six provider rows, four rotation rows and one source scope row.
- The packet pins the previous migration packet, one-shot grant, receipt, independent review and boundary note by SHA. MGR02 separately accepted that isolated migration result; its acceptance was communicated in the manager thread and is not represented as a new file here.

`PACKET-draft-01.json` is superseded and is not a signing target. The fixed Python interpreter and PowerShell binary are pinned by path and SHA in the current packet.

## Exact permitted execution

After MGR01 reviews this exact packet, MGR02 may independently sign one new `GRANT.json` with `state=APPROVED_ONCE`, matching scope/call ID, packet SHA, runner SHA and launcher SHA. QA01 may invoke the fixed launcher once. It creates the attempt marker with `CreateNew` before preflight; any failure after that marker is `RED_NO_RETRY`. No second call, edit, repair, or reuse of this grant is permitted.

The runner copies the frozen synthetic DB into 41 separate case directories. Six positives cover `PUBLIC_HTTPS` and canonical `LOCAL_LOOPBACK_HTTP` at `http://127.0.0.1:1` and `http://[::1]:65535` through UPDATE and INSERT. Thirty-five negatives cover mode/URL mismatches, NULL/unknown Sub2API mode, non-Sub2API mode, loopback aliases and malformed local authorities, missing or invalid ports, userinfo, path/query/fragment, whitespace/NUL/backslash, plus display-name uniqueness, provider foreign-key protection, immutable source scope and rotation history deletion. Every negative must raise SQLite `IntegrityError` and match the seed's complete logical SQLite dump after rollback. Every positive must read back the exact URL/mode and preserve the other provider fields. All cases require schema33, unchanged schema, integrity `ok`, no FK violations and unchanged rotation/scope rows. The runner writes a receipt only after every case passes. The launcher records child exit, timeout, both output streams and a terminal RED marker on failure.

## Boundary and stop conditions

This gate tests direct SQLite storage constraints in a synthetic isolated DB. It performs no product import, repository CAS, old LOCAL edit omission policy, approval-hash consumption, HTTP/DNS/TLS/redirect, provider, Vault, key, IPC, Electron, c19 or product write. It makes no port 8080 request. Public HTTPS validation beyond this schema's direct SQL constraint is outside this gate. Same-version repository/API approval behavior waits for DEV05/DEV07/DEV04 composition and a separate scope review.

MGR01 should reject any changed packet/runner/launcher/seed hash or expanded scope. MGR02 should grant only the exact reviewed identities, and postrun acceptance must inspect the closed DBs and raw launch evidence independently.

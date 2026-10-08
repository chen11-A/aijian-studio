# MGR01 exact scope review: schema33 repository and LOCAL edit policy

State: `READY_FOR_MGR01_SCOPE_REVIEW_NO_GRANT_NO_RUN`. This is a new QA call, separate from the consumed migration and direct-SQL grants. No `GRANT.json`, `ATTEMPT-USED.json`, `run-01`, `launch-01` or `profile-01` exists.

## Fixed identity

- Scope `ORIGIN_MODE_33_REPOSITORY_LOCAL_POLICY_ONLY`; call ID `QA01-ORIGIN33-REPO-POLICY-20261008-01`.
- `PACKET.json` SHA256 `2C28B7AF242D2D9F1BF98A3C913FA210A245714B0BE9366474865E54A3080414`.
- `repository_policy_once.py` SHA256 `EDF107D956A0BD355E33032231B46EA7D721CE16058ECEBB3CE7E3180B680C59`.
- `launch_repository_policy_once.ps1` SHA256 `10BAFE7AE8C43B3AE8CD81DF327C8925A75BC99D2BD802EDEB96D1024502C040`.
- `STATIC-REVIEW.json` SHA256 `FCB11E79FE04523445A9693AA88D8288FAAFFD4902CF05592E01522B07B7330C`. Python AST and PowerShell parser pass; product modules and gate cases were not executed.
- MGR04 v4 static composition SHA256 `D9985C46A2942DD606D2583141787010EEF7435E697922AD97C6ABB93ECB90E1`, `INPUTS-REVIEW.json` SHA256 `6D744F002442122FCBC107D8BCBF1F0E346B7AE64C8EB606BE7AE1039B61E622` (26/26 selected author files by the fixed reader).
- QA-only backend `PHYSICAL-MANIFEST.json` SHA256 `B330183106A3F2659F9AFCC17F204A8368132EB3FDE21D5FFE07D19460CA63B7`: 156 physical Python files, including 16 v4 backend inputs. `STATIC-PHYSICAL-REVIEW.json` SHA256 `C8E97A89166266F4F48C9371D63B7FB1A49512B2D89A76524D089211FF31FEDD`: 156/156 source and copy hashes, 157/157 dependency hashes, AST and relevant import closure without generated contracts. The only new file compared with the prior 155-file base is `aijian_api/sub2api_connection_readiness.py`; `PREP-COPY-TRIAGE.md` records the static preparation stop and correction.
- Schema33 seed `seed-v33/workspace.sqlite3` SHA256 `EDD7F4D30BA06C585F86A35D30A6B01221B2FFCE613F13957DE33DE9D0CF3A9F`, byte-identical to the independently accepted migration/SQL seed. Prior direct-SQL evidence freeze SHA256 `ECDD1490DA74104EB5EF89D96FBDC2AF03B8BE4E2C5A71CBB95AF4FFD553E544`.
- The packet pins fixed Python `-I -B -S`, PowerShell, package, dependencies, seed, input reviews, ten case IDs, runner and launcher by path and SHA. It has no generated-contract import; CTL confirmed G generation is not a prerequisite for this bounded backend gate.

`PREP-INPUTS.json` is an earlier static-preparation record; its old plan hash is superseded. It is not an execution packet or signing target.

## One-shot operation for review

After MGR01 reviews **this exact byte identity and scope**, MGR02 may independently sign one new `GRANT.json` with matching packet, runner, launcher, scope and call ID. QA01 will invoke the fixed launcher once. It creates `ATTEMPT-USED.json` with `CreateNew` before preflight and records raw stdout/stderr, child PID, exit, timeout and a terminal RED on failure. A consumed or uncertain attempt is never retried.

The runner verifies source/dependency hashes and copies the synthetic seed into ten independent case DBs. Nine cases start by making one explicit repository CAS from the seed's PUBLIC connection to canonical LOCAL; the PUBLIC omission case starts from the seed. The ten cases cover:

1. LOCAL edit with omitted mode and a local URL: request-model rejection and direct service-policy rejection, both zero CAS and unchanged DB.
2. LOCAL edit with omitted mode and a valid public HTTPS URL: the request model defaults to PUBLIC, but the existing LOCAL service rejects before CAS; unchanged DB.
3. Explicit LOCAL metadata edit: one CAS, revision increment, exact mode/URL/name and credential-reference readback, including a new repository instance.
4. Explicit LOCAL→PUBLIC with matching revision: one CAS and durable PUBLIC readback. The old LOCAL origin/mode/revision approval matches its original facts and fails `APPROVAL_SCOPE_MISMATCH` against the new connection facts. No approval is created or consumed.
5. Stale service revision, stale explicit LOCAL→PUBLIC revision and stale direct repository CAS: expected conflict and unchanged DB; the direct repository case records one attempted CAS with zero commit.
6. Explicit invalid PUBLIC origin: request validation rejects before CAS.
7. Existing PUBLIC edit with omitted mode: one compatible CAS and durable PUBLIC readback.

Each case checks complete logical DB state on rejection, protected rotation/scope/approval/consumption/attempt rows, schema33, `integrity_check`, foreign keys, no WAL/SHM and exact provider readback. The receipt is written only after all three positive and seven rejection cases pass. A fake Vault supplies only `get=None`; `set`/`delete` are forbidden and counted. Socket connections are blocked. No external provider or credential is used.

## Acceptance boundary

This gate tests the frozen backend repository, service, request model and pure approval binding in isolated copied SQLite DBs. It does not invoke the FastAPI route or test atomic approval consumption, real local API, generated contracts, desktop/Web consumers, provider, Vault, network, IPC, Electron, c19 or product acceptance. MGR01 assigned actual old-approval atomic-consumption rejection to QA03's separate same-version P/API gate with authoritative DB before/after and same-profile reopen. Pure policy mismatch here must not be reported as consumption proof.

MGR01 should reject changed hashes or expanded claims. MGR02 should independently grant only this exact packet once, then independently inspect closed DBs and raw launch evidence before postrun acceptance.

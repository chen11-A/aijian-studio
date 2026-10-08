# Sub2API literal-loopback mode: desktop/runtime static audit

State: `READ_ONLY_DESIGN_NO_LOCAL_SUPPORT_NO_PROVIDER_CALL`. Audited against
the author source on 2026-09-29. This report is separate from the B31 c19 R1
integration map and from DEV04's W1 edit.

## Current path and blocker

The UI create form `apps/studio-web/src/domain/use-provider-connection-form.ts`
SHA `334F02F179E766CD4E179B99163362397E875503D5E4B5C09982B937056B12CC`
requires an HTTPS origin; its preset text in `provider-settings-model.ts` SHA
`D3E5170B14D69CCF8E2DA1B65DCA0303D930C173917B70ECA7897E10B1F8921E`
promises public HTTPS. `studio.ts` SHA
`0D8F6CF403A15A1CA73ADBBDD4BB671E61F27AF64DB73BB84C45F7B1F3F007A6`
passes the existing provider create/edit commands through the desktop bridge,
with no origin mode field. The desktop create validator
`provider-connection-contract.ts` SHA
`B69804B482B58F35785525EC3348BB9569D181D8BA80B689C95DD92497582952`
and edit validator `sub2api-connection-mutation-contract.ts` SHA
`85F0D1FC41ED3CF5BF839335F63FFA2D0A27B86EAC79ED5B0D095B878CF3A844`
also require HTTPS. `main.ts`/`preload.ts` only relay the typed commands; they
do not choose provider network transport.

Backend `provider_contracts.py` SHA
`8C69AAFA39B13253FA46CC43622AD2EAD2A7CFF6596CAFC76A23EFD8CB1BB284`
requires public HTTPS for both create and edit. `provider_connection_repository.py`
SHA `96DAE6694953485C2A5FDD997E19D811B00A713E00EFD5559BF7B1FD1123F053`
rechecks it before persistence. The current v31 SQLite table in
`provider_credential_ref_schema.py` SHA
`B170FFC0C157D3C46109A7511BF10D9217B178EF05CFA77FD749C4C19C20932C`
has a SUB2API-only `https://%` CHECK. The repository's schema version is 31.
Readiness, queue creation, approval match, frozen scope, and final dispatch
each call the public-only validator. `sub2api_text_transport.py` SHA
`22722588A013B5A0B1C11A2D8D83792A68D264E0453CFF7B73A20750550BF385`
resolves only public DNS/IP and creates a pinned HTTPS connection. Its fixed
path is `/v1/chat/completions`, one POST, no proxy/fallback/retry, and 3xx is
rejected; that redirect rule must remain.

`http://127.0.0.1:8317` is the *CPA_LOOPBACK* constant, not a selected
Sub2API local port. No Sub2API port is committed in the inspected UI preset.
At 2026-09-29 09:15 UTC, a read-only listener/process/service-name snapshot
found no listener on 8317 and no process/service named `sub2api`. That does
not establish whether a differently named local gateway is installed or
whether another port is intended. No service was started or probed.

## Proposed explicit contract and ownership

Use a persisted SUB2API `origin_mode` with exactly `PUBLIC_HTTPS` and
`LOCAL_LOOPBACK_HTTP`. New SUB2API create/edit commands must carry the mode;
existing stored SUB2API rows migrate to `PUBLIC_HTTPS`. Other provider kinds
must not gain this local exception. Return the mode in list/create/edit
receipts so the UI can read back what was actually saved. The mode should be
bound with origin in the immutable approval scope; a mode change increments
connection revision and invalidates an older approval. Preserve old public
history via a versioned scope/hash rule or fail old pending scopes closed,
with explicit migration QA.

`PUBLIC_HTTPS`: keep the existing global-IP/DNS, TLS, no-path, no-redirect,
no-proxy and one-call rules and all old private/reserved/localhost negatives.

`LOCAL_LOOPBACK_HTTP`: accept only canonical
`http://127.0.0.1:<decimal-port>` or `http://[::1]:<decimal-port>` as the
saved origin, with port 1..65535 explicitly present. Reject `localhost`,
`127.1`, other 127/8 addresses, IPv4 mapped IPv6, zone identifiers, DNS names,
wildcard/private/public IPs, userinfo, encoded host, path, query, fragment,
backslash, whitespace, and ambiguous numeric/port forms. Parse the authority
with an exact allowlist before a URL library can normalize aliases. Build the
fixed API path in the transport. Connect directly to the vetted literal
address and specified port without DNS, proxy, redirect, alternate address,
or retry; preserve bounded connect/read/total deadlines, bounded response,
and UNKNOWN after uncertain dispatch. A local HTTPS extension would need its
own explicit TLS contract and is outside this minimal candidate.

Owner split for a later write window:

| Owner | Minimum affected area |
| --- | --- |
| DEV07 desktop | `provider-connection-contract.ts` create/response mode validation and `sub2api-connection-mutation-contract.ts` edit/receipt mode validation. `api-client.ts` forwards the new command shape and retains one-call/UNKNOWN handling; `preload.ts` remains type-only; `main.ts` and R1 sidecar startup/resource files need no local-origin exception. Current desktop SHA are in `MANIFEST.json` and `C19-R1-STATIC-INTEGRATION.md`. |
| DEV03/DEV04 UI | Explicit mode selector, mode-specific help and exact local input preflight in create/edit forms; `studio.ts` types and the pending metadata journal must retain the mode through unknown/readback. Keep DEV04 W1 patch separate. |
| DEV05/DEV01 backend | Pydantic create/edit/response mode contract, a new versioned SQLite migration/backfill and repository/service/route propagation, mode-aware readiness/queue/policy/frozen-scope/approval checks, and a literal-address HTTP branch in the one-shot transport. Re-export OpenAPI/generated TypeScript contract. Preserve public validator unchanged for `PUBLIC_HTTPS`. |

The backend validator currently has nine call sites across create/edit,
repository, readiness, queue, frozen scope, approval, and transport; changing
only the UI or one desktop guard would still reject local mode. The v31 SQL
CHECK would also reject it independently.

## Independent acceptance gate (future; not run)

1. Contract/DB tests: explicit mode required for new SUB2API mutations;
   existing records backfilled public; create/list/edit/restart readback
   retains exact mode/origin and revision; other provider kinds unchanged.
2. Local parsing table: `127.0.0.1` and `[::1]` with explicit valid port pass;
   missing/zero/out-of-range ports and all aliases, DNS, nonloopback, private,
   reserved, path, userinfo, query, fragment and encoded forms fail at UI,
   desktop, backend, and DB/dispatch boundaries as applicable.
3. Local mock only: one fixed-path POST to a dedicated loopback fixture,
   exact literal address/port, no DNS/proxy/redirect/fallback/retry, bounded
   response, and correct NOT_DISPATCHED versus REMOTE_UNKNOWN semantics.
   3xx must not make a second request. No real provider credential/call.
4. Public regression: existing HTTPS positive and private/reserved/localhost
   negatives, TLS hostname verification and public DNS pinning remain.
5. Approval and journal: origin+mode+revision scope cannot be silently
   reinterpreted; explicit one-call approval and durable operation identity
   remain; unknown create/edit/rotation prompts readback, not resubmission.
6. New emitted desktop and renderer plus migrated sidecar in an isolated
   profile; rerun c19 R1 packaged resource/TEMP/Busy/owner checks against
   exact hashes. Existing R2 EXE, old renderer, and IPC mocks are not local
   mode acceptance.

# DEV07 Sub2API local mode desktop candidate

State: `AUTHOR_SOURCE_ONLY_NO_BUILD_NO_TEST_NO_PROVIDER_NO_C19_SYNC`.
`MANIFEST.json` pins all pre-edit backups, current sources, per-file patches,
and unchanged R1 files. This candidate depends on the DEV05/DEV01 backend
mode contract and its independently qualified migration; it does not make the
current sidecar accept local mode. The c19 R1 hunk map remains in
`work/dev07-b31-desktop-bridge-20260929/C19-R1-STATIC-INTEGRATION.md`.
That map pins the pre-local B31 author hashes. The three patches here layer
onto those B31 author files; they are not direct patches for the older c19
files. Rebase reviewed hunks under the c19 write owner after rechecking hashes.

DEV05 confirmed the request compatibility rule: omitted SUB2API mode defaults
to `PUBLIC_HTTPS`, while explicit `null` is rejected for both create and edit.
The newer DEV05 backend candidate is pinned by its separate `MANIFEST.json`
SHA-256 `56E09F7BE264316474FEA6F78EF7560D53266AE394C0DA314803BA34E40FDF24`
and patch SHA-256
`342A4106E2F0F3BEAE503F0513C4AFCA39586FAA5A2195D5A109175139DC63A8`.
Its new service guard rejects an omitted edit mode for an existing LOCAL
connection before CAS, including when the request changes to a public HTTPS
origin. Existing PUBLIC omitted edits retain the public default. DEV05
reports AST and reverse-patch checks only; no integration or runtime QA.

MGR04 independently reviewed the offline OpenAPI v3 generation (receipt
SHA-256 `68C3B6236F441D4A67DCF004BEA35462D7BCA361001AF5FF23879DBA0520841A`).
Its staged `openapi.json` SHA-256 is
`5DB5480A7CDFC5AADECECD9D9F6835148B289ED32427289250AAAEE3623C8AFE`;
staged `generated.ts` SHA-256 is
`DE2B2F58314658A21576AE7E850CB93016A8A419F021E8E294F026FD95EAE8A0`.
These are isolated generation outputs, not the author-tree contract files.
Generated Create allows optional/nullable `origin_mode`, while the backend
rejects explicit SUB2API null; the desktop create validator rejects it too.
Generated Edit marks mode required despite OpenAPI's public default and the
backend's omitted-public compatibility; the desktop edit type is optional.
Generated ProviderConnectionData allows optional/null for every kind, while
the backend route supplies a mode for SUB2API and null otherwise, which the
desktop response validator enforces. Same-version QA must cover these cases
at runtime rather than treating generated type acceptance as acceptance.

The desktop create and metadata-edit validators accept omitted `origin_mode`
as legacy `PUBLIC_HTTPS`. An explicit `LOCAL_LOOPBACK_HTTP` accepts only
`http://127.0.0.1:<port>` or `http://[::1]:<port>`, with a canonical decimal
port from 1 through 65535. No hostname, alias, userinfo, path, query,
fragment, whitespace, percent encoding, or implicit port passes the exact
local check. Other provider inputs may omit mode or set it to null, never to a
Sub2API mode. Every provider response must carry mode: SUB2API uses one of
the two values; other kinds use null. A metadata success receipt must echo the
requested effective mode and next revision. Create success is accepted only
when the SUB2API receipt echoes the effective mode, normalized origin, and
revision 1. Existing UNKNOWN/readback behavior remains in the API client.

The DEV07 desktop consumer revision reads the authoritative connection list
before metadata PATCH, checks the connection ID/current mode/CAS revision,
and rejects an omitted mode for an existing LOCAL connection without PATCH.
For an existing PUBLIC connection, omitted mode is sent explicitly as PUBLIC;
an explicit mode remains explicit. It reads the list again after a valid 200
receipt and returns UPDATED only when persisted mode, revision, origin and
metadata match. Each of these two GETs has its own 15-second deadline and
AbortController; the Promise race bounds the result even if an injected
fetcher ignores cancellation. A pre-read timeout returns REMOTE_UNKNOWN with
zero PATCH; a post-write readback timeout returns REMOTE_UNKNOWN after exactly
one PATCH. Neither path retries. This is author source behavior, not runtime
verification or a complete Web consumer flow. The current generated author
types do not yet include mode, so runtime narrowing is used without a cast;
new generated TS still requires a separate same-version integration gate.

The public HTTPS create preflight and metadata edit syntax preflight remain
separate. The sidecar remains authoritative for global IP/DNS policy and must
preserve the old public negative cases. Desktop literal validation cannot
prove that a Windows loopback port has not been forwarded elsewhere. Port
8080 currently has a Windows portproxy to `192.168.254.115:80`; it cannot be
used as local Sub2API QA evidence. The actual local Sub2API port and service
identity remain unverified.

## Consumer mode persistence gate (OPEN)

Pin each request and readback to connection ID, `expected_revision`,
`origin_mode`, and canonical `base_url`; record the isolated profile and
backend revision used. The DEV07 consumer v3 source identity is
`apps/desktop/src/api-client.ts` SHA-256
`B59AA696E059E64B3167DCBA52993010D21F67F9849ADA74C105282AC189396E`;
the two-case unrun pure-mock test source SHA-256 is
`B18187304B871B876DCCDF70BA8B1D02CEA196F4A3DDDC15105B5248EC5F80C1`.
Use the DEV05 revised candidate and MGR04 staged contract identities above;
repeat these assertions against the same integrated build. Offline generation
and author source checks do not close this gate.

1. Start with a persisted SUB2API connection in `LOCAL_LOOPBACK_HTTP`, at
   revision `r`, with a canonical local origin. Before a metadata-only edit,
   obtain authoritative mode and revision from the backend connection list
   by ID, not from a form default or cached local state. The desktop/client
   request must explicitly carry `origin_mode=LOCAL_LOOPBACK_HTTP`, the same
   `base_url`, and `expected_revision=r`. On success, read back mode
   `LOCAL_LOOPBACK_HTTP`, the unchanged origin and credential reference, and
   revision `r+1`. Close and reopen the isolated client/profile, then read
   from the backend again: mode remains LOCAL at `r+1`. A client that omits
   mode and silently changes this connection to PUBLIC fails this gate.
   The current client validator defaults omitted edit mode to PUBLIC and
   cannot infer a persisted mode from ID alone; the consumer must supply the
   authoritative readback value. The desktop API client now performs a
   pre-read and post-write readback, but the Web consumer flow has not been
   implemented or run end to end in this author candidate.
2. Test an explicit LOCAL-to-PUBLIC or PUBLIC-to-LOCAL switch separately,
   using an origin valid for the requested mode and the current CAS revision.
   Assert receipt and subsequent authoritative readback match the requested
   mode/origin at revision `r+1`; a stale revision must fail without mutation.
   Assert the earlier approval scope no longer authorizes a provider call.
   Record the old and new approval identities and do not auto-dispatch.
3. Exercise an old client that omits `origin_mode` on edit as a separate
   compatibility case, with two distinct full-metadata requests against an
   existing LOCAL connection. A local HTTP URL is rejected by the omitted
   PUBLIC origin check; a valid public HTTPS URL reaches the new service
   guard and is also rejected before CAS. Assert zero mutation and unchanged
   approval identity for both. An existing PUBLIC connection with omitted
   mode retains the public default. Test explicit PUBLIC plus valid public
   URL and matching revision as the separate LOCAL-to-PUBLIC switch. These
   are source-path expectations, not runtime results; read back mode, URL,
   revision, credential reference, and approval consumption in the new QA gate.
4. On create, SUB2API omitted mode must persist/return `PUBLIC_HTTPS` and
   explicit null must be rejected without a connection. For other providers,
   omitted and explicit null input must follow the validator and read back
   mode null. Every SUB2API response must have a non-null valid mode; every
   other provider response must have null. Reject a mismatched or missing
   response mode as an uncertain receipt, not successful persistence.
5. Using a mock fetcher that never resolves, verify the pre-read reaches its
   15-second deadline, cancels, returns REMOTE_UNKNOWN, and sends zero PATCH.
   Then return a valid pre-read and one valid PATCH receipt but hang the
   post-read: verify its 15-second deadline, cancellation, one PATCH total,
   REMOTE_UNKNOWN, and no automatic retry. The saved test source covers these
   two cases but DEV07 has not executed it; independent QA must record raw
   command, result, source hashes, and any failure.

The current Web author UI blocks local save, and the author-tree generated
contracts do not yet carry `origin_mode`; these are integration gaps. Do not
hand-edit generated output or use a cast to conceal the type mismatch.

## Required independent QA (not run by DEV07)

1. With fixed generated contracts and backend mode revision, verify create
   and edit accept explicit public mode and old omitted-public requests;
   response mode is `PUBLIC_HTTPS`. Keep all existing public HTTPS positives
   and private/reserved/localhost negatives.
2. Verify explicit local mode accepts both canonical loopback IP literals
   with a configured, non-forwarded port. Reject `localhost`, `127.1`,
   `127.0.0.2`, mapped IPv6, numeric aliases, missing/zero/65536/leading-zero
   ports, DNS names, nonloopback/private/reserved IP, userinfo, path, query,
   fragment, encoded host, whitespace, and redirect targets.
3. Verify omitted mode cannot authorize a local URL; a metadata mode change
   increments revision, preserves credential reference, invalidates old
   approval scope, and a mismatched response mode/revision remains unknown.
4. Verify list/create/edit/rotation receipts carry the persisted mode;
   non-SUB2API response mode is null. No plaintext key in receipt, logs,
   database metadata, or browser journal.
5. Use an isolated loopback mock for one fixed-path POST and no DNS, proxy,
   redirect, fallback, or automatic retry. Preserve post-dispatch UNKNOWN and
   durable operation identity. Do not call a real provider in this gate.
6. Re-emit desktop and renderer from exact source hashes, then qualify the
   actual packaged c19 candidate with its R1 resource/TEMP/Busy/owner guards.
   The old R2 EXE, 9/28 renderer, and IPC mocks are not local-mode acceptance.

Static checks completed: original three source/backup/patch SHA readbacks,
the consumer v2 and v3 source/backup/patch SHA readbacks and reverse-patch
checks, `git diff --check`, and unchanged main/preload/R1 source SHA readback.
No TypeScript compile, test execution, build,
Electron, service, credential, or provider operation was performed.

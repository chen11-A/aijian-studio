# QA02 Stage-A four-media registration: single approved invocation RED

Status: `STAGE_A_FAILED_PRESERVED`. One MGR02-approved invocation occurred; no
retry, rights decision, probe, resolver, MLT runtime, provider, or product DB
operation followed.

## Exact invocation and preserved evidence

- MGR02 external approval:
  `C:\Users\Administrator\Documents\AIVORA\management\manager-handoffs\approvals\20260928-qa02-stage-a-one-shot.json`,
  SHA-256 `188EF666033FF42FF0D54D2718E58C1560B9D6977E3DF004F0A08461CB1F3827`.
- Approved outer wrapper SHA-256
  `6B025A736B9BC791C758B0CCB2D72EAA1A99B2495DD46B387E032D0C3926B40E`;
  inner script SHA-256
  `200AA89B0E3645FDAEC5C52FE3E8110C4E67BA65E9472371B27ABCE43B2EF153`;
  envelope SHA-256
  `84188BF2F420C9BEA7A9C96DFE91417963D80009F997A34C33B5146EFED6DCB7`.
- Raw outer directory: `qa02-stage-a-registration-20260928/invocation-01`.
  `receipt.json` SHA-256
  `626D7C2B450058A8AB821E57674F7D3626AC96347CC5ED9DDE97CBC7CE46D3EA`.
  Child PID `18248`, exit `1`, timeout `false`; `stdout.bin` 0 bytes,
  `stderr.bin` 1751 bytes, SHA-256
  `67C8A4213B3FFFF38836D01E6A1378154B22024C4565BB4297B572D8DF1AFD7E`.
  The outer wrapper process exit `0` reports that capture completed; it is not
  a Stage-A pass. Child PID was absent on post-run inspection.
- Inner profile: `qa02-stage-a-registration-20260928/profile-01`.
  `receipt.json` SHA-256
  `3BD9E7D03DB57CA46D09AF64CAE1933BCDF3A0DE09F7826A21796229469184BF`.
  Status `STAGE_A_FAILED_PRESERVED`; `assets=[]`.

## Raw failure and state

The first `v1-blue.webm` call entered the frozen `MediaAssetStore.import_local`.
At `media_asset_store.py:234`, `os.link(staged_path, blob)` raised
`FileNotFoundError: [WinError 3] 系统找不到指定的路径。` The raw stderr and inner
traceback preserve the exact paths and stack. The store's `finally` removed
the staging temporary file. The final `media-assets/staging` and `blobs/75`
directories are empty; that final state does not prove which path was missing
at the `os.link` instant. The cause remains `UNKNOWN`.

The copied QA02 database `workspace/workspace.sqlite3` is 1,015,808 bytes,
SHA-256 `034EEE485780DFD760EAAA44AAD3E680DB8C624150CB311B26C4475FE38CE616`.
An immutable read-only SQLite query found schema version 30 and zero rows in
`media_assets`, `media_asset_versions`, `media_asset_rights_decisions`, and
`media_asset_probe_evidence`. Thus the copied schema migration completed, but
no media registration succeeded. The original QA01 seed remains SHA-256
`54533ABEEAC1E45DB3D643303967EFDCF9379024405853DF1B240838B80F90CC`
with zero-byte WAL at post-run readback.

For the 39 copied `profile-01/source/aijian_api/*.py` files, the fixed s2
Python interpreter's `Path.read_bytes()` sees 39/39 hashes matching the v2
freeze manifest. PowerShell `Get-FileHash` sees 38 different byte streams with
an `E-SafeNet`/`LOCK` binary header (only empty `__init__.py` matches). For
example, Python reads the copied `repository.py` as expected `C2104917...`,
while PowerShell reads `B8ECDA93...`; both report 155,315 bytes. This is an
observed process/API-dependent read difference. It does not establish when
bytes changed or whether it caused `os.link` to fail.

## Boundary

Do not reuse `profile-01` or `invocation-01`, modify their raw evidence, or
rerun this approval. Four real `asset_*`/`asv_*` identities, persisted media
readback, selected bindings, `NO_DECISION` reader result, managed-blob hash/
mtime rejection, human `CLEARED`, video probe, and MLT execution remain
untested. A new investigation and any new invocation require separate scope,
fresh paths, and explicit review of the exact failure.

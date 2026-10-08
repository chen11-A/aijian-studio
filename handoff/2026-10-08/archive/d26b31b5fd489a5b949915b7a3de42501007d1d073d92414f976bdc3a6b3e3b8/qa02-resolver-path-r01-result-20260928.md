# QA02 final resolver path r01: one-call result

Status: `PATH_GATE_LOCAL_PASS_REVIEW_REQUIRED`. Exactly one MGR02-approved
wrapper call was made; no retry. This checks the frozen final resolver's
closed-DB and external-fixture path helpers plus the shared managed-path
helper. It does not establish a public `prepare_test_selection` positive,
native MLT behavior, rendering, export, or product acceptance.

## Authority and raw receipts

- External one-shot approval:
  `C:\Users\Administrator\Documents\AIVORA\management\manager-handoffs\approvals\20260928-qa02-resolver-path-r01-one-shot.json`,
  SHA-256 `520517D0403343C3297B36D0CEA038E6A238CCC9989FBD7B92C4682083C0E27C`.
- Approved envelope SHA-256
  `EB3E8D86F47B92DB3679F209198140A61D9B86FB5F0C0A1977C3F8CD889BDFE9`;
  child script `0862D9637E1CA69457ABF5414C435545DF5B1DD9977501A0546382E946EC96C6`;
  wrapper `369C3CE1FB0F73797F68EC83A484593AD2AFFD15EF6388C52B0CF55EC1DCE71F`.
- Outer receipt:
  `C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\native-source-qa-20260924\qa02-resolver-path-r01-20260928\invocation-01\receipt.json`,
  SHA-256 `70BDACF252588DB6670C8D62A362735A765FB8E7AF3F2CA01E4300B74DBCD951`.
  Status `PROCESS_EXIT_ZERO_REVIEW_PROFILE_RECEIPT`, child PID `6224`, exit
  code `0`, `timed_out=false`. Both `stdout.bin` and `stderr.bin` are zero
  bytes, each SHA-256
  `E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855`.
- Inner receipt:
  `C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\native-source-qa-20260924\qa02-resolver-path-r01-20260928\profile-01\receipt.json`,
  SHA-256 `2401E07F5C984A545D311F602802BE4B681B07889FFE2DED3685860BAE72DD49`;
  status `RESOLVER_PATH_GATE_LOCAL_RESULT_REVIEW_REQUIRED`.

## Path-gate observations

| Case | Result |
| --- | --- |
| Closed DB, 251 UTF-16 units plus 8-unit `-journal` suffix = 259 | `_frozen_database` accepted a copied schema-30 DB. |
| Closed DB, 252 + 8 = 260 | `DATABASE_UNAVAILABLE`. |
| DB with one emoji, 251 Python code points but 252 UTF-16 units, plus suffix = 260 | `DATABASE_UNAVAILABLE`. |
| Exact five-input manifest copy at 259 UTF-16 units | `_file_bytes` returned 3,487 bytes matching SHA-256 `EE2166D379C1000D65138C12023209A9D535AEE17D707C04BB907B7823FB04E3`. |
| Fixture candidate at 260 units | `FIXTURE_PATH_UNSAFE` before open. |
| Fixture with one emoji, 259 code points but 260 units | `FIXTURE_PATH_UNSAFE` before open. |
| Four run04 logical managed blobs at 266 units | Shared managed helper returned extended I/O paths; all byte counts and SHA-256 values matched their frozen identities. `MltFileIdentity.path` stayed logical. |
| QA-owned 266-unit candidate through a symlink/reparse ancestor | Shared helper rejected it; the outside marker remained unchanged. |

Read-only post-run checks confirmed the three copied DB files are each
1,015,808 bytes with source SHA-256
`65EF2306FD83CFDAA454754A3B6A6E1919431F1C570826ABC37E93A6795A11FC`.
A read-only SQLite check of the positive copy found schema 30, integrity
`ok`, and zero foreign-key violations. The positive fixture copy matched
the frozen manifest. The two overlong fixture candidates do not exist. The copied 54-file source closure rehashed
54/54; source DB and input manifest hashes remained unchanged. No DB
WAL/journal/SHM sidecar remains. The QA-owned outside directory still has
only `marker.bin`, SHA-256
`72FBBEA2F51389E8CB614F34E99E723E98F35FBA4C016DC559E93BB79F401540`.

The run04 source database has zero rights decisions and zero video-probe
rows. The public resolver checks authoritative `CLEARED` rights before its
managed-path branch, so public `prepare_test_selection` and the resolver's
`ASSET_SELECTION_CONFLICT` branch were **not run**. No rights/probe records
were fabricated. No FFmpeg/ffprobe, MLT, provider, rendering, or export ran.
The ancestor `lstat` and later file I/O are separate operations; junction
replacement races remain unproved. The r01 one-shot approval is consumed.

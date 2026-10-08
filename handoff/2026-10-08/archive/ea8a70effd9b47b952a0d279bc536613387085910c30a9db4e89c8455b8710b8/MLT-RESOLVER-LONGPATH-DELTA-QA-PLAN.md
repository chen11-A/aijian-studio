# MLT TEST resolver long-path delta: separate QA gate

Date: 2026-09-28. Input is `C:\Users\Administrator\Documents\AIVORA\management\manager-handoffs\release-snapshots\20260928-mlt-test-resolver-managed-longpath-delta-1\SNAPSHOT.json` SHA-256 `C21DF803B5C69215E6C0AB2EBF21A70EED93847B23EE1983CA3B2CBD0F880E47`. Its final resolver is `1D80A540465A4AF2F6F768A49E1193E4ADEA6A351814DE4EEE486153FED3ED45`, helper `managed_local_paths.py` is `78FCCE4F28FF720F6610AB72EEC2C5C5AB179E7BEB758B980610303B7CA9D7AC`. `FA874D...` was an intermediate candidate and is excluded. This delta is outside the Stage-A47 frozen closure; no existing short-path result accepts it.

Prepare a separately sealed local source closure and disposable short database path. Do not import the mutable author tree or mix this delta into D/repo30 QA. Each case records before/after DB and fixture SHA-256, logical `MltFileIdentity.path`, actual managed I/O path, raw exception code, and source manifest hash. No MLT executable, renderer, provider, user database, or product checkout write is in scope.

| Case | Input | Expected local result |
| --- | --- | --- |
| Short DB, long managed blob | DB plus `-journal` is at most 259 Windows UTF-16 code units. A managed blob has a safe path longer than 259 units, with plain existing ancestors and fixed bytes. | Controlled managed I/O spelling opens/stats the blob; identity exposed to the resolver remains the original logical path. DB, blob, fixture bytes remain unchanged. This is a helper/resolver boundary result, not MLT native playback. |
| Overlong DB | DB path plus `-journal` exceeds 259 UTF-16 code units. | `_frozen_database` fails closed with `DATABASE_UNAVAILABLE` before SQLite URI/read; DB bytes unchanged. |
| Overlong external fixture | Manifest or subtitle fixture path exceeds 259 UTF-16 code units. | `_file_bytes` fails closed with `FIXTURE_PATH_UNSAFE`; no read, no writes. |
| Non-BMP boundary | Construct otherwise equal paths where an emoji makes the UTF-16 count cross 259 while Python character count stays at most 259. | DB and fixture guards reject by UTF-16 units, confirming the corrected boundary. |
| Unsafe managed path | Reparse/symlink, UNC, traversal, or outside managed root, including a long spelling. | `managed_local_io_path` rejects; resolver maps an unsafe selected blob to `ASSET_SELECTION_CONFLICT`; original identity and files unchanged. |

Before claiming a full selected TEST path, the frozen package also needs the actual four selected ASVs, latest CLEARED rights, probe/audio evidence, five-input manifest, script, and a normally closed sidecar DB. Those inputs are not established by this delta snapshot. Existing short-path checks remain historical and separate.

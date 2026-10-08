# Final resolver path-gate case matrix

Candidate source: MGR04's frozen 54-file import closure, `FILES.json` SHA-256
`FB7B477C6BC5EEAF6DCA4D1A970275062ED658C0EFF6F3998AE1D73D9A537B72`.
It pins resolver `1D80A540465A4AF2F6F768A49E1193E4ADEA6A351814DE4EEE486153FED3ED45`
and managed helper `78FCCE4F28FF720F6610AB72EEC2C5C5AB179E7BEB758B980610303B7CA9D7AC`.
The Stage-A run04 database and five-input manifest are read-only sources.
The one-shot child would copy only into a new QA profile after an external
MGR02 approval; no case has run yet.

| Case | Proposed input | Expected product path result | Evidence level |
| --- | --- | --- | --- |
| Closed DB positive | Exact copy of run04 schema-30 DB at 251 UTF-16 units; `-journal` makes 259 | Resolver `_frozen_database` context accepts and holds the closed DB | Internal resolver path gate, not full selection |
| DB over limit | Same DB copied at 252 units; `-journal` makes 260 | `DATABASE_UNAVAILABLE` before DB read | Internal resolver rejection |
| DB non-BMP limit | Same DB at 251 Python code points but 252 UTF-16 units with one emoji; `-journal` makes 260 | `DATABASE_UNAVAILABLE` | UTF-16 boundary rejection |
| Fixture positive | Exact five-input manifest copy at 259 UTF-16 units | Resolver `_file_bytes` returns bytes matching frozen SHA | Internal resolver path gate |
| Fixture over limit | Absent QA-owned candidate at 260 units under an existing plain parent | `FIXTURE_PATH_UNSAFE`, before open | Internal resolver rejection |
| Fixture non-BMP limit | Absent candidate at 259 code points but 260 UTF-16 units | `FIXTURE_PATH_UNSAFE`, before open | UTF-16 boundary rejection |
| Long managed positive | Four original run04 managed blobs at 266 units, no copy or mutation | Managed helper returns extended I/O paths with exact bytes and SHA; `MltFileIdentity.path` remains logical | Helper and identity level only |
| Unsafe long managed | QA-owned symlink/reparse ancestor with 266-unit candidate | Managed helper raises `ValueError`; outside marker unchanged | Helper level only; setup failure is `NOT_TESTED` |

The public `prepare_test_selection` full positive and its
`ASSET_SELECTION_CONFLICT` branch are **not run** in this packet. Run04 has
zero rights decisions and zero video-probe rows; `_verified_media` checks
authoritative `CLEARED` rights before entering its new managed-path branch.
This packet neither fabricates those records nor claims a selected binding.
No FFmpeg/ffprobe, MLT, provider, render, export, UI, or native tool runs.
The helper's ancestor `lstat` and later I/O are separate operations and do
not prove junction-swap race resistance.

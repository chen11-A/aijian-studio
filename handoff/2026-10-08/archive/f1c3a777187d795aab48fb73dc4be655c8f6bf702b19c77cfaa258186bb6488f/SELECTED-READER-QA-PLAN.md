# Selected media reader independent QA plan (2026-09-28)

Status: SCRIPT_STATIC_ONLY. Do not execute against c19 until MGR04 has synced the frozen single file and MGR02 has independently released the QA01 window.

Candidate contract: `media_asset_selected_reader.py` SHA256 `9A3268DA438BEB6E1085F4BECDC5DDF289AA9CB1BC906D875D2FBD4E84E96B68`; schema version 26. The original external script `test_selected_media_reader.py` remains SHA256 `9841077189BB14148D85585B5FE6620D13B6E071BE55781346073E8581540AB0`. The v2 script adds missing/fresh/read-only samples and records file mode in snapshots. No candidate source is edited by either script.

## Samples and expected result

| Sample | Expected status | Main observation |
| --- | --- | --- |
| Missing workspace; workspace exists but DB missing | `UNKNOWN_UNSAFE_PATH`; `UNKNOWN_DATABASE` | No directory or DB creation |
| Fresh schema26 DB, selected IDs absent | `NOT_FOUND` | No DB/sidecar/task write |
| Read-only DB and selected blob | `VERIFIED` | No mode, byte, size or mtime change |
| Missing media root, blobs root, or digest prefix | `MISSING` | Missing path remains absent |
| Valid selected version; historical sibling blob missing | `VERIFIED` | Only selected version is required |
| Selected blob absent; same-size changed bytes | `MISSING`; `CORRUPT` | Never verify unavailable or wrong bytes |
| Selected sparse blob above 256 MiB | `UNVERIFIED_SIZE_LIMIT` | Size gate precedes blob hashing |
| Active writer and nonempty WAL | `UNKNOWN_DATABASE_BUSY` | No SQLite checkpoint or write from reader |
| Cross-project/version/asset IDs; soft-deleted asset | `NOT_FOUND` | Scope and deletion enforced |
| Sparse DB above 256 MiB | `UNKNOWN_READ_BUDGET` | Database size gate |
| Injected DB or blob file-stat drift | `UNKNOWN_DATABASE_CHANGED`; `UNKNOWN_MEDIA_CHANGED` | No `VERIFIED` across detected race |
| Injected external `-shm` mtime drift | `UNKNOWN_DATABASE_CHANGED` | Only externally changed sidecar may differ |

For every ordinary read, capture a pre/post recursive tree with relative paths, type/mode, file size, mtime_ns and SHA256. Include the workspace DB, existing SQLite sidecars, media directories, all blobs, and a task-state sentinel. In the active-WAL case the writer's transaction stays open through both snapshots. The `-shm` drift test intentionally mutates that sidecar in a separate injected step, and compares every other path byte-for-byte and metadata-for-metadata.

Classification: a fixture/setup/import/assumption failure is QA harness RED; a returned status or workspace mutation that contradicts the frozen contract after a valid fixture is candidate RED. Preserve full terminal output, exit code, test script hash, candidate/snapshot hashes, and isolated temporary DBs before any correction. The local read-only file attribute is not an OS-enforced read-only directory ACL, so its pass alone cannot prove a denied-write directory works.

Static check: AST parse of v2 passed with `C:\Users\Administrator\Documents\sp\.venv\Scripts\python.exe`. The bare `python` WindowsApps shim returned exit 1 with no output; no candidate test was run.

# QA03 PROJECT01 c19 front and desktop

- Window: 2026-09-24, c19 `211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2`.
- Product source: `C:\Users\Administrator\.codex\worktrees\c19-trim-211c9e8-qa-20260923`.
- External QA harness: parent directory of this report. Product source was not edited in this window.
- Result: scoped front/desktop QA GREEN; release c19 to QA02 for native-window verification. This is not Electron/runtime or final user acceptance.

## Evidence and gates

| Gate | Raw files in this directory | Result |
| --- | --- | --- |
| Generated PATCH, adapter, desktop client | `contract.stdout.txt`, `contract.stderr.txt`, `contract.result.json` | 7/7, exit 0 |
| Real HomePages / EditorDialog | `home.stdout.txt`, `home.stderr.txt`, `home.exit.txt` | 4/4, exit 0 |
| Real `main.ts` IPC handler with fake Electron and sidecar | `ipc-final.stdout.txt`, `ipc-final.stderr.txt`, `ipc-final.exit.txt` | 3/3, exit 0 |
| All targeted tests together | `all-targeted.stdout.txt`, `all-targeted.stderr.txt`, `all-targeted.exit.txt` | 14/14, exit 0 |
| Web typecheck | `web-typecheck.stdout.txt`, `.stderr.txt`, `.exit.txt` | exit 0 |
| Desktop typecheck | `desktop-typecheck.stdout.txt`, `.stderr.txt`, `.exit.txt` | exit 0 |
| Web build | `web-build.stdout.txt`, `.stderr.txt`, `.exit.txt` | exit 0; Vite reported a chunk larger than 500 kB |
| Desktop build | `desktop-build.stdout.txt`, `.stderr.txt`, `.exit.txt` | exit 0 |

The HomePages scenarios cover rename save and reopen, archive and restore, unsupported favorite/delete with no fake mutation, 412 authoritative GET without success notice, and switching to project B while project A's write is pending. Adapter/client scenarios cover matching 200 receipt plus GET, 412, UNKNOWN with GET-only reconciliation and no repeat PATCH, corrupt/unavailable journal storage blocking PATCH, and desktop 200/412/UNKNOWN. IPC scenarios cover main-frame forwarding, child-frame and foreign sender rejection, and invalid arguments.

The first two IPC runs failed in the external harness: `ipc.stdout.txt`/`.stderr.txt`/`.exit.txt` document Electron mock resolution; `ipc-rerun.*` document an incorrect asynchronous throw assertion. The harness was corrected; no product code changed in response.

## Fingerprints

`after-contract.json` SHA256 `2BC58924232B76C6807B5B2D6745549CF7EB065996D96603CD5E9DD098A90EF8` is the 69-source/75-dist pre-test reference. Typecheck did not change source or any of the 75 dist hashes. `after-desktop-build.json` SHA256 `7D6E23F445337201C491B0EE0A6F0A29141904D67F0B4F0EF385C3FC699C012B` records 69 source files, unchanged source/status hashes, and 76 dist files. Against the original 75: added `apps/desktop/dist/project-update-contract.js` and `apps/studio-web/dist/assets/index-BBBjpMyv.js`; removed prior Web hash bundle `index-B8mbtJYp.js`; changed `apps/desktop/dist/api-client.js`, `main.js`, `preload.js`, and Web `index.html`. The new `main.js` includes the `projects:update` guard and `preload.js` exposes that channel.

No Electron, provider, or network process was started for this QA window. Native behavior remains QA02's next gate.

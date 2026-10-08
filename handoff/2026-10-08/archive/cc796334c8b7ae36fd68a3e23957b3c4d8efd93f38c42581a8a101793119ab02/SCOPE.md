# MGR04 v4 same-source Web and desktop build

This packet uses the physical post-G native derivative at `qa03-local-sub2api-native-source-v4-01`. The derivative already has an approved one-call copy and independent full-tree readback. This packet does not copy source again.

An MGR01 exact scope review and MGR02 approval binding `PACKAGE.json` are required before one execution of `build_once.py` with call ID `MGR04-V4-SAME-SOURCE-WEB-DESKTOP-BUILD-02`. The runner creates `run-01/CLAIM.json` before reading or checking approval and package inputs. A failure consumes the attempt; do not retry under this package. The previous B4 package was not run and is retained as `SUPERSEDED-PACKAGE-B4.json`.

The five sequential offline steps are Web app typecheck, Web Node config typecheck, Web Vite build, desktop no-emit typecheck, and desktop TypeScript emit. Web output is `source/apps/studio-web/dist`; desktop output is `source/apps/desktop/dist`. TypeScript build info, Vite cache, raw output and evidence are under `run-01`. The pinned Vite config is copied into `run-01` before loading so its temporary bundle file stays inside that claimed directory. Each Node process loads the pinned network-deny preload. The runner checks all 14,466 existing files and 771 links against the G baseline plus the one approved `main.ts` replacement before execution, and checks the source again after any outcome.

The desktop package's `build` script emits JavaScript. This packet does not produce an installed Electron application or bundled sidecar executable. The source currently has no `.venv/Scripts/python.exe` or `config/media-toolchain-lock.json`; the runner records these facts again at execution. QA02 must handle runtime resources and native verification separately. No visible Electron launch, sidecar start, API or provider call, c19 write, or release acceptance is in scope.

`fixture_test.py` uses a temporary fake tree and no Node child. It checks that invalid approval, child failure, and missing postflight input each leave a CLAIM and terminal RED receipt. `FIXTURE-RESULT.json` records the results.

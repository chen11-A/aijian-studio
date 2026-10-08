# Review-state keyboard Tab follow-up

State: PREPARED_PLAN_ONLY; NOT_RUN. The signed `css-layout-gate-v1/run-01` is immutable and must not be rerun.

## Existing evidence

- `css-layout-delta-v1/READONLY-DIFF.md` SHA-256 `332C5182200AFD1E38FABF6657F658DC44543341A11921772B3CF3658F30E350` distinguishes the former two-button DOM fixture from the complete review state.
- `css-layout-gate-v1/RUN-PACKET.json` SHA-256 `BBFF07B36F336246292D9ABBED8B34781B3082E6E0412F4F62F8D0852920242C` pins current source, renderer25, Edge, Playwright, and the read-only review fixture.
- `css-layout-gate-v1/run-01/RECEIPT.json` SHA-256 `5F7A2F218673C92FDD4A8D2D952FB3631D1B8144FDCFEA82A0B6394109C195C1` reports 1424×881 and 1424×720 three-button geometry, screenshots, excerpt `scrollTop=120`, programmatic focus, hit tests, and trial clicks. It did not press keyboard Tab.

## Proposed single-run check

1. Freeze the same renderer25 manifest and the c19 source pins. Use a new external output directory and isolated headless Edge profile. Recheck SHA-256 and byte counts before launching. Reuse only the read-only `window.aijian` fixture; reject mutation, fetch, nonlocal requests, and page errors.
2. At each viewport, wait for `sourceStage=review` as shown by exactly `刷新来源状态`, `确认来源审核基线`, `审核来源版本` in the integrated React preview. Record initial active element, button DOM order, tab indices, disabled state, bounding rectangles, and a screenshot.
3. Focus the first button once, then issue real `page.keyboard.press('Tab')` twice. After each press, record `document.activeElement` text and rectangle and require the second and third button respectively. Issue `Shift+Tab` twice and require second and first. Record any scroll position change, hit-test result, and screenshot after the keyboard sequence. Never issue a non-trial click.
4. Close page, context, server, and profile normally. Record browser PID/command while running and absence after close; preserve raw stdout, stderr, exit code, browser events, all screenshots/geometry, and hashes. First RED ends this gate without retry.

Acceptance boundary: keyboard navigation in a local headless Web review fixture only. It does not accept the native Electron window, real review action, product DB, G1, provider, or installation. Execution requires a new MGR02 `APPROVED_SINGLE_RUN` file tied to the exact new packet and runner hashes.

# D57ACF source preview: old evidence versus a new three-button layout gate

Status: READ_ONLY_DIFF; browser, product state changes, and new approvals NOT_RUN.

## Reusable evidence

- QA03 `qa03-ac05-front-20260924/run-05-rel03-css-build-20260928/geometry.json` SHA-256 `4A33BBEEE69B3CD270066C75B2172303EC608A60234F1FEEDA89D7C6A5AFCC87` used the actual built CSS `index-jsEG3DHn.css` SHA-256 `8B8AA7581262D68B1737A61C5587C4D545020C8C9AB73C211FC317555004ED0A` at 1424×720 and 1424×881. Both isolated DOM samples passed. The long excerpt had `scrollHeight=6561` versus `clientHeight=136/187`; the status and two fixture buttons were inside the card, and both fixture click handlers ran. Two screenshots and raw exit/stdout/stderr are retained in that directory.
- Current c19 `v2-story.css` SHA-256 remains `D57ACFD69CE6190A85C0A4041798CF572889534D0FA228BDA01A5A12C83E2B6E`. The later QA03 `web-gate-v3/web-03/after-build.json` pins the same built CSS SHA-256 `8B8AA758...` and a different Web JS `index-V0uKrLD3.js` SHA-256 `1ABE569DEF8BE04954CFEA441A40DDF4F6FA322013C29AC8154649FDC362B44E`. The old CSS geometry remains useful for that exact two-button local fixture.

## Uncovered difference

- The old fixture was hand-written isolated DOM. It showed a 440px right-side shell and card `h2`, but not the integrated page title or real Panel/CAS surroundings. It created only **refresh** and **confirm** buttons. It measured excerpt scroll capacity but never measured a nonzero `scrollTop` after scrolling. The side container itself had equal `scrollHeight` and `clientHeight` (420/420 at 720; 581/581 at 881).
- Current `StoryPages.tsx` SHA-256 `34D272A7ED104E2A983BAB774212C17F6CF7F9913198212B7052E7487B67DA60` renders refresh, review-only confirm, and a third navigation button when `sourceNavigation.target` is present. In `review`, `productionSourceStage.ts` SHA-256 `A0597138E818C35D9C00598752C234FC7440B5EB896BC2AD48AFF17504874DA7` supplies target `source-review` and label `审核来源版本`, so the expanded review state has all three. The old pre-CAS `StoryPages.before.tsx` SHA-256 `13998D8D7BBCA0CC857231469B5CD337352D37A60474253DEB5C1AF9EA834929` already contained this conditional third button; it was omitted by the old geometry fixture. Panel/CAS integration changed the surrounding Web JS and `StoryPages.tsx`, while the D57 CSS bytes stayed fixed.
- Current pinned Web source also includes `SourceExtractionPanel.tsx` SHA-256 `61AFFCF1DEC5D555E6D94766DF68967196AFAC63277AA278BB45633089682A4B` and `model.tsx` SHA-256 `0B2F661BFB9F156489667603F070DA04AE3F28633452201236D65249996CE211`. The prior two-button fixture never mounted this integrated state.

## If MGR02 opens a new isolated Web layout gate

Pin c19 HEAD/status, D57 CSS, current Web JS/CSS/HTML and the three React source files above before running. Use one fresh external QA output and isolated headless browser profile. The fixture must show the expanded review state **without writing product DB or treating a mocked review as accepted**. A static DOM fixture can establish only CSS geometry; an integrated React/API fixture must disclose its mocked inputs and can claim only local Web behavior. At both 1424×881 and 1424×720, record the page title, source card, right sidebar, all three buttons, bounding rectangles, `scrollHeight/clientHeight`, nonzero post-scroll `scrollTop`, visibility and click hit test for each button, screenshots, raw exits and errors. A two-button result is insufficient. Keep QA02 native G1 and packaged Electron status separate.

Decision: reuse the old 720/881 result for its exact two-button isolated CSS scope. A full expanded-review three-button layout has material uncovered risk; it remains NOT_RUN pending a concrete review-state fixture and MGR02 one-shot approval. No browser was launched for this comparison.

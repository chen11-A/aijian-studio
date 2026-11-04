# Phase 3j browser regression evidence

Captured with Chromium 151.0.7922.173 on Linux, 2026-11-04. The running Vite application uses repository sample-film data with synthetic repeated descriptions. Desktop image generation is replaced by a recorded bridge that returns a one-pixel PNG; no model provider, paid image generation, real portrait, user novel, or credential is used.

Reproduce from the repository root, with the web dev server running:

```sh
AIVORA_CHROMIUM=/usr/bin/chromium \
  AIVORA_AUDIT_OUT=/tmp/p3j-browser \
  node apps/studio-web/e2e/p3j-regression.mjs
```

`results.json` records the assertions and viewport observations. The 1280×800 screenshots show long shot descriptions and performance notes, generation progress, completed portrait slots, and the export path. Card checks include adjacent-card overlap, full-text titles, three-line clamping, and labels contained within their own card. The script also checks one-click generation, all four portrait views per character, explicit first-frame reference arguments, suggestion expiry on page/scene changes, keyboard focus, reduced-motion preference, and browser errors. `board-1280x800.aria.txt` records the accessibility tree.

The 1440×900 observation found no horizontally clipped controls. The 390×844 screenshot records a limitation: 35 controls extend outside that viewport. This is below the documented 980px minimum desktop width and is **not** a passing mobile acceptance result. Browser checks do not establish real supplier output quality or actual Windows installation behavior.

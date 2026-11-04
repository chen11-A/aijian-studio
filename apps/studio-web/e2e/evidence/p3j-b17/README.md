# Phase 3j B17 business regression evidence

This is the later B14/B17 business-wiring run, captured with Chromium 151 on Linux on 2026-11-04. The earlier `../p3j/` captures are retained unchanged and represent the earlier implementation. No JSX or CSS was changed for this run.

```sh
AIVORA_CHROMIUM=/usr/bin/chromium \
  AIVORA_AUDIT_OUT=/tmp/p3j-b17 \
  node apps/studio-web/e2e/p3j-regression.mjs
```

Input is the repository sample film with synthetic long descriptions and two visible characters. The desktop image bridge is replaced; each generated image is a different same-origin fixture URL backed by a one-pixel PNG intercepted locally by Playwright. These fixture URLs exercise browser selection and rendering, not desktop path acceptance or a real supplier. The fixture deliberately avoids changing the development page's CSP. Actual preload event delivery is separately tested by `task-progress-preload.test.ts`, which executes the real transpiled self-contained preload.

The browser recorded 59 real workflow snapshot publications to the substitute display bridge. Assertions cover queued/running/done image states, completed portrait batches, and a boolean `running` field. Two characters with eight stored portrait views yield five first-frame references with both characters represented. The final frozen-source run also confirms that the four-candidate confirmation starts exactly four image requests, each with five references, and all four real workflow tasks finish done. The additional four candidate controls are included in this run’s viewport observation. The other checks cover first-click image generation, four-view portraits and batch completion, expired suggestions, export-path display, keyboard focus, and reduced motion.

All 13 long cards passed three-line clamp, full-text title, internal label boundaries, and pairwise card overlap checks. The 1280×800 board screenshot was manually reviewed. The 1440×900 observation found zero horizontally clipped controls. At 390×844, 39 controls still extend outside the viewport; this is below the documented desktop minimum and is not a mobile acceptance pass. Console warnings/errors and page errors were empty. No real supplier generation or Windows installation was tested here.

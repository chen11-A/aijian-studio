# Canonical generation producer runtime checkpoint

This is the shared pure producer/extraction checkpoint for prerequisite budget work,
not the implemented schema-54 execution or a provider authorization. Preload has not
enabled the execution contract. No request is made by building or loading this module.

`packages/aivora-modules/generation-input/index.ts` re-exports the original
`oneShot`/`storyFilmBatches`, seven-part request guard, reference selection and image
prompt functions. `shotStillInput` and `locationGenerationPrompt` are pure extractions
from the existing editor callers, which now delegate to those same functions. There
is no copied native prompt implementation or fallback to runtime repository sources.

The fixed builder uses the already locked studio Vite to emit a single static CJS
`film-generation-producer.js`. Its source receipt includes every retained source SHA,
the original lock/builder SHA, pre/post source-input fingerprint, exports and output
SHA. It requires zero external/dynamic imports and rejects ambient filesystem/network/
renderer access. Output and receipt are fixed, owned filenames. No dependency or lock
version changed. The original ZIP helper in `operations.ts` is not retained.

The ordinary desktop build, actual production builder, and both Linux packagers invoke
this same builder in their actual output `dist`. The new native wrapper loads only
that fixed compiled module and passes its request through the original strict parser.
This checkpoint does not claim the future main execution consumer, complete package
candidate, schema migration or Windows execution has been verified.

Validation at this checkpoint:

- `node --test scripts/build-generation-input-runtime.test.mjs`: actual built CJS in
  an isolated VM with no source/network/filesystem loader is compared to the real
  editor modules for all sample targets and draft/full models, keyframes, and valid/
  stale seven-part review behavior. Source/output SHA and zero imports are checked.
- Original `workflow`, `still-workflow`, `location-reference`, `scene-location-reference`,
  `operations`, and `seven-part-video` files: **6 files / 78 tests passed**.
- Formal desktop and web typechecks passed. Target ESLint, Python packaging Ruff and
  format checks passed; a first test-script missing explicit Node `URL` import was
  corrected, with its failing log retained.

The final native/API-54 integration must rerun actual shipping/SDK/build closure on
its final source. The earlier `fe399` Windows candidate validates its own frozen
runtime/installer source, and is not evidence for these new producer bytes.

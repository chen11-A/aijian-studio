# Phase 0 M03A Timeline Core Acceptance

Date: 2026-08-15

Backlog: M03 `timeline-golden` (first bounded slice only)

Branch: `codex/m03a-timeline-core`

Baseline: `48c79e57e38b157b746d33bfc2c0eaa620c8340a`

Research: [`docs/research/m03a-timeline-core-benchmark.md`](../research/m03a-timeline-core-benchmark.md)

Specs / ADRs:

- [`docs/architecture/ADR-0003-timeline-timebase.md`](../architecture/ADR-0003-timeline-timebase.md)
- [`docs/specs/phase0-media-contract.md`](../specs/phase0-media-contract.md)
- [`docs/specs/phase0-ffmpeg-toolchain.md`](../specs/phase0-ffmpeg-toolchain.md)

## Conclusion

M03A delivers an immutable, deterministic **timeline domain core** with pure edit
commands, proxy/original selection, and a canonical render-plan compiler. This is
**not** M03 completion: no FFmpeg invocation, no 1080p MP4, no golden media hash of a
rendered file, no CAS, no timeline HTTP API, and no UI.

M03 status must remain **`PARTIAL`** until M03B performs real export and media
verification against this plan.

## Command matrix

| Command / operation | Behavior proven | Failure modes proven |
| --- | --- | --- |
| `create_timeline` / model validate | Phase 0 rates `24000/1001`, `24/1`, `25/1`, `30000/1001`; unique IDs (per-track and cross-track); track/clip kind agreement; positive durations; source bounds | duplicate track/clip IDs, overlap, zero-length, float coercion, kind mismatch, source overflow |
| `trim_clip` | Frame-exact timeline start, duration, source_in; validating rebuild; new immutable revision | stale revision (incl. non-int), NO_OP, overlap, source bounds, unknown clip, INVALID_DURATION, INVALID_BOUNDS (float/bool/negative/JSON-unsafe end) |
| `reorder_track` | Ripple pack from frame 0; preserves each clip duration + source range | stale revision, NO_OP, non-permutation reorder, UNKNOWN_TRACK, EMPTY_TRACK |
| `replace_clip_source` | Preserves timeline span; updates source identity without mutating prior revision | media kind mismatch, insufficient replacement duration, NO_OP, STALE_REVISION, non-int source_in |
| `select_clip_source` | ORIGINAL/PROXY selection; binds hashes + `ProxyTimeMapV1`; stable `INVALID_PROXY_MAP` codes | wrong timebase, incomplete map, hash mismatch, missing both/one proxy arg, NO_OP (same selection+binding), STALE_REVISION |
| `compile_render_plan` | Explicit GAP segments; multi-track duration pad; 48 kHz sample bounds via `sequence_frame_to_audio_sample`; CLIP keeps original hash under PROXY | N/A (pure compile of valid timelines) |
| `render_plan_canonical_hash` | Identical render content → identical hash regardless of track input order, `timeline_id`, or `timeline_revision` (content-addressed export/cache key; provenance omitted); semantic edit changes hash | N/A |

## Design limits (intentional)

- Timeline authority is **integer sequence frames** only; source timing reuses M01
  rationals / `ProxyTimeMapV1`.
- Gaps are **not** first-class editable objects; they appear as explicit `GAP`
  segments in the compiled plan derived from absolute clip starts.
- `reorder_track` packs contiguously from frame 0 (deterministic ripple). Inter-clip
  gaps are not preserved across reorder.
- No transitions, effects, captions, nested sequences, OTIO I/O, or mix automation.
- No FFmpeg argv emission in M03A — only data M03B needs to build argv/filtergraphs.
- Internal Python domain only; OpenAPI unchanged.

## M03B handoff contract

M03B must consume `RenderPlanData` (`schema_version = 1`) and:

1. Resolve `selected_asset_sha256` / `original_asset_sha256` through CAS/path binding
   (out of M03A scope).
2. For each `CLIP` segment, build bounded FFmpeg inputs with source in/out frames and
   audio sample windows already computed at 48 kHz.
3. Treat `GAP` segments as explicit silence/black generators or timeline pads — never
   infer timing from list index alone.
4. Keep `shell=False`, argv arrays, toolchain lock checks, and refuse unknown binaries
   (M02 rules).
5. Export a real 1080p MP4 and verify golden media / A/V drift; only then may M03 move
   toward `DONE`.

Stable entry points:

- `aijian_api.timeline_core.create_timeline`
- `aijian_api.timeline_core.trim_clip`
- `aijian_api.timeline_core.reorder_track`
- `aijian_api.timeline_core.replace_clip_source`
- `aijian_api.timeline_core.select_clip_source`
- `aijian_api.timeline_core.compile_render_plan`
- `aijian_api.timeline_core.render_plan_canonical_hash`

## Verification commands and results

Environment: workspace
`F:\UserData\Documents\ChatGPT\sp\aijian-wt-m03-timeline-core`, project venv
`.\\.venv\\Scripts\\python.exe`.

```powershell
.\.venv\Scripts\python.exe -m pytest services/api/tests/test_timeline_core.py -q --tb=line --basetemp=<unique-path>
# 19 passed

.\.venv\Scripts\python.exe -m pytest services/api/tests -q --tb=line --basetemp=<unique-path>
# 721 passed, 1 skipped

.\.venv\Scripts\python.exe -m mypy
# Success (package aijian_api)

.\.venv\Scripts\python.exe -m ruff check services/api/src/aijian_api/timeline_core.py services/api/tests/test_timeline_core.py
.\.venv\Scripts\python.exe -m ruff format --check services/api/src/aijian_api/timeline_core.py services/api/tests/test_timeline_core.py
git diff --check
git status --short
# packages/contracts/openapi.json unchanged
```

### Golden coverage checklist

- [x] All four Phase 0 sequence rates
- [x] Trim / reorder / replace / proxy selection
- [x] Gaps + multi-track duration
- [x] Stale revision, overlap, duplicate IDs, wrong media kind, invalid source bounds
- [x] Bad proxy maps (timebase, coverage, hash mismatch)
- [x] Canonical hash stability and change
- [x] Deterministic seeded multi-edit invariant walk
- [x] 30-minute-equivalent 48 kHz boundary drift bound (incl. 24000/1001 and 30000/1001)
- [x] No wall-clock, network, random (unseeded), or external-binary dependency

## What this record does **not** prove

- Real FFmpeg export or 1080p MP4 bytes
- Proxy file generation or CAS persistence
- Playback, UI timeline editing, or HTTP timeline routes
- Transition handles, color, captions, or OTIO interchange
- K01 walking skeleton

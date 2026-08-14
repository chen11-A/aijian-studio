# M03A Timeline Core — Open-Source Benchmark

Status: research gate for **bounded M03A** (immutable timeline domain, pure edit
commands, canonical render-plan compiler). No FFmpeg export, HTTP route, UI, or CAS
in this slice.
Author: implementer on `codex/m03a-timeline-core`.
Observation clock: GitHub REST `GET /repos/{owner}/{repo}` checked on
**2026-08-15 (Asia/Shanghai)** (queried during this work session; responses recorded
below). Exact UTC query instants were not recorded.
Workspace check: branch `codex/m03a-timeline-core`, required base
`48c79e57e38b157b746d33bfc2c0eaa620c8340a`; no vendor clones.

This document answers a product question, not a popularity contest:

> What timeline/time models, edit semantics, identity rules, proxy/source relink
> behavior, and export-plan patterns from mature open-source projects should Aijian
> **reuse as ideas**, **rewrite under Apache-2.0**, or **reject**, without importing
> GPL/AGPL code into the Phase 0 core?

M03A is **not** M03 completion. Real 1080p MP4 export and golden media verification
remain M03B.

## 1. Evidence rules and method

- Technical claims use primary evidence: official manuals, official repositories,
  source symbols, or official maintainer docs. Marketing README language is not proof.
- Every important claim has an exact URL. Source claims name project + document path.
- GitHub star totals come from the public repository API at the observation clock
  above. **30-day star growth is `not verifiable`**: GitHub restricted public
  stargazer timelines on 2026-06-30
  ([changelog](https://github.blog/changelog/2026-06-30-upcoming-access-restrictions-to-public-api-endpoints-and-ui-views/),
  [REST starring docs](https://docs.github.com/rest/activity/starring), prior Aijian
  note in [`docs/research/oss-baseline-2026-08-14.md`](oss-baseline-2026-08-14.md)).
- Labels used below:
  - **Documented**: official manual or design page.
  - **Source-confirmed**: inspected public source or tests (via docs/source URLs only;
    no clone into this worktree).
  - **Inference**: author conclusion, not claimed by the project.
- Six mandatory families were scanned in depth. Neighbours (Shotcut as MLT consumer,
  Blender VSE, FFmpeg filtergraph) are included as export/runtime references.
- No repository was cloned into this worktree. No GPL/AGPL source was copied.

## 2. Catalog — scanned projects

GitHub REST metadata recorded **2026-08-15 (Asia/Shanghai)** (session query).
30-day star growth: **not verifiable** (stargazer timeline API restricted).

| # | Project | Repo | Stars | License (API SPDX / notes) | Primary docs / source | Deep compare? |
| --- | --- | --- | ---: | --- | --- | --- |
| 1 | OpenTimelineIO | [AcademySoftwareFoundation/OpenTimelineIO](https://github.com/AcademySoftwareFoundation/OpenTimelineIO) | 1,954 | Apache-2.0 | [Time Ranges](https://opentimelineio.readthedocs.io/en/latest/tutorials/time-ranges.html), [Timeline Structure](https://opentimelineio.readthedocs.io/en/latest/tutorials/otio-timeline-structure.html) | yes |
| 2 | MLT Framework | [mltframework/mlt](https://github.com/mltframework/mlt) | 1,831 | LGPL-2.1 | [Framework Design](https://www.mltframework.org/docs/framework/), [MLT XML](https://www.mltframework.org/docs/mltxml/) | yes |
| 3 | Shotcut | [mltframework/shotcut](https://github.com/mltframework/shotcut) | 14,920 | GPL-3.0 | [shotcut.org](https://www.shotcut.org/), MLT consumer | yes (as MLT app) |
| 4 | Kdenlive | [KDE/kdenlive](https://github.com/KDE/kdenlive) | 5,467 | GPL-3.0 | [invent.kde.org/multimedia/kdenlive](https://invent.kde.org/multimedia/kdenlive), MLT-backed | yes |
| 5 | Olive | [olive-editor/olive](https://github.com/olive-editor/olive) | 9,113 | GPL-3.0 | [olivevideoeditor.org](https://www.olivevideoeditor.org/) (docs currently stub) | yes |
| 6 | Remotion | [remotion-dev/remotion](https://github.com/remotion-dev/remotion) | 56,312 | NOASSERTION (project uses a custom source-available company license for some packages; core docs public) | [`<Sequence>` docs](https://www.remotion.dev/docs/sequence), [timeline concepts](https://www.remotion.dev/docs/timeline) | yes |
| 7 | FFmpeg | [FFmpeg/FFmpeg](https://github.com/FFmpeg/FFmpeg) | 63,304 | LGPL-2.1+ default; GPL when GPL components enabled ([legal](https://ffmpeg.org/legal.html)) | [Filters: trim/concat](https://ffmpeg.org/ffmpeg-filters.html), [legal](https://ffmpeg.org/legal.html) | yes (export planner) |
| 8 | Blender VSE | [blender/blender](https://github.com/blender/blender) | 19,701 | GPL-2.0-or-later (Blender license; API reports NOASSERTION) | [VSE strips manual](https://docs.blender.org/manual/en/latest/video_editing/edit/montage/strips/index.html) | neighbour |

Activity inference: OTIO, MLT, Shotcut, Kdenlive, Remotion, FFmpeg, and Blender show
recent push activity in Aug 2026. Olive last observed push 2024-12-05 (slower). Stars
do not decide M03A design.

## 3. Deep comparisons

### 3.1 OpenTimelineIO (OTIO)

**Docs:** [Time Ranges](https://opentimelineio.readthedocs.io/en/latest/tutorials/time-ranges.html),
[Timeline Structure](https://opentimelineio.readthedocs.io/en/latest/tutorials/otio-timeline-structure.html).
**Repo:** https://github.com/AcademySoftwareFoundation/OpenTimelineIO (Apache-2.0).

#### Timeline / time model

- **Documented:** `RationalTime(value, rate)` and half-open `TimeRange(start, duration)`.
- **Documented:** Clip effective length is `trimmed_range()` = `source_range` if set,
  else `available_range()` from the media reference.
- **Documented:** Tracks lay children sequentially; Gaps encode empty time; Stacks
  compose parallel tracks.

#### Edit semantics

- **Documented:** Non-destructive trim via `source_range`. Parent ranges
  (`range_in_parent`, `trimmed_range_in_parent`) separate clip-local and track time.
- **Documented:** Transitions expand `visible_range` without necessarily changing
  track duration math the same way as hard cuts.

#### Identity / versioning

- **Documented:** Schema objects with names/metadata; interchange-focused, not an
  optimistic-concurrency revision fence for collaborative editors.
- **Inference:** OTIO is an interchange graph, not Aijian’s immutable revisioned
  domain command log.

#### Proxy relink

- **Documented:** Media references can be relinked via adapters/media linkers; OTIO
  does not own Aijian’s hash-bound `ProxyTimeMapV1`.

#### Render-plan / export

- **Documented:** OTIO describes editorial structure; rendering is adapter/host
  responsibility. Not a canonical FFmpeg argv planner.

#### License boundary

- Apache-2.0 — **license-compatible** for idea and optional dependency later. M03A
  does **not** take a runtime dependency; ideas only.

#### Aijian decision

- **Reuse (ideas):** half-open ranges, explicit Gaps, source vs available range,
  track/stack separation, rational time (already frozen in M01 as `{num,den}`).
- **Rewrite:** Aijian sequence-frame integers + existing `RationalData` /
  `SequenceTimebaseData` (do not introduce OTIO `RationalTime` types).
- **Reject for M03A:** OTIO import/export adapters, transition graph, nested
  compositions, media linker plugins.

### 3.2 MLT Framework (+ Shotcut / Kdenlive as consumers)

**Docs:** [Framework Design](https://www.mltframework.org/docs/framework/),
[MLT XML](https://www.mltframework.org/docs/mltxml/).
**Repos:** [mlt](https://github.com/mltframework/mlt) (LGPL-2.1),
[shotcut](https://github.com/mltframework/shotcut) (GPL-3.0),
[kdenlive](https://github.com/KDE/kdenlive) (GPL-3.0).

#### Timeline / time model

- **Documented:** Pull-based producer/consumer. Playlists are sequential entries with
  in/out frames and blanks; tractors compose multitracks with filters/transitions.
- **Documented:** Profile normalizes framerate/resolution for a project.

#### Edit semantics

- **Documented:** Playlist entry in/out is the trim; blanks are explicit gaps;
  multitrack overlay via tractor field transitions.
- **Inference (Shotcut/Kdenlive):** UI edit commands mutate MLT XML / in-memory
  services; not pure immutable command functions.

#### Identity / versioning

- **Documented:** XML ids for producers/playlists; project files are mutable
  documents.
- **Inference:** No Aijian-style expected-revision fence on every pure command.

#### Proxy relink

- **Inference:** Proxies are a host/editor concern (Kdenlive proxy clips, Shotcut
  proxy mode), not a content-hash + complete frame map contract like
  `ProxyTimeMapV1`.

#### Render-plan / export

- **Documented:** Consumer drives encode (avformat consumer, etc.). The “plan” is
  the service graph itself, not a separate canonical JSON hash.

#### License boundary

- MLT LGPL-2.1 may be linkable under conditions, but **Shotcut/Kdenlive are GPL-3.0**.
  Aijian Phase 0 core is Apache-2.0 — **do not copy** GPL editor code; treat MLT as
  idea reference only for M03A.

#### Aijian decision

- **Reuse (ideas):** explicit blanks/gaps, per-entry in/out, multitrack tractor as
  parallel composition metaphor, profile = sequence timebase.
- **Rewrite:** pure immutable Python models + commands; render plan as data, not a
  live producer graph.
- **Reject:** embedding MLT/Shotcut/Kdenlive, XML project format, transition field
  engine, GPL UI code.

### 3.3 Olive Editor

**Repo:** https://github.com/olive-editor/olive (GPL-3.0).
**Site:** https://www.olivevideoeditor.org/ (docs currently a stub: “Olive will return…”).

#### Timeline / time model

- **Inference from project identity / historical public design:** node-based / track
  NLE with rational-ish media time; exact current model not re-derived from stub docs
  in this session.
- **Source-confirmed constraint:** GPL-3.0 license on the repository API response.

#### Edit / export / proxy

- Public docs were not a reliable primary source at check time (stub page).
- Treat as **high-level NLE peer** only: track clips, trims, export pipeline exist in
  the product category.

#### License boundary

- GPL-3.0 — **hard reject** for code reuse in Apache-2.0 core.

#### Aijian decision

- **Reuse (ideas):** none beyond generic NLE vocabulary already covered by OTIO/MLT.
- **Rewrite:** N/A.
- **Reject:** any Olive source, project format, or GPL-derived algorithm dump.

### 3.4 Remotion

**Docs:** [Sequence](https://www.remotion.dev/docs/sequence),
[Timeline](https://www.remotion.dev/docs/timeline).
**Repo:** https://github.com/remotion-dev/remotion (API license `NOASSERTION`; project
uses Remotion’s own licensing for company use — not Apache-2.0 clean for wholesale
dependency without legal review).

#### Timeline / time model

- **Documented:** Frame-based React compositions; `<Sequence from={n} durationInFrames={d}>`
  places content at absolute composition frames.
- **Documented:** Composition fps is project-level; time is integer frames in the
  composition, not float seconds in the primary API.

#### Edit semantics

- **Documented:** Ordering and placement are declarative via component tree / `from`
  offsets, not NLE trim/ripple commands.
- **Inference:** Great for deterministic programmatic video; weak match for
  trim/reorder/replace editor commands.

#### Identity / versioning

- Source-controlled compositions; not optimistic timeline revision fences.

#### Proxy relink

- Not an editorial proxy/original hash map model.

#### Render-plan / export

- **Documented:** Remotion renders frames via its own renderer; not FFmpeg
  filtergraph-first planning (FFmpeg may be used in tooling, but the public model is
  React frame render).

#### License boundary

- Custom / non-Apache — **reject as dependency** for Phase 0 core without legal
  review. Ideas only.

#### Aijian decision

- **Reuse (ideas):** absolute integer frame placement (`from` + `durationInFrames`),
  composition-level fps, deterministic frame enumeration for export.
- **Rewrite:** timeline as data + pure commands (not React tree).
- **Reject:** Remotion runtime, JSX composition model, company license dependency.

### 3.5 FFmpeg filtergraph (export planning reference)

**Docs:** [ffmpeg-filters](https://ffmpeg.org/ffmpeg-filters.html) (`trim`/`atrim`,
`setpts`/`asetpts`, `concat`), [legal](https://ffmpeg.org/legal.html).
**Repo:** https://github.com/FFmpeg/FFmpeg.

#### Timeline / time model

- **Documented:** Filters operate on stream timestamps and frame/sample indices.
  `trim` keeps a continuous subpart; timestamps are **not** reset unless `setpts`
  follows.
- **Documented:** `concat` requires matching stream layout and segments that start at
  timestamp 0 for predictable joins.

#### Edit semantics

- FFmpeg is an execution engine, not an NLE command layer.
- **Documented pattern:** `trim`/`atrim` → `setpts`/`asetpts` → `concat` for cut lists.

#### Identity / versioning

- None for editorial revisions.

#### Proxy relink

- Inputs are paths/URLs; Aijian must supply resolved original/proxy paths from CAS
  later (M03B/CAS01).

#### Render-plan / export

- **Documented:** filtergraph is the executable plan. M03A should emit **enough
  segment data** (frame ranges, source in/out, sample boundaries, selected asset
  hashes) for M03B to build argv safely with `shell=False`.

#### License boundary

- LGPL default / GPL if GPL components enabled. Already handled under M02 toolchain
  lock (`DEV_GPL` vs future `RELEASE_LGPL_REVIEWED`). M03A does **not** invoke
  FFmpeg.

#### Aijian decision

- **Reuse (ideas):** segment list with explicit trim bounds + timestamp reset + concat
  order; audio sample-accurate `atrim` bounds from M01 helper.
- **Rewrite:** canonical JSON render plan + hash, not string filtergraphs in M03A.
- **Reject:** calling FFmpeg in M03A; claiming MP4 output.

### 3.6 Blender VSE (neighbour)

**Manual:** [VSE strips](https://docs.blender.org/manual/en/latest/video_editing/edit/montage/strips/index.html).
**Repo:** https://github.com/blender/blender (GPL).

#### Observed model

- **Documented:** Strip-based montage on channels; frame-based placement; movie/image
  strips with start/hard trim concepts in the UI model.
- GPL — **reject code**. Useful only as confirmation that professional open NLEs use
  integer frame placement on tracks with explicit strip bounds.

## 4. Cross-cutting synthesis for Aijian M03A

| Concern | Industry pattern | Aijian M03A choice |
| --- | --- | --- |
| Time | OTIO rational; Remotion int frames; MLT profile frames | Sequence integer frames + existing M01 rationals/timebases |
| Gaps | OTIO Gap / MLT blank | Explicit GAP segments in **compiled** plan; clips carry absolute starts |
| Trim | source_range / in-out | `trim` command: timeline start, duration, source_in; fail closed |
| Reorder | playlist permute + ripple | `reorder` permutation + contiguous ripple pack; preserve source ranges |
| Replace | relink media ref | `replace` keeps timeline span; new source identity; kind/duration checks |
| Proxy | editor-specific | Bind `ProxyTimeMapV1` + hashes; wrong map/timebase fails closed |
| Versioning | mutable project files | Optimistic `expected_revision` → new immutable revision |
| Export plan | FFmpeg filtergraph / MLT consumer | Deterministic `RenderPlanV1` JSON + `canonical_content_hash` |
| License | many GPL NLEs | Ideas only; Apache-2.0 pure Python core; no GPL copy |

## 5. Concise reuse / rewrite / reject

### Reuse (ideas only)

- OTIO: half-open ranges, explicit gaps, source vs available media range.
- MLT: playlist blanks, multitrack composition, project profile ≈ sequence timebase.
- Remotion: absolute integer frame placement at composition fps.
- FFmpeg docs: trim → reset PTS → concat as M03B execution pattern.
- Aijian M01/M02: `RationalData`, `SequenceTimebaseData`, `ProxyTimeMapV1`,
  `sequence_frame_to_audio_sample`, `canonical_content_hash`.

### Rewrite (implement in-repo)

- Immutable versioned `Timeline` / `Track` / `Clip` / `SourceBinding` / `RenderPlan`.
- Pure commands: `trim`, `reorder`, `replace`, proxy/original selection with revision
  fences.
- Canonical render-plan compiler and golden hash matrix.
- Fail-closed validation: no floats, no overlaps, no zero-length clips, no stale
  revisions, no bad proxy maps.

### Reject

- Copying GPL/AGPL code from Shotcut, Kdenlive, Olive, Blender.
- OTIO/MLT/Remotion runtime dependencies in M03A.
- Transitions, effects, captions, mix automation, OTIO I/O.
- FFmpeg invocation, MP4 claims, CAS, HTTP timeline API, UI.
- Float-second timeline authority (already forbidden by ADR-0003 / M01).

## 6. M03A implementation implication

Ship a single focused module `services/api/src/aijian_api/timeline_core.py` plus
`services/api/tests/test_timeline_core.py`, acceptance evidence, and roadmap status
`M03 = PARTIAL`. M03B owns real 1080p export against this plan.

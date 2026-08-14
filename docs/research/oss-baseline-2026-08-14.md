# OSS Baseline Audit - 2026-08-14

Scope: this audit records the read-only research checkout under `F:\UserData\Documents\ChatGPT\sp\oss-research` and public GitHub metadata observed on 2026-08-14. No upstream source, fixtures, media, or long-form documentation were copied into Aijian Studio.

## GitHub Star Timeline Boundary

Current total star counts remain visible through repository metadata or public repository pages. Precise stargazer timelines are no longer a reliable public data source after GitHub's 2026-06-30 changelog: GitHub announced that the `/repos/{owner}/{repo}/stargazers` and watcher-list endpoints would be limited to repository admins and collaborators. GitHub's REST documentation still describes `application/vnd.github.star+json` as the media type that includes `starred_at`, but the post-July-2026 access restriction means Aijian must not infer monthly growth from inaccessible stargazer lists.

Rule for this baseline: monthly growth is marked `不可精确取得` unless a public event snapshot with date and count is cited. No synthetic month-over-month growth was calculated.

Sources: [GitHub changelog, 2026-06-30](https://github.blog/changelog/2026-06-30-upcoming-access-restrictions-to-public-api-endpoints-and-ui-views/), [GitHub REST starring docs](https://docs.github.com/rest/activity/starring), [Star History restriction note, 2026-07-06](https://www.star-history.com/blog/github-stargazer-api-restriction).

## Candidate Matrix

| Candidate | Research HEAD | Current stars | License finding | Maintenance activity | Aijian borrowing point | Adoption mode | Monthly growth |
| --- | --- | ---: | --- | --- | --- | --- | --- |
| HyperFrames | `532caf7aa24fef382cb103013f6414bb547a4129` | 40,905 | Apache-2.0 via GitHub API and local `LICENSE` | Last local commit 2026-08-13; GitHub `pushed_at` 2026-08-14 | Deterministic HTML/CSS/animation rendering lane, Puppeteer/FFmpeg pipeline, subtitle and graphics packaging | 可评估引入: U02 isolated spike only; no production dependency until render cost and provenance are reviewed | 不可精确取得 |
| Jellyfish | `a9678194ddf2d9be3ccbe78d4287d87d5089e123` | 5,967 | Apache-2.0 via GitHub API and local `LICENSE` | Local HEAD 2026-04-20; GitHub `pushed_at` 2026-07-30 | Motion-comic domain model, project/chapter/shot concepts, unified task truth layer | 可评估引入 only after file-level provenance; primary use is architecture reference | 不可精确取得 |
| ViMax | `05a48943878312d88fe5a016c12a9654940ecc43` | 11,925 | MIT via GitHub API and local `LICENSE` | Local HEAD 2026-07-29 | Producer/director/writer agent role boundaries and idea/script/novel entry modes | 只学设计; prompt/role concepts only | 不可精确取得 |
| LumenX | `f2a02e23171447c939e7d8e1386b24d17049bbf1` | 1,061 | MIT via GitHub API and local `LICENSE` | Local HEAD and GitHub `pushed_at` 2026-08-11 | Six-stage comic SOP, provider setup experience, model catalog UX | 只学设计; rewrite interactions and avoid fixed local ports/wide CORS | 不可精确取得 |
| Toonflow-app | `bc61ec7a1b5df31293b286981a5f4ad4635464ee` | 13,862 | Local `LICENSE` begins with Apache-2.0 but appends commercial authorization terms for product distribution to two or more third parties | Local HEAD 2026-07-09; GitHub `pushed_at` 2026-07-28 | Infinite canvas, chapter event graph, layered agents, editable skills | 只学设计; do not import code or depend on it until legal confirms the added terms | 不可精确取得 |
| LocalMiniDrama | `7b6c1a748e9e3013b88a902cfbfd31ec283da0d1` | 1,274 | MIT via GitHub API and local `LICENSE` | Local HEAD and GitHub `pushed_at` 2026-08-13 | Electron packaging, local backend launch, FFmpeg probing, provider coverage | 只学设计 / 外部适配 patterns; do not reuse plaintext-key handling | 不可精确取得 |
| wind-comic | `c83e1cf5e9b88fa8ac62bb737c79985a95243b8d` | 424 | MIT via GitHub API and local `LICENSE` | Local HEAD and GitHub `pushed_at` 2026-08-11 | Long-form season/episode model, typed DAG, collaboration concepts, tests | 可评估引入 for small dependency ideas only after provenance; mostly design/test reference | 不可精确取得 |
| OpenTimelineIO | `bc5fe2d78dc3f8b2a8feb7e04483d85a12e80072` | 1,953 | Apache-2.0 via GitHub API and local `LICENSE.txt` | Local HEAD and GitHub `pushed_at` 2026-08-07 | Timeline interchange and OTIO/OTIOZ import/export vocabulary | 可评估引入 as external interchange layer; not Aijian's internal truth model | 不可精确取得 |
| xyflow | `6eee160629a1c29267e1ae35ecabf4c9cc8d63e1` | 38,009 | MIT via GitHub API and local `LICENSE` | Local HEAD 2026-08-12; GitHub `pushed_at` 2026-08-13 | Node canvas, workflow/event graph UI | 可评估引入 as frontend dependency candidate after large-canvas performance check | 不可精确取得 |
| ComfyUI | `7fe8a6138504f90ff7be82f3babf416da32876b1` | 127,466 | GPL-3.0 via GitHub API and `git show HEAD:LICENSE` | Local HEAD and GitHub `pushed_at` 2026-08-14 | Node-based generation workflows and local model ecosystem | 外部适配 only: HTTP boundary, user-installed service; no GPL code in Apache core | 不可精确取得 |
| Remotion | `9e36391d770daf1466568a52dc884f66845492db` | 56,272 | Special source-available / tiered commercial license in local `LICENSE.md`; GitHub page states company license may be required | Local HEAD 2026-08-14; GitHub org page updated 2026-08-13 | React video rendering concepts, agent-era video docs, external render service experience | 外部适配 only: user-installed renderer or licensed service; not built into Apache core | 不可精确取得 |

Star sources: GitHub REST repository API for all rows except Remotion, where unauthenticated API access returned 403 during this audit; Remotion count comes from the public [remotion-dev GitHub organization page](https://github.com/remotion-dev) showing `56,272` and the [repository page](https://github.com/remotion-dev/remotion) showing `56.3k`.

## Corrected Adoption Conclusions

- Toonflow-app is downgraded to `只学设计` because its local `LICENSE` appends commercial authorization terms after the Apache-2.0 text. Treat it as legally ambiguous for Aijian distribution.
- ComfyUI remains GPL-3.0. It may only be used through an HTTP external-service boundary, with no ComfyUI code or model assets distributed in the Apache-2.0 core.
- Remotion remains special-licensed/source-available. It may only be considered as an external renderer or licensed integration, not an embedded rendering core.
- HyperFrames is Apache-2.0 and can be used for a U02 isolated spike. That spike must record exact input HTML, renderer version, browser/FFmpeg versions, output hashes, render-time cost, NOTICE obligations, and failure modes before any dependency proposal.

## Sources And Local Evidence

- Local Git evidence: `git -C F:\UserData\Documents\ChatGPT\sp\oss-research\<candidate> rev-parse HEAD`, `remote -v`, `log -1`, and local license files where present.
- GitHub repository metadata API: `https://api.github.com/repos/<owner>/<repo>` with `Accept: application/vnd.github+json`.
- Remotion license evidence: local `git show HEAD:LICENSE.md` and [Remotion repository license section](https://github.com/remotion-dev/remotion).
- Aijian prior research boundary: `docs/research/github-landscape-2026-08.md` and `docs/research/ui-provider-reference-2026-08.md` already state that research links do not mean upstream source import.

## Legal Items Requiring Human Confirmation

- Toonflow-app appended commercial terms and their enforceability/compatibility with the preceding Apache-2.0 text.
- Whether any future HyperFrames code import requires additional NOTICE entries beyond Apache-2.0 license preservation.
- Remotion license fit for any paid Aijian feature, SaaS, or distributed desktop integration.
- FFmpeg distribution posture: current `third_party/provenance.yml` records the Gyan GPL build as development-only; release packaging still needs legal review for codecs and build flags.
- Any future use of ComfyUI workflows, custom nodes, model weights, or generated assets, because the HTTP boundary does not solve model/data/license rights by itself.

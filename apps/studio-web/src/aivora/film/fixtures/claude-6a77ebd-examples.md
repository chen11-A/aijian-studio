# 4A-B08 design example compatibility evidence

Source commit: `6a77ebddc74af492baaf1bec19288706980e81f4`.
Source roles: `packages/aivora-prompts/roles/*.json`; actual rule script: `packages/aivora-prompts/scripts/rules.mjs`.
The JSON fixture preserves the complete input/output examples, with their original role path and Git blob ID. All 24 values were compared against `git show` after extraction. These are Claude design fixtures, not real Grok responses.

| Example       | Verified scope                                                             | Limitation                                                                                       |
| ------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| writer-1      | Actual object and array replies parse identically                          | All input source paragraphs retained; not all optional fields projected                          |
| writer-2      | Actual object and array replies parse identically                          | All input source paragraphs retained; not all optional fields projected                          |
| writer-3      | Actual object and array replies parse identically                          | All input source paragraphs retained; not all optional fields projected                          |
| director-1    | Actual object and array replies parse identically                          | All scene dialogue retained; not all optional fields projected                                   |
| director-2    | Actual object and array replies parse identically                          | All scene dialogue retained; not all optional fields projected                                   |
| director-3    | Actual object and array replies parse identically                          | All scene dialogue retained; not all optional fields projected                                   |
| action-1      | Every node move retains its shot ID; every beat text survives mixed output | Typed action plans now retain injuries/props_after; declarations are not rendered-media evidence |
| action-2      | Every node move retains its shot ID; every beat text survives mixed output | Typed action plans now retain injuries/props_after; declarations are not rendered-media evidence |
| action-3      | Every node move retains its shot ID; every beat text survives mixed output | Typed action plans now retain injuries/props_after; declarations are not rendered-media evidence |
| performance-1 | All shot IDs/counts and face cues survive assignPerformance                | Not a guarantee all source fields are persisted                                                  |
| performance-2 | All shot IDs/counts and face cues survive assignPerformance                | Not a guarantee all source fields are persisted                                                  |
| performance-3 | All shot IDs/counts and face cues survive assignPerformance                | Not a guarantee all source fields are persisted                                                  |
| art-1         | artFromModel accepts original output                                       | Design metadata and declared asset/portrait plans persisted; declarations do not create media    |
| art-2         | artFromModel accepts original output                                       | Design metadata and declared asset/portrait plans persisted; declarations do not create media    |
| art-3         | artFromModel accepts original output                                       | Design metadata and declared asset/portrait plans persisted; declarations do not create media    |
| review-1      | qcFromModel accepts original output                                        | Structured text reports persisted; no visual provider validation or automatic choice             |
| review-2      | qcFromModel accepts original output                                        | Structured text reports persisted; no visual provider validation or automatic choice             |
| review-3      | qcFromModel accepts original output                                        | Structured text reports persisted; no visual provider validation or automatic choice             |
| sound-1       | Original fixture preserved                                                 | No sound role executor; not supported                                                            |
| sound-2       | Original fixture preserved                                                 | No sound role executor; not supported                                                            |
| sound-3       | Original fixture preserved                                                 | No sound role executor; not supported                                                            |
| continuity-1  | Original fixture preserved                                                 | No continuity role executor; not supported                                                       |
| continuity-2  | Original fixture preserved                                                 | No continuity role executor; not supported                                                       |
| continuity-3  | Original fixture preserved                                                 | No continuity role executor; not supported                                                       |

Targeted tests: agent-reply-compat.test.ts, phase2.test.ts, voice-action-regression.test.ts: 68 passed across five files after director/writer wiring; replay checks cover both envelopes and all input dialogue/source paragraphs.
No real Grok response collection was available or fabricated in this work; live membership validation remains unverified.

Implemented prompt rules (source: user development plan, not the Claude role file): every 3–4 shots insert a detail view, genre duration targets 1–2 / 3–5 / 3–4 seconds are now in director.md. No unrelated role prompt was changed. These targets must yield to dialogue duration and lossless coverage.

Array normalization is wired for action, writer and director; performance already accepts arrays. Actions never receive a position-based ID. Matching node_id allows an explicit summary to supplement the matching node, not replace its movement text; unlinked beats remain unassigned.

Art design persistence follow-up: all three original art outputs are compared directly field by field for style_status/preset/era/palette/lighting/lens/grain/contrast/texture/aspect/prompt_block_en/avoid/portraits, with declared identity/location/prop metadata retained separately from actual generated assets. Tests exercise manual and pipeline actions, JSON upgrade, saveFilm/readSaved/hydrate, fingerprint consistency, and transaction apply/undo/conflict. User-edited metadata is protected by its prior AI baseline. Declared English text is not automatically used; declared aspect does not change the project aspect ratio. The original outputs do not contain top-level asset_ids; support for that optional declaration is covered by an explicitly synthetic test. Costume-specific portrait execution and independent sound/continuity agents are not claimed.

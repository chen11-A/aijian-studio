# Manual director desktop checkpoint — 2026-10-08

This is a development checkpoint after public commit
`3c29e319d83d500d9dd8956745b7a8b5726358e4`, not a release approval.
The new local candidate uses database schema 40. Existing workspaces need a
verified backup before forward migration; this checkpoint does not promise a
schema downgrade or an installer upgrade/restore procedure.

## Usable original-UI flow

1. Create/open a real project and episode. Save an original production brief,
   or use the existing reviewed-source adaptation path.
2. Write and save an episode script, then explicitly confirm that exact version.
3. In the original storyboard page, open **导演提案**. Select a variable shot count
   and establish a **HUMAN** editable template. This is not an AI generation.
4. Edit intentions and exact scene/block references. Save a new proposal version.
5. Review and explicitly adopt it into a new storyboard version. Old proposal and
   storyboard versions are retained. The manual storyboard remains editable.
6. Close and reopen the application to read the saved versions.

The native Linux acceptance used a fresh synthetic workspace. It exercised a
seven-shot proposal, an edited second proposal version, explicit adoption,
cancelled navigation with unsaved changes, full application shutdown/reopen,
and a separate eleven-shot proposal/adoption. A later script edit was saved and
explicitly confirmed as version 2 while preserving scene/block identities.
The earlier eleven-shot proposal retained its original script/confirmation pins.

When the current script differs from a saved historical proposal, the history
view does not substitute the new script text. It shows the original authority
pins and stable scene/block IDs until matching historical text is available.
Current inputs for a **new** template are labeled separately.

## Boundaries and protections

- HUMAN provenance is explicit. AI generation remains unavailable in this slice;
  no external inference, image, voice, or media generation was performed.
- Original and adapted input authorities remain distinct. Adapted inputs retain
  existing acceptance and source-span requirements.
- Preparation verifies preserved raw content hashes before normalized typed
  equivalence. Missing legacy defaults do not require rewriting old artifacts.
- Save/adopt use canonical operation IDs, current-version checks, and durable
  receipts. An unknown result is reconciled by read-only original-operation
  queries, not automatic write replay. Missing status is not proof of no write.
- Proposal cardinality is 1–1000. V1 storyboard projection supports integer frame
  rates only; fractional rates and projection overflow block adoption explicitly.
- Intentions and referenced dialogue remain in the immutable proposal. Projection
  into a manual storyboard is not evidence that images, movement, or sound exist.
- Script/world/FPS/profile input handlers capture primitive values before deferred
  React state updates. Regression checks reproduce the old stale-value behavior
  and preserve the existing validation, confirmation, and UNKNOWN rules.
- A renderer boundary provides a bounded recovery message for descendant React
  render/lifecycle exceptions. It never retries writes or clears recovery records.
  Reload is explicit and may lose unsaved changes. This does not cover process,
  GPU, event-handler, or asynchronous failures.

## Acceptance limits

- Component, contract, local API, migration, and independent frozen-source checks
  are separate from actual native-window acceptance. Counts from overlapping
  commands must not be added as unique coverage.
- Native checks covered 1178×814 and 980×680. At the minimum size with the AI pane
  expanded, the director canvas is compact and uses internal scrolling; collapsing
  the pane gives more editing space. This is not a new workspace/theme design.
- One earlier native save click produced an unexplained blank window. Read-only
  reconciliation found no new saved script version. A later repaired-input flow
  saved/read back and confirmed version 2, but the prior graphics/input-provider
  incident's root cause was not proved.
- Windows run 12 passed for the **earlier public schema39 source**, including
  unsigned installation and external-tool DRAFT media checks. It does not validate
  this newer schema40 candidate. Installer downloads remain unavailable while
  artifact uploads are disabled.
- Whole-repository quality gates still have documented pre-existing failures.
  Focused acceptance is not a claim that every root check or coverage gate passes.
- Formal media redistribution, signing, standard-user Windows clean-machine
  acceptance, upgrade/restore, and live AI remain separate outstanding work.

# Exact DRAFT character choices in saved storyboards

Storyboard content 1.1.0 adds closed `character_bindings` to each shot in the
existing episode-storyboard artifact. Each binding selects a character already
present in that shot, an optional costume owned by that character, and unique
reference IDs owned by that character and compatible with the chosen costume.
Everything resolves against the storyboard's exact creative-library version.
There is no default newest version, second store, approval field or provider call.

Content 1.0.0 retains its original schema semantics, bytes and hashes. A user
choice upgrades the current draft to 1.1.0; every shot then carries an explicit
bindings array. Once saved, a new head cannot downgrade to 1.0.0. Empty bindings
are valid and mean no explicit costume/reference choice. Removing a character or
changing a costume asks before removing affected choices in the current draft;
historical artifacts remain unchanged.

Fresh saves resolve exact library membership and verify only selected reference
originals through the existing media-asset verifier. Wrong ownership, version,
hash, missing or changed files reject the append. Historical reads and original
idempotent replays retain their saved object without claiming current file
availability. Readback validates closed content, canonical hash, pinned membership
and dependency edges, including after a corrupt stored binding has a recomputed
hash. Existing CAS, native receipt validation and pending journal apply unchanged.
UNKNOWN input remains the original command and requires explicit reconciliation.

Both native storyboard editors use these objects. Library controls disable while
the exact pin is unresolved; callbacks reject changed project, episode or library
scope. Character usage reports display the exact saved costume/reference IDs and
library pin from each episode rather than resolving historical names from the
current shared library. Whole-episode pin upgrades include costume/reference
changes and ownership checks across all shots before the existing confirmation.

Human and official director adoption previously created a whole replacement V1
storyboard directly. They now preserve a V2 base schema with explicit empty
bindings, and reject replacement if the base contains any choices. Automatically
mapping choices onto new shot IDs would invent continuity; silently clearing them
would lose user intent. A user must explicitly handle and save those choices in
the storyboard first. Original proposals, source pins, adoption idempotency and
historical verification remain intact. No provider is called by adoption.

This is manual DRAFT selection, not G5 identity approval or a visual identity lock.
The current gate policy only implements G1/G2. Formal identity review, approved
reference consumption, downstream invalidation, generation upload consent and
Windows visual/player acceptance remain separate work. Existing assistant reader
platform gates, archive rules, DRAFT export limits and safety/CI gates are unchanged.

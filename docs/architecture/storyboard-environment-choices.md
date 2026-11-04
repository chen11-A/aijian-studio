# Exact manual storyboard environment choices

Storyboard schema 1.4 extends the existing immutable storyboard artifact. Each
shot requires a nullable location-state ID and unique environment-reference IDs,
while preserving character choices, planning intent and the exact creative-library
version. Old schemas, content hashes and stored JSON do not change. Only an
explicit environment edit promotes a draft; new shots in 1.4 get empty choices.

Resolution reads the pinned library, never its latest head. A state must belong to
the selected location. References can be world-wide, base-location or the selected
state; unrelated location/state references fail. New saves verify selected exact
owned originals, hashes and rights. Immutable history and original idempotent
replay remain readable after original loss. No new table or parallel asset truth
is introduced.

Both actual editors share controls, pending-write recovery and unsaved-navigation
protection. Lost or unknown originals stay visible with their exact identity;
new reference selection is closed until verified. State/location changes that
remove incompatible choices require explicit confirmation. Inspection never
replaces a historical asset version with the current head.

Fresh manual 1.4 assembly consumption verifies original references only for the
shots actually referenced by that exact assembly. Full-board membership and
immutable dependency checks remain. The same admission runs before DRAFT export
and native plan reads; history uses membership/integrity checks without fresh
original availability. G5 retains its existing complete approved-bundle checks.

The current G5 scope does not approve independent environment choices. A nonempty
environment binding cannot coexist with a visual pin; UI and closed native/API
contracts enforce this. Empty environment fields can preserve a 1.4 G5 chain.
Formal world/state approval, dynamic inspections and all-consumer invalidation
are separate remaining work. Manual DRAFT choice does not imply generated media,
native playback or acceptance.

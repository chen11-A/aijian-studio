# Character usage in saved storyboards

P08 requires episode usage and the shots affected by shared character changes.
This batch reads the existing project episode list and each episode's saved
storyboard through the existing scoped transport. The backend's exact library
membership/dependency readback remains authoritative. No new store or write
endpoint is introduced.

The role editor lists exact episode, storyboard version, pinned library version,
stable shot IDs and timing for each use of the selected character. Shared edits
identify these as shots requiring review if a new library version is adopted;
they do not rewrite or automatically invalidate the old pinned storyboard.
Unknown/failed reads remain incomplete evidence, never zero usage. A missing
saved storyboard is explicitly different from an unreadable one.

Reads use up to four concurrent local requests, preserve project/episode scope,
and discard results after scope/list changes or unmount. Changing a selected
character filters already-read objects; it does not perform a write or rescan
the backend. Refresh only rereads saved storyboards and preserves editor inputs.
Normal and professional mode use the same native container.

The scope is current saved storyboard usage, not a complete invalidation ledger:
unsaved storyboard edits, explicit episode costume selections, generated-media
task dependencies, assembly and formal identity approvals still need their
respective contracts and consumption checks. Do not call this the completed
automatic impact/invalidation chain.

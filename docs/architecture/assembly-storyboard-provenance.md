# Version-bound storyboard references in local assembly

A visual segment may explicitly name one immutable manual storyboard version and
one stable shot ID in that version. This links the selected imported media version
to the author's intended shot. It does not claim AI generation, coverage completion,
creative approval, matching duration, rights clearance, or final delivery.

The optional `storyboard_ref` object contains `storyboard_version_id` and `shot_id`.
It is omitted for unlinked segments, including all legacy saved assemblies, so
canonical content and hashes remain unchanged. Assembly schema 1.0.0 and the existing artifact/dependency tables remain in use.
This increment needs no database migration. No existing version is rewritten.

Reads and writes verify the exact storyboard's episode/project, immutable content
hash, its upstream reference integrity, and shot membership. Assembly versions
record deduplicated `references` / `advisory` artifact dependencies for those
exact storyboard versions. Reads verify that these match the segment links.

New storyboards never rebind old assemblies. The original interface shows saved
shot choices, selected-source identity, read failures, changed or deleted latest
shots, and timebase/duration differences. Linking or explicitly replacing a link
is an unsaved assembly edit, participates in undo/redo, and only persists through
normal CAS save/readback. Split/trim/reorder preserve the source reference. A
missing or unreadable latest storyboard cannot clear an older reference.

Upstream script/library upgrades keep existing references. A proposed upgrade
that lacks referenced IDs stays blocked and leaves the exact old version pin
intact. Individual reference edits are deliberate; a bulk clear is not an upgrade.

Verification is targeted backend, native contract and React component testing.
Actual native UI, professional creative review and Windows acceptance are separate
checks; no provider request or media generation is part of this increment.

## Focused verification

- 7 provenance tests cover legacy hash compatibility, exact source membership and
  foreign scope, corrupted records, historical-version reopen, authenticated HTTP
  readback and an actual linked-assembly DRAFT MP4 after the latest storyboard
  removes the referenced shot. Its durable export provenance retains the exact
  old shot/version and pending rights state. Existing draft-runtime tests: 10 pass.
- Native strict assembly-contract/client tests: 13 pass. Renderer assembly-source,
  save/undo/readback, upstream pin and storyboard-panel tests: 44 pass.
- Desktop and renderer no-emit TypeScript checks pass. New provenance module passes
  focused strict mypy; new modules/tests pass scoped ESLint/Ruff and formatting.
- Existing assembly-contract mypy diagnostics and old assembly-store line-length
  findings are not hidden or represented as a repository-wide green check.
- Native original-interface acceptance is coordinated separately with the main
  workbench task; this source checkpoint does not claim Windows or native UI QA.

## Native follow-through

At 07:02 UTC the cloud Linux Electron original interface saved and reopened two
real clip-to-shot references, upgraded a storyboard's script pin while retaining
its scene and creative-library references, then displayed the saved old assembly
links with an upstream-change warning after the newer storyboard was saved.
See the native-workbench checkpoint for precise scope. This extends the source
checks with native local editing evidence; Windows and formal review remain open.

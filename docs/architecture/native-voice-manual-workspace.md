# Native voice page using the existing episode assembly

The production voice route mounts an audio-focused view of the existing
EpisodeMediaAssemblyPanel with the current project/episode key. It reads and
saves the same immutable assembly, asset versions and exact saved script blocks
as the assembly page. There is no parallel voice database, synthetic dialogue,
default recording or generated audio result. The fixture route remains separate.

The audio-focused view lists only eligible imported audio versions and audio
segments. It can add BGM/SFX, explicitly bind a segment to a saved dialogue block,
edit integer sequence frames/source samples, split with a verified WAV sample
rate, undo/redo and save another assembly version. Existing video, storyboard and
subtitle references remain part of the shared content; this view does not edit
their controls. A saved visual range is required by the existing assembly
contract before audio can be placed. It does not create a blank picture or alter
that contract to support an independent audio-only master.

Existing CAS, bad-receipt rejection, pending journal, scoped read epochs,
navigation/close guards and UNKNOWN read-only reconciliation are reused.
Unapplied trim fields now contribute to pending input, disable save/segment
replacement, and enable the same departure/close protection. Applying valid trim
or explicitly discarding the fields clears this pending input. Invalid trim
retains it. This protection also applies in the assembly page.

Original playback is keyed by project, media identity, version/hash, MIME, kind,
size, availability and rights status. Scope changes discard old async replies and
release owned URLs; decode failure releases the current URL immediately. The
existing bounded native byte reader, 32 MiB embedded preview limit and rights
restrictions remain intact. Playback uses the complete selected original, with
no claim that sequence trims, mix, dialogue content or lip sync have been applied.

This closes a manual local-recording workflow in P18. Voice models, voice rights
and cloning consent, generation tasks/budgets, alignment, readthrough approval,
MixMaster and native Windows playback still require their separate full product
implementation and acceptance. No provider call, encoding, publication, charge
or credential handling is added by opening, binding or saving this page.

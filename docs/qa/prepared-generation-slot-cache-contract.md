# Issued per-slot cache preparation contract

This is an unpublished neutral contract checkpoint. API-54 cache execution and
native sink wiring remain separate work in progress, not enabled by this type.

Every PREPARED target now has `slotPreparations`, an ordered array with exactly one
`{videoSlotId, preparation}` for each `videoSlotIds` element. Native issues the
facts from the original dispatch/regenerate behavior and verified full-input cache.
The renderer must reject missing, duplicate, foreign or reordered entries instead
of inferring behavior from a slot index. The existing target summary is CACHE only
when every slot is CACHE; otherwise it is CLIENT_IMAGES. It does not authorize
skipping all versions.

For a mixed batch, a verified cache-only first slot may coexist with new-version
slots that need client images. The native image-stage dependency set contains only
actual client-image consumers. The persistent before-image reservation must skip
cache-only slots and attach to the first truly dependent new slot, never charge the
cached first slot. Global scene preparation can still happen before the queue for
the later confirmed slots; it neither expands generation count nor creates an
extra image for a cached slot.

STORYFILM_CACHE means the actual original dispatch would reuse the complete cache,
including its regenerate choice, full effective recipe, and all three readable raw
image/video/voice SHA identities. Neither a matching old filename nor the presence
of one part is this fact. A missing/changed cache at the final API step stops the
operation before any new POST; it cannot silently fall back to image/TTS/video.
Cached output never by itself clears another unresolved provider attempt.

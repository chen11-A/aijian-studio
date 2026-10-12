# Exact real asset references in the creative library

P09 requires real reference assets rather than text-only or fabricated images.
The project media-asset store is the existing source of original bytes, asset
versions, hashes, rights and provenance. Reference content 1.2.0 extends the same
creative-library artifact with stable ordered reference IDs, character ownership,
optional costume ownership, exact asset/version IDs, stored byte hash and a
user-editable label. It does not create another asset store or an approval.

The new schema must preserve 1.0.0/1.1.0 historical content/hash and idempotent
readback; schema downgrade is rejected. References must resolve to a character
and its optional costume inside that same library version. Saving verifies the
asset's project membership, exact version, visual kind, byte hash and fresh file
availability through the existing managed original reader, before appending the
artifact/receipt. Wrong project/version/hash and missing/changed files reject the
save. An idempotent historical replay still returns its original saved object.

Historical library reads keep reference identities even if a file later becomes
unavailable. Rendering/consuming an asset must independently verify current bytes;
historical references are not a declaration of current file availability, decoded
media validity, rights clearance, identity lock or external upload consent. The
existing asset deletion scan protects asset IDs/hashes referenced by historical
artifact versions. No Linux ABA candidate or new archive exception is adopted.

Saving uses `MediaAssetStore.get_asset(verify=True)` from the existing manual
write domain. The separate Windows-only assistant selected-version reader and
its platform/security gates are unchanged. This is not an assistant read proof
and cannot authorize a provider upload. Full original-byte verification can take
time for large local assets; it is not a background generation job.

The native editor selects registered asset versions explicitly and saves them
through the same draft/journal/CAS flow. Asset data/preview reads stay at existing
native IPC boundaries; there is no provider, upload, generation, charge or automatic
UNKNOWN retry. Local-import registry provenance remains accurately described as
local import. Formal generated provenance and approved visual identity still need
their separate contracts and real Windows/model acceptance.

Preview ownership includes project, asset, version, hash, media kind, MIME and byte
size. Scope changes unmount the old reader, invalidate pending replies and revoke
its URL. An explicit reread clears previous bytes before awaiting the result;
unknown, missing, changed, mismatched or undecodable bytes never retain the old
display as a current preview. Same-project episode changes preserve shared draft
inputs; saved storyboards retain their exact pinned library versions. Preview
tests use controlled transport replies, not real browser/player acceptance.

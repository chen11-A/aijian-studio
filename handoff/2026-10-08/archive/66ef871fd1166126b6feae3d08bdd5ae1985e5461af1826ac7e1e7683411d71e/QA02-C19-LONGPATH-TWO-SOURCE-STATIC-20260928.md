# QA02 c19 schema26 two-source long-path read-only review

Status: `PASS_STATIC_COMPATIBILITY_RUNTIME_NOT_RUN`. No c19 file was written;
the r02 one-shot run and its evidence were not resumed.

## Frozen comparison

- c19 HEAD `211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2`.
- Current c19 `repository.py` schema26 SHA
  `BB366B214157007E2CB906EEADDC895E1ED60AE95DC97D86BEE686F137710E69`;
  existing `media_asset_routes.py` SHA
  `931D14F8B3D3069ED89E224C6BF4EBF2EE4CA9CA34DAFC9A6415CD2E1B3B8770`.
- Current store SHA
  `E2B2002D157DEBA5F2E03F5340AD83BE9B09BE4F5D77E1ACF614D3617A60AF8D`.
  Candidate helper SHA
  `78FCCE4F28FF720F6610AB72EEC2C5C5AB179E7BEB758B980610303B7CA9D7AC`;
  candidate store SHA
  `2954042D87754211526891A5CC3506DD55DCA78CBB349FC44D19D54FDDC105B8`.
- QA01's final independent static review SHA
  `CAD331743083818AC808BE674D99430D74066C3FB7F85E57DCA92A380B937113`;
  independent preflight readback SHA
  `558390B3525EDD57696C7D8AA2E4BF7BB9C6041A62F91B4F4D5D31E2BFC14677`.

## Compatibility observations

Read-only AST comparison found all nine `MediaAssetStore` method signatures
unchanged; 22/22 SQL literals unchanged and ordered the same. The entire AST
for `get_asset`, `list_assets`, `add_episode_reference`,
`remove_episode_reference`, `soft_delete`, and `_contains_identity` is
unchanged. The store's internal `_ensure_directory` and `_availability`
signatures change to accept a workspace root, as required by the new path
adapter; these are not public route calls.

The existing route still accepts HTTP bytes and uses
`MediaAssetStore.import_local` for new assets and versions, `list_assets`
and `get_asset` for readback, `read_verified_preview` for content, and
`soft_delete` for deletion. The candidate store wraps managed staging and
blob creation, hard link, stat, open, verification, and cleanup in the
helper's extended Windows I/O spelling. It keeps logical asset/ASV IDs,
SHA, DB values, and public route paths unchanged. `soft_delete` only marks
the DB row; it does not delete the long blob path.

The helper is standard-library only. It rejects non-absolute, traversal,
outside-root, UNC/nonlocal, ambiguous-component, and reparse-point paths
before returning an I/O path. Its lstat/check followed by I/O is not
atomic; the new isolated helper-negative gate does not prove safety against
a concurrent junction swap.

## Runtime gates

The r02 first RED remains the evidence boundary: actual sidecar HTTP WebM
import returned 500 when old store `os.link` raised `WinError 3` at a
265-character blob target. The new helper/store have not yet been synced
to c19 or exercised through its schema26 route. No claim of HTTP 201,
content GET, reopen, or decoder playback follows from this review.

Two separate new one-shot drafts are ready for post-sync freezing:

1. r03 uses fresh 265- and 266-character blob paths, helper dangerous-path
   rejection, actual HTTP import/content SHA and normal reopen. No browser.
2. r04 uses a fresh short profile, fixes the r02 database table-name bug,
   selftests the inspector against the closed r02 QA DB, and then exercises
   HTTP persistence plus actual headless Edge media events.

MGR04 must supply its protected two-source c19 POSTFLIGHT path/SHA before
either package can be frozen. MGR02 signs each package separately; neither
draft has run.

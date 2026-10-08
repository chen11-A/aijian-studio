# Run04 SHA equality audit

The run03 harness stopped after four successful imports because it compared
uppercase `sha256(blob_io)` text with lowercase `AssetVersion.sha256` text.
Run04 adds `canonical_digest(value) = value.upper()` and uses it on **both
sides** of the managed blob and WAV inspection comparisons. The pure AST
self-check in `digest-case-selfcheck.py` finds both comparison expressions,
checks upper/lower equivalence, and rejects a different digest without
importing product modules or creating a profile. `SELF-CHECK.json` retains
its result.

The other SHA equalities were scanned in both run04 scripts:

- `sha256(path)` and wrapper `digest(path)` return uppercase. Closure manifest
  SHA, seed SHA, input manifest SHA, required module SHA, and all five
  envelope fixture SHA values are uppercase 64-character hex. All 47 frozen
  closure entries and all five input-manifest entries are uppercase.
- The input-manifest-to-envelope comparison uppercases the manifest value;
  `version.sha256.upper()` normalizes the product's stored digest before
  comparing it with the uppercase envelope value.
- Copied source, seed, marker, package, and signed approval comparisons use
  hashes produced by the same uppercase helper or the pinned uppercase
  envelope/approval values. No other product-returned lowercase SHA is
  compared directly with an uppercase QA hash.

The run04 profile and invocation paths are new and absent. Four constructed
managed blob paths remain 266 characters; staging remains 240. The envelope
is `MGR02_APPROVED_STAGE_A_RUN04_ONCE`; the template remains
`NOT_APPROVED_TEMPLATE` with `seed_process_zero_observed=false`. No product
call has been made. The run03 approval was consumed and cannot authorize
run04. Source closure-3, QA01 seed, and five fixtures are unchanged.

The symlink negative case records `NOT_TESTED_SYMLINK_SETUP_FAILED` if this
host cannot create the QA-owned link. That result is untested, never a PASS.
The helper's ancestor check and later I/O remain separate operations; this
package does not test a junction-swap race.

# Runtime baseline reconstruction (2026-10-08)

This local repair independently implements the missing persistence contracts from
available application code, schemas and tests. It does not recover protected
versions, authorize production database migration, or establish desktop release
acceptance.

## Migration decisions

Keep the existing forward-only migration history through version 21. Register the
available candidates in dependency order: 22 provider kinds, 23 Sub2API consent,
24 episode artifacts, 25 preferences, 26 media assets, 27 rights, 28 exports,
29 episode script confirmations, 30 probe evidence, 31 credential references and
engineering export records, 32 project settings, 33 provider origin modes.
The two independently supplied candidates both labeled 31 create disjoint objects;
this reconstructed baseline runs both in one transaction. Historical candidate
schema-31/32/33 databases are not assumed compatible with this implementation.

Each version is atomic. Rebuild migrations disable foreign keys before beginning
an immediate transaction, check all foreign keys before commit, and restore
foreign-key enforcement after success or rollback. Existing projects, artifacts,
provider identities and credentials are preserved; legacy providers start PUBLIC.
LOCAL is an explicit opt-in restricted to literal loopback HTTP origins with an
explicit port. No credentials or paid external requests are needed for testing.

## Persistence contracts

Provider edits use exact revisions and compare-and-swap. Credential rotation uses
an immutable operation identifier and versioned vault reference, with durable
PREPARED/APPLIED/CONFLICT/UNKNOWN outcomes. A stale connection revision must reject
previously approved Sub2API dispatch at the actual consumption boundary.

Episode-scoped artifact reads and writes constrain project, episode and type.
Omitted episode scope means project scope, never an arbitrary episode. Migration
preserves legacy project artifacts with NULL episode_id.

## Verification

Use temporary databases. Exercise forward migration, failure rollback and retry,
CAS and stale approvals, API project creation/reopen, generated contracts and
available quality gates. Report unrelated existing gate failures separately; do
not lower coverage thresholds, suppress failures, or use fake media as product
acceptance. Windows Electron, real gateway/media and installer acceptance remain
separate checks.

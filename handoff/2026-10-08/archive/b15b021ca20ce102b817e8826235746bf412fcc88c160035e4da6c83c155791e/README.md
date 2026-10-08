# QA02 Stage-A four-media registration package

Status: `READY_FOR_MGR02_EXTERNAL_APPROVAL_DO_NOT_RUN`. This package has not imported media,
opened the copied database, run a resolver, started a sidecar, or invoked MLT.

## Frozen source and execution gate

The protected repo30 `SOURCE-CLOSURE.json` (SHA-256
`3D996986C7ED080B7994EF91ED17674E3E864C12F5402974AA1F6E90477605AE`)
contains the version-30 repository and its 23 local dependencies. MGR04 added
the exact store and reader transitive imports in one 39-file protected closure:
`20260928-stage-a-asset-import-repo30-closure-1/FILES.json`, SHA-256
`760C75E94B8C8689E2909377001A36F43D5F33983EC4B9D2A9F9B1DC15A5C041`.
The first closure directory was invalid: 38 of 39 file hashes differed from
`FILES.json` and its `repository.py` began with binary `E-SafeNet`/`LOCK`
data. It remains preserved as failure evidence. MGR04 created a separate v2
directory; QA02 independently recomputed all 39 hashes there and found 39/39
matches to the same `FILES.json` SHA. `RECOVERY.json` SHA-256 is
`1C66F7537967E84BA4D17A149AD788F76D71EEFE57E99995A51E72A3A30C5BD4`.
This is still a static source check, not an import or QA result. The envelope
contains the runner-required status string `MGR02_APPROVED_STAGE_A_ONCE` at
MGR02's direction so its final hash can be reviewed. This string alone is not
an approval: no external approval JSON exists, and the wrapper refuses to run
without its exact separately approved hash. MGR02 must authorize one invocation
against the final script, envelope, v2 closure, and fresh profile.

Requested call chain: copied QA01 schema-26 database → frozen repository
migration to 30 → `MediaAssetStore.import_local` for four frozen video/WAV files
→ `get_asset(verify=True)` → checkpoint →
`read_selected_media_asset_version` and `read_latest_rights_decision`. The
SRT stays a manifest input. The resolver, video probe, rights decision writer,
provider, and MLT execution are outside Stage-A.

## Fixed inputs and output

- QA01 seed DB: 864256 bytes, SHA-256
  `54533ABEEAC1E45DB3D643303967EFDCF9379024405853DF1B240838B80F90CC`;
  original WAL observed at zero bytes. The original DB, WAL, and SHM are read
  only; a pre-run owner/process check is still required.
- Five-input manifest: SHA-256
  `EE2166D379C1000D65138C12023209A9D535AEE17D707C04BB907B7823FB04E3`.
  The envelope independently pins all five file sizes and hashes.
- One fresh QA02 profile: `profile-01` immediately below this directory.
  It must not exist before the approved invocation. A failed run preserves its
  receipt, copied database, managed bytes, and isolated negative-case clones.

The script requires the MGR04 closure manifest with
`{"files":[{"name":"aijian_api/module.py","sha256":"..."}]}`. It checks
every `.py` file in the closure and the required module hashes in the envelope,
then copies those bytes into the fresh profile using Windows `CopyFileW`,
checking every copied hash before touching the database. All loaded
`aijian_api` module paths must resolve inside `profile-01/source/aijian_api`;
source and copied hashes are checked again at the end. It refuses a missing or
changed module, changed input, nonzero seed WAL/journal, reused profile, or
unapproved envelope hash before creating the profile. It never copies live
author files.

After an approved run, the receipt must show four actual `asset_*`/`asv_*`
identities with pending rights, persisted verified bytes, and `NO_DECISION`
from the rights reader. A same-size byte change in a clone must return
`CORRUPT`. A pre-read mtime-only change is recorded separately: the current
reader compares mtime during each read but does not persist the import mtime,
so `VERIFIED` there would **not** prove mtime invalidation. Only a concurrent
change during the read can yield `UNKNOWN_MEDIA_CHANGED` under the current
reader contract. No positive `CLEARED` decision, `ard_*`, or `mpe_*` is made up.

MGR02 must review the completed closure, script hash, envelope hash, profile
path, source-process state, and single invocation before execution.

`approval-template.json` is **not an approval**. For a signed invocation,
MGR02 must review the final envelope SHA, then issue a separate approval JSON with
status `MGR02_APPROVED_STAGE_A_ONCE`, a recorded process-zero observation, the
final wrapper/script/envelope/interpreter/source hashes, the same fresh
`profile-01`, fixed `invocation-01`, and bounded timeout. Pass that approval
file and its exact SHA to `invoke-stage-a-once.py` via `--approval` and
`--approved-approval-sha256`. The wrapper independently verifies 39/39 frozen
source hashes before launching the one Python child. It saves binary stdout,
stderr, PID, exit code, timeout state, and a receipt. On timeout it addresses
only its own child PID and descendants with Windows `taskkill /T /F`, keeps the
cleanup output, and records `UNKNOWN`; it never retries. A wrapper exit zero
still requires review of the Stage-A receipt. A local Stage-A result remains
separate from Stage-B rights, probe, binding, MLT runtime, and product
acceptance.

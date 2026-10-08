# MGR01 exact scope review: schema33 repository and LOCAL policy successor

State: `READY_FOR_MGR01_SCOPE_REVIEW_NO_GRANT_NO_RUN`. This is a new call. The first repository-policy call remains terminal RED and consumed; no case completed, so policy behavior is UNKNOWN. Do not reuse or retry that call.

## Fixed identity

- Scope `ORIGIN_MODE_33_REPOSITORY_LOCAL_POLICY_ONLY`; call ID `QA01-ORIGIN33-REPO-POLICY-20261008-02`.
- `PACKET.json` SHA256 `D38098F7A0C4C441DA4309879F78FF1E38B7D376C785E3E013850BA4D440FD8D`.
- `repository_policy_once.py` SHA256 `0A0546A9FC2E8C77DFA57729083B8557173CCAC3A27E51AB106A277624A9DE2D`; `launch_repository_policy_once.ps1` SHA256 `3B1E0EB51233A59ED18D263B3C7063A9562294F22BD4760265337E4AA40FC379`.
- `STATIC-REVIEW.json` SHA256 `4C416737A293820097ADAA385E4BB154C2F66C398851FA3C2C185491293A3EC3`: 156/156 source/copy files and 157/157 dependencies rehashed, runner AST and PowerShell parse pass, seed schema33/integrity/FK pass. No product import or policy case was run.
- QA physical manifest SHA256 `EABE9BDB7C703003A4D8FC5C2D3B482D3D5E4FA6C850CFF399889A64507CAB31`; v4 composition SHA256 `D9985C46A2942DD606D2583141787010EEF7435E697922AD97C6ABB93ECB90E1`; seed main SHA256 `EDD7F4D30BA06C585F86A35D30A6B01221B2FFCE613F13957DE33DE9D0CF3A9F`. The packet pins all paths, hashes, the fixed Python `-I -B -S` and PowerShell readers, dependencies, ten case IDs and prior accepted SQL freeze.
- First call's `RED-REVIEW.json` SHA256 `01F5512AF1B85B030EA9B7A3F7BFE4E0F24BB9FD75CD7D6CB7FB8EAED2EA2825`, `RED-BOUNDARY.md` SHA256 `1C21D7A1DDF0674C99F059282677161D41FF0A7467F42857B7FD914C2B2B7EB6`. `RECOVERY-PLAN.md` SHA256 `17A907D0FBBED9E073C03CB15B322AE7B7715F5474C5AD0AFCD2D00DC5E63128` explains the correction. Pure SQLite WAL lifecycle SHA256 `AB44D708988BC9513C715C2DA2870EDB14CDC2745314ADB22F744B5F14A54797`; copied-fixture snapshot helper probe SHA256 `247B9C7170C9E7BC8F92BD28015D24C3279F75E2E15E5CBF644722859DA69300` pins the current runner. These probes did not import product code or execute cases.

## One-shot behavior and readback

After MGR01 reviews this exact package, MGR02 may independently issue one new `GRANT.json` matching packet, runner, launcher, scope and call ID. QA01 invokes the fixed launcher once. It claims `ATTEMPT-USED.json` with `CreateNew` before preflight, stores raw stdout/stderr, child PID, exit and timeout, and stops terminal RED on uncertainty or failure.

Ten copied DBs cover three successful operations and seven expected rejections: LOCAL omitted mode rejects before CAS for local or public submitted URLs; explicit LOCAL metadata and LOCAL to PUBLIC with matching revision each commit once; stale revision and invalid mode/URL reject without commit; PUBLIC omitted mode remains compatible. The old LOCAL approval's pure binding must mismatch after an explicit switch. The runner verifies request model, service, repository CAS, exact provider/revision/credential-reference readback, protected tables, schema33, integrity and foreign keys. A fake Vault permits only `get=None`; all network connection attempts are blocked. No provider or key is used.

The first RED arose because the old QA snapshot helper demanded absent WAL while the product repository still held an open SQLite connection. The new helper reads committed live state using WAL-aware `mode=ro`, explicitly closes tracked product handles, and reads the same DB using `mode=ro&immutable=1`. It requires equal full logical dumps, schema, provider and protected rows; only the post-close snapshot requires absent WAL/SHM. It does this after LOCAL setup and after the policy action, then checks a separately reopened repository and immutable DB. A mismatch is terminal RED without retry.

## Acceptance boundary

This is isolated backend repository/service, request-model and pure approval-binding evidence. It is not actual API atomic approval consumption, real Vault/provider, network, generated contract, desktop/Web, IPC, Electron, c19 or product acceptance. QA03 owns the separate P/API atomic old-approval consume rejection with authoritative before/after and same-profile reopen. A pure policy mismatch must not be reported as consume proof.

MGR01 should review this byte identity and scope. MGR02 should sign a new one-shot call only after independent review and inspect all closed DBs and raw launch evidence before postrun acceptance. At this request's creation, `GRANT.json`, `ATTEMPT-USED.json`, `run-01`, `launch-01` and `profile-01` do not exist.

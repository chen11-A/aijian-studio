# core153 consumer import packet review

State: READY_FOR_MGR02_IMPORT_GRANT_REVIEW. No import has been run.

## Copy and identity

- The one-shot QA03 dependency copy ended with outer exit 0 and `PASS_QA_DEPENDENCY_COPY_READBACK_ONLY`. Copy receipt SHA256: `06F94B6B635C38B864B339AB3FA934BA7F7D07071EEE5C84902BF93975A5EB22`.
- Fixed CPython 3.12.13 `-I -B` readback of the five selected distributions: 157/157 source candidate files and 157/157 QA target files match bytes and SHA256; 7,767,087 bytes. The QA target has no extra files, `.pth`, or `.pyc`. The source before/after and target after/final raw logs each cover 157 candidate paths. Copy progress is exactly 1..157. Copy PID 15952 is gone.
- The first read-only postflight used an invalid whole-source inventory assertion. Its exact failure is preserved in `POSTFLIGHT-FIRST-FAILURE.txt`. The corrected postflight is `COPY-POSTFLIGHT.json`, SHA256 `7D4B1CDEB903373DBCD09EF460C87369A591C746DDA6085E4E490869ED92E6FC`.
- PowerShell and fixed Python disagree on 108 target `.py` file hashes while agreeing on lengths and the other 49 files. The PowerShell crossreader is retained, SHA256 `E764D060601F7F1EEFC940ECB7531B23EB309ABF056F80591760606F56F00AB6`; the fixed Python crossreader SHA256 is `F351CE7C645275E89C76EDCB1EE35229146032B4C130A9EF4B5D7C52023B1F21`. The cause of this view difference remains unproven. Import approval must pin the fixed Python consumer view and must not substitute a PowerShell raw hash.

## Import scope and boundary

- `PACKET.json` SHA256 `953F40DBA8C9B9314513844C35C353B63A7115DF40853309629B6B56ADB668E5` is the executable packet read by `run_once.py`. It binds the 153-file QA physical package, nine selected modules, 56-module static closure, five distributions/157 files, copy receipt, fixed Python executable, and exact import `sys.path`. No QA03 source directory or product checkout is in that path.
- The selected imports are `workspace_owner_lock`, `managed_local_paths`, `media_asset_selected_reader`, `media_asset_store`, `media_asset_probe_store`, `episode_media_assembly_store`, `product_export_output_verify`, `product_export_claim`, and `product_export_runtime`, all under `aijian_api`.
- `MODULE-STATIC-AUDIT.json` and `DEPENDENCY-TOPLEVEL-AUDIT.json` found no direct top-level effect calls under their bounded AST rules. They do not prove absence of all effects. `pydantic_core/_pydantic_core.cp312-win_amd64.pyd` is compiled and opaque to that audit; runtime ABI/loading remains unverified until the signed import.
- The runner was AST parsed, not executed. At import time it installs an audit hook to reject selected write, process, network, SQLite, registry, and unexpected import events; verifies imported `__file__` paths and hashes; and checks 153 product files and 157 dependency files before and after. The audit hook is a bounded observation, not a complete sandbox or product acceptance. Evidence writes are limited to the QA-owned `run-01` directory outside import phase; first RED stops without retry.
- The runner's fixed Python consumer SHA256 is `17D8F9FE1817A1362700576BD8DF938CCFCC3413E03F8C554A3DB61BB22BB5B2`. PowerShell reads a different raw SHA256, `C2BAD233790017410BE0EC90A8154C36DD3E3A14E54E875C2CE7961A7FC12B16`. A future grant must approve the fixed Python consumer hash, with this difference disclosed.

## Pending

`GRANT.json` and `run-01` are absent. The copy approval authorizes only the dependency copy. MGR02 must separately sign the one-shot import scope, compiled-extension boundary, allowed write policy, `PACKET.json` SHA256, runner fixed Python SHA256, dependency candidate SHA256, and copy receipt SHA256. Import success would establish only bounded import identity, not product/runtime acceptance.
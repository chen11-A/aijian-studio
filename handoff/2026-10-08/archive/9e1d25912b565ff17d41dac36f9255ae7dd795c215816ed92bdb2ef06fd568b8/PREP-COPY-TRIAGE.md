# Static copy preparation failure and resolution

First `prepare_physical.py` invocation stopped before creating `qa-physical-package` or `PHYSICAL-MANIFEST.json` at `assert set(overlays).issubset(expected)`. The fixed-reader set comparison showed one v4 backend source absent from the 155-file prior QA base: `aijian_api/sub2api_connection_readiness.py`. This is a newly selected DEV05 file, not an E-SafeNet hash drift.

The preparation script now asserts that this exact one file is the only new target, copies the union of old targets and v4 backend selections, and verifies every source and destination byte hash. The second static-copy invocation produced 156 physical files, 16 v4 backend inputs and one new file; `PHYSICAL-MANIFEST.json` SHA256 `B330183106A3F2659F9AFCC17F204A8368132EB3FDE21D5FFE07D19460CA63B7`. No product import, test runner, grant or runtime execution occurred during either preparation attempt.

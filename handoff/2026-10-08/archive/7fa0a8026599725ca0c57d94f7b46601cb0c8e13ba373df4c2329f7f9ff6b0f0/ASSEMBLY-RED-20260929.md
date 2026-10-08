# QA02 74-file staging stopped before copy

The PRE check passed for all 74 source files (56,540,415 bytes) and wrote `PRE.json`. The staging target `C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\native-source-qa-20260924\qa02-packaged-staging-20260929` was still absent.

The single `--assemble` invocation repeated source, path, size, hash, version, c19 state, and destination checks, then stopped at `assert.deepEqual(inventory.rows, frozenPre.rows)` **before `stageFiles`**. JSON serialization omitted the `version` property when it was `undefined` for ordinary file rows; the fresh in-memory inventory retained that property. The resulting `AssertionError: source/destination inventory drift after PRE` is a QA control-script comparison defect. It is not evidence of source drift or an E-SafeNet mismatch. No file was copied and the staging target remains absent. The original script, PRE, console, raw log, and RED record are retained unchanged; no retry was made.

Evidence SHA256: `stage-74.mjs` `5B83D82848E2D3D97E68E59A50AE1FA580405C30487D052C66F1F5074A9CE0D7`; `PRE.json` `2B6D05B6477F47B64AB3CB79F36D1FB08A47831AFB460F266FC68EF10B4587AC`; `assembly-console.log` `F9FF184D1B5A91B32CFCE34FEF0469092EDF06892E8ADB1EBCCD2EFAEB5E1CF6`; `raw.log` `921B5C3916FA68CCD88CF1B2332613AE5166EEAA31AE5641A9E4CB69ACDD47D8`; `RED.json` `66F1D945E04875AA409929520A923ED5696411DF3C1D83E1D198DC785243A88D`.

After stop, c19 remains at HEAD `211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2`, 114 status lines, raw UTF-8 status SHA256 `FE92C6E787E71888226D3E3B9E5AE12833080C40194BA2C2A236BF6F7F258AEB`. A corrected control script should represent absent version metadata consistently and use a fresh QA control/staging pair; this attempt will not be rerun.

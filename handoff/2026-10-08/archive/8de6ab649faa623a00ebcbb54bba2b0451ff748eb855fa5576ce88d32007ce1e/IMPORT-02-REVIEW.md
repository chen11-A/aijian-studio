# CORE153 import v2: QA-only narrow ctypes initialization proposal

State: READY_FOR_MGR02_REVIEW_NOT_APPROVED_NOT_EXECUTED.

## Why v2 exists

The original import run-01 stopped RED in phase IMPORT, before an import receipt or post-readback. Its RED SHA256 is `112B9253787049448646040A152BB4969F0CEB81DB664B34FD867A1C0E1E066D`. It records event name `ctypes.dlopen` but does not record event arguments. Product import path reaches fixed `product_export_windows_job.py` SHA256 `11A5762844F0C79471DFB46719E00ACC0D951A71FAC4E11F9C58202A2DBACFA2` line 10 through runtime -> service -> encoder. DEV08's read-only source review confirms top-level imports, constants and ctypes.Structure definitions; Job/process launch is in later calls. The module header saying it is not connected to encoder is stale.

The fixed CPython 3.12.13 stdlib `Lib/ctypes/__init__.py` SHA256 `E0DB1242E78267CBA0124EE9FE5963B72D1C8A1832BB51A88ABCF012A9CBCE76` uses `windll.kernel32.GetLastError` at line 479; the load path passes lines 450 and 379. A separate stdlib-only audit probe observed one `ctypes.dlopen` event with args `('kernel32',)` and that frame chain. This does not retrospectively establish the missing run-01 args.

## Exact exception and evidence

The QA-only v2 guard allows one `ctypes.dlopen` only in IMPORT with exact args `('kernel32',)` and exact three-frame stdlib chain 379 -> 450 -> 479 under the pinned stdlib file path. It records count and frames. Any other `ctypes.dlopen`, repeat, phase, argument or frame fails. Existing write, process, network, SQLite, registry, import-root, path and SHA guards remain. This is an explicit native system DLL load exception; the receipt would only establish bounded import identity, not absence of every side effect or product acceptance.

`CLASSIFIER-02-TEST-FINAL.json` SHA256 `1A6B276F34ECDC1B0CBBF9F2C09F9114067039CC9C8C98FF97463B5A84E3F3C8` executes only the extracted pure-data classifier. Fifteen cases passed: one positive, fourteen rejects including user32, absolute path, kernel32.dll, argument shape, repeat, wrong event/phase/path/line/stack. No DLL or product module was loaded by this test.

## Identity and authorization

- Original `PACKET.json` SHA256 `953F40DBA8C9B9314513844C35C353B63A7115DF40853309629B6B56ADB668E5`, original fixed Python runner SHA256 `17D8F9FE1817A1362700576BD8DF938CCFCC3413E03F8C554A3DB61BB22BB5B2`, and run-01 RED remain unchanged.
- `PACKET-02.json` SHA256 `E2B61291C92575499300623BF124B68680B6702BFAFDEC97DDF923D2450371CA` binds the same 153 QA package files, 157 QA dependency files, nine selected imports, prior RED, pinned ctypes stdlib file, exact exception and classifier evidence. The new scope is `CORE153_CONSUMER_IMPORT_9_CTYPES_KERNEL32_V2`; evidence is new `run-02`.
- `run_once_v2.py` fixed Python consumer SHA256 is `5ADAA93F9FC908EA502F776A0EC5B11567646052EA6425999FD72DCAF969EB27`; PowerShell raw SHA256 is `94D4178FFD4B225EBB17AC22AC6B247A1EC998E4CF6F33C6F9E10A5BA660C7B1`. A future grant must sign the consumer SHA and disclose the dual view.
- `launch_import_v2_once.ps1` PowerShell SHA256 is `638C7D34351AC53B8631688787FFE61CF0351EA71388902234655AAF30172660`, syntax parser zero errors. It uses QA cwd, fixed Python `-I -B`, `Environment.Clear()`, eight listed QA/Windows keys, `CreateNoWindow=true`, 180-second timeout and captures output/exit/PID. `LAUNCH-PACKET-02.json` SHA256 is `B797967C12EC23C7AD884B3CDF8645B10D3FB49644869921A3D59CB835C81F85`.
- Fresh `profile-import-02` has five directories, zero files; `PROFILE-02-PREPARED.json` SHA256 is `66F6E15B8C88F9C7DE7EA459C28741485E8FCC55625F5F869BB1E4BD4CF95AFF`.
- `GRANT-02.json`, `launch-02` and `run-02` are absent. MGR02 must separately approve packet, runner, launcher, prior RED, stdlib file and narrow exception. A first RED stops without retry. No product source, old runner, old packet or old evidence was changed.

Two static preparation transform errors are retained in `V2-PREP-FAILURES.txt`; neither started a child process.
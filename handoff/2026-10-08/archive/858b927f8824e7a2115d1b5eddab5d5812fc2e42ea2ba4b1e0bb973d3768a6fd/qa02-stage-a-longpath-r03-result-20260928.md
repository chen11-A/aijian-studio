# QA02 Stage-A long-path run03: one-call result

Status: `QA_HARNESS_ASSERTION_RED; PRODUCT_SCOPE_PARTIAL`. Exactly one
MGR02-approved wrapper call was made. There was no retry. The original run01
RED and run02 short-path artifacts were not changed.

## Authority and raw evidence

- External one-shot approval:
  `C:\Users\Administrator\Documents\AIVORA\management\manager-handoffs\approvals\20260928-qa02-stage-a-longpath-run03-one-shot.json`,
  SHA-256 `EDFB6A5AABC2D66E884512982B575CFB0D9031E653817B8509B6ADCB5A0541BC`.
- Approved envelope SHA-256
  `889F23BC9D0ACB934FB37A70B431A5E9BE051EA35629CF327A5DEED700F4B6DA`.
  Wrapper SHA-256 `F3B19E6030DB383C85C240FE43CF8A5C124B1406384BEA9E9682D004238E1337`;
  child script SHA-256 `0F13703C1562EFCEC820A0FBFB6314749C4D82907F34B34FB467A05CF238956A`.
- Outer receipt:
  `C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\native-source-qa-20260924\qa02-stage-a-longpath-r03-20260928\invocation-03\receipt.json`,
  SHA-256 `CCCCAB15EA5653B4AAEB30A7E3F558DEC8486F27DEF3B30D40A43C2417C4E3E2`.
  Status `PROCESS_NONZERO_REVIEW_RAW`, child PID `9908`, exit code `1`,
  `timed_out=false`. The wrapper process itself exited zero after saving the
  child's failure. `stdout.bin` is 0 bytes, SHA-256
  `E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855`;
  `stderr.bin` is 1075 bytes, SHA-256
  `F200152B4F674229B806807CFAC09B2C472683A3575A621C609A20D4332FC9C2`.
- Inner receipt:
  `C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\native-source-qa-20260924\qa02-stage-a-longpath-r03-20260928\profile-03\receipt.json`,
  SHA-256 `CA32E09DF710A5647A35A33C05AE972D5DCC7FBEDB5FB803608C6B62B53F1E16`,
  status `STAGE_A_FAILED_PRESERVED`.

## First failure and observed product work

The first failure is the QA script's `MANAGED_BLOB_BYTES_CHANGED:v1-blue.webm`
at `stage-a-once.py:329`. The traceback is preserved in the inner receipt and
raw stderr. The script's `sha256()` returns uppercase text, while the product
`AssetVersion.sha256` is lowercase. The assertion compared them without
normalizing case. A read-only post-run check used the extended Windows path
spelling and compared normalized hashes; all four 266-character logical blob
paths had the expected byte counts and SHA-256 values:

| Input | Bytes | Actual and expected SHA-256 |
|---|---:|---|
| v1-blue.webm | 2619 | `75FCA3022F0D4369175E5341505544D8AED1837C1DCE0899F35BF1D7EDB73947` |
| v2-red.webm | 2542 | `507DB639D74CAEBEAB3DFB9DDAD4EEA328A732D59794BEC7B49C66F51AB78AC4` |
| dialogue-test.wav | 96078 | `E2C5F4AC222A67C22FC548275BB422A45FAEEAAB0A5EBAAED29CB0F1AFA37641` |
| bgm-test.wav | 480078 | `590CC4A39EC6DE15C24C3EDEBB8F5754F3088BAD398932C7C194960453BBD7C4` |

The product store created four assets and four versions. Its immediate
`get_asset(..., verify=True)` readback reported `VERIFIED` for all four.
The first selected reader returned `VERIFIED` and rights reader
`NO_DECISION` before the QA assertion stopped the loop. The isolated database
is schema 30, 1,015,808 bytes, SHA-256
`6DB113AD639CC977ED200F12D7D6CBA89F91BE8481C56CC1826B3A8E1469C42E`,
with 4 assets, 4 versions, 0 rights decisions, and 0 probe evidence; no
WAL/journal/SHM remains.

The assertion prevented selected/rights readback for the other three inputs,
WAV inspections, private assembly availability, and negative path cases.
Those gates are `NOT_RUN`, including symlink/reparse rejection. Video probe,
MLT, provider, human clearance, and export were outside this approved gate.
The run does not establish full Stage-A PASS or a product long-path RED.
The one-shot approval has been consumed; any corrected run needs a fresh
isolated profile and separate exact-hash authorization.

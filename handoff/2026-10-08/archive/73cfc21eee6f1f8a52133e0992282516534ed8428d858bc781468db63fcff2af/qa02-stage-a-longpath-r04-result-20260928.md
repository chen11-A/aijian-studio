# QA02 Stage-A long-path run04: one-call first-gate result

Status: `FIRST_GATE_LOCAL_PASS_REVIEW_REQUIRED`. Exactly one MGR02-approved
wrapper call was made; no retry. This is isolated local product verification
of the named first gate, not video probe, MLT/native, provider, rights
clearance, installation, UI, or overall acceptance. Run03 raw and database
were preserved.

## Authority and raw evidence

- External one-shot approval:
  `C:\Users\Administrator\Documents\AIVORA\management\manager-handoffs\approvals\20260928-qa02-stage-a-longpath-run04-one-shot.json`,
  SHA-256 `B7AED1108BE820D0F479588F442CE641A3F9FE4E88A10316986F910981FAA1DE`.
- Approved envelope SHA-256
  `E44AE080F54905A06F252311567CFF13AA8289DC54C76FD67A8F2399E7122F85`;
  child script `37459ABDFA58BEA8DBCBC1EA1F7D49D08BF222A1A1F1C8732401CEC14F7A522C`;
  wrapper `038BB952174B8B1E1D0EF51C505108EC85439FE1B6D631FC296AAF3611642AB7`.
- Outer receipt:
  `C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\native-source-qa-20260924\qa02-stage-a-longpath-r04-20260928\invocation-04\receipt.json`,
  SHA-256 `76697EF8580D7593E13168E42CBC538C8F5CCD840AFC48D3DB1081F90C7DA97B`.
  Status `PROCESS_EXIT_ZERO_REVIEW_STAGE_RECEIPT`, child PID `16828`, exit
  code `0`, `timed_out=false`. Both `stdout.bin` and `stderr.bin` are 0 bytes,
  SHA-256 `E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855`.
- Inner receipt:
  `C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\native-source-qa-20260924\qa02-stage-a-longpath-r04-20260928\profile-04\receipt.json`,
  SHA-256 `38DA1A750D7E868681EC27955231799B1FBB5B847C6BA308F444F065BD9D8AC1`;
  status `LONGPATH_RUN04_LOCAL_RESULT_REVIEW_REQUIRED`.

## First-gate observations

- Four synthetic inputs were imported into the isolated schema-30 profile.
  The two WebM and two WAV logical managed blob targets are each 266
  characters. Product `get_asset(..., verify=True)` and persisted selected
  readback both returned `VERIFIED` for all four. Independent managed-byte
  inspection matched each frozen byte count and SHA-256. Rights readback was
  `NO_DECISION` for all four; no human decision was written. The SRT remained
  manifest-only.
- WAV local inspection returned 48,000 dialogue samples, inspection SHA-256
  `BFBB234178A80FC310DC0FB10638F67EEF8A96E9E2041D26827F9275A8D6719D`,
  and 240,000 BGM samples, inspection SHA-256
  `C76A5ECA5B937AB60050913FE88341A77DF082705FFFC6FD5F6E666FC47249A9`.
  Each inspection's asset SHA matched its imported managed asset.
- Private assembly `_availability` returned `VERIFIED` for all four long
  blobs. This is helper-level evidence only; the QA01 seed has no assembly
  artifact for public `read_version`.
- The path helper rejected relative, UNC, parent-traversal, and a created
  symlink/reparse ancestor with `ValueError`. The symlink had a reparse
  attribute; this is an actual rejection, not `NOT_TESTED`. The QA-owned
  outside marker SHA stayed
  `A8B451BCAA64984DAC2FC2B2109857A12680F3FC2E4BA3024BB8452E40FB95C1`
  with no new outside entry. The ancestor check and later I/O are separate,
  so this does not prove junction-swap race resistance.
- The isolated database has 4 assets, 4 versions, 0 rights decisions, and
  0 probe evidence. It is 1,015,808 bytes, SHA-256
  `65EF2306FD83CFDAA454754A3B6A6E1919431F1C570826ABC37E93A6795A11FC`,
  with no WAL/journal/SHM left. The frozen 47-file source copy was used and
  rehashed by the child before its receipt was written.

The run04 first gate passed within this local profile. Video probe still
requires separately pinned FFmpeg/ffprobe and approval. Public assembly
readback, MLT/native execution, provider, human `CLEARED`, and export remain
untested. The run04 one-shot approval has been consumed.

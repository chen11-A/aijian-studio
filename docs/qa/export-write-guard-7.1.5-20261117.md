lock ffmpeg e8a8d46f5225f3062cec7c07fb145d58ae73c603cb740dcd5bad34bfb54e455a
lock ffprobe cefc5f81c0b18429cdbf8fa5a89e1e9c759235e10f93f9b329ff1b2fdff26f46
actual e8a8d46f5225f3062cec7c07fb145d58ae73c603cb740dcd5bad34bfb54e455a  /tmp/ffmpeg-deb/usr/bin/ffmpeg
cefc5f81c0b18429cdbf8fa5a89e1e9c759235e10f93f9b329ff1b2fdff26f46  /tmp/ffmpeg-deb/usr/bin/ffprobe
ffmpeg version 7.1.5-0+deb13u1 Copyright (c) 2000-2026 the FFmpeg developers
ffprobe version 7.1.5-0+deb13u1 Copyright (c) 2007-2026 the FFmpeg developers


 RUN  v4.1.10 /workspace/apps/desktop

 ✓ src/film-export-cancel.integration.test.ts > refuses to stop a film check while it is rendering 1330ms
 ✓ src/film-export-qc.test.ts > trusted checked export > checks actual two-aspect staged video before publication and keeps original bytes 2688ms
 ✓ src/film-export-qc.test.ts > trusted checked export > refuses project fallback, missing selection and foreign film paths before tool execution 97ms
 ✓ src/film-export-cancel.integration.test.ts > keeps a user stop unavailable through the folder picker and both aspect writes 2562ms
 ✓ src/film-export-qc.test.ts > trusted checked export > rejects changed selected version, settings and owner without publishing 1169ms
 ✓ src/film-export-qc.test.ts > trusted checked export > refuses renderer execution paths and unknown settings 1ms
 ✓ src/film-export-qc.test.ts > checked publication ownership and lifecycle > blocks both outputs using original true-peak rules and rejects an aspect-only bypass 1750ms
 ✓ src/film-export-qc.test.ts > checked publication ownership and lifecycle > refuses shared legacy and foreign-episode video rather than guessing project ownership 54ms
 ✓ src/film-export-cancel.integration.test.ts > rejects a cancel that arrives on a later turn after the first aspect is published 2421ms
 ✓ src/film-export-qc.test.ts > checked publication ownership and lifecycle > does not allow a duplicate prepare and cleans staged media after a changed record or disposal (engine startup 0ms) 1956ms
 ✓ src/film-export-cancel.integration.test.ts > returns the actual written evidence through authorized export IPC after managed work settles 2376ms
 ✓ src/film-export-write-log.test.ts > removes an interrupted file and a temp directory, and leaves a file this export did not write 18ms
 ✓ src/film-export-write-log.test.ts > clears the whole set when the first aspect was written and the process died during the second 6ms
 ✓ src/film-export-write-log.test.ts > keeps the first aspect after a committed partial result, including across a restart 6ms
 ✓ src/film-export-write-log.test.ts > leaves both files after a committed published result 7ms
 ✓ src/film-export-write-log.test.ts > does not follow a journal path that leaves the chosen folder 2ms
 ✓ src/film-export-write-log.test.ts > does not delete a same-path file replaced after the journal was written 8ms
 ✓ src/film-export-write-log.test.ts > does not delete an in-place overwrite of an unfinished export file 3ms
 ✓ src/film-export-write-log.test.ts > does not follow a symlink that replaced an unfinished export file 3ms
 ✓ src/film-export-write-log.test.ts > does not remove an outside directory through a temp path that became a symlink 3ms
 ✓ src/film-export-write-log.test.ts > does not delete a user directory that appears at a reserved temp path before this export creates it 2ms
 ✓ src/film-export-write-log.test.ts > removes a temp directory whose owner marker was written before the claim was saved 3ms
 ✓ src/film-export-write-log.test.ts > does not delete a different file that occupies a planned link path 4ms
 ✓ src/film-export-write-log.test.ts > deletes a hardlink that was created after the plan and before the claim 3ms
 ✓ src/film-export-write-log.test.ts > keeps the open journal and the first file when committing partial cannot be stored 2ms
 ✓ src/film-export-write-log.test.ts > rejects a rename failure without marking the export partial 1ms
 ✓ src/film-export-write-log.test.ts > rejects a directory sync failure without treating the in-memory journal as committed 4ms
 ✓ src/film-export-write-log.test.ts > does not follow a symlink that replaced the chosen directory 3ms
 ✓ src/film-export-write-log.test.ts > does not delete a temp directory the user replaced at the same path 4ms
 ✓ src/film-export-write-log.test.ts > puts a file back when its bytes change while the hash is being checked 3ms
 ✓ src/film-export-write-log.test.ts > keeps the journal when the chosen directory cannot be read 3ms
 ✓ src/film-export-write-log.test.ts > does not report a cleared export when deleting the file is denied 3ms
 ✓ src/film-export-write-log.test.ts > reports retry instead of none when the journal directory itself cannot be listed 1ms
 ✓ src/film-delivery-manifest.test.ts > writes exclusive actual-byte evidence without paths, tokens, or inferred technical values 16ms
 ✓ src/film-delivery-manifest.test.ts > lists only actual partial sidecars and refuses a false complete status 3ms
 ✓ src/film-delivery-manifest.test.ts > rejects modified bytes and preserves the file instead of issuing checked evidence 2ms
 ✓ src/film-delivery-manifest.test.ts > rechecks file identity after the final current-project guard 2ms
 ✓ src/film-delivery-manifest.test.ts > never overwrites an existing manifest or deletes existing user video 3ms
 ✓ src/film-delivery-manifest.test.ts > does not commit a manifest after input changes or accepted cancellation 4ms
 ✓ src/film-delivery-manifest.test.ts > refuses escaped or symlink file references without exposing the target path 1ms
 ✓ src/film-delivery-manifest.test.ts > preserves the written file fact but never confirms cleanup after a real owned-directory rm failure 3ms
 ✓ src/film-delivery-manifest.test.ts > rejects a user stop during delivery evidence when owned JSON staging cannot be cleaned 4ms
 ✓ src/film-delivery-manifest.test.ts > mirrors main canonicalization for a real directory alias without relaxing the noncanonical gate 3ms
 ✓ src/film-export-quit-guard.test.ts > blocks quit only while a folder write is in progress and then releases it 2ms
 ✓ src/film-export-quit-guard.test.ts > keeps the guard while another export is still writing 0ms
 ✓ src/film-export-quit-guard.test.ts > ignores a notifier that has already gone away 1ms
 ✓ src/film-export-quit-guard.test.ts > does not notify again when the same export is held twice 1ms
 ✓ src/film-export-quit-guard.test.ts > recognizes reload and force-reload shortcuts 0ms
 ✓ src/film-export-qc.test.ts > checked publication ownership and lifecycle > does not allow a duplicate prepare and cleans staged media after a changed record or disposal (engine startup 1200ms) 3181ms
 ✓ src/film-export-qc.test.ts > checked publication ownership and lifecycle > rejects tampered checked video and all checked sidecar bytes 3731ms
 ✓ src/film-export-qc.test.ts > checked publication ownership and lifecycle > publishes without overwriting a pre-existing mp4 file 1838ms
 ✓ src/film-export-qc.test.ts > checked publication ownership and lifecycle > publishes without overwriting a pre-existing srt file 1675ms
 ✓ src/film-export-qc.test.ts > checked publication ownership and lifecycle > publishes without overwriting a pre-existing cover file 1649ms
 ✓ src/film-export-qc.test.ts > rejects same-series episode aliases and series junction escape against the canonical library root 59ms
 ✓ src/film-export-qc.test.ts > invalidates a publishing receipt when its sender closes during the native folder picker 1272ms
 ✓ src/film-export-qc.test.ts > retains actual outputs but never reports complete delivery when evidence collision fails 1844ms
 ✓ src/film-export-qc.test.ts > retains actual outputs but never reports complete delivery when evidence changed fails 1761ms
 ✓ src/film-export-qc.test.ts > preserves a hash-verified public manifest while reporting cleanup as a partial result 1716ms
 ✓ src/film-export-qc.test.ts > writes one silent AAC track for an explicit silent film and keeps the decision on the record 1806ms
 ✓ src/film-export-qc.test.ts > writes a silent AAC track for both aspects in one export 2571ms
 ✓ src/film-export-qc.test.ts > replaces a source with more than two channels instead of rejecting the silent export 1756ms
 ✓ src/film-export-qc.test.ts > keeps the existing mixed track when the user chose audio 1728ms
 ✓ src/film-export-qc.test.ts > blocks export of a stale clip and has no confirm-and-export field 454ms
 ✓ src/film-export-qc.test.ts > echoes the cleaned requested file name on the check and the published path 3617ms
 ✓ src/film-export-qc.test.ts > numbers the second and third default export without touching the first file 5179ms
 ✓ src/film-export-qc.test.ts > uses one sequence number for both aspects when the default name is taken 2510ms
 ✓ src/film-export-qc.test.ts > treats a different-cased default name as taken and writes the next number 1632ms
 ✓ src/film-export-qc.test.ts > rejects an edited name that is already taken and keeps the receipt 1725ms
 ✓ src/film-export-qc.test.ts > rejects an edited name when only the srt is taken and keeps the receipt 1717ms
 ✓ src/film-export-qc.test.ts > rejects an edited name when only the cover is taken and keeps the receipt 1718ms
 ✓ src/film-export-qc.test.ts > takes the next default-name number when linking races with EEXIST 1632ms
 ✓ src/film-export-qc.test.ts > stops with a clear error when every default-name number races 2310ms
 ✓ src/film-export-qc.test.ts > refuses to discard the staging folder while a publish is still using the receipt 1894ms
 ✓ src/film-export-qc.test.ts > holds the write guard through evidence and releases it if journal finish throws 2506ms
 ✓ src/film-export-qc.test.ts > does not return a partial result when the partial journal cannot be stored 2419ms
 ✓ src/film-export-qc.test.ts > keeps the first aspect when the second aspect link fails 2987ms
 ✓ src/film-export-qc.test.ts > keeps the first aspect when copying the second aspect runs out of disk 2597ms
 ✓ src/film-export-qc.test.ts > deletes the second aspect video when its subtitle cannot be written 2640ms
 ✓ src/film-export-qc.test.ts > keeps the first aspect and reports PROJECT_CHANGED when the project moves before the second copy 2452ms
 ✓ src/film-export-qc.test.ts > deletes the second aspect video when its cover cannot be written 2535ms
 ✓ src/film-export-qc.test.ts > renumbers both aspects when the second aspect name is taken after the first is written 2619ms
 ✓ src/film-export-qc.test.ts > rolls an edited name back when the second aspect is grabbed 3552ms
 ✓ src/film-export-qc.test.ts > does not leave a published progress record when every default-name number races 2045ms

 Test Files  5 passed (5)
      Tests  83 passed (83)
   Start at  09:14:48
   Duration  85.44s (transform 597ms, setup 0ms, import 674ms, tests 93.87s, environment 0ms)


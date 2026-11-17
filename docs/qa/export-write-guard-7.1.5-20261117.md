lock ffmpeg e8a8d46f5225f3062cec7c07fb145d58ae73c603cb740dcd5bad34bfb54e455a
lock ffprobe cefc5f81c0b18429cdbf8fa5a89e1e9c759235e10f93f9b329ff1b2fdff26f46
actual e8a8d46f5225f3062cec7c07fb145d58ae73c603cb740dcd5bad34bfb54e455a  /tmp/ffmpeg-deb/usr/bin/ffmpeg
cefc5f81c0b18429cdbf8fa5a89e1e9c759235e10f93f9b329ff1b2fdff26f46  /tmp/ffmpeg-deb/usr/bin/ffprobe
ffmpeg version 7.1.5-0+deb13u1 Copyright (c) 2000-2026 the FFmpeg developers
ffprobe version 7.1.5-0+deb13u1 Copyright (c) 2007-2026 the FFmpeg developers


 RUN  v4.1.10 /workspace/apps/desktop

 ✓ src/film-export-cancel.integration.test.ts > refuses to stop a film check while it is rendering 1416ms
 ✓ src/film-export-qc.test.ts > trusted checked export > checks actual two-aspect staged video before publication and keeps original bytes 2828ms
 ✓ src/film-export-qc.test.ts > trusted checked export > refuses project fallback, missing selection and foreign film paths before tool execution 59ms
 ✓ src/film-export-cancel.integration.test.ts > keeps a user stop unavailable through the folder picker and both aspect writes 2430ms
 ✓ src/film-export-qc.test.ts > trusted checked export > rejects changed selected version, settings and owner without publishing 1088ms
 ✓ src/film-export-qc.test.ts > trusted checked export > refuses renderer execution paths and unknown settings 1ms
 ✓ src/film-export-qc.test.ts > checked publication ownership and lifecycle > blocks both outputs using original true-peak rules and rejects an aspect-only bypass 1798ms
 ✓ src/film-export-qc.test.ts > checked publication ownership and lifecycle > refuses shared legacy and foreign-episode video rather than guessing project ownership 65ms
 ✓ src/film-export-cancel.integration.test.ts > rejects a cancel that arrives on a later turn after the first aspect is published 2453ms
 ✓ src/film-export-qc.test.ts > checked publication ownership and lifecycle > does not allow a duplicate prepare and cleans staged media after a changed record or disposal (engine startup 0ms) 2056ms
 ✓ src/film-export-cancel.integration.test.ts > returns the actual written evidence through authorized export IPC after managed work settles 2416ms
 ✓ src/film-export-write-log.test.ts > removes an interrupted file and a temp directory, and leaves a file this export did not write 20ms
 ✓ src/film-export-write-log.test.ts > clears the whole set when the first aspect was written and the process died during the second 7ms
 ✓ src/film-export-write-log.test.ts > keeps the first aspect after a committed partial result, including across a restart 5ms
 ✓ src/film-export-write-log.test.ts > leaves both files after a committed published result 7ms
 ✓ src/film-export-write-log.test.ts > does not follow a journal path that leaves the chosen folder 2ms
 ✓ src/film-export-write-log.test.ts > does not delete a same-path file replaced after the journal was written 4ms
 ✓ src/film-export-write-log.test.ts > does not delete an in-place overwrite of an unfinished export file 2ms
 ✓ src/film-export-write-log.test.ts > does not follow a symlink that replaced an unfinished export file 3ms
 ✓ src/film-export-write-log.test.ts > does not remove an outside directory through a temp path that became a symlink 5ms
 ✓ src/film-export-write-log.test.ts > does not delete a user directory that appears at a reserved temp path before this export creates it 3ms
 ✓ src/film-export-write-log.test.ts > removes a temp directory whose owner marker was written before the claim was saved 3ms
 ✓ src/film-export-write-log.test.ts > does not delete a different file that occupies a planned link path 2ms
 ✓ src/film-export-write-log.test.ts > deletes a hardlink that was created after the plan and before the claim 4ms
 ✓ src/film-export-write-log.test.ts > keeps the open journal and the first file when committing partial cannot be stored 4ms
 ✓ src/film-export-write-log.test.ts > rejects a rename failure without marking the export partial 1ms
 ✓ src/film-export-write-log.test.ts > rejects a directory sync failure without treating the in-memory journal as committed 3ms
 ✓ src/film-export-write-log.test.ts > does not follow a symlink that replaced the chosen directory 2ms
 ✓ src/film-export-write-log.test.ts > does not delete a temp directory the user replaced at the same path 2ms
 ✓ src/film-export-write-log.test.ts > puts a file back when its bytes change while the hash is being checked 3ms
 ✓ src/film-export-write-log.test.ts > keeps the journal when the chosen directory cannot be read 3ms
 ✓ src/film-export-write-log.test.ts > does not report a cleared export when deleting the file is denied 3ms
 ✓ src/film-export-write-log.test.ts > reports retry instead of none when the journal directory itself cannot be listed 1ms
 ✓ src/film-export-write-log.test.ts > treats only unsupported Windows directory codes as skippable 2ms
 ✓ src/film-export-write-log.test.ts > keeps the journal when a planned link or temp has not been cleaned 5ms
 ✓ src/film-export-write-log.test.ts > drops the journal only after the owned file and temp are confirmed gone 2ms
 ✓ src/film-export-write-log.test.ts > deletes a claim left when recovery itself stops after the rename 6ms
 ✓ src/film-export-write-log.test.ts > does not move a claim onto a user file that appeared at the original path 3ms
 ✓ src/film-export-write-log.test.ts > does not delete a file swapped in after the identity check 3ms
 ✓ src/film-export-write-log.test.ts > does not recursively delete a temp directory swapped in after the marker check 3ms
 ✓ src/film-delivery-manifest.test.ts > writes exclusive actual-byte evidence without paths, tokens, or inferred technical values 14ms
 ✓ src/film-delivery-manifest.test.ts > lists only actual partial sidecars and refuses a false complete status 4ms
 ✓ src/film-delivery-manifest.test.ts > rejects modified bytes and preserves the file instead of issuing checked evidence 2ms
 ✓ src/film-delivery-manifest.test.ts > rechecks file identity after the final current-project guard 8ms
 ✓ src/film-delivery-manifest.test.ts > never overwrites an existing manifest or deletes existing user video 3ms
 ✓ src/film-delivery-manifest.test.ts > does not commit a manifest after input changes or accepted cancellation 5ms
 ✓ src/film-delivery-manifest.test.ts > refuses escaped or symlink file references without exposing the target path 2ms
 ✓ src/film-delivery-manifest.test.ts > preserves the written file fact but never confirms cleanup after a real owned-directory rm failure 3ms
 ✓ src/film-delivery-manifest.test.ts > rejects a user stop during delivery evidence when owned JSON staging cannot be cleaned 4ms
 ✓ src/film-delivery-manifest.test.ts > mirrors main canonicalization for a real directory alias without relaxing the noncanonical gate 4ms
 ✓ src/film-export-quit-guard.test.ts > blocks quit only while a folder write is in progress and then releases it 2ms
 ✓ src/film-export-quit-guard.test.ts > keeps the guard while another export is still writing 0ms
 ✓ src/film-export-quit-guard.test.ts > ignores a notifier that has already gone away 1ms
 ✓ src/film-export-quit-guard.test.ts > does not notify again when the same export is held twice 1ms
 ✓ src/film-export-quit-guard.test.ts > recognizes reload and force-reload shortcuts 0ms
 ✓ src/film-export-qc.test.ts > checked publication ownership and lifecycle > does not allow a duplicate prepare and cleans staged media after a changed record or disposal (engine startup 1200ms) 3151ms
 ✓ src/film-export-qc.test.ts > checked publication ownership and lifecycle > rejects tampered checked video and all checked sidecar bytes 3699ms
 ✓ src/film-export-qc.test.ts > checked publication ownership and lifecycle > publishes without overwriting a pre-existing mp4 file 1639ms
 ✓ src/film-export-qc.test.ts > checked publication ownership and lifecycle > publishes without overwriting a pre-existing srt file 1569ms
 ✓ src/film-export-qc.test.ts > checked publication ownership and lifecycle > publishes without overwriting a pre-existing cover file 1589ms
 ✓ src/film-export-qc.test.ts > rejects same-series episode aliases and series junction escape against the canonical library root 62ms
 ✓ src/film-export-qc.test.ts > invalidates a publishing receipt when its sender closes during the native folder picker 1178ms
 ✓ src/film-export-qc.test.ts > retains actual outputs but never reports complete delivery when evidence collision fails 1697ms
 ✓ src/film-export-qc.test.ts > retains actual outputs but never reports complete delivery when evidence changed fails 1666ms
 ✓ src/film-export-qc.test.ts > preserves a hash-verified public manifest while reporting cleanup as a partial result 1808ms
 ✓ src/film-export-qc.test.ts > writes one silent AAC track for an explicit silent film and keeps the decision on the record 1673ms
 ✓ src/film-export-qc.test.ts > writes a silent AAC track for both aspects in one export 2713ms
 ✓ src/film-export-qc.test.ts > replaces a source with more than two channels instead of rejecting the silent export 1887ms
 ✓ src/film-export-qc.test.ts > keeps the existing mixed track when the user chose audio 1850ms
 ✓ src/film-export-qc.test.ts > blocks export of a stale clip and has no confirm-and-export field 567ms
 ✓ src/film-export-qc.test.ts > echoes the cleaned requested file name on the check and the published path 3754ms
 ✓ src/film-export-qc.test.ts > numbers the second and third default export without touching the first file 4946ms
 ✓ src/film-export-qc.test.ts > uses one sequence number for both aspects when the default name is taken 2391ms
 ✓ src/film-export-qc.test.ts > treats a different-cased default name as taken and writes the next number 1574ms
 ✓ src/film-export-qc.test.ts > rejects an edited name that is already taken and keeps the receipt 1648ms
 ✓ src/film-export-qc.test.ts > rejects an edited name when only the srt is taken and keeps the receipt 1645ms
 ✓ src/film-export-qc.test.ts > rejects an edited name when only the cover is taken and keeps the receipt 1682ms
 ✓ src/film-export-qc.test.ts > takes the next default-name number when linking races with EEXIST 1834ms
 ✓ src/film-export-qc.test.ts > stops with a clear error when every default-name number races 2443ms
 ✓ src/film-export-qc.test.ts > refuses to discard the staging folder while a publish is still using the receipt 1799ms
 ✓ src/film-export-qc.test.ts > holds the write guard through evidence and releases it if journal finish throws 2515ms
 ✓ src/film-export-qc.test.ts > does not return a partial result when the partial journal cannot be stored 2370ms
 ✓ src/film-export-qc.test.ts > keeps the first aspect when the second aspect link fails 2533ms
 ✓ src/film-export-qc.test.ts > keeps the first aspect when copying the second aspect runs out of disk 2354ms
 ✓ src/film-export-qc.test.ts > deletes the second aspect video when its subtitle cannot be written 2603ms
 ✓ src/film-export-qc.test.ts > keeps the first aspect and reports PROJECT_CHANGED when the project moves before the second copy 2272ms
 ✓ src/film-export-qc.test.ts > deletes the second aspect video when its cover cannot be written 2264ms
 ✓ src/film-export-qc.test.ts > renumbers both aspects when the second aspect name is taken after the first is written 2373ms
 ✓ src/film-export-qc.test.ts > rolls an edited name back when the second aspect is grabbed 2985ms
 ✓ src/film-export-qc.test.ts > does not leave a published progress record when every default-name number races 1642ms

 Test Files  5 passed (5)
      Tests  90 passed (90)
   Start at  09:27:27
   Duration  82.74s (transform 650ms, setup 0ms, import 787ms, tests 91.15s, environment 0ms)


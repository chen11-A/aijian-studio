# R1 desktop overlay candidate

Status: static candidate only. DEV07 did not modify c19, build TypeScript, launch Electron, or run the frozen sidecar.

Base: `C:/Users/Administrator/.codex/worktrees/c19-trim-211c9e8-qa-20260923/apps/desktop/src/main.ts` SHA256 `E1BAAA599BB340BA4F2DEAD8755485B2E55406894E23F29D225EC0690823ABF0`.

| Destination | Packet file | SHA256 |
| --- | --- | --- |
| `apps/desktop/src/main.ts` | `main.after.ts` | `BDAB4361B5D0671735253C8A57258FC48005165F07969DCD9D56C3BDC5636DAC` |
| `apps/desktop/src/sidecar-process.ts` | `sidecar-process.ts` | `DE5D46DCE9CEB276F67A968F0B271B37498814CECECAF7AD7712FB6DBE22710F` |
| `apps/desktop/src/sidecar-startup-diagnostic.ts` | `sidecar-startup-diagnostic.ts` | `2B2147A6480824B6FBBC0489CB7A74780D04FE994C6C2F285E76308533FDABA6` |
| `apps/desktop/src/sidecar-extraction-temp.ts` | `sidecar-extraction-temp.ts` | `6EA5A2BA8ACD40F46CEE5F8A6F035C824A5A3479D93DD1565FF0C550511F7821` |

`main.patch` SHA256 `C5724F808F9BBAD4DF0E5A86F0EEC4436D82E23516CD43CE0DD972EACF552BF2`; `git apply --check` against the c19 baseline passed without writing it. The patch changes only imports, packaged sidecar TEMP/TMP setup, and startup failure classification. It retains `packagedResourceRoot`, the plain resource checks for the sidecar and media lock, `packagedRendererIndex`, and the existing IPC registrations. The renderer preflight remains before `startSidecar`. The author tree's `main.ts` is not a replacement for c19.

`sidecar-process.ts` imports `sidecar-protocol.ts`, which has identical SHA256 `EA24A205A7BBC7964FDB78F9B39016B3E4C1246816D855426B628ABFAF2839C7` in both trees, plus the new diagnostic file above. The extraction helper imports only `node:fs` and `node:path`. No EpisodeScript, media, or Sub2API contract source is part of this overlay.

## Independent QA cases

1. Long inherited TEMP/TMP with short, plain, writable LOCALAPPDATA: read back child TEMP/TMP, EXE PID, ready handshake, HTTP readiness, and normal close; verify global TEMP/TMP is unchanged.
2. Standard user: verify the extraction directory ACL, no elevation, unique per launch path, and that unrelated users cannot alter the extraction before load.
3. Invalid LOCALAPPDATA/USERPROFILE (missing, UNC, outside profile, junction, over the 100-character budget, or unwritable): verify `STARTUP_UNKNOWN`, no EXE spawn, and no userData change.
4. Two concurrent launches: verify distinct extraction wrappers; the second sidecar's same-workspace busy response must not affect the first process or its wrapper.
5. Normal close, startup cancellation, and pre-handshake exit: verify the callback removes only the current empty wrapper after the child closes. If `_MEI` remains, preserve it and report cleanup as UNKNOWN; do not sweep another instance or delete a possible survivor's files.
6. Read back the frozen PyInstaller spec and EXE identity. `runtime_tmpdir` must remain unset, since it overrides child TEMP/TMP. Rebuild and retest if the spec or EXE hash changes.

Missing renderer, media lock, sidecar EXE, unsafe resource root, or invalid extraction directory must reject before sidecar spawn. No static check here proves the actual EXE extraction, Windows ACL, installer, or packaged Electron behavior.

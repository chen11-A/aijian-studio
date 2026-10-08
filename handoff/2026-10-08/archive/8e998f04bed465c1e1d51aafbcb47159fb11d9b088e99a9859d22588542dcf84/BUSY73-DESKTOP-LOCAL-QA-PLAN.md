# Busy73 desktop diagnostic: isolated local QA

## Frozen input and limits

- Input: `C:\Users\Administrator\Documents\AIVORA\management\manager-handoffs\release-snapshots\20260928-busy73-desktop-diagnostic-source-1\SNAPSHOT.json`, SHA-256 `3F2F604DB7E4770AC40C8404D9F164D380932376E307ECBC64801FAA3601CAF6`.
- Recheck the three relevant copied source hashes against the manifest before transpiling. Compile only `sidecar-process.ts`, `sidecar-startup-diagnostic.ts`, and `sidecar-protocol.ts` into this QA directory with the installed TypeScript compiler. No product or c19 writes.
- Exercise `startSidecar` with controlled Node children only. Do not run the existing test's real Python sidecar case, Electron, an installed app, provider, user profile, or user database.

## Acceptance cases

1. Exact LF and CRLF diagnostic line plus exit 73 gives `WORKSPACE_BUSY`, including split stderr writes.
2. Code 73 alone, missing LF, diagnostic substring, wrong exit code, and overflow beyond 16 KiB give `STARTUP_UNKNOWN`.
3. A spawn failure and a pre-handshake timeout give `STARTUP_UNKNOWN`.
4. A valid ready handshake remains usable and `stop()` observes clean child exit.

Capture each case's outcome and wrapper stdout/stderr with hashes. A passing result establishes this frozen TypeScript module's local Node behavior only. Full desktop, real dual sidecar, D lifecycle, installation, and product acceptance remain open.

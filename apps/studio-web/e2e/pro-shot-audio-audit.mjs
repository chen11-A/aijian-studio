/** Actual Pro suggestion viewer; synthetic ABI, no filesystem, playback or paid request. */
import { runAuditCli } from "./pro-export-qc-audit.mjs";
import { shotAudioStates, runShotAudioCases } from "./pro-shot-audio-cases.mjs";
await runAuditCli({ kind: "shot-audio", states: shotAudioStates, runCases: runShotAudioCases });

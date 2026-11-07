/** Actual Pro audio-group execution UI, synthetic ABI; no native file or listening assertion. */
import { runAuditCli } from "./pro-export-qc-audit.mjs";
import { audioGroupStates, runAudioGroupCases } from "./pro-audio-groups-cases.mjs";
await runAuditCli({ kind: "audio-groups", states: audioGroupStates, runCases: runAudioGroupCases });

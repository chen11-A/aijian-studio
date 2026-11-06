/** Actual Pro four-lane settings/preview, with a synthetic native bridge. */
import { runAuditCli } from "./pro-export-qc-audit.mjs";
import { audioMixStates, runAudioMixCases } from "./pro-audio-mix-cases.mjs";
await runAuditCli({ kind: "audio-mix", states: audioMixStates, runCases: runAudioMixCases });

/** Actual Pro scene UI plus controlled native ABI, never media/file/listening validation. */
import { runAuditCli } from "./pro-export-qc-audit.mjs";
import { sceneAudioStates, runSceneAudioCases } from "./pro-scene-audio-cases.mjs";
await runAuditCli({ kind: "scene-audio", states: sceneAudioStates, runCases: runSceneAudioCases });

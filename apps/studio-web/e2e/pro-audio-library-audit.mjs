/** Actual local library UI; synthetic native ABI, no actual file or listening assertion. */
import { runAuditCli } from "./pro-export-qc-audit.mjs";
import { audioLibraryStates, runAudioLibraryCases } from "./pro-audio-library-cases.mjs";
await runAuditCli({
  kind: "audio-library",
  states: audioLibraryStates,
  runCases: runAudioLibraryCases,
});

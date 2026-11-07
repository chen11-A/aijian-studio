import { runAuditCli } from "./pro-export-qc-audit.mjs";
import { dialogueSplitStates, runDialogueSplitCases } from "./pro-dialogue-split-cases.mjs";
await runAuditCli({
  kind: "dialogue-split",
  states: dialogueSplitStates,
  runCases: runDialogueSplitCases,
});

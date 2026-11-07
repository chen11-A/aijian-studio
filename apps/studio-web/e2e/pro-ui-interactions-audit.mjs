import { runAuditCli } from "./pro-export-qc-audit.mjs";
import { uiInteractionStates, runUiInteractionCases } from "./pro-ui-interactions-cases.mjs";
await runAuditCli({
  kind: "ui-interactions",
  states: uiInteractionStates,
  runCases: runUiInteractionCases,
});

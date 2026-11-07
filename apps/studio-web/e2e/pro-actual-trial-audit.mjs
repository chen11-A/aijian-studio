import { runAuditCli } from "./pro-export-qc-audit.mjs";
import { actualTrialStates, runActualTrialCases } from "./pro-actual-trial-cases.mjs";
await runAuditCli({
  kind: "actual-trial",
  states: actualTrialStates,
  runCases: runActualTrialCases,
});

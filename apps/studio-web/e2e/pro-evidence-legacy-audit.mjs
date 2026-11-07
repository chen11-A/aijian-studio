/** Actual Pro delivery results and existing UI actions; synthetic bridge, no paid provider. */
import { runAuditCli } from "./pro-export-qc-audit.mjs";
import { evidenceLegacyStates, runEvidenceLegacyCases } from "./pro-evidence-legacy-cases.mjs";
await runAuditCli({
  kind: "evidence-legacy",
  states: evidenceLegacyStates,
  runCases: runEvidenceLegacyCases,
});

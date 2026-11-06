/** Actual Pro archive/seven-part UI with synthetic native ABI, no providers or ZIP execution. */
import { runAuditCli } from "./pro-export-qc-audit.mjs";
import { creationStates, runCreationCases } from "./pro-creation-cases.mjs";
await runAuditCli({ kind: "creation", states: creationStates, runCases: runCreationCases });

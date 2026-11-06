/** Reuses the QC audit's constrained CLI, source fingerprints and sandboxed Vite lifecycle. */
import { runAuditCli } from "./pro-export-qc-audit.mjs";
import { progressStates, runProgressCases } from "./pro-export-progress-cases.mjs";

await runAuditCli({ kind: "progress", states: progressStates, runCases: runProgressCases });

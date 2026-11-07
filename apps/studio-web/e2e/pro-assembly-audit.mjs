import { runAuditCli } from "./pro-export-qc-audit.mjs";
import { assemblyStates, runAssemblyCases } from "./pro-assembly-cases.mjs";
await runAuditCli({ kind: "assembly", states: assemblyStates, runCases: runAssemblyCases });

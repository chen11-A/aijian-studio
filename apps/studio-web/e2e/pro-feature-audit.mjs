/** Actual Cast/edit host, synthetic text/PCM metadata ABI; no providers or native decode. */
import { runAuditCli } from "./pro-export-qc-audit.mjs";
import { featureStates, runFeatureCases } from "./pro-feature-cases.mjs";
await runAuditCli({ kind: "features", states: featureStates, runCases: runFeatureCases });

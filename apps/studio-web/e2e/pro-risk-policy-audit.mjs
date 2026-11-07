/** Actual Pro text review and configuration with synthetic API; never a provider assertion. */
import { runAuditCli } from "./pro-export-qc-audit.mjs";
import { riskPolicyStates, runRiskPolicyCases } from "./pro-risk-policy-cases.mjs";
await runAuditCli({ kind: "risk-policy", states: riskPolicyStates, runCases: runRiskPolicyCases });

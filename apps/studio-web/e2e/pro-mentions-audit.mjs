/** Real Pro references with controlled synthetic text ABI; no provider or Electron assertion. */
import { runAuditCli } from "./pro-export-qc-audit.mjs";
import { mentionStates, runMentionCases } from "./pro-mentions-cases.mjs";
await runAuditCli({ kind: "mentions", states: mentionStates, runCases: runMentionCases });

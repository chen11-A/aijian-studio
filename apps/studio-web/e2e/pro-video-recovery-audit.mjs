import { runAuditCli } from "./pro-export-qc-audit.mjs";
import { videoRecoveryStates, runVideoRecoveryCases } from "./pro-video-recovery-cases.mjs";
await runAuditCli({
  kind: "video-recovery",
  states: videoRecoveryStates,
  runCases: runVideoRecoveryCases,
});

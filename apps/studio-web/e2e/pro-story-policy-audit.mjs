import { runAuditCli } from "./pro-export-qc-audit.mjs";
import { storyPolicyStates, runStoryPolicyCases } from "./pro-story-policy-cases.mjs";
await runAuditCli({
  kind: "story-policy",
  states: storyPolicyStates,
  runCases: runStoryPolicyCases,
});

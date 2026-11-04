import assert from "node:assert/strict";
import console from "node:console";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { URL, fileURLToPath, pathToFileURL } from "node:url";
const root = join(fileURLToPath(new URL("..", import.meta.url)), "apps/studio-web/src/aivora");
const temp = mkdtempSync(join(tmpdir(), "aivora-revision-ui-static-"));
let checks = 0;
const check = (value, ...rest) => {
  assert.equal(value, rest.length ? rest[0] : true);
  checks++;
};
try {
  for (const name of [
    "draftReviewRevision",
    "draftReviewRevisionRecovery",
    "draftReviewRevisionInput",
    "draftReviewRevision.testFixtures",
  ]) {
    const source = readFileSync(join(root, "adapters", `${name}.ts`), "utf8");
    const js = stripTypeScriptTypes(source, { mode: "strip" })
      .replaceAll('"./draftReviewRevision"', '"./draftReviewRevision.mjs"')
      .replaceAll('"./draftReviewRevisionRecovery"', '"./draftReviewRevisionRecovery.mjs"');
    writeFileSync(join(temp, `${name}.mjs`), js);
  }
  writeFileSync(
    join(temp, "draftExports.mjs"),
    stripTypeScriptTypes(readFileSync(join(root, "..", "api", "draftExports.ts"), "utf8"), {
      mode: "strip",
    }),
  );
  const transport = await import(pathToFileURL(join(temp, "draftExports.mjs")));
  const inputs = await import(pathToFileURL(join(temp, "draftReviewRevisionInput.mjs")));
  const adapter = await import(pathToFileURL(join(temp, "draftReviewRevision.mjs")));
  const recovery = await import(pathToFileURL(join(temp, "draftReviewRevisionRecovery.mjs")));
  const f = await import(pathToFileURL(join(temp, "draftReviewRevision.testFixtures.mjs")));
  check(adapter.revisionMatches(f.candidateData(), f.sourceJob));
  for (const patch of [
    { project_id: "other" },
    { episode_id: "other" },
    { operation_id: "other" },
    { assembly_version_id: "other" },
    { assembly_content_hash: "other" },
    { output_sha256: "other" },
    { output_bytes: 101 },
    { total_frames: 49 },
  ])
    check(adapter.revisionSourceMatches({ ...f.source, ...patch }, f.sourceJob), false);
  check(
    adapter.revisionMatches({ ...f.revisionData(), output_verified: "true" }, f.sourceJob),
    false,
  );
  const scope = f.revisionScope();
  check(adapter.revisionScopeMatches(scope, f.sourceJob));
  check(
    adapter.revisionScopeMatches(
      { ...scope, segments: [...scope.segments, ...scope.segments] },
      f.sourceJob,
    ),
    false,
  );
  check(
    adapter.revisionScopeMatches(
      { ...scope, segments: [{ ...f.sourceSegment, end_frame: 51 }] },
      f.sourceJob,
    ),
    false,
  );
  check(
    adapter.revisionScopeMatches(
      { ...scope, segments: [{ ...f.sourceSegment, start_frame: 25, end_frame: 25 }] },
      f.sourceJob,
    ),
    false,
  );
  const data = f.candidateData();
  data.plans[0].candidates[0].recheck = f.recheck;
  const commands = [
    {
      kind: "create",
      command: {
        ...adapter.revisionIdentity(f.source),
        plan_id: f.plan.plan_id,
        note_ids: [f.savedNote.note_id],
        affected_segment_ids: [f.sourceSegment.segment_id],
        instruction: f.plan.instruction,
      },
    },
    {
      kind: "approve",
      planId: f.plan.plan_id,
      command: { approval_id: f.approval.approval_id, expected_plan_hash: f.plan.plan_hash },
    },
    {
      kind: "attach",
      planId: f.plan.plan_id,
      command: {
        ...adapter.revisionIdentity(f.candidate.target),
        candidate_id: f.candidate.candidate_id,
        expected_plan_hash: f.plan.plan_hash,
        approval_id: f.approval.approval_id,
        candidate_operation_id: f.candidate.target.operation_id,
        change_summary: f.candidate.change_summary,
      },
    },
    {
      kind: "recheck",
      planId: f.plan.plan_id,
      candidateId: f.candidate.candidate_id,
      command: {
        recheck_id: f.recheck.recheck_id,
        expected_candidate_hash: f.candidate.candidate_hash,
        outcome: f.recheck.outcome,
        reason: f.recheck.reason,
      },
    },
  ];
  for (const command of commands) {
    check(adapter.pendingRevisionMatches(data, command));
    assert.deepEqual(recovery.parsePendingRevision(command), command);
    checks++;
    check(recovery.parsePendingRevision({ ...command, actor_id: "renderer" }), undefined);
    check(
      recovery.parsePendingRevision({
        ...command,
        command: { ...command.command, output_path: "/private/path" },
      }),
      undefined,
    );
  }
  for (const patch of [
    { output_bytes: 0 },
    { output_sha256: "bad" },
    { note_ids: [f.savedNote.note_id, f.savedNote.note_id] },
    { affected_segment_ids: [] },
    { instruction: " " },
    { instruction: "\0" },
    { instruction: "\ud800" },
  ])
    check(
      recovery.parsePendingRevision({
        ...commands[0],
        command: { ...commands[0].command, ...patch },
      }),
      undefined,
    );
  check(
    adapter.pendingRevisionMatches(data, {
      ...commands[0],
      command: { ...commands[0].command, instruction: "other" },
    }),
    false,
  );
  check(
    adapter.pendingRevisionMatches(data, {
      ...commands[1],
      command: { ...commands[1].command, expected_plan_hash: "bad" },
    }),
    false,
  );
  check(
    adapter.pendingRevisionMatches(data, {
      ...commands[2],
      command: { ...commands[2].command, output_bytes: 201 },
    }),
    false,
  );
  check(
    adapter.pendingRevisionMatches(data, {
      ...commands[3],
      command: { ...commands[3].command, outcome: "NEEDS_MORE_WORK" },
    }),
    false,
  );
  check(adapter.revisionText("🙂".repeat(2000)));
  for (const value of ["", "  ", "\0", "\ud800", "🙂".repeat(2001)])
    check(adapter.revisionText(value), false);
  const entry = { plan: f.plan, approval: f.approval, candidates: [] };
  check(adapter.eligibleRevisionCandidate(f.candidateJob, f.source, entry));
  for (const job of [
    f.sourceJob,
    { ...f.candidateJob, status: "FAILED" },
    { ...f.candidateJob, assembly_version_id: f.source.assembly_version_id },
    { ...f.candidateJob, created_at: f.approval.created_at },
    { ...f.candidateJob, episode_id: "other" },
    { ...f.candidateJob, output_sha256: null },
  ])
    check(adapter.eligibleRevisionCandidate(job, f.source, entry), false);
  const cache = new Map();
  globalThis.localStorage = {
    get length() {
      return cache.size;
    },
    key: (index) => [...cache.keys()][index] ?? null,
    getItem: (key) => cache.get(key) ?? null,
    setItem: (key, value) => cache.set(key, value),
    removeItem: (key) => cache.delete(key),
  };
  const key = recovery.revisionRecoveryKey(f.sourceJob);
  check(recovery.readPendingRevision(key), null);
  cache.set(key, JSON.stringify(commands[0]));
  assert.deepEqual(recovery.readPendingRevision(key), commands[0]);
  checks++;
  cache.set(key, "bad");
  check(recovery.readPendingRevision(key), undefined);
  check(cache.get(key), "bad");
  globalThis.localStorage = {
    getItem() {
      throw Error("unavailable");
    },
  };
  check(recovery.readPendingRevision(key), undefined);
  check(recovery.revisionRecoveryKey({ ...f.sourceJob, output_bytes: 101 }) !== key);
  check(
    inputs.parseRevisionInput({ ...inputs.emptyRevisionInput, instruction: "🙂".repeat(2000) }) !==
      null,
  );
  for (const patch of [
    { actor_id: "renderer" },
    { noteIds: [f.savedNote.note_id, f.savedNote.note_id] },
    { segmentIds: ["bad"] },
    { candidateOperationId: "/private/path" },
    { outcome: "FIXED" },
    { reason: "\0" },
    { instruction: "\ud800" },
  ])
    check(inputs.parseRevisionInput({ ...inputs.emptyRevisionInput, ...patch }), null);
  globalThis.localStorage = {
    get length() {
      return cache.size;
    },
    key: (index) => [...cache.keys()][index] ?? null,
    getItem: (key) => cache.get(key) ?? null,
    setItem: (key, value) => cache.set(key, value),
    removeItem: (key) => cache.delete(key),
  };
  const inputKey = inputs.revisionInputKey(f.sourceJob);
  check(inputs.readRevisionInput(inputKey).status, "READY");
  cache.set(inputKey, "bad-json");
  check(inputs.readRevisionInput(inputKey).status, "INVALID");
  check(cache.get(inputKey), "bad-json");
  cache.set(
    inputKey,
    JSON.stringify({
      ...inputs.emptyRevisionInput,
      instruction: "保留的指令",
      noteIds: [f.savedNote.note_id],
    }),
  );
  check(inputs.readRevisionInput(inputKey).input.instruction, "保留的指令");
  check(inputs.revisionInputKey({ ...f.sourceJob, output_bytes: 101 }) !== inputKey);
  check(adapter.revisionMatches(f.candidateData(), f.source));
  check(recovery.revisionRecoveryKey(f.source), recovery.revisionRecoveryKey(f.sourceJob));
  check(inputs.revisionInputKey(f.source), inputs.revisionInputKey(f.sourceJob));
  const failed = { ...f.sourceJob, status: "FAILED", output_sha256: null, output_bytes: null };
  check(adapter.revisionMatches(f.candidateData(), failed), false);
  const before = f.candidateData();
  before.plans[0].candidates[0].recheck = f.recheck;
  const after = globalThis.structuredClone(before);
  after.output_verified = false;
  after.plans[0].candidates[0].output_verified = false;
  check(adapter.revisionPreservesHistory(before, after));
  check(adapter.revisionPreservesHistory(before, { ...after, plans: [] }), false);
  const altered = globalThis.structuredClone(after);
  altered.plans[0].plan.instruction = "rewrite";
  check(adapter.revisionPreservesHistory(before, altered), false);
  const lostRecheck = globalThis.structuredClone(after);
  lostRecheck.plans[0].candidates[0].recheck = null;
  check(adapter.revisionPreservesHistory(before, lostRecheck), false);
  const ordered = globalThis.structuredClone(f.plannedData());
  ordered.plans[0].plan.notes.push({ ...f.savedNote, note_id: `drn_${"a".repeat(32)}` });
  ordered.plans[0].plan.affected_segments.push({ ...f.sourceSegment, segment_id: "seg_visual_2" });
  const orderedCommand = {
    ...commands[0],
    command: {
      ...commands[0].command,
      note_ids: ordered.plans[0].plan.notes.map((n) => n.note_id),
      affected_segment_ids: ordered.plans[0].plan.affected_segments.map((n) => n.segment_id),
    },
  };
  check(adapter.pendingRevisionMatches(ordered, orderedCommand));
  check(
    adapter.pendingRevisionMatches(ordered, {
      ...orderedCommand,
      command: {
        ...orderedCommand.command,
        note_ids: [...orderedCommand.command.note_ids].reverse(),
      },
    }),
    false,
  );
  check(
    adapter.pendingRevisionMatches(ordered, {
      ...orderedCommand,
      command: {
        ...orderedCommand.command,
        affected_segment_ids: [...orderedCommand.command.affected_segment_ids].reverse(),
      },
    }),
    false,
  );
  cache.delete(key);
  cache.set(key, JSON.stringify(commands[0]));
  check(recovery.setAsidePendingRevision(f.source, commands[0]));
  check(recovery.readPendingRevision(key), null);
  const aside = recovery.readSetAsideRevisions(f.source);
  check(aside.length, 1);
  assert.deepEqual(aside[0].pending, commands[0]);
  checks++;
  const timestamp = aside[0].set_aside_at;
  cache.set(key, JSON.stringify(commands[0]));
  check(recovery.setAsidePendingRevision(f.source, commands[0]));
  check(recovery.readSetAsideRevisions(f.source)[0].set_aside_at, timestamp);
  cache.set(key, JSON.stringify(commands[0]));
  const normalStorage = globalThis.localStorage;
  globalThis.localStorage = {
    ...normalStorage,
    get length() {
      return cache.size;
    },
    removeItem() {
      throw Error("blocked");
    },
  };
  check(recovery.setAsidePendingRevision(f.source, commands[0]), false);
  assert.deepEqual(recovery.readPendingRevision(key), commands[0]);
  checks++;
  globalThis.localStorage = normalStorage;
  const unknown = {
    ...commands[0],
    command: { ...commands[0].command, plan_id: `drp_${"c".repeat(32)}` },
  };
  cache.set(key, JSON.stringify(unknown));
  globalThis.localStorage = {
    ...normalStorage,
    get length() {
      return cache.size;
    },
    setItem() {
      throw Error("full");
    },
  };
  check(recovery.setAsidePendingRevision(f.source, unknown), false);
  assert.deepEqual(recovery.readPendingRevision(key), unknown);
  checks++;
  globalThis.localStorage = normalStorage;
  cache.set(recovery.setAsideRevisionKey(f.source), "corrupt");
  check(recovery.readSetAsideRevisions(f.source), undefined);
  check(recovery.setAsidePendingRevision(f.source, unknown), false);
  check(cache.get(recovery.setAsideRevisionKey(f.source)), "corrupt");
  cache.delete(recovery.setAsideRevisionKey(f.source));
  const methods = [
    "listDraftReviewRevisionPlans",
    "getDraftReviewRevisionScope",
    "createDraftReviewRevisionPlan",
    "approveDraftReviewRevisionPlan",
    "attachDraftReviewRevisionCandidate",
    "recheckDraftReviewRevisionCandidate",
  ];
  const calls = new Map();
  const reply = { kind: "REMOTE_UNKNOWN" };
  const bridge = {
    listDraftExports() {},
    getDraftExport() {},
    createDraftExportFromPicker() {},
    cancelDraftExport() {},
    listDraftReviewNotes() {},
    createDraftReviewNote() {},
    resolveDraftReviewNote() {},
  };
  for (const method of methods)
    bridge[method] = function (...args) {
      check(this, bridge);
      calls.set(method, args);
      return Promise.resolve(reply);
    };
  const gateway = transport.desktopDraftExports(bridge);
  assert.deepEqual(Object.keys(gateway.revision), methods);
  checks++;
  for (const method of methods) {
    const old = transport.desktopDraftExports({ ...bridge, [method]: undefined });
    check(old.revision, undefined);
    check(typeof old.review.createDraftReviewNote, "function");
    check(typeof old.createFromPicker, "function");
  }
  const scopeArgs = [f.source.project_id, f.source.episode_id, f.source.operation_id];
  const args = [
    scopeArgs,
    scopeArgs,
    [...scopeArgs, commands[0].command],
    [...scopeArgs, f.plan.plan_id, commands[1].command],
    [...scopeArgs, f.plan.plan_id, commands[2].command],
    [...scopeArgs, f.plan.plan_id, f.candidate.candidate_id, commands[3].command],
  ];
  for (let index = 0; index < methods.length; index++) {
    check(await gateway.revision[methods[index]](...args[index]), reply);
    assert.deepEqual(calls.get(methods[index]), args[index]);
    checks++;
  }
  console.log(
    JSON.stringify({
      check: "isolated frontend revision adapter/recovery stdlib assertions",
      passed: checks,
      runtimeUI: "not run",
      dependencies: "none",
      temporaryFilesRemoved: true,
    }),
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}

/* global process, setTimeout, clearTimeout, btoa */
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { _electron as electron } from "playwright-core";

import { runDesktopProviderResult } from "./desktop-provider-result.mjs";

const kind = process.argv[2];
if (kind !== "fake-timeline" && kind !== "proposal")
  throw new Error("usage: electron-headless-operation-recovery.mjs <fake-timeline|proposal>");

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const evidenceDir = join(
  root,
  ".aijian-dev",
  `c20-${kind}-headless`,
  `${Date.now()}-${process.pid}-${randomUUID()}`,
);
const runId = `${kind}-headless-recovery-${Date.now()}-${process.pid}-${randomUUID()}`;
const resultPath = join(evidenceDir, "run-result.json");
const desktopMain = join(root, "apps", "desktop", "dist", "main.js");
const desktopPreload = join(root, "apps", "desktop", "dist", "preload.js");
const webIndex = join(root, "apps", "studio-web", "dist", "index.html");
const CLOSE_TIMEOUT_MS = 10_000;
// Keep generated media well under the Windows executable/path limits while
// remaining inside this checkout's disposable evidence root.
const profilePrefix = join(root, ".aijian-dev", "c20p-");
const electronExecutable = join(
  root,
  "apps",
  "desktop",
  "node_modules",
  "electron",
  "dist",
  process.platform === "win32" ? "electron.exe" : "electron",
);
const python = join(
  root,
  ".venv",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);
const harnessDir = join(root, ".aijian-dev", "c20-headless-harness");

function runPython(script, args) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(python, [script, ...args], {
      cwd: root,
      env: { ...process.env, PYTHONPATH: join(root, "services", "api", "src") },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(`fixture helper failed: ${stderr}`));
      else {
        try {
          resolveResult(JSON.parse(stdout));
        } catch (error) {
          reject(error);
        }
      }
    });
  });
}

async function harnessAsset() {
  const assets = await readdir(join(harnessDir, "assets"));
  const file = assets.find((item) => /^index-.*\.js$/.test(item));
  if (!file) throw new Error("build the C20 headless harness before running this check");
  return join(harnessDir, "assets", file);
}

async function launch(profile, fault) {
  const faultMode = kind === "fake-timeline" ? "after-201-once" : "after-commit-once";
  const app = await electron.launch({
    executablePath: electronExecutable,
    args: [join(root, "apps", "desktop"), `--user-data-dir=${profile}`],
    cwd: root,
    timeout: 30_000,
    env: {
      ...process.env,
      AIJIAN_E2E_USER_DATA_DIR: profile,
      ...(fault
        ? {
            [kind === "fake-timeline"
              ? "AIJIAN_E2E_FAKE_TIMELINE_RUN_RESPONSE_FAULT"
              : "AIJIAN_E2E_PROPOSAL_RUN_RESPONSE_FAULT"]: faultMode,
          }
        : {}),
    },
  });
  return { app };
}

async function inject(page, asset) {
  // The production app intentionally permits only self-hosted scripts.  This is a
  // per-CDP-session test override so the untrusted test asset never becomes a
  // desktop trusted URL or a production CSP exception.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Page.setBypassCSP", { enabled: true });
  await page.reload();
  await page.addScriptTag({ path: asset, type: "module" });
  await page.waitForFunction(() => typeof globalThis.c20HeadlessRun === "function");
}

function journalKey(projectId) {
  return `aijian.${kind === "fake-timeline" ? "fake-timeline" : "proposal"}-run.pending.v1:${projectId}`;
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function inspectPersisted(database, projectId) {
  const helper =
    kind === "fake-timeline" ? "seed_fake_timeline_recovery.py" : "proposal_run_evidence.py";
  const args =
    kind === "fake-timeline"
      ? [database, projectId]
      : ["inspect", "--database", database, "--project-id", projectId];
  return runPython(join(here, helper), kind === "fake-timeline" ? ["inspect", ...args] : args);
}

function assertTerminalCardinality(persisted) {
  const expected =
    kind === "fake-timeline"
      ? {
          workflow_count: 1,
          node_count: 1,
          attempt_count: 1,
          task_count: 1,
          intent_count: 1,
          timeline_count: 1,
        }
      : { workflow_count: 1, attempt_count: 1, task_count: 1, intent_count: 1, proposal_count: 1 };
  for (const [field, value] of Object.entries(expected)) {
    if (persisted[field] !== value)
      throw new Error(`${kind} recovery duplicated or lost ${field}: ${JSON.stringify(persisted)}`);
  }
  const successful =
    kind === "fake-timeline"
      ? persisted.workflow_status === "SUCCEEDED" &&
        persisted.node_status === "SUCCEEDED" &&
        persisted.attempt_status === "SUCCEEDED" &&
        persisted.task_status === "COMPLETED"
      : persisted.workflow_status === "SUCCEEDED" &&
        persisted.node_status === "SUCCEEDED" &&
        persisted.attempt_status === "SUCCEEDED" &&
        persisted.task_status === "COMPLETED" &&
        persisted.agent_status === "SUCCEEDED" &&
        persisted.skill_status === "SUCCEEDED";
  if (!successful)
    throw new Error(
      `${kind} worker did not reach its expected terminal success state: ${JSON.stringify(persisted)}`,
    );
  if (
    kind === "fake-timeline" &&
    (persisted.task_kind !== "local.timeline.assemble.fake.media.v1" ||
      persisted.output_version_id !== persisted.timeline_version_id ||
      persisted.timeline_latest_version_id !== persisted.timeline_version_id ||
      persisted.timeline_accepted_version_id !== null ||
      persisted.producer_attempt_id !== persisted.attempt_id ||
      persisted.gate_decision_count !== 0 ||
      persisted.review_submission_count !== 0 ||
      persisted.provider_connection_count !== 0)
  ) {
    throw new Error(
      `${kind} terminal identity or approval boundary is invalid: ${JSON.stringify(persisted)}`,
    );
  }
}

async function waitForTerminalCardinality(database, projectId) {
  let last;
  for (let attempt = 0; attempt < 480; attempt += 1) {
    last = await inspectPersisted(database, projectId);
    const terminalFailures = [
      last.workflow_status,
      last.node_status,
      last.attempt_status,
      last.task_status,
    ].filter((status) => status === "FAILED" || status === "CANCELLED");
    if (terminalFailures.length > 0) {
      throw new Error(`${kind} worker reached terminal failure: ${JSON.stringify(last)}`);
    }
    try {
      assertTerminalCardinality(last);
      return last;
    } catch (error) {
      if (attempt === 479) throw error;
      await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
    }
  }
  throw new Error(`unreachable terminal cardinality: ${JSON.stringify(last)}`);
}

async function waitForReplaySafeState(database, projectId) {
  if (kind === "fake-timeline") return waitForTerminalCardinality(database, projectId);
  let last;
  for (let attempt = 0; attempt < 480; attempt += 1) {
    last = await inspectPersisted(database, projectId);
    const readyForReview =
      last.workflow_count === 1 &&
      last.attempt_count === 1 &&
      last.task_count === 1 &&
      last.intent_count === 1 &&
      last.proposal_count === 1 &&
      last.workflow_status === "ACTIVE" &&
      last.node_status === "NEEDS_REVIEW" &&
      last.attempt_status === "RUNNING" &&
      last.task_status === "COMPLETED" &&
      last.agent_status === "NEEDS_REVIEW" &&
      last.skill_status === "NEEDS_REVIEW" &&
      typeof last.proposal_id === "string";
    if (readyForReview) return last;
    const failed = [
      last.workflow_status,
      last.node_status,
      last.attempt_status,
      last.task_status,
    ].some((status) => status === "FAILED" || status === "CANCELLED");
    if (failed) throw new Error(`${kind} worker reached terminal failure: ${JSON.stringify(last)}`);
    if (attempt === 479)
      throw new Error(
        `${kind} proposal never reached its review-ready state: ${JSON.stringify(last)}`,
      );
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
  }
  throw new Error(`unreachable replay-safe state: ${JSON.stringify(last)}`);
}

async function executeRecovery(runState) {
  if (!existsSync(electronExecutable)) throw new Error("Electron runtime is missing");
  await mkdir(evidenceDir, { recursive: true });
  const asset = await harnessAsset();
  const build_inputs = await builtInputHashes(asset);
  runState.profile = await mkdtemp(profilePrefix);
  const profile = runState.profile;
  let app;
  const setApp = (value) => {
    app = value;
    runState.app = value;
  };
  setApp((await launch(profile, false)).app);
  const page = await app.firstWindow();
  let fixture;
  if (kind === "fake-timeline") {
    fixture = await page.evaluate(async () => {
      const project = await globalThis.aijian.createProject({
        name: "C20 fake headless",
        aspect_ratio: "9:16",
        target_duration_seconds: 30,
        source_language: "zh-CN",
      });
      const source = await globalThis.aijian.importTextSource(project.data.id, {
        filename: "c20.txt",
        media_type: "text/plain",
        content_base64: btoa("C20 isolated source"),
      });
      return { project_id: project.data.id, source_id: source.data.id };
    });
    fixture = await runPython(join(here, "seed_fake_timeline_recovery.py"), [
      "seed",
      join(profile, "workspace", "workspace.sqlite3"),
      fixture.project_id,
      fixture.source_id,
    ]);
  } else {
    fixture = await runPython(join(here, "proposal_run_evidence.py"), [
      "seed",
      "--database",
      join(profile, "workspace", "workspace.sqlite3"),
    ]);
  }
  await withTimeout(app.close(), "Electron normal close");
  setApp(undefined);
  setApp((await launch(profile, true)).app);
  let pageFault = await app.firstWindow();
  await inject(pageFault, asset);
  const request =
    kind === "fake-timeline"
      ? {
          kind,
          projectId: fixture.project_id,
          input: {
            source_manifest_version_id: fixture.source_manifest_version_id,
            source_document_id: fixture.source_id,
          },
        }
      : {
          kind,
          projectId: fixture.project_id,
          input: {
            agent_definition: { definition_id: "writer.source-analyst", version: "1.0.0" },
            skill_definition: { definition_id: "source.extract", version: "1.0.0" },
            source_manifest_version_id: fixture.source_manifest_version_id,
            source_document_id: fixture.source_id,
            source_block_id: fixture.source_block_id,
            start_byte: fixture.start_byte,
            end_byte: fixture.end_byte,
          },
        };
  const first = await pageFault.evaluate((input) => globalThis.c20HeadlessRun(input), request);
  if (first.kind !== "REMOTE_UNKNOWN")
    throw new Error(
      `faulted response was not recorded as REMOTE_UNKNOWN: ${JSON.stringify(first)}`,
    );
  const key = journalKey(fixture.project_id);
  const pending = await pageFault.evaluate(
    (journalKey) => globalThis.localStorage.getItem(journalKey),
    key,
  );
  if (!pending) throw new Error("REMOTE_UNKNOWN did not retain the operation journal");
  const pendingOperation = JSON.parse(pending);
  if (
    pendingOperation.operation_id !== first.operation_id ||
    !sameJson(pendingOperation.input, request.input)
  ) {
    throw new Error(
      "REMOTE_UNKNOWN journal did not preserve the original operation identity and input",
    );
  }
  // A 201 response fault is a renderer uncertainty, not permission to stop the
  // Electron sidecar. Keep this instance alive until its one accepted task
  // completes, then verify the relaunch uses that same persisted operation.
  const completedBeforeReplay = await waitForReplaySafeState(
    join(profile, "workspace", "workspace.sqlite3"),
    fixture.project_id,
  );
  await withTimeout(app.close(), "Electron normal close");
  setApp(undefined);
  setApp((await launch(profile, false)).app);
  const pageReplay = await app.firstWindow();
  await inject(pageReplay, asset);
  const replay = await pageReplay.evaluate((input) => globalThis.c20HeadlessRun(input), request);
  if (
    replay.kind !== "SUCCEEDED" ||
    replay.operation_id !== first.operation_id ||
    replay.replayed !== true ||
    replay.journal_cleanup_pending
  )
    throw new Error("relaunch did not replay and complete the original operation");
  const remaining = await pageReplay.evaluate(
    (journalKey) => globalThis.localStorage.getItem(journalKey),
    key,
  );
  if (remaining !== null) throw new Error("definite success did not clean the operation journal");
  let acceptance;
  if (kind === "proposal") {
    if (typeof completedBeforeReplay.proposal_id !== "string") {
      throw new Error(
        `proposal worker did not persist a proposal id: ${JSON.stringify(completedBeforeReplay)}`,
      );
    }
    acceptance = await pageReplay.evaluate(
      ({ projectId, proposalId }) =>
        globalThis.aijian.acceptArtifactProposalAsDraft(projectId, proposalId, {
          parent_version_id: null,
          expected_head_revision: null,
        }),
      { projectId: fixture.project_id, proposalId: completedBeforeReplay.proposal_id },
    );
    if (acceptance.kind !== "SUCCEEDED") {
      throw new Error(
        `proposal DRAFT acceptance did not definitely succeed: ${JSON.stringify(acceptance)}`,
      );
    }
  }
  const persisted = await inspectPersisted(
    join(profile, "workspace", "workspace.sqlite3"),
    fixture.project_id,
  );
  assertTerminalCardinality(persisted);
  if (
    kind === "proposal" &&
    (persisted.acceptance_count !== 1 ||
      persisted.draft_version_id !== persisted.latest_version_id ||
      persisted.accepted_version_id !== null ||
      persisted.gate_decision_count !== 0)
  ) {
    throw new Error(`proposal DRAFT acceptance state is invalid: ${JSON.stringify(persisted)}`);
  }
  await withTimeout(app.close(), "Electron normal close");
  setApp(undefined);
  const evidence = {
    runner: "scripts/e2e/electron-headless-operation-recovery.mjs",
    runner_sha256: await sha256(fileURLToPath(import.meta.url)),
    build_inputs,
    kind,
    fixture,
    operation_id: first.operation_id,
    request_input: request.input,
    pending_operation: pendingOperation,
    replayed: replay.replayed,
    acceptance,
    persisted,
    harness_sha256: createHash("sha256")
      .update(await readFile(asset))
      .digest("hex"),
    assertions: {
      actual_preload_bridge: true,
      isolated_profile_relaunch: true,
      remote_unknown_journal_retained: true,
      journal_input_unchanged: true,
      replay_same_operation: true,
      replayed_true: true,
      cardinality_exactly_one: true,
      proposal_accepted_as_single_immutable_draft: kind === "proposal",
      journal_cleaned: true,
      bounded_normal_close_each_phase: true,
      compiled_build_inputs_hashed: true,
    },
  };
  await writeFile(join(evidenceDir, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`, {
    flag: "wx",
  });
  return evidence;
}

function withTimeout(promise, label, timeoutMs = CLOSE_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function sha256(path) {
  if (!existsSync(path)) throw new Error(`required built artifact is missing: ${path}`);
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

async function builtInputHashes(asset) {
  const paths = {
    desktop_main_js: desktopMain,
    desktop_preload_js: desktopPreload,
    studio_web_index_html: webIndex,
    headless_harness_js: asset,
  };
  const hashes = {};
  for (const [name, path] of Object.entries(paths)) {
    hashes[name] = {
      path: path.slice(root.length + 1).replaceAll("\\", "/"),
      sha256: await sha256(path),
    };
  }
  return hashes;
}

async function cleanupRecovery(runState, directory = evidenceDir) {
  if (runState.profile === undefined) {
    await writeFile(
      join(directory, "cleanup.json"),
      `${JSON.stringify({ profileRemoved: false, profileRetained: false, reason: "profile was never created" }, null, 2)}\n`,
      { flag: "wx" },
    );
    return;
  }
  if (runState.app) {
    try {
      await withTimeout(runState.app.close(), "Electron normal close (cleanup)");
      runState.app = undefined;
    } catch (error) {
      runState.closeError = error;
      await writeFile(
        join(directory, "cleanup.json"),
        `${JSON.stringify({ profileRemoved: false, profileRetained: true, closeError: String(error) }, null, 2)}\n`,
        { flag: "wx" },
      );
      throw error;
    }
  }
  await rm(runState.profile, { recursive: true, force: false });
  const profileRetained = existsSync(runState.profile);
  await writeFile(
    join(directory, "cleanup.json"),
    `${JSON.stringify({ profileRemoved: !profileRetained, profileRetained }, null, 2)}\n`,
    { flag: "wx" },
  );
  if (profileRetained)
    throw new Error(`owned Electron profile remained after cleanup: ${runState.profile}`);
  runState.profile = undefined;
}

async function main() {
  await mkdir(evidenceDir, { recursive: true });
  const runState = { profile: undefined, app: undefined, closeError: undefined };
  const completed = await runDesktopProviderResult({
    writePath: resultPath,
    runId,
    body: () => executeRecovery(runState),
    cleanup: () => cleanupRecovery(runState),
  });
  process.stdout.write(
    `${JSON.stringify({ status: completed.stage, runId, resultPath, evidenceDir })}\n`,
  );
}

async function runFailurePathSelfTest() {
  const directory = join(
    root,
    ".aijian-dev",
    "c20-shared-recovery-protocol",
    `failure-path-selftest-${Date.now()}-${process.pid}`,
  );
  await mkdir(directory, { recursive: true });
  const cases = [];
  async function expectFailed(name, state) {
    const caseDirectory = join(directory, name);
    await mkdir(caseDirectory);
    const writePath = join(caseDirectory, "run-result.json");
    let failure;
    try {
      await runDesktopProviderResult({
        writePath,
        runId: `${name}-${randomUUID()}`,
        body: async () => {
          throw new Error(`injected ${name} body failure`);
        },
        cleanup: () => cleanupRecovery(state, caseDirectory),
      });
    } catch (error) {
      failure = error;
    }
    if (!failure) throw new Error(`${name} unexpectedly passed`);
    const result = JSON.parse(await readFile(writePath, "utf8"));
    const cleanup = JSON.parse(await readFile(join(caseDirectory, "cleanup.json"), "utf8"));
    cases.push({
      name,
      stage: result.stage,
      primaryError: result.primaryError,
      cleanupError: result.cleanupError,
      cleanup,
    });
    return { result, cleanup };
  }
  const prelaunchProfile = await mkdtemp(join(directory, "prelaunch-profile-"));
  const prelaunch = await expectFailed("body-fail-prelaunch-cleanup", {
    profile: prelaunchProfile,
    app: undefined,
    closeError: undefined,
  });
  if (
    prelaunch.result.stage !== "FAILED" ||
    prelaunch.result.cleanupError ||
    existsSync(prelaunchProfile) ||
    !prelaunch.cleanup.profileRemoved
  )
    throw new Error("prelaunch failure did not use cleanupRecovery to remove its owned profile");
  const retainedProfile = await mkdtemp(join(directory, "close-fail-profile-"));
  const closeFailure = await expectFailed("body-and-close-fail", {
    profile: retainedProfile,
    app: {
      close: async () => {
        throw new Error("injected normal close failure");
      },
    },
    closeError: undefined,
  });
  if (
    closeFailure.result.stage !== "FAILED" ||
    !closeFailure.result.primaryError ||
    !closeFailure.result.cleanupError ||
    !existsSync(retainedProfile) ||
    !closeFailure.cleanup.profileRetained
  )
    throw new Error("dual failure did not retain both body and cleanup facts or the profile");
  await rm(retainedProfile, { recursive: true, force: false });
  await writeFile(
    join(directory, "selftest.json"),
    `${JSON.stringify({ status: "PASSED", cases }, null, 2)}\n`,
    { flag: "wx" },
  );
  process.stdout.write(`${JSON.stringify({ status: "PASSED", evidenceDir: directory })}\n`);
}

if (process.env.AIJIAN_C20_RUNNER_SELF_TEST === "1") await runFailurePathSelfTest();
else await main();

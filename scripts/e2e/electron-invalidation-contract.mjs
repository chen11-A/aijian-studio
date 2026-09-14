/* global process, setTimeout, clearTimeout */

import { deepStrictEqual } from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { _electron as electron } from "playwright-core";

import { runDesktopProviderResult } from "./desktop-provider-result.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const evidenceRoot = join(repositoryRoot, ".aijian-dev", "c20-invalidation-contract");
const desktopMain = join(repositoryRoot, "apps", "desktop", "dist", "main.js");
const desktopPreload = join(repositoryRoot, "apps", "desktop", "dist", "preload.js");
const webIndex = join(repositoryRoot, "apps", "studio-web", "dist", "index.html");
const electronExecutable = join(
  repositoryRoot,
  "apps",
  "desktop",
  "node_modules",
  "electron",
  "dist",
  process.platform === "win32" ? "electron.exe" : "electron",
);
const seeder = join(scriptDirectory, "seed_invalidation_operation_workspace.py");
const pythonExecutable = join(
  repositoryRoot,
  ".venv",
  process.platform === "win32" ? "Scripts" : "bin",
  process.platform === "win32" ? "python.exe" : "python",
);
const runId = `invalidation-contract-${Date.now()}-${process.pid}-${randomUUID()}`;
const evidenceDirectory = join(evidenceRoot, runId);
const profilePrefix = join(evidenceDirectory, "profile-");
const resultPath = join(evidenceDirectory, "run-result.json");
const CLOSE_TIMEOUT_MS = 10_000;

function boundedRedacted(value) {
  const redacted = String(value)
    .replace(/\b(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/\b(bearer|token|api[_-]?key|secret)\s*[:=]?\s*[^\s,;]+/gi, "$1=[REDACTED]");
  return redacted.length <= 8_192 ? redacted : redacted.slice(-8_192);
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

async function runSeeder(command, workspaceDirectory) {
  return new Promise((resolveResult, rejectResult) => {
    const child = spawn(pythonExecutable, [seeder, command, workspaceDirectory], {
      cwd: repositoryRoot,
      env: { ...process.env, PYTHONPATH: join(repositoryRoot, "services", "api", "src") },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) =>
      rejectResult(
        new Error(`seeder ${command} failed to start: ${boundedRedacted(error.message)}`, {
          cause: error,
        }),
      ),
    );
    child.once("close", (code) => {
      if (code !== 0) {
        rejectResult(new Error(`seeder ${command} failed: ${boundedRedacted(stderr)}`));
        return;
      }
      try {
        resolveResult(JSON.parse(stdout));
      } catch (error) {
        rejectResult(new Error(`seeder ${command} returned invalid JSON`, { cause: error }));
      }
    });
  });
}

async function builtInputHashes() {
  const inputs = {
    desktop_main_js: desktopMain,
    desktop_preload_js: desktopPreload,
    studio_web_index_html: webIndex,
  };
  const hashes = {};
  for (const [name, path] of Object.entries(inputs)) {
    if (!existsSync(path)) throw new Error(`required built desktop artifact is missing: ${path}`);
    hashes[name] = {
      path: path.slice(repositoryRoot.length + 1).replaceAll("\\", "/"),
      sha256: createHash("sha256")
        .update(await readFile(path))
        .digest("hex"),
    };
  }
  if (!existsSync(electronExecutable))
    throw new Error(`required Electron runtime is missing: ${electronExecutable}`);
  return hashes;
}

async function writeCleanupRecord(directory, record) {
  await writeFile(join(directory, "cleanup.json"), `${JSON.stringify(record, null, 2)}\n`, {
    flag: "wx",
  });
}

async function cleanupOwnedProfile({
  evidenceDirectory: directory,
  profileDirectory,
  launched,
  closeApplication,
}) {
  if (profileDirectory === undefined) {
    await writeCleanupRecord(directory, {
      profileRemoved: false,
      profileRetained: false,
      launched,
      reason: "profile was never created",
    });
    return;
  }
  if (launched) {
    try {
      await closeApplication();
    } catch (error) {
      await writeCleanupRecord(directory, {
        profileRemoved: false,
        profileRetained: true,
        launched: true,
        closeError: boundedRedacted(error.message),
      });
      throw error;
    }
  }
  await rm(profileDirectory, { recursive: true, force: false });
  if (existsSync(profileDirectory))
    throw new Error(`owned Electron profile remained after cleanup: ${profileDirectory}`);
  await writeCleanupRecord(directory, { profileRemoved: true, profileRetained: false, launched });
}

async function runMain() {
  await mkdir(evidenceDirectory, { recursive: true });
  let profileDirectory;
  let application;
  let launched = false;
  const cleanup = async () => {
    const applicationToClose = application;
    await cleanupOwnedProfile({
      evidenceDirectory,
      profileDirectory,
      launched,
      closeApplication: async () => {
        if (applicationToClose === undefined)
          throw new Error("Electron launched without an application handle");
        await withTimeout(applicationToClose.close(), "Electron normal close");
      },
    });
    application = undefined;
    profileDirectory = undefined;
  };
  const completed = await runDesktopProviderResult({
    writePath: resultPath,
    runId,
    cleanup,
    body: async () => {
      const buildInputs = await builtInputHashes();
      profileDirectory = await mkdtemp(profilePrefix);
      const workspaceDirectory = join(profileDirectory, "workspace");
      if (process.env.AIJIAN_C20_TEST_SEED_FAILURE === "1")
        throw new Error("injected C20 seed failure");
      const seeded = await runSeeder("seed", workspaceDirectory);
      application = await electron.launch({
        executablePath: electronExecutable,
        args: [join(repositoryRoot, "apps", "desktop"), `--user-data-dir=${profileDirectory}`],
        cwd: repositoryRoot,
        env: { ...process.env, AIJIAN_E2E_USER_DATA_DIR: profileDirectory },
        timeout: 30_000,
      });
      launched = true;
      const page = await application.firstWindow({ timeout: 30_000 });
      const before = await runSeeder("snapshot", workspaceDirectory);
      const actual = await page.evaluate(
        async ({ projectId, operationId }) => {
          const bridge = globalThis.aijian;
          const firstList = await bridge.listInvalidationOperations(projectId);
          const repeatedList = await bridge.listInvalidationOperations(projectId);
          const firstDetail = await bridge.getInvalidationOperation(projectId, operationId);
          const repeatedDetail = await bridge.getInvalidationOperation(projectId, operationId);
          let missing = "";
          try {
            await bridge.getInvalidationOperation(projectId, `ivo_${"f".repeat(32)}`);
          } catch (error) {
            missing = error instanceof Error ? error.message : String(error);
          }
          return {
            firstList,
            repeatedList,
            firstDetail,
            repeatedDetail,
            missing,
            publicBridge: {
              listInvalidationOperations: typeof bridge.listInvalidationOperations,
              getInvalidationOperation: typeof bridge.getInvalidationOperation,
              process: typeof bridge.process,
              require: typeof bridge.require,
              token: typeof bridge.token,
              origin: typeof bridge.origin,
              fetch: typeof bridge.fetch,
              invoke: typeof bridge.invoke,
            },
          };
        },
        { projectId: seeded.project_id, operationId: seeded.operation_id },
      );
      const after = await runSeeder("snapshot", workspaceDirectory);
      deepStrictEqual(actual.firstDetail.data, seeded.expected_data);
      deepStrictEqual(actual.repeatedDetail.data, seeded.expected_data);
      deepStrictEqual(actual.firstList.data, actual.repeatedList.data);
      deepStrictEqual(actual.firstDetail.data, actual.repeatedDetail.data);
      deepStrictEqual(actual.firstList.data.items, [
        {
          operation_id: seeded.operation_id,
          project_id: seeded.project_id,
          changed_artifact_id: seeded.expected_data.changed_artifact_id,
          old_accepted_version_id: seeded.expected_data.old_accepted_version_id,
          new_accepted_version_id: seeded.expected_data.new_accepted_version_id,
          gate_decision_id: seeded.expected_data.gate_decision_id,
          assessment_hash: seeded.expected_data.assessment_hash,
          created_at: seeded.expected_data.created_at,
          reason_path_count: seeded.expected_data.paths.length,
        },
      ]);
      if (actual.firstList.data.next_cursor !== null)
        throw new Error("seeded list unexpectedly paginated");
      if (
        !actual.missing.includes("status 404") ||
        !actual.missing.includes("INVALIDATION_OPERATION_NOT_FOUND")
      )
        throw new Error("missing invalidation operation did not propagate the sidecar 404");
      deepStrictEqual(actual.publicBridge, {
        listInvalidationOperations: "function",
        getInvalidationOperation: "function",
        process: "undefined",
        require: "undefined",
        token: "undefined",
        origin: "undefined",
        fetch: "undefined",
        invoke: "undefined",
      });
      deepStrictEqual(after, before);
      const evidence = {
        runner: "scripts/e2e/electron-invalidation-contract.mjs",
        runner_sha256: createHash("sha256")
          .update(await readFile(fileURLToPath(import.meta.url)))
          .digest("hex"),
        build_inputs: buildInputs,
        seeded: {
          project_id: seeded.project_id,
          operation_id: seeded.operation_id,
          reason_path_count: seeded.expected_data.paths.length,
        },
        database: { before, after, unchanged: true },
        assertions: {
          public_preload_list_and_detail: true,
          repeated_reads_equal: true,
          missing_id_404_propagated: true,
          database_unchanged: true,
          no_privileged_bridge_access: true,
        },
      };
      await writeFile(
        join(evidenceDirectory, "evidence.json"),
        `${JSON.stringify(evidence, null, 2)}\n`,
        { flag: "wx" },
      );
      return evidence;
    },
  });
  process.stdout.write(
    `${JSON.stringify({ status: completed.stage, runId, resultPath, evidenceDirectory })}\n`,
  );
}

async function runFailurePathSelfTest() {
  const root = join(evidenceRoot, `failure-path-selftest-${Date.now()}-${process.pid}`);
  await mkdir(root, { recursive: true });
  const cases = [];
  async function expectFailedCase(name, body, cleanup, profileDirectory) {
    const caseDirectory = join(root, name);
    await mkdir(caseDirectory);
    const writePath = join(caseDirectory, "result.json");
    let failure;
    try {
      await runDesktopProviderResult({
        writePath,
        runId: `${name}-${randomUUID()}`,
        body,
        cleanup,
      });
    } catch (error) {
      failure = error;
    }
    if (failure === undefined) throw new Error(`${name} unexpectedly passed`);
    const result = JSON.parse(await readFile(writePath, "utf8"));
    if (result.stage !== "FAILED" || result.passed !== false)
      throw new Error(`${name} did not record FAILED state`);
    cases.push({
      name,
      result_stage: result.stage,
      profile_exists_after_failure: existsSync(profileDirectory),
      cleanup: JSON.parse(await readFile(join(caseDirectory, "cleanup.json"), "utf8")),
    });
  }
  const seedProfile = await mkdtemp(join(root, "seed-profile-"));
  await expectFailedCase(
    "seed-failure",
    async () => {
      throw new Error("injected seed failure");
    },
    () =>
      cleanupOwnedProfile({
        evidenceDirectory: join(root, "seed-failure"),
        profileDirectory: seedProfile,
        launched: false,
        closeApplication: async () => {
          throw new Error("not reached");
        },
      }),
    seedProfile,
  );
  if (cases.at(-1).profile_exists_after_failure)
    throw new Error("seed failure did not remove its owned pre-launch profile");
  const closeProfile = await mkdtemp(join(root, "close-profile-"));
  await expectFailedCase(
    "normal-close-failure",
    async () => ({ fixture: true }),
    () =>
      cleanupOwnedProfile({
        evidenceDirectory: join(root, "normal-close-failure"),
        profileDirectory: closeProfile,
        launched: true,
        closeApplication: async () => {
          throw new Error("injected normal close failure");
        },
      }),
    closeProfile,
  );
  if (!cases.at(-1).profile_exists_after_failure)
    throw new Error("normal close failure did not retain its owned profile");
  const output = { status: "PASSED", cases, retained_profile: closeProfile };
  await writeFile(join(root, "selftest.json"), `${JSON.stringify(output, null, 2)}\n`, {
    flag: "wx",
  });
  process.stdout.write(`${JSON.stringify({ ...output, evidenceDirectory: root })}\n`);
}

if (process.env.AIJIAN_C20_RUNNER_SELF_TEST === "1") await runFailurePathSelfTest();
else await runMain();

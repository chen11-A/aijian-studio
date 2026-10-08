/* global process, setTimeout, clearTimeout, AbortSignal, btoa */

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
const evidenceRoot = join(repositoryRoot, ".aijian-dev", "c20-source-manifest-contract");
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
const snapshotSeeder = join(scriptDirectory, "seed_invalidation_operation_workspace.py");
const pythonExecutable = join(
  repositoryRoot,
  ".venv",
  process.platform === "win32" ? "Scripts" : "bin",
  process.platform === "win32" ? "python.exe" : "python",
);
const runId = `source-manifest-contract-${Date.now()}-${process.pid}-${randomUUID()}`;
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

async function waitFor(read, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let value;
  do {
    value = await read();
    if (value) return value;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  } while (Date.now() < deadline);
  throw new Error(`${label} timed out`);
}

async function runSnapshot(workspaceDirectory) {
  return new Promise((resolveResult, rejectResult) => {
    const child = spawn(pythonExecutable, [snapshotSeeder, "snapshot", workspaceDirectory], {
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
        new Error(`snapshot failed to start: ${boundedRedacted(error.message)}`, { cause: error }),
      ),
    );
    child.once("close", (code) => {
      if (code !== 0) {
        rejectResult(new Error(`snapshot failed: ${boundedRedacted(stderr)}`));
        return;
      }
      try {
        resolveResult(JSON.parse(stdout));
      } catch (error) {
        rejectResult(new Error("snapshot returned invalid JSON", { cause: error }));
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

async function writeCleanupRecord(record) {
  await writeFile(join(evidenceDirectory, "cleanup.json"), `${JSON.stringify(record, null, 2)}\n`, {
    flag: "wx",
  });
}

async function installDialogObservation(application) {
  await application.evaluate(({ dialog }) => {
    const original = dialog.showMessageBox;
    const state = {
      calls: [],
      restore: () => {
        dialog.showMessageBox = original;
      },
    };
    globalThis.__c20SourceDialog = state;
    dialog.showMessageBox = (_parent, options) => {
      let resolve;
      const call = {
        defaultId: options.defaultId,
        cancelId: options.cancelId,
        title: options.title,
        message: options.message,
        detail: options.detail,
        hasSignal: options.signal instanceof AbortSignal,
        aborted: false,
        response: null,
        completed: false,
        settle(response) {
          call.response = response;
          call.completed = true;
          resolve({ response });
        },
      };
      options.signal?.addEventListener(
        "abort",
        () => {
          call.aborted = true;
        },
        { once: true },
      );
      state.calls.push(call);
      return new Promise((resume) => {
        resolve = resume;
      });
    };
  });
}

async function main() {
  await mkdir(evidenceDirectory, { recursive: true });
  let application;
  let profileDirectory;
  let launched = false;
  const cleanup = async () => {
    if (profileDirectory === undefined) {
      await writeCleanupRecord({
        profileRemoved: false,
        profileRetained: false,
        launched,
        reason: "profile was never created",
      });
      return;
    }
    if (launched) {
      try {
        await withTimeout(application.close(), "Electron normal close");
      } catch (error) {
        await writeCleanupRecord({
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
    await writeCleanupRecord({ profileRemoved: true, profileRetained: false, launched });
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
      application = await electron.launch({
        executablePath: electronExecutable,
        args: [join(repositoryRoot, "apps", "desktop"), `--user-data-dir=${profileDirectory}`],
        cwd: repositoryRoot,
        env: { ...process.env, AIJIAN_E2E_USER_DATA_DIR: profileDirectory },
        timeout: 30_000,
      });
      launched = true;
      const page = await application.firstWindow({ timeout: 30_000 });
      const identity = await page.evaluate(async () => {
        const project = await globalThis.aijian.createProject({
          name: "C20 source manifest cancellation fixture",
          aspect_ratio: "9:16",
          target_duration_seconds: 90,
          source_language: "zh-CN",
        });
        await globalThis.aijian.importTextSource(project.data.id, {
          filename: "headless-source.txt",
          media_type: "text/plain",
          content_base64: btoa("C20 source manifest cancellation fixture."),
        });
        const manifest = await globalThis.aijian.getSourceManifest(project.data.id);
        if (!manifest) throw new Error("source manifest missing after public import");
        return {
          project_id: project.data.id,
          version_id: manifest.data.latest_version.id,
          content_hash: manifest.data.latest_version.content_hash,
          expected_revision: manifest.data.head.revision,
        };
      });
      await installDialogObservation(application);

      const nativeCancel = page.evaluate(
        (input) => globalThis.aijian.submitSourceManifest(input),
        identity,
      );
      await waitFor(
        () => application.evaluate(() => globalThis.__c20SourceDialog.calls.length === 1),
        "native cancellation dialog",
      );
      const nativePending = await runSnapshot(workspaceDirectory);
      await application.evaluate(() => globalThis.__c20SourceDialog.calls[0].settle(0));
      const nativeResult = await nativeCancel;
      const nativeAfter = await runSnapshot(workspaceDirectory);
      deepStrictEqual(nativeAfter, nativePending);
      deepStrictEqual(nativeResult, {
        kind: "CANCELLED",
        phase: "confirm_submit",
        identity,
        completed_actions: [],
        receipts: [],
      });
      const nativeObservation = await application.evaluate(() => {
        const call = globalThis.__c20SourceDialog.calls[0];
        return {
          defaultId: call.defaultId,
          cancelId: call.cancelId,
          title: call.title,
          hasSignal: call.hasSignal,
          response: call.response,
          completed: call.completed,
        };
      });
      if (
        nativeObservation.defaultId !== 0 ||
        nativeObservation.cancelId !== 0 ||
        nativeObservation.response !== 0 ||
        !nativeObservation.hasSignal
      )
        throw new Error("native cancellation did not preserve safe dialog defaults and signal");

      const documentLoss = page.evaluate(
        (input) => globalThis.aijian.submitSourceManifest(input),
        identity,
      );
      void documentLoss.catch(() => undefined);
      await waitFor(
        () => application.evaluate(() => globalThis.__c20SourceDialog.calls.length === 2),
        "document-loss dialog",
      );
      const lossPending = await runSnapshot(workspaceDirectory);
      await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
      await waitFor(
        () => application.evaluate(() => globalThis.__c20SourceDialog.calls[1].aborted === true),
        "document-loss AbortSignal",
      );
      await application.evaluate(() => globalThis.__c20SourceDialog.calls[1].settle(0));
      const lossAfter = await runSnapshot(workspaceDirectory);
      deepStrictEqual(lossAfter, lossPending);
      const lossObservation = await application.evaluate(() => {
        const call = globalThis.__c20SourceDialog.calls[1];
        return {
          hasSignal: call.hasSignal,
          aborted: call.aborted,
          response: call.response,
          completed: call.completed,
        };
      });
      deepStrictEqual(lossObservation, {
        hasSignal: true,
        aborted: true,
        response: 0,
        completed: true,
      });
      await application.evaluate(() => globalThis.__c20SourceDialog.restore());

      const evidence = {
        runner: "scripts/e2e/electron-source-manifest-contract.mjs",
        runner_sha256: createHash("sha256")
          .update(await readFile(fileURLToPath(import.meta.url)))
          .digest("hex"),
        build_inputs: buildInputs,
        identity,
        assertions: {
          public_create_import_manifest_submit: true,
          native_cancel_no_post_prepare_mutation: true,
          document_loss_aborts_pending_native_confirmation: true,
          document_loss_no_post_prepare_mutation: true,
        },
        database: {
          native_pending: nativePending,
          native_after: nativeAfter,
          loss_pending: lossPending,
          loss_after: lossAfter,
        },
        native_cancel: nativeObservation,
        document_loss: lossObservation,
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

await main();

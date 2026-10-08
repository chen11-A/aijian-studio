import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const qaRoot = path.dirname(fileURLToPath(import.meta.url));
const c19 = "C:\\Users\\Administrator\\.codex\\worktrees\\c19-trim-211c9e8-qa-20260923";
const snapshotDir = "C:\\Users\\Administrator\\Documents\\AIVORA\\management\\manager-handoffs\\release-snapshots\\20260928-c19-r1-external-overlay-candidate-1";
const profile = "C:\\Users\\Administrator\\Documents\\Codex\\q2r1b-20260929";
const localAppData = path.join(profile, "AppData", "Local");
const desktop = path.join(qaRoot, "overlay", "apps", "desktop");
const source = path.join(desktop, "src");
const baselineSource = path.join(c19, "apps", "desktop", "src");
const resultDir = path.join(qaRoot, "results-once");
const require = createRequire(import.meta.url);
const ts = require(path.join(c19, "node_modules", "typescript", "lib", "typescript.js"));
const { canonical, within } = require(path.join(qaRoot, "path-canonical.cjs"));

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").toUpperCase();
}

function filesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(full) : [full];
  }).sort();
}

function fail(message) {
  throw new Error(message);
}

function freezeCheck() {
  const manifestPath = path.join(qaRoot, "FROZEN-MANIFEST.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  for (const item of manifest.files) {
    assert.equal(sha256(path.join(qaRoot, item.path)), item.sha256, `QA packet file drift: ${item.path}`);
  }
  const expectedHead = "211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2";
  const head = execFileSync("git", ["-C", c19, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  assert.equal(head, expectedHead, "c19 HEAD drift");
  const status = execFileSync("git", ["-C", c19, "status", "--porcelain=v1", "-uall"], { encoding: "utf8" });
  const statusLines = status.trimEnd().split(/\r?\n/).filter(Boolean).length;
  assert.equal(statusLines, 111, "c19 status count drift");
  assert.equal(sha256(path.join(baselineSource, "main.ts")), "E1BAAA599BB340BA4F2DEAD8755485B2E55406894E23F29D225EC0690823ABF0");
  assert.equal(sha256(path.join(snapshotDir, "SNAPSHOT.json")), "2E4EB5B707A1BC1BFEE33CDF71C373F61D0CCC4A0BA8DD80F434D34C64496987");
  const snapshot = JSON.parse(fs.readFileSync(path.join(snapshotDir, "SNAPSHOT.json"), "utf8"));
  const mapped = new Map([
    ["main.ts", "main.after.ts"],
    ["sidecar-process.ts", "sidecar-process.ts"],
    ["sidecar-startup-diagnostic.ts", "sidecar-startup-diagnostic.ts"],
    ["sidecar-extraction-temp.ts", "sidecar-extraction-temp.ts"],
  ]);
  assert.equal(mapped.size, snapshot.destinations.length);
  for (const item of snapshot.files) {
    assert.equal(sha256(path.join(snapshotDir, item.name)), item.sha256, `snapshot file drift: ${item.name}`);
  }
  const baseline = filesUnder(baselineSource).filter((file) => file.endsWith(".ts"));
  const overlay = filesUnder(source).filter((file) => file.endsWith(".ts"));
  assert.equal(baseline.length, 57);
  assert.equal(overlay.length, 59);
  const differences = [];
  for (const file of overlay) {
    const relative = path.relative(source, file);
    const original = path.join(baselineSource, relative);
    const oldHash = fs.existsSync(original) ? sha256(original) : "ABSENT";
    const newHash = sha256(file);
    if (oldHash !== newHash) differences.push({ path: relative.replaceAll("\\", "/"), oldHash, newHash });
  }
  assert.equal(differences.length, 4, "physical overlay changed more than four paths");
  for (const destination of snapshot.destinations) {
    const relative = destination.path.replace("apps/desktop/src/", "");
    const actual = differences.find((item) => item.path === relative);
    assert.ok(actual, `missing expected difference: ${relative}`);
    assert.equal(actual.oldHash, destination.old_sha256);
    assert.equal(actual.newHash, destination.new_sha256);
    assert.equal(actual.newHash, sha256(path.join(snapshotDir, mapped.get(relative))));
  }
  for (const file of ["tsconfig.json", "package.json"]) {
    assert.equal(sha256(path.join(desktop, file)), sha256(path.join(c19, "apps", "desktop", file)));
  }
  const link = fs.lstatSync(path.join(desktop, "node_modules"));
  assert.ok(link.isSymbolicLink(), "node_modules must be a read-only dependency junction");
  assert.equal(fs.realpathSync.native(path.join(desktop, "node_modules")).toLowerCase(),
    fs.realpathSync.native(path.join(c19, "apps", "desktop", "node_modules")).toLowerCase());
  return { head, statusLines, snapshotSha256: sha256(path.join(snapshotDir, "SNAPSHOT.json")), packetManifestSha256: sha256(manifestPath), differences };
}

function formatDiagnostics(diagnostics) {
  return ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: () => qaRoot,
    getCanonicalFileName: (file) => file,
    getNewLine: () => "\n",
  });
}

function compileFullProgram() {
  const configPath = path.join(desktop, "tsconfig.json");
  const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
  if (loaded.error) fail(formatDiagnostics([loaded.error]));
  const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, desktop, undefined, configPath);
  if (parsed.errors.length) fail(formatDiagnostics(parsed.errors));
  assert.equal(parsed.fileNames.length, 59, "full TS root set incomplete");
  assert.equal(path.resolve(parsed.options.outDir).toLowerCase(), path.join(desktop, "dist").toLowerCase());
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const closure = program.getSourceFiles().map((item) => ({
    path: item.fileName,
    sha256: sha256(item.fileName),
    category: within(item.fileName, source) ? "QA_OVERLAY_SOURCE" :
      within(item.fileName, c19) ? "C19_READ_ONLY_DEPENDENCY" : "OTHER_READ_ONLY_DEPENDENCY",
  })).sort((a, b) => a.path.localeCompare(b.path));
  assert.ok(closure.some((item) => canonical(item.path) === canonical(path.join(source, "main.ts"))), "release main entry absent");
  assert.equal(closure.filter((item) => item.category === "QA_OVERLAY_SOURCE").length, 59);
  const frozenClosure = JSON.parse(fs.readFileSync(path.join(qaRoot, "CLOSURE-PREFLIGHT.json"), "utf8"));
  assert.equal(ts.version, frozenClosure.compilerVersion, "TypeScript version drift");
  assert.equal(closure.length, frozenClosure.programFileCount, "TypeScript closure size drift");
  const frozenFiles = new Map(frozenClosure.files.map((item) => [item.canonicalPath, item]));
  assert.equal(frozenFiles.size, closure.length, "frozen closure has duplicate paths");
  for (const item of closure) {
    const frozen = frozenFiles.get(canonical(item.path));
    assert.ok(frozen, `new TypeScript dependency: ${item.path}`);
    assert.equal(item.sha256, frozen.sha256, `TypeScript dependency hash drift: ${item.path}`);
    assert.equal(item.category, frozen.category, `TypeScript dependency category drift: ${item.path}`);
  }
  fs.writeFileSync(path.join(resultDir, "typescript-closure.json"), JSON.stringify({
    rootFiles: parsed.fileNames.length,
    programFiles: closure.length,
    compilerVersion: ts.version,
    compilerOptions: parsed.options,
    files: closure,
  }, null, 2));
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length) fail(`Full desktop TypeScript typecheck RED:\n${formatDiagnostics(diagnostics)}`);
  const emitted = program.emit();
  if (emitted.emitSkipped || emitted.diagnostics.length) {
    fail(`Full desktop TypeScript emit RED:\n${formatDiagnostics(emitted.diagnostics)}`);
  }
  const expectedOutputs = ["main.js", "sidecar-process.js", "sidecar-startup-diagnostic.js", "sidecar-extraction-temp.js"];
  const outputHashes = Object.fromEntries(expectedOutputs.map((file) => {
    const full = path.join(desktop, "dist", file);
    assert.ok(fs.existsSync(full), `missing release emit ${file}`);
    return [file, sha256(full)];
  }));
  return { typecheck: "PASS", emit: "PASS", rootFiles: parsed.fileNames.length, programFiles: closure.length, compilerVersion: ts.version, outputHashes };
}

async function runFakeChildCases() {
  const { startSidecar, SidecarStartupError } = require(path.join(desktop, "dist", "sidecar-process.js"));
  const { createSidecarExtractionTemp } = require(path.join(desktop, "dist", "sidecar-extraction-temp.js"));
  assert.equal(fs.existsSync(profile), false, "QA profile must be fresh");
  const originalTemp = process.env.TEMP;
  const originalTmp = process.env.TMP;
  const originalForbidden = process.env.AIVORA_QA02_FORBIDDEN;
  process.env.AIVORA_QA02_FORBIDDEN = "do-not-forward";
  const cases = [];
  try {
    for (const [mode, expected] of [
      ["ready", "READY"],
      ["busy", "WORKSPACE_BUSY"],
      ["false-busy", "STARTUP_UNKNOWN"],
      ["wrong-code", "STARTUP_UNKNOWN"],
      ["timeout", "STARTUP_UNKNOWN"],
      ["survivor", "WORKSPACE_BUSY"],
    ]) {
      const extraction = createSidecarExtractionTemp(localAppData, profile);
      const capturePath = path.join(resultDir, `fake-child-${mode}.json`);
      let actual;
      let exit;
      try {
        const handle = await startSidecar({
          command: process.execPath,
          args: [path.join(qaRoot, "fake-child.cjs"), mode, capturePath],
          cwd: qaRoot,
          env: { TEMP: extraction.directory, TMP: extraction.directory },
          cleanupAfterClose: extraction.cleanupAfterClose,
          startupTimeoutMs: mode === "timeout" ? 200 : 3000,
          shutdownTimeoutMs: 3000,
        });
        actual = "READY";
        assert.equal(mode, "ready", "unexpected handshake");
        assert.equal(handle.session.pid > 0, true);
        await handle.stop();
        exit = await handle.exited;
        assert.equal(exit.code, 0);
      } catch (error) {
        if (!(error instanceof SidecarStartupError)) throw error;
        actual = error.classification;
      }
      const captured = JSON.parse(fs.readFileSync(capturePath, "utf8"));
      assert.equal(actual, expected, `${mode} classification`);
      assert.equal(captured.TEMP, extraction.directory, `${mode} child TEMP`);
      assert.equal(captured.TMP, extraction.directory, `${mode} child TMP`);
      assert.equal(captured.forbiddenPresent, false, `${mode} inherited forbidden env`);
      assert.equal(process.env.TEMP, originalTemp, `${mode} parent TEMP changed`);
      assert.equal(process.env.TMP, originalTmp, `${mode} parent TMP changed`);
      const wrapperExistsAfterClose = fs.existsSync(extraction.directory);
      assert.equal(wrapperExistsAfterClose, mode === "survivor", `${mode} cleanup boundary`);
      if (mode === "survivor") {
        assert.equal(fs.readFileSync(path.join(extraction.directory, "_MEIqa02", "survivor.txt"), "utf8"), "QA02 fake child survivor");
      }
      cases.push({ mode, expected, actual, captured, extractionDirectory: extraction.directory, wrapperExistsAfterClose, exit });
    }
  } finally {
    if (originalForbidden === undefined) delete process.env.AIVORA_QA02_FORBIDDEN;
    else process.env.AIVORA_QA02_FORBIDDEN = originalForbidden;
    assert.equal(process.env.TEMP, originalTemp);
    assert.equal(process.env.TMP, originalTmp);
  }
  return cases;
}

async function main() {
  const approval = process.argv.find((item) => item.startsWith("--mgr02-approval="))?.slice("--mgr02-approval=".length);
  if (!approval || !/^MGR02-R1-[A-Za-z0-9_-]{8,100}$/.test(approval)) {
    fail("R1 gate is unsigned; require exact MGR02 one-shot approval token");
  }
  if (fs.existsSync(resultDir)) fail("One-shot result directory already exists; no automatic retry");
  const frozen = freezeCheck();
  fs.mkdirSync(resultDir, { recursive: false });
  const record = { schema: "qa02.c19-r1-ts-gate.v1", approval, qaRoot, c19, profile, frozen, startedAt: new Date().toISOString() };
  try {
    record.typescript = compileFullProgram();
    record.fakeChildCases = await runFakeChildCases();
    record.result = "PASS_LOCAL_TS_AND_FAKE_CHILD_ONLY";
  } catch (error) {
    record.result = "RED_STOPPED";
    record.error = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error);
  }
  record.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(resultDir, "result.json"), JSON.stringify(record, null, 2));
  console.log(JSON.stringify({ result: record.result, resultPath: path.join(resultDir, "result.json"), error: record.error?.message }));
  if (record.result !== "PASS_LOCAL_TS_AND_FAKE_CHILD_ONLY") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});

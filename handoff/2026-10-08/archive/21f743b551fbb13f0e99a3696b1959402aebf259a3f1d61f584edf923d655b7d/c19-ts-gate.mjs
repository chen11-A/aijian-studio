import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const qaRoot = path.dirname(fileURLToPath(import.meta.url));
const runRoot = path.join(qaRoot, "run-01");
const qaDist = path.join(runRoot, "dist");
const c19 = "C:\\Users\\Administrator\\.codex\\worktrees\\c19-trim-211c9e8-qa-20260923";
const desktop = path.join(c19, "apps", "desktop");
const source = path.join(desktop, "src");
const postPath = "C:\\Users\\Administrator\\Documents\\AIVORA\\management\\manager-handoffs\\release-snapshots\\20260929-c19-r1-four-path-prewrite-1\\POST.json";
const require = createRequire(import.meta.url);
const ts = require(path.join(c19, "node_modules", "typescript", "lib", "typescript.js"));
const { canonical, within } = require(path.join(qaRoot, "path-canonical.cjs"));
const { resolveDependencies } = require(path.join(qaRoot, "dependency-resolution.cjs"));
const sha = (data) => crypto.createHash("sha256").update(data).digest("hex").toUpperCase();
const shaFile = (file) => sha(fs.readFileSync(file));

function outputDirectoryInventory(relative) {
  const dir = path.join(c19, relative);
  if (!fs.existsSync(dir)) return { path: relative, exists: false, files: [] };
  const files = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else {
        assert.ok(entry.isFile(), `unexpected output link: ${full}`);
        files.push({ path: path.relative(dir, full).replaceAll("\\", "/"), sha256: shaFile(full), bytes: fs.statSync(full).size });
      }
    }
  };
  visit(dir);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { path: relative, exists: true, files };
}

function readC19State() {
  const head = execFileSync("git", ["-C", c19, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const status = execFileSync("git", ["-C", c19, "status", "--porcelain=v1", "-uall"], { encoding: "utf8" });
  return {
    head,
    statusSha256: sha(status),
    statusLines: status.trimEnd().split(/\r?\n/).filter(Boolean).length,
    postSha256: shaFile(postPath),
    sources: Object.fromEntries(["main.ts", "sidecar-process.ts", "sidecar-startup-diagnostic.ts", "sidecar-extraction-temp.ts"].map(
      (name) => [name, shaFile(path.join(source, name))],
    )),
    outputDirectories: ["apps/desktop/dist", "apps/desktop/build", "dist", "build"].map(outputDirectoryInventory),
  };
}

function checkFrozenFiles() {
  const manifest = JSON.parse(fs.readFileSync(path.join(qaRoot, "FROZEN-MANIFEST.json"), "utf8"));
  for (const item of manifest.files) {
    const file = path.join(qaRoot, item.path);
    assert.equal(shaFile(file), item.sha256, `QA packet hash drift: ${item.path}`);
    assert.equal(fs.statSync(file).size, item.bytes, `QA packet size drift: ${item.path}`);
  }
  const old = manifest.priorEvidence;
  for (const item of old) assert.equal(shaFile(item.path), item.sha256, `prior evidence drift: ${item.path}`);
  return { manifestSha256: shaFile(path.join(qaRoot, "FROZEN-MANIFEST.json")), frozenFiles: manifest.files.length };
}

function formatDiagnostics(diagnostics) {
  return ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: () => qaRoot,
    getCanonicalFileName: (file) => file,
    getNewLine: () => "\n",
  });
}

function prepareProgram(frozen) {
  const configPath = path.join(desktop, "tsconfig.json");
  assert.equal(shaFile(configPath), frozen.tsconfigSha256);
  assert.equal(shaFile(path.join(desktop, "package.json")), frozen.packageSha256);
  const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
  if (loaded.error) throw new Error(formatDiagnostics([loaded.error]));
  const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, desktop, undefined, configPath);
  if (parsed.errors.length) throw new Error(formatDiagnostics(parsed.errors));
  assert.equal(parsed.fileNames.length, frozen.rootFileCount);
  assert.equal(parsed.fileNames.length, 59);
  assert.equal(path.resolve(parsed.options.rootDir).toLowerCase(), path.resolve(source).toLowerCase());
  assert.equal(path.resolve(parsed.options.outDir).toLowerCase(), path.join(desktop, "dist").toLowerCase());
  const options = { ...parsed.options, outDir: qaDist };
  const program = ts.createProgram(parsed.fileNames, options);
  const files = program.getSourceFiles().map((item) => ({
    path: item.fileName,
    canonicalPath: canonical(item.fileName),
    category: within(item.fileName, source) ? "C19_DESKTOP_SOURCE" :
      within(item.fileName, c19) ? "C19_READ_ONLY_DEPENDENCY" : "OUTSIDE_C19",
    sha256: shaFile(item.fileName),
  })).sort((a, b) => a.canonicalPath.localeCompare(b.canonicalPath));
  assert.equal(files.length, frozen.programFileCount);
  assert.equal(ts.version, frozen.compilerVersion);
  const frozenByPath = new Map(frozen.files.map((item) => [item.canonicalPath, item]));
  assert.equal(frozenByPath.size, files.length);
  for (const item of files) {
    const expected = frozenByPath.get(item.canonicalPath);
    assert.ok(expected, `new TypeScript source: ${item.path}`);
    assert.equal(item.sha256, expected.sha256, `TypeScript source hash drift: ${item.path}`);
    assert.equal(item.category, expected.category, `TypeScript source category drift: ${item.path}`);
  }
  assert.equal(files.filter((item) => item.category === "C19_DESKTOP_SOURCE").length, 59);
  assert.equal(files.filter((item) => item.category === "OUTSIDE_C19").length, 0);
  assert.equal(files.filter((item) => item.canonicalPath === canonical(path.join(source, "main.ts"))).length, 1);
  const moduleResolutions = resolveDependencies(ts, options, source, desktop, c19, canonical);
  assert.deepEqual(moduleResolutions, frozen.moduleResolutions, "module/type resolution drift");
  return { program, options, files, moduleResolutions };
}

function guardedWrite(fileName, data, writeByteOrderMark, _onError, sourceFiles, emitted) {
  assert.ok(path.isAbsolute(fileName), `non-absolute emit: ${fileName}`);
  const target = path.resolve(fileName);
  const prefix = `${path.resolve(qaDist).toLowerCase()}${path.sep}`;
  assert.ok(target.toLowerCase().startsWith(prefix), `emit outside QA dist: ${fileName}`);
  const parent = path.dirname(target);
  fs.mkdirSync(parent, { recursive: true });
  const realQaDist = fs.realpathSync.native(qaDist).toLowerCase();
  const realParent = fs.realpathSync.native(parent).toLowerCase();
  assert.ok(realParent === realQaDist || realParent.startsWith(`${realQaDist}${path.sep}`),
    `emit parent escapes QA dist: ${fileName}`);
  const buffer = Buffer.from(`${writeByteOrderMark ? "\uFEFF" : ""}${data}`, "utf8");
  fs.writeFileSync(target, buffer, { flag: "wx" });
  emitted.push({ path: path.relative(qaDist, target).replaceAll("\\", "/"), sha256: sha(buffer), bytes: buffer.length,
    sourceFiles: (sourceFiles ?? []).map((item) => canonical(item.fileName)) });
}

async function main() {
  const approval = process.argv.find((item) => item.startsWith("--mgr02-approval="))?.slice("--mgr02-approval=".length);
  assert.ok(approval && /^MGR02-C19TS-[A-Za-z0-9_-]{8,100}$/.test(approval), "c19 TS gate unsigned");
  assert.equal(fs.existsSync(runRoot), false, "one-shot output already exists");
  const frozen = JSON.parse(fs.readFileSync(path.join(qaRoot, "STATIC-CLOSURE.json"), "utf8"));
  const frozenPacket = checkFrozenFiles();
  const before = readC19State();
  assert.equal(before.head, frozen.head);
  assert.equal(before.statusSha256, frozen.statusSha256);
  assert.equal(before.statusLines, 114);
  assert.equal(before.postSha256, frozen.postSha256);
  assert.deepEqual(before.sources, frozen.sourceDestinations);
  assert.deepEqual(before.outputDirectories, frozen.outputDirectories);
  fs.mkdirSync(runRoot, { recursive: false });
  const record = { schema: "qa02.c19-postsync-ts-gate.v1", approval, c19, qaRoot, startedAt: new Date().toISOString(), frozenPacket, before };
  try {
    const prepared = prepareProgram(frozen);
    record.closure = { rootFiles: frozen.rootFileCount, programFiles: prepared.files.length, compilerVersion: ts.version,
      moduleResolutions: prepared.moduleResolutions, files: prepared.files };
    fs.writeFileSync(path.join(runRoot, "actual-closure.json"), JSON.stringify(record.closure, null, 2));
    const diagnostics = ts.getPreEmitDiagnostics(prepared.program);
    if (diagnostics.length) throw new Error(`Full c19 desktop TypeScript typecheck RED:\n${formatDiagnostics(diagnostics)}`);
    record.typecheck = "PASS";
    const emitted = [];
    const emitResult = prepared.program.emit(undefined, (fileName, data, writeByteOrderMark, onError, sourceFiles) =>
      guardedWrite(fileName, data, writeByteOrderMark, onError, sourceFiles, emitted));
    if (emitResult.emitSkipped || emitResult.diagnostics.length) {
      throw new Error(`Full c19 desktop TypeScript emit RED:\n${formatDiagnostics(emitResult.diagnostics)}`);
    }
    emitted.sort((a, b) => a.path.localeCompare(b.path));
    record.emit = { state: "PASS", outDir: qaDist, files: emitted };
    for (const file of ["main.js", "sidecar-process.js", "sidecar-startup-diagnostic.js", "sidecar-extraction-temp.js"]) {
      assert.ok(emitted.some((item) => item.path === file), `missing release emit: ${file}`);
    }
    record.result = "PASS_C19_TS_QA_EMIT_ONLY";
  } catch (error) {
    record.result = "RED_STOPPED";
    record.error = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error);
  }
  try {
    const after = readC19State();
    record.after = after;
    assert.deepEqual(after, before, "c19 source/status/output directories changed during gate");
    for (const item of frozen.files) {
      assert.equal(shaFile(item.path), item.sha256, `c19 program source changed during gate: ${item.path}`);
      assert.equal(canonical(item.path), item.canonicalPath, `c19 program source path changed during gate: ${item.path}`);
    }
    record.postflightSourceFiles = frozen.files.length;
    const frozenAfter = checkFrozenFiles();
    assert.deepEqual(frozenAfter, frozenPacket, "QA packet changed during gate");
  } catch (error) {
    record.result = "RED_POSTFLIGHT";
    record.postflightError = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error);
  }
  record.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(runRoot, "result.json"), JSON.stringify(record, null, 2));
  console.log(JSON.stringify({ result: record.result, typecheck: record.typecheck, emit: record.emit?.state,
    resultPath: path.join(runRoot, "result.json"), error: record.error?.message?.slice(0, 500), postflightError: record.postflightError?.message }));
  if (record.result !== "PASS_C19_TS_QA_EMIT_ONLY") process.exitCode = 1;
}

main().catch((error) => { console.error(error instanceof Error ? error.stack : error); process.exitCode = 1; });

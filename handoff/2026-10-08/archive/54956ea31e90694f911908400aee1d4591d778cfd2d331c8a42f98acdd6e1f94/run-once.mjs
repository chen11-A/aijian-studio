import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import vm from "node:vm";
import { createOverlayCompilerHost } from "./overlay-compiler.mjs";

const qaRoot = dirname(import.meta.filename);
const repo = "C:/Users/Administrator/.codex/worktrees/c19-trim-211c9e8-qa-20260923";
const snapshotRoot = "C:/Users/Administrator/Documents/AIVORA/management/manager-handoffs/release-snapshots/20260928-c19-packaged-resource-root-main-1";
const target = join(repo, "apps/desktop/src/main.ts");
const snapshotPath = join(snapshotRoot, "SNAPSHOT.json");
const candidatePath = join(snapshotRoot, "main.ts");
const tsconfigPath = join(repo, "apps/desktop/tsconfig.json");
const desktopDirectory = dirname(tsconfigPath);
const nodeTypesPath = join(desktopDirectory, "node_modules/@types/node/index.d.ts");
const tsRuntimePath = join(repo, "apps/desktop/node_modules/typescript/lib/typescript.js");
const options = Object.fromEntries(process.argv.slice(2).map((part) => {
  const equal = part.indexOf("=");
  assert.ok(part.startsWith("--") && equal > 2, `Invalid argument: ${part}`);
  return [part.slice(2, equal), part.slice(equal + 1)];
}));
for (const key of ["approval", "approval-sha256", "output"])
  assert.ok(options[key], `Missing ${key}`);
const approvalPath = resolve(options.approval);
const output = resolve(options.output);
const relationship = relative(qaRoot, output);
assert.ok(relationship && !relationship.startsWith("..") && !isAbsolute(relationship),
  "Output must be under this external QA directory");
assert.ok(!existsSync(output), "One-shot output already exists");
assert.notEqual(approvalPath.toLowerCase(),
  join(qaRoot, "RUN-APPROVAL.template.json").toLowerCase(), "Template is not approved");
const sha = (data) => createHash("sha256").update(data).digest("hex").toUpperCase();
const hash = (path) => sha(readFileSync(path));
assert.equal(hash(approvalPath), options["approval-sha256"].toUpperCase());
const approval = JSON.parse(readFileSync(approvalPath, "utf8"));
assert.equal(approval.schema, "qa03.c19-packaged-resource-root.one-shot.approval.v2");
assert.equal(approval.state, "APPROVED_SINGLE_RUN");
assert.equal(approval.runId, "qa03-resource-root-02");
assert.equal(resolve(approval.outputDir), output);
assert.equal(approval.packetSha256, hash(join(qaRoot, "PACKET.json")));
assert.equal(approval.runnerSha256, hash(import.meta.filename));
assert.equal(approval.overlayCompilerSha256, hash(join(qaRoot, "overlay-compiler.mjs")));
assert.equal(approval.snapshotSha256, hash(snapshotPath));
assert.equal(approval.snapshotSha256,
  "9D11A58DAD05D48BED698D05160A6FF7327C52BBEC630D0C0E03EE92A2D45364");
assert.equal(approval.candidateSha256, hash(candidatePath));
assert.equal(approval.candidateSha256,
  "E1BAAA599BB340BA4F2DEAD8755485B2E55406894E23F29D225EC0690823ABF0");
assert.equal(approval.baselineSha256, hash(target));
assert.equal(approval.baselineSha256,
  "443624A7007C6664DC232895464AA7DD41F4B38D14FB3315088B1AF9F702401E");
assert.equal(approval.typescriptSha256, hash(tsRuntimePath));
assert.equal(approval.tsconfigSha256, hash(tsconfigPath));
assert.equal(approval.nodeTypesSha256, hash(nodeTypesPath));
const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
const statusLines = () => git("status", "--porcelain", "-uall").trimEnd().split(/\r?\n/).filter(Boolean);
const statusSha = () => sha(statusLines().join("\n"));
assert.equal(git("rev-parse", "HEAD").trim(), approval.c19Head);
assert.equal(statusSha(), approval.c19StatusSha256);
const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
assert.equal(snapshot.status, "STATIC_EXTERNAL_CANDIDATE_NOT_SYNCED_NOT_QA_ACCEPTED");
assert.equal(snapshot.candidate_main_sha256, approval.candidateSha256);
assert.equal(snapshot.base_c19_main_sha256, approval.baselineSha256);
const candidate = readFileSync(candidatePath, "utf8");
const require = createRequire(import.meta.url);
const ts = require(tsRuntimePath);
mkdirSync(output);
const receipt = { schema: "qa03.c19-packaged-resource-root.v2", state: "RUNNING",
  startedUtc: new Date().toISOString(), pid: process.pid, output,
  approvalSha256: hash(approvalPath), snapshotSha256: hash(snapshotPath),
  candidateSha256: hash(candidatePath), baselineSha256: hash(target),
  typecheck: null, build: null, negative: null, postflight: null,
  firstRed: null, rawFiles: [] };
const save = () => writeFileSync(join(output, "RECEIPT.json"), JSON.stringify(receipt, null, 2) + "\n");
const sameTarget = (path) => resolve(path).toLowerCase() === resolve(target).toLowerCase();
function diagnosticsText(diagnostics) {
  return ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: (path) => path, getCurrentDirectory: () => repo,
    getNewLine: () => "\n",
  });
}
function negativeCases() {
  const source = ts.createSourceFile(candidatePath, candidate, ts.ScriptTarget.ES2022, true);
  const names = ["plainResource", "packagedResourceRoot", "packagedSidecarOptions",
    "packagedRendererIndex"];
  const declarations = source.statements.filter((node) =>
    ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
  assert.deepEqual(declarations.map((node) => node.name.text), names);
  const js = ts.transpileModule(declarations.map((node) => node.getText(source)).join("\n"),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const root = join(output, "mock-install", "resources");
  const sidecar = join(root, "sidecar");
  const config = join(root, "config");
  const renderer = join(root, "renderer");
  for (const path of [sidecar, config, renderer]) mkdirSync(path, { recursive: true });
  const exe = join(sidecar, "aijian-sidecar.exe");
  const lock = join(config, "media-toolchain-lock.json");
  const index = join(renderer, "index.html");
  for (const path of [exe, lock, index]) writeFileSync(path, "QA03 fixture\n");
  const app = { isPackaged: true, getPath: (name) => {
    assert.equal(name, "userData"); return join(output, "mock-user-data"); } };
  const processMock = { platform: "win32", resourcesPath: root };
  const functions = vm.runInNewContext(`${js}\n({packagedResourceRoot,packagedSidecarOptions,packagedRendererIndex})`,
    { lstatSync, isAbsolute, join, resolve, app, process: processMock });
  const cases = [];
  const positive = functions.packagedSidecarOptions();
  assert.equal(positive.command, exe);
  assert.equal(positive.cwd, sidecar);
  assert.deepEqual([...positive.args], []);
  assert.equal(positive.env.AIJIAN_RESOURCE_ROOT, root);
  assert.equal(functions.packagedRendererIndex(), index);
  cases.push({ name: "installed-layout", result: "PASS" });
  const mustReject = (name, action, expectedMessage, restore) => {
    let failure;
    try { action(); } catch (error) { failure = error; }
    if (restore) restore();
    assert.ok(failure instanceof Error || typeof failure?.message === "string",
      `${name} did not fail closed with an Error`);
    assert.equal(failure.message, expectedMessage,
      `${name} rejected for an unexpected reason`);
    cases.push({ name, result: "REJECTED_AS_EXPECTED",
      errorName: failure.name, errorMessage: failure.message });
  };
  unlinkSync(exe);
  mustReject("missing-sidecar-exe", () => functions.packagedSidecarOptions(),
    "Packaged sidecar resources are unavailable",
    () => writeFileSync(exe, "QA03 fixture\n"));
  unlinkSync(lock);
  mustReject("missing-media-lock", () => functions.packagedSidecarOptions(),
    "Packaged sidecar resources are unavailable",
    () => writeFileSync(lock, "QA03 fixture\n"));
  unlinkSync(index);
  mustReject("missing-renderer-index", () => functions.packagedRendererIndex(),
    "Packaged renderer is unavailable",
    () => writeFileSync(index, "QA03 fixture\n"));
  processMock.resourcesPath = join(output, "missing-resources");
  mustReject("missing-resource-root", () => functions.packagedResourceRoot(),
    "Packaged resource root is unavailable");
  processMock.resourcesPath = root;
  app.isPackaged = false;
  mustReject("unpackaged-runtime", () => functions.packagedResourceRoot(),
    "Packaged resources require a Windows installation");
  return cases;
}
try {
  const config = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  assert.equal(config.error, undefined, "tsconfig read failed");
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(tsconfigPath));
  assert.equal(parsed.errors.length, 0, diagnosticsText(parsed.errors));
  assert.ok(parsed.fileNames.some((path) => sameTarget(path)), "main.ts absent from project");
  const sharedOptions = { ...parsed.options,
    typeRoots: [join(desktopDirectory, "node_modules/@types")],
    incremental: false, tsBuildInfoFile: undefined };
  const typeOptions = { ...sharedOptions, noEmit: true };
  const typeProgram = ts.createProgram(parsed.fileNames, typeOptions,
    createOverlayCompilerHost(ts, typeOptions, target, candidate,
      undefined, desktopDirectory));
  const typeDiagnostics = ts.getPreEmitDiagnostics(typeProgram);
  const typeRaw = join(output, "typecheck.diagnostics.raw");
  writeFileSync(typeRaw, diagnosticsText(typeDiagnostics));
  receipt.typecheck = { diagnosticCount: typeDiagnostics.length,
    rawPath: typeRaw, rawSha256: hash(typeRaw) };
  assert.equal(typeDiagnostics.length, 0, "Candidate typecheck RED");

  const buildRoot = join(output, "build");
  const buildOptions = { ...sharedOptions, noEmit: false, noEmitOnError: true,
    outDir: buildRoot };
  const emitted = [];
  const writer = (path, data) => {
    const absolute = resolve(path);
    const relationship = relative(buildRoot, absolute);
    assert.ok(relationship && !relationship.startsWith("..") && !isAbsolute(relationship),
      `Emit escaped external build root: ${path}`);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, data);
    emitted.push(absolute);
  };
  const buildProgram = ts.createProgram(parsed.fileNames, buildOptions,
    createOverlayCompilerHost(ts, buildOptions, target, candidate,
      writer, desktopDirectory));
  const buildDiagnostics = ts.getPreEmitDiagnostics(buildProgram);
  const buildRaw = join(output, "build.diagnostics.raw");
  writeFileSync(buildRaw, diagnosticsText(buildDiagnostics));
  assert.equal(buildDiagnostics.length, 0, "Candidate build diagnostics RED");
  const emit = buildProgram.emit();
  assert.equal(emit.emitSkipped, false, "Candidate emit skipped");
  assert.equal(emit.diagnostics.length, 0, "Candidate emit diagnostics RED");
  receipt.build = { diagnosticCount: 0, rawPath: buildRaw, rawSha256: hash(buildRaw),
    emitted: emitted.map((path) => ({ path, bytes: statSync(path).size, sha256: hash(path) })) };
  assert.ok(emitted.some((path) => path.toLowerCase() === join(buildRoot, "main.js").toLowerCase()),
    "Candidate main.js missing from external build");

  const cases = negativeCases();
  const negativePath = join(output, "negative-cases.json");
  writeFileSync(negativePath, JSON.stringify(cases, null, 2) + "\n");
  receipt.negative = { cases, path: negativePath, sha256: hash(negativePath),
    scope: "EXTRACTED_FUNCTIONS_VM_MOCK_ONLY" };
  receipt.state = "EXTERNAL_TYPE_BUILD_AND_MOCK_NEGATIVES_PASS";
} catch (error) {
  receipt.state = "RED";
  receipt.firstRed = String(error?.stack ?? error);
} finally {
  receipt.postflight = { c19Head: git("rev-parse", "HEAD").trim(),
    c19StatusSha256: statusSha(), c19MainSha256: hash(target) };
  if (receipt.state !== "RED" && (receipt.postflight.c19Head !== approval.c19Head ||
      receipt.postflight.c19StatusSha256 !== approval.c19StatusSha256 ||
      receipt.postflight.c19MainSha256 !== approval.baselineSha256)) {
    receipt.state = "POSTFLIGHT_RED";
    receipt.firstRed = "c19 HEAD/status/main changed";
  }
  receipt.rawFiles = readdirSync(output, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name !== "RECEIPT.json")
    .map((entry) => { const path = join(output, entry.name);
      return { name: entry.name, bytes: statSync(path).size, sha256: hash(path) }; });
  receipt.finishedUtc = new Date().toISOString();
  save();
}
if (receipt.state !== "EXTERNAL_TYPE_BUILD_AND_MOCK_NEGATIVES_PASS") process.exitCode = 1;

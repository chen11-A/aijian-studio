import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const qaRoot = resolve(import.meta.dirname);
const snapshotRoot = "C:\\Users\\Administrator\\Documents\\AIVORA\\management\\manager-handoffs\\release-snapshots\\20260928-busy73-desktop-diagnostic-source-1";
const snapshotFile = join(snapshotRoot, "SNAPSHOT.json");
const snapshotHash = "3F2F604DB7E4770AC40C8404D9F164D380932376E307ECBC64801FAA3601CAF6";
const compilerFile = "C:\\Users\\Administrator\\.codex\\worktrees\\c19-trim-211c9e8-qa-20260923\\node_modules\\typescript";
const outputRoot = join(qaRoot, "busy73-desktop-local-01");
const compiledRoot = join(outputRoot, "compiled");
const names = ["sidecar-process.ts", "sidecar-startup-diagnostic.ts", "sidecar-protocol.ts"];
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex").toUpperCase();

assert.equal(sha(readFileSync(snapshotFile)), snapshotHash, "snapshot manifest changed");
const manifest = JSON.parse(readFileSync(snapshotFile, "utf8"));
const ts = require(compilerFile);
mkdirSync(compiledRoot, { recursive: true });
const sourceIdentity = [];
for (const name of names) {
  const relative = `apps\\desktop\\src\\${name}`;
  const expected = manifest.files.find((file) => file.relative_path === relative)?.sha256;
  assert.ok(expected, `missing manifest entry: ${name}`);
  const sourceFile = join(snapshotRoot, "source", "apps", "desktop", "src", name);
  const bytes = readFileSync(sourceFile);
  assert.equal(sha(bytes), expected, `source changed: ${name}`);
  const compiled = ts.transpileModule(bytes.toString("utf8"), {
    fileName: name,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  });
  assert.deepEqual(compiled.diagnostics ?? [], [], `TypeScript diagnostic: ${name}`);
  const compiledFile = join(compiledRoot, name.replace(/\.ts$/, ".js"));
  writeFileSync(compiledFile, compiled.outputText);
  sourceIdentity.push({ name, sha256: expected, compiled_sha256: sha(readFileSync(compiledFile)) });
}

const { startSidecar, SidecarStartupError } = require(join(compiledRoot, "sidecar-process.js"));
const { createSidecarStartupDiagnosticCollector } = require(join(compiledRoot, "sidecar-startup-diagnostic.js"));
const results = [];
const busy = "AIVORA_STARTUP_WORKSPACE_BUSY";
const opts = (script, extras = {}) => ({
  command: process.execPath,
  args: ["-e", script],
  cwd: qaRoot,
  startupTimeoutMs: 1500,
  shutdownTimeoutMs: 500,
  ...extras,
});

async function classify(name, options, expected) {
  const started = performance.now();
  let observed;
  try {
    const handle = await startSidecar(options);
    await handle.stop();
    observed = "UNEXPECTED_READY";
  } catch (error) {
    assert.ok(error instanceof SidecarStartupError, `${name}: unexpected error ${error}`);
    observed = error.classification;
  }
  assert.equal(observed, expected, name);
  results.push({ name, expected, observed, elapsed_ms: Math.round(performance.now() - started) });
}

function stderrThenExit(parts, code) {
  return `const parts=${JSON.stringify(parts)};let i=0;function write(){if(i===parts.length){process.exit(${code});return;}process.stderr.write(parts[i++],()=>setTimeout(write,5));}write();`;
}

await classify("exact_lf", opts(stderrThenExit([busy + "\n"], 73)), "WORKSPACE_BUSY");
await classify("exact_crlf", opts(stderrThenExit([busy + "\r\n"], 73)), "WORKSPACE_BUSY");
await classify("split_line", opts(stderrThenExit([busy.slice(0, 12), busy.slice(12) + "\n"], 73)), "WORKSPACE_BUSY");
await classify("code_only", opts(stderrThenExit([], 73)), "STARTUP_UNKNOWN");
await classify("missing_newline", opts(stderrThenExit([busy], 73)), "STARTUP_UNKNOWN");
await classify("substring", opts(stderrThenExit(["prefix_" + busy + "\n"], 73)), "STARTUP_UNKNOWN");
await classify("wrong_exit", opts(stderrThenExit([busy + "\n"], 1)), "STARTUP_UNKNOWN");
await classify("overflow", opts(stderrThenExit(["X".repeat(16 * 1024 + 1), busy + "\n"], 73)), "STARTUP_UNKNOWN");
await classify("spawn_failure", {
  command: join(qaRoot, "no-such-executable-busy73.exe"), args: [], cwd: qaRoot,
  startupTimeoutMs: 300, shutdownTimeoutMs: 300,
}, "STARTUP_UNKNOWN");
await classify("timeout", opts(`process.stderr.write(${JSON.stringify(busy + "\n")});setInterval(()=>{},1000);`, {
  startupTimeoutMs: 150, shutdownTimeoutMs: 500,
}), "STARTUP_UNKNOWN");

const collector = createSidecarStartupDiagnosticCollector();
collector.append(Buffer.from(busy + "\n"));
assert.equal(collector.classify({ code: 73, signal: "SIGTERM", spawn_failed: false, timed_out: false }), "STARTUP_UNKNOWN");
results.push({ name: "signal_gate", expected: "STARTUP_UNKNOWN", observed: "STARTUP_UNKNOWN" });

const token = "s".repeat(43);
const handshake = JSON.stringify({ event: "ready", host: "127.0.0.1", pid: 7654, port: 43123, protocol_version: 1, token });
const healthy = `process.stdin.resume();const timer=setInterval(()=>{},1000);process.stdin.on('end',()=>{clearInterval(timer);process.exit(0)});process.stdout.write(${JSON.stringify(handshake + "\n")});`;
const handle = await startSidecar(opts(healthy));
assert.equal(handle.session.port, 43123);
assert.equal(handle.session.token, token);
await handle.stop();
assert.deepEqual(await handle.exited, { code: 0, signal: null });
results.push({ name: "healthy_handshake_and_stop", expected: "READY_AND_CLEAN_EXIT", observed: "READY_AND_CLEAN_EXIT" });

const report = {
  status: "PASS_LOCAL_NODE_MOCK_ONLY",
  snapshot_sha256: snapshotHash,
  compiler_version: ts.version,
  node_version: process.version,
  source_identity: sourceIdentity,
  results,
};
writeFileSync(join(outputRoot, "RESULT.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ status: report.status, cases: results.length, result: join(outputRoot, "RESULT.json") }));

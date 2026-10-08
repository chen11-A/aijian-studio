import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { createOverlayCompilerHost } from "./overlay-compiler.mjs";

const root = dirname(import.meta.filename);
const output = join(root, "selfcheck-01");
assert.ok(!existsSync(output), "Selfcheck output already exists");
const sourceDir = join(output, "source");
const buildDir = join(output, "build");
mkdirSync(sourceDir, { recursive: true });
mkdirSync(buildDir, { recursive: true });
const sourcePath = join(sourceDir, "sample.ts");
const baseline = 'export const answer: number = "wrong";\n';
const candidate = "export const answer: number = 2;\n";
writeFileSync(sourcePath, baseline);
const tsRuntimePath = "C:/Users/Administrator/.codex/worktrees/c19-trim-211c9e8-qa-20260923/apps/desktop/node_modules/typescript/lib/typescript.js";
const ts = createRequire(import.meta.url)(tsRuntimePath);
const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();
const evidence = { schema: "qa03.resource-root-overlay-selfcheck.v1", state: "RUNNING",
  tsRuntimeSha256: sha(tsRuntimePath), sourcePath, baselineSha256: sha(sourcePath),
  typeDiagnostics: null, emitted: [], sourceAfterSha256: null, error: null };
try {
  const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    strict: true, rootDir: sourceDir, outDir: buildDir };
  const typeOptions = { ...options, noEmit: true };
  const typeProgram = ts.createProgram([sourcePath], typeOptions,
    createOverlayCompilerHost(ts, typeOptions, sourcePath, candidate));
  const diagnostics = ts.getPreEmitDiagnostics(typeProgram);
  evidence.typeDiagnostics = diagnostics.length;
  assert.equal(diagnostics.length, 0, "Overlay typecheck did not replace invalid baseline");
  const emitted = [];
  const writer = (path, data) => {
    const absolute = resolve(path);
    const rel = relative(buildDir, absolute);
    assert.ok(rel && !rel.startsWith(".."), "Emit escaped external selfcheck build");
    writeFileSync(absolute, data);
    emitted.push(absolute);
  };
  const buildProgram = ts.createProgram([sourcePath], options,
    createOverlayCompilerHost(ts, options, sourcePath, candidate, writer));
  const emit = buildProgram.emit();
  assert.equal(emit.emitSkipped, false);
  assert.equal(emit.diagnostics.length, 0);
  assert.deepEqual(emitted, [join(buildDir, "sample.js")]);
  assert.match(readFileSync(emitted[0], "utf8"), /answer\s*=\s*2/);
  evidence.emitted = emitted.map((path) => ({ path, sha256: sha(path) }));
  evidence.sourceAfterSha256 = sha(sourcePath);
  assert.equal(evidence.sourceAfterSha256, evidence.baselineSha256,
    "Source file changed during overlay selfcheck");
  evidence.state = "SELF_CHECK_PASS";
} catch (error) {
  evidence.state = "SELF_CHECK_RED";
  evidence.error = String(error?.stack ?? error);
  process.exitCode = 1;
} finally {
  writeFileSync(join(output, "SELFTEST.json"), JSON.stringify(evidence, null, 2) + "\n");
}

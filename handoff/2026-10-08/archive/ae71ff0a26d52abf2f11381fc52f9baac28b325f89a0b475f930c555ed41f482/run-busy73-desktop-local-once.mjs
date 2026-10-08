import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname);
const script = join(root, "verify-busy73-desktop-local.mjs");
const result = spawnSync(process.execPath, [script], {
  cwd: root,
  encoding: null,
  timeout: 20_000,
  maxBuffer: 1024 * 1024,
  windowsHide: true,
});
const stdout = result.stdout ?? Buffer.alloc(0);
const stderr = result.stderr ?? Buffer.alloc(0);
const outFile = join(root, "busy73-desktop-local-01-stdout.raw");
const errFile = join(root, "busy73-desktop-local-01-stderr.raw");
writeFileSync(outFile, stdout);
writeFileSync(errFile, stderr);
const sha = (buffer) => createHash("sha256").update(buffer).digest("hex").toUpperCase();
const invocation = {
  script_sha256: sha(readFileSync(script)),
  wrapper_sha256: sha(readFileSync(new URL(import.meta.url))),
  exit_code: result.status,
  signal: result.signal,
  error: result.error ? { code: result.error.code, message: result.error.message } : null,
  stdout: { bytes: stdout.length, sha256: sha(stdout), path: outFile },
  stderr: { bytes: stderr.length, sha256: sha(stderr), path: errFile },
};
writeFileSync(join(root, "busy73-desktop-local-01-invocation.json"), JSON.stringify(invocation, null, 2) + "\n");
console.log(JSON.stringify(invocation));
if (result.status !== 0 || result.error) process.exitCode = 1;

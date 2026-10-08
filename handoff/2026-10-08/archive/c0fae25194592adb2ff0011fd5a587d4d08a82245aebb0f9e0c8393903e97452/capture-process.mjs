import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();

export async function captured({ name, executable, args, cwd, output, timeoutMs, steps }) {
  const stdoutPath = join(output, `${name}.stdout.raw`);
  const stderrPath = join(output, `${name}.stderr.raw`);
  const stdout = createWriteStream(stdoutPath, { flags: "wx" });
  const stderr = createWriteStream(stderrPath, { flags: "wx" });
  const child = spawn(executable, args, { cwd, shell: false, windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(stdout);
  child.stderr.pipe(stderr);
  const step = { pid: child.pid ?? null, executable, arguments: args, timeoutMs,
    exitCode: null, signal: null, timedOut: false, cleanup: "NOT_REQUIRED",
    stdoutPath, stderrPath };
  steps[name] = step;
  const outcome = await new Promise((done) => {
    let settled = false;
    const finish = (result) => { if (!settled) { settled = true; clearTimeout(timer); done(result); } };
    const timer = setTimeout(() => {
      step.timedOut = true;
      try {
        execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { timeout: 10000 });
        step.cleanup = "TASKKILL_TREE_REQUESTED";
      } catch (error) { step.cleanup = `TASKKILL_ERROR: ${error.message}`; }
      setTimeout(() => finish({ code: 124, signal: "TIMEOUT" }), 10000);
    }, timeoutMs);
    child.once("error", (error) => finish({ code: 9009, signal: String(error) }));
    child.once("close", (code, signal) => finish({ code, signal }));
  });
  step.exitCode = outcome.code;
  step.signal = outcome.signal;
  await Promise.all([new Promise((done) => stdout.end(done)),
    new Promise((done) => stderr.end(done))]);
  for (const stream of ["stdout", "stderr"]) {
    const path = stream === "stdout" ? stdoutPath : stderrPath;
    step[`${stream}Bytes`] = statSync(path).size;
    step[`${stream}Sha256`] = hash(path);
  }
  return step;
}

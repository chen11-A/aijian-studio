import process from "node:process";
import { spawn } from "node:child_process";
import { stripVTControlCharacters } from "node:util";
import { constants } from "node:os";
import { extname, resolve } from "node:path";
import { realpathSync, statSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath, pathToFileURL, URL } from "node:url";

export const escapeData = (text) =>
  String(text).replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
export const escapeProperty = (text) =>
  escapeData(text).replaceAll(":", "%3A").replaceAll(",", "%2C");

/** npm_execpath belongs to pnpm run, not pnpm exec. Never execute a .cmd through a shell. */
export function pnpmInvocation(entry, executable = process.execPath) {
  if (!entry || extname(entry).toLowerCase() === ".cmd")
    throw new Error("PNPM_JAVASCRIPT_ENTRY_REQUIRED");
  const javascript = realpathSync(entry);
  if (
    ![".js", ".cjs", ".mjs"].includes(extname(javascript).toLowerCase()) ||
    !statSync(javascript).isFile()
  )
    throw new Error("PNPM_JAVASCRIPT_ENTRY_REQUIRED");
  return { command: executable, args: [javascript, "test"] };
}

/** Keep metadata only: no assertion values, raw error messages, absolute paths or log tails. */
export function failureSummary(initialPhase = "pnpm test") {
  let phase = initialPhase;
  let failureBlock = false;
  const entries = new Map();
  const add = (message) => {
    const key = `${phase}: ${message}`;
    if (entries.size < 6) entries.set(key, { phase, message });
  };
  const line = (raw) => {
    const text = stripVTControlCharacters(raw).replaceAll("\\", "/");
    if (text.includes("aivora-media")) phase = "TypeScript / media";
    else if (text.includes("aivora-qc")) phase = "TypeScript / QC";
    else if (text.includes("apps/studio-web")) phase = "TypeScript / web";
    else if (text.includes("apps/desktop")) phase = "TypeScript / desktop";
    else if (/uv run pytest|^platform .*Python|^=+ .*test session starts/u.test(text))
      phase = "Python";
    if (/\bFAIL(?:ED)?\b|^\s*✖|^not ok\b|^\s*ERROR\b|failureType:|Coverage for/u.test(text))
      failureBlock = true;
    if (!failureBlock) return;
    const file = text.match(
      /(?:^|[\s/'"(])((?:packages|apps|services|scripts|src|test)\/[A-Za-z0-9_./-]+\.(?:[cm]?[jt]sx?|py))(?::(\d+))?(?::\d+)?/u,
    );
    if (file) {
      if (file[1].includes("aivora-media")) phase = "TypeScript / media";
      else if (file[1].includes("aivora-qc")) phase = "TypeScript / QC";
      else if (file[1].includes(".py")) phase = "Python";
      add(`Failure location: ${file[1]}${file[2] ? `:${file[2]}` : ""}`);
    }
    const timeout = text.match(/(?:timed out after|timeout(?: of)?)\s+(\d+)\s*ms/iu);
    if (timeout) add(`Test timeout: ${timeout[1]} ms.`);
    const type = text.match(
      /failureType:\s*['"](testCodeFailure|testTimeoutFailure|cancelledByParent|hookFailed|unhandledRejection|uncaughtException|subtestsFailed)['"]/u,
    );
    if (type) add(`Node test failure type: ${type[1]}.`);
    const code = text.match(/\b(ERR_[A-Z0-9_]+|ETIMEDOUT|ENOENT|ENOSPC)\b/u);
    if (code) add(`Failure code: ${code[1]}.`);
    const coverage = text.match(
      /Coverage for (statements|branches|functions|lines) \(([\d.]+)%\).*threshold \(([\d.]+)%\)/u,
    );
    if (coverage) add(`Coverage ${coverage[1]}: ${coverage[2]}%, required ${coverage[3]}%.`);
    const count = text.match(/^\s*(Test Files|Tests)\s+([1-9]\d*) failed/u);
    if (count) add(`${count[1]}: ${count[2]} failed.`);
  };
  return { line, entries: () => [...entries.values()], phase: () => phase };
}

function observe(stream, output, summary) {
  const decoder = new StringDecoder("utf8");
  let pending = "";
  const accept = (chunk) => {
    pending += chunk;
    let at;
    while ((at = pending.indexOf("\n")) !== -1) {
      summary.line(pending.slice(0, at));
      pending = pending.slice(at + 1);
    }
    // A single giant diagnostic value must not become an unbounded log buffer.
    if (pending.length > 16384) pending = "";
  };
  stream.pipe(output, { end: false });
  stream.on("data", (chunk) => accept(decoder.write(chunk)));
  stream.on("end", () => {
    accept(decoder.end());
    if (pending) summary.line(pending);
  });
}

/** Preserve the original process streams and status; append bounded, safe annotations on failure. */
export async function runTestDiagnostics({
  command,
  args,
  stdout = process.stdout,
  stderr = process.stderr,
  phase = "pnpm test",
}) {
  const summary = failureSummary(phase);
  const child = spawn(command, args, { shell: false, stdio: ["inherit", "pipe", "pipe"] });
  observe(child.stdout, stdout, summary);
  observe(child.stderr, stderr, summary);
  let spawnCode = "";
  child.on("error", (error) => {
    spawnCode = /^[A-Z0-9_]+$/u.test(error.code ?? "") ? error.code : "SPAWN_FAILED";
  });
  const forward = (signal) => child.kill(signal);
  const interrupt = () => forward("SIGINT");
  const terminate = () => forward("SIGTERM");
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  const status = await new Promise((done) =>
    child.on("close", (code, signal) =>
      done(code ?? (signal ? 128 + (constants.signals[signal] ?? 1) : 1)),
    ),
  );
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", terminate);
  if (status !== 0) {
    const entries = summary.entries();
    if (!entries.length)
      entries.push({
        phase: summary.phase(),
        message: spawnCode
          ? `Process launch failed: ${spawnCode}.`
          : "No supported safe failure metadata was found; inspect the original Test log.",
      });
    for (const entry of entries)
      stdout.write(
        `::error title=${escapeProperty(`CI Test / ${entry.phase} / exit ${status}`)}::${escapeData(entry.message)}\n`,
      );
  }
  return status;
}

let direct = false;
try {
  direct =
    Boolean(process.argv[1]) &&
    pathToFileURL(realpathSync(resolve(process.argv[1]))).href === import.meta.url;
} catch {
  // Imported modules need not have a filesystem entry point.
}
if (direct) {
  try {
    const invocation =
      process.argv[2] === "--self-test"
        ? {
            command: process.execPath,
            args: [
              "--test",
              fileURLToPath(new URL("./ci-test-diagnostics.test.mjs", import.meta.url)),
            ],
            phase: "diagnostics self-test",
          }
        : pnpmInvocation(process.env.npm_execpath);
    if (process.argv[2] === "--check-launcher")
      process.stdout.write("CI launcher verified: JavaScript entry, shell disabled.\n");
    else process.exitCode = await runTestDiagnostics(invocation);
  } catch {
    process.stdout.write(
      "::error title=CI Test launcher::pnpm run must provide a JavaScript npm_execpath entry; no shell fallback was used.\n",
    );
    process.exitCode = 1;
  }
}

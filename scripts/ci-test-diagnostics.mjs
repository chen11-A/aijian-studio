import process from "node:process";
import { spawn } from "node:child_process";
import { stripVTControlCharacters } from "node:util";
import { constants } from "node:os";
import { extname, resolve, relative, isAbsolute } from "node:path";
import { realpathSync, statSync, readFileSync } from "node:fs";
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

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
/** Only declared top-level test names in this checkout are safe node metadata.
 * Never emit pytest parameter IDs, exception messages or an absolute path. */
function pytestSourceLines(file, sourceRoot) {
  if (!/^services\/api\/tests\/test_[A-Za-z0-9_]+\.py$/u.test(file) || file.length > 240)
    return null;
  try {
    const root = realpathSync.native(sourceRoot),
      source = realpathSync.native(resolve(root, file));
    const part = relative(root, source);
    if (!part || part.startsWith("..") || isAbsolute(part) || part.replaceAll("\\", "/") !== file)
      return null;
    const info = statSync(source);
    if (!info.isFile() || info.size > 1024 * 1024) return null;
    return readFileSync(source, "utf8").split(/\r?\n/u);
  } catch {
    return null;
  }
}
export function pytestSourceLocation(file, name, sourceRoot = repositoryRoot) {
  if (!/^test_[A-Za-z0-9_]{1,155}$/u.test(name)) return null;
  const lines = pytestSourceLines(file, sourceRoot);
  if (!lines) return null;
  let found = null;
  for (const [index, line] of lines.entries()) {
    const definition = line.match(/^(?:async[ \t]+)?def[ \t]+(test_[A-Za-z0-9_]+)[ \t]*\(/u);
    if (definition?.[1] === name) found = index + 1;
  }
  return found;
}
export function pytestFailureLocation(file, line, sourceRoot = repositoryRoot) {
  if (!/^[1-9]\d{0,7}$/u.test(String(line))) return null;
  const lines = pytestSourceLines(file, sourceRoot);
  return lines && Number(line) <= lines.length ? Number(line) : null;
}

/** Closed test-local PCM statistics; no raw text/string fields can enter annotations. */
export function emptySpeechPcmSummary(raw) {
  if (typeof raw !== "string" || raw.length > 2048 || !raw.startsWith("CI_EMPTY_SPEECH_PCM "))
    return null;
  try {
    const v = JSON.parse(raw.slice("CI_EMPTY_SPEECH_PCM ".length));
    if (
      !v ||
      typeof v !== "object" ||
      Array.isArray(v) ||
      Object.keys(v).sort().join() !==
        "channels,nonzero,ordinal,peakAbs,rate,referenced,rms,samples,schema,stage,width" ||
      v.schema !== 1 ||
      typeof v.referenced !== "boolean" ||
      !["silent", "loudnorm", "fit", "final"].includes(v.stage) ||
      ![16000, 48000].includes(v.rate) ||
      ![1, 2].includes(v.channels) ||
      v.width !== 2 ||
      !Number.isInteger(v.ordinal) ||
      v.ordinal < 1 ||
      v.ordinal > 16 ||
      !Number.isInteger(v.samples) ||
      v.samples < 1 ||
      v.samples > 2000000 ||
      v.samples % v.channels !== 0 ||
      !Number.isInteger(v.nonzero) ||
      v.nonzero < 0 ||
      v.nonzero > v.samples ||
      !Number.isInteger(v.peakAbs) ||
      v.peakAbs < 0 ||
      v.peakAbs > 32768 ||
      typeof v.rms !== "number" ||
      !Number.isFinite(v.rms) ||
      v.rms < 0 ||
      v.rms > v.peakAbs ||
      (v.nonzero === 0 ? v.peakAbs !== 0 || v.rms !== 0 : v.peakAbs === 0 || v.rms === 0)
    )
      return null;
    return `Empty speech PCM: referenced=${v.referenced}; stage=${v.stage}#${v.ordinal}; rate=${v.rate}; channels=${v.channels}; width=${v.width}; samples=${v.samples}; nonzero=${v.nonzero}; peakAbs=${v.peakAbs}; RMS=${v.rms.toFixed(6)}.`;
  } catch {
    return null;
  }
}

/** Keep metadata only: no assertion values, raw error messages, absolute paths or log tails. */
export function failureSummary(initialPhase = "pnpm test", sourceRoot = repositoryRoot) {
  let phase = initialPhase;
  let failureBlock = false;
  let pytestFailures = false;
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
    // pnpm recursive output may prefix runtime lines; remove only our two fixed app labels.
    const diagnostic = text.replace(
      /^(?:apps\/(?:studio-web|desktop) test:|@aijian\/(?:studio-web|desktop):test:)\s*/u,
      "",
    );
    // Fixed upstream runtime phrases only: never append their file list, cause or stack.
    const workerExit = /^\s*(?:Error:\s*)?Worker exited unexpectedly(?:[.\s]|$)/u.test(diagnostic);
    const pool = diagnostic.match(
      /^\s*(?:Error:\s*)?\[vitest-pool\]: (Worker (?:forks|threads|vmForks|vmThreads) emitted error\.|Failed to (?:start|terminate) (?:forks|threads|vmForks|vmThreads) worker\b|Timeout (?:starting|terminating) (?:forks|threads|vmForks|vmThreads) (?:runner|worker)\b)/u,
    );
    const heap =
      /^\s*FATAL ERROR: (?:Reached heap limit|Ineffective mark-compacts near heap limit) Allocation failed - JavaScript heap out of memory\b/u.test(
        diagnostic,
      );
    const vitestTimeout = diagnostic.match(
      /^\s*(?:Error:\s*)?(?:Test|Hook) timed out in ([1-9]\d{0,9})ms(?:[.\s]|$)/u,
    );
    if (workerExit || pool || heap || vitestTimeout) failureBlock = true;
    if (workerExit) add("Test worker exited unexpectedly.");
    if (pool) {
      const kind = pool[1].startsWith("Worker")
        ? "worker error"
        : pool[1].startsWith("Failed to start")
          ? "start failure"
          : pool[1].startsWith("Failed to terminate")
            ? "termination failure"
            : pool[1].startsWith("Timeout starting")
              ? "start timeout"
              : "termination timeout";
      add(`Vitest pool: ${kind}.`);
    }
    if (heap) add("Node heap limit reached.");
    if (/\bFAIL(?:ED)?\b|^\s*✖|^not ok\b|^\s*ERROR\b|failureType:|Coverage for/u.test(text))
      failureBlock = true;
    if (/^=+\s+FAILURES\s+=+$/u.test(diagnostic.trim())) {
      pytestFailures = true;
      failureBlock = true;
    } else if (
      /^=+\s+(?:short test summary info|warnings summary|ERRORS)\b/u.test(diagnostic.trim())
    ) {
      pytestFailures = false;
    }
    if (!failureBlock) return;
    const pcm = pytestFailures ? emptySpeechPcmSummary(diagnostic) : null;
    if (pcm) {
      phase = "Python";
      add(pcm);
    }
    const pytestFrame =
      pytestFailures &&
      diagnostic.match(
        /^\s*(services\/api\/tests\/test_[A-Za-z0-9_]+\.py):([1-9]\d{0,7}):\s*(AssertionError|RuntimeError|ValueError|TypeError|OSError|FileNotFoundError|PermissionError|KeyError|IndexError|EOFError|TimeoutError|AttributeError)\b/u,
      );
    if (pytestFrame && entries.size < 6) {
      const actualLine = pytestFailureLocation(pytestFrame[1], pytestFrame[2], sourceRoot);
      if (actualLine) {
        phase = "Python";
        add(`Pytest failure frame: ${pytestFrame[1]}:${actualLine} (${pytestFrame[3]}).`);
      }
    }
    const file = text.match(
      /(?:^|[\s/'"(])((?:packages|apps|services|scripts|src|test)\/[A-Za-z0-9_./-]+\.(?:[cm]?[jt]sx?|py))(?::(\d+))?(?::\d+)?/u,
    );
    const sourceLocation = /^\s*(?:FAIL(?:ED)?\b|✖|not ok\b|❯|at\b|location:|file:)/u.test(
      diagnostic,
    );
    if (
      sourceLocation &&
      file &&
      file[1].length <= 240 &&
      !file[1].split("/").some((part) => part === "." || part === "..") &&
      (!file[2] || (Number(file[2]) >= 1 && Number(file[2]) <= 10000000 && file[2].length <= 8))
    ) {
      if (file[1].includes("aivora-media")) phase = "TypeScript / media";
      else if (file[1].includes("aivora-qc")) phase = "TypeScript / QC";
      else if (file[1].includes(".py")) phase = "Python";
      add(`Failure location: ${file[1]}${file[2] ? `:${file[2]}` : ""}`);
    }
    const pytestNode = diagnostic.match(
      /^\s*FAILED\s+(services\/api\/tests\/test_[A-Za-z0-9_]+\.py)::(test_[A-Za-z0-9_]{1,155})(?=\[|\s|$)/u,
    );
    if (pytestNode && entries.size < 6) {
      const declaredLine = pytestSourceLocation(pytestNode[1], pytestNode[2], sourceRoot);
      if (declaredLine) {
        phase = "Python";
        add(`Failure test: ${pytestNode[1]}::${pytestNode[2]}:${declaredLine}`);
      }
    }

    const timeout =
      vitestTimeout ?? text.match(/(?:timed out after|timeout(?: of)?)\s+([1-9]\d{0,9})\s*ms\b/iu);
    if (timeout && Number(timeout[1]) <= 2147483647) add(`Test timeout: ${timeout[1]} ms.`);
    const type = text.match(
      /failureType:\s*['"](testCodeFailure|testTimeoutFailure|cancelledByParent|hookFailed|unhandledRejection|uncaughtException|subtestsFailed)['"]/u,
    );
    if (type) add(`Node test failure type: ${type[1]}.`);
    const code = text.match(/\b(ERR_[A-Z0-9_]+|ETIMEDOUT|ENOENT|ENOSPC)\b/u);
    const codes = new Set([
      "ERR_TEST_FAILURE",
      "ERR_WORKER_OUT_OF_MEMORY",
      "ERR_WORKER_INIT_FAILED",
      "ERR_WORKER_INVALID_EXEC_ARGV",
      "ERR_WORKER_NOT_RUNNING",
      "ERR_IPC_CHANNEL_CLOSED",
      "ERR_IPC_DISCONNECTED",
      "ERR_CHILD_PROCESS_IPC_REQUIRED",
      "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
      "ERR_MODULE_NOT_FOUND",
      "ERR_REQUIRE_ESM",
      "ERR_UNKNOWN_FILE_EXTENSION",
      "ERR_UNHANDLED_ERROR",
      "ETIMEDOUT",
      "ENOENT",
      "ENOSPC",
    ]);
    if (code && codes.has(code[1])) add(`Failure code: ${code[1]}.`);
    const coverage = text.match(
      /Coverage for (statements|branches|functions|lines) \((\d{1,3}(?:\.\d{1,4})?)%\).*threshold \((\d{1,3}(?:\.\d{1,4})?)%\)/u,
    );
    if (coverage && Number(coverage[2]) <= 100 && Number(coverage[3]) <= 100)
      add(`Coverage ${coverage[1]}: ${coverage[2]}%, required ${coverage[3]}%.`);
    const count = text.match(/^\s*(Test Files|Tests)\s+([1-9]\d{0,6}) failed/u);
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
    if (process.argv[2] === "--speech-window-test" && process.argv.length !== 3)
      throw new Error("UNEXPECTED_TARGET_ARGUMENTS");
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
        : process.argv[2] === "--speech-window-test"
          ? {
              command: "uv",
              args: ["run", "pytest", "services/api/tests/test_story_speech_window.py"],
              phase: "Python / speech-window",
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

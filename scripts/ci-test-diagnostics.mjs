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

/** One exact six-variant regression, never caller-selected files or patterns. */
export function libraryWriteInvocation(entry, executable = process.execPath) {
  const launcher = pnpmInvocation(entry, executable);
  return {
    command: launcher.command,
    args: [
      launcher.args[0],
      "--filter",
      "@aijian/desktop",
      "exec",
      "vitest",
      "run",
      "src/film-audio-library.test.ts",
      "-t",
      "^reports (?:before|after|unreadable|readback-stale|readback-empty|readback-wrong) write failure accurately and preserves possibly referenced group copies$",
    ],
    phase: "TypeScript / desktop / library-write",
  };
}

/** Two fixed Windows media regressions, never caller-selected files. */
export function deliveryManifestInvocation(entry, executable = process.execPath) {
  const launcher = pnpmInvocation(entry, executable);
  return {
    command: launcher.command,
    args: [
      launcher.args[0],
      "--filter",
      "@aijian/desktop",
      "exec",
      "vitest",
      "run",
      "src/film-delivery-manifest.test.ts",
      "src/film-export-qc-ownership.test.ts",
    ],
    phase: "TypeScript / desktop / delivery-manifest",
  };
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

/** Only boolean comparisons of actual test-local identities; never stat values,
 * filenames, exception strings, hashes or caller-defined diagnostic labels. */
export function recoveryIdentitySummary(raw) {
  const prefix = "CI_VIDEO_RECOVERY_IDENTITY ";
  if (typeof raw !== "string" || raw.length > 2048 || !raw.startsWith(prefix)) return null;
  try {
    const value = JSON.parse(raw.slice(prefix.length));
    const flags = [
      "fdStable",
      "fdRegular",
      "pathRegular",
      "sameDevice",
      "sameInode",
      "sameSize",
      "sameMtime",
      "sameCtime",
      "namedHandleMatch",
      "shaMatch",
      "byteCountMatch",
    ];
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).sort().join() !== [...flags, "schemaVersion", "stage"].sort().join() ||
      value.schemaVersion !== 1 ||
      value.stage !== "read-path" ||
      flags.some((field) => typeof value[field] !== "boolean")
    )
      return null;
    return `Video recovery read identity: ${flags.map((field) => `${field}=${value[field]}`).join("; ")}.`;
  } catch {
    return null;
  }
}

const libraryWriteStages = new Set([
  "fixture",
  "suggest",
  "apply",
  "commit",
  "commit-return",
  "write",
  "write-ack",
  "readback",
  "actual-read",
  "inspect",
  "hash-check",
  "done",
]);
const libraryWriteTools = new Set(["none", "ffmpeg", "ffprobe", "other"]);
/** Closed test-local timing only. No parameters, identifiers, paths or exception text. */
export function libraryWritePhaseSummary(line) {
  const prefix = "CI_LIBRARY_WRITE_PHASE ";
  if (!line.startsWith(prefix) || line.length > 2048) return null;
  try {
    const row = JSON.parse(line.slice(prefix.length));
    const object = (value) => value && typeof value === "object" && !Array.isArray(value);
    const milliseconds = (value) => Number.isInteger(value) && value >= 0 && value <= 120000;
    if (
      !object(row) ||
      Object.keys(row).sort().join() !==
        "closed,completed,elapsedMs,failed,freeMb,heapMb,last,mode,open,probes,stage,v" ||
      row.v !== 1 ||
      ![
        "before",
        "after",
        "unreadable",
        "readback-stale",
        "readback-empty",
        "readback-wrong",
      ].includes(row.mode) ||
      !libraryWriteStages.has(row.stage) ||
      !libraryWriteTools.has(row.last) ||
      !milliseconds(row.elapsedMs) ||
      !Number.isInteger(row.probes) ||
      row.probes < 0 ||
      row.probes > 4096 ||
      !Number.isInteger(row.open) ||
      row.open < 0 ||
      row.open > 4096 ||
      !Number.isInteger(row.closed) ||
      row.closed < 0 ||
      row.closed > 4096 ||
      !Number.isInteger(row.failed) ||
      row.failed < 0 ||
      row.failed > 4096 ||
      !Number.isInteger(row.heapMb) ||
      row.heapMb < 0 ||
      row.heapMb > 65536 ||
      !Number.isInteger(row.freeMb) ||
      row.freeMb < 0 ||
      row.freeMb > 1048576 ||
      !Array.isArray(row.completed) ||
      row.completed.length > 16 ||
      row.completed.some(
        (value) =>
          !object(value) ||
          Object.keys(value).sort().join() !== "elapsedMs,stage" ||
          !libraryWriteStages.has(value.stage) ||
          !milliseconds(value.elapsedMs),
      ) ||
      row.completed.reduce((total, value) => total + value.elapsedMs, 0) > row.elapsedMs + 16
    )
      return null;
    return `Audio library write phase: variant=${row.mode}; stage=${row.stage}; elapsed=${row.elapsedMs}ms; completed=${row.completed.map((value) => `${value.stage}:${value.elapsedMs}ms`).join("|") || "none"}; probes=${row.probes}; open=${row.open}; closed=${row.closed}; failed=${row.failed}; last=${row.last}; heap=${row.heapMb}MiB; free=${row.freeMb}MiB.`;
  } catch {
    return null;
  }
}

const mutationStages = new Set([
  "fixture",
  "suggest",
  "bundle",
  "commit",
  "encode",
  "apply",
  "done",
]);
/** Closed source/clean timing. No file paths or command arguments. */
export function libraryMutationPhaseSummary(line) {
  const prefix = "CI_LIBRARY_MUTATION_PHASE ";
  if (!line.startsWith(prefix) || line.length > 2048) return null;
  try {
    const row = JSON.parse(line.slice(prefix.length));
    const object = (value) => value && typeof value === "object" && !Array.isArray(value);
    const milliseconds = (value) => Number.isInteger(value) && value >= 0 && value <= 120000;
    if (
      !object(row) ||
      Object.keys(row).sort().join() !==
        "closed,completed,elapsedMs,failed,freeMb,heapMb,last,mode,open,stage,v" ||
      row.v !== 1 ||
      !["source", "clean"].includes(row.mode) ||
      !mutationStages.has(row.stage) ||
      !libraryWriteTools.has(row.last) ||
      !milliseconds(row.elapsedMs) ||
      [row.open, row.closed, row.failed].some(
        (value) => !Number.isInteger(value) || value < 0 || value > 4096,
      ) ||
      !Number.isInteger(row.heapMb) ||
      row.heapMb < 0 ||
      row.heapMb > 65536 ||
      !Number.isInteger(row.freeMb) ||
      row.freeMb < 0 ||
      row.freeMb > 1048576 ||
      !Array.isArray(row.completed) ||
      row.completed.length > 12 ||
      row.completed.some(
        (value) =>
          !object(value) ||
          Object.keys(value).sort().join() !== "elapsedMs,stage" ||
          !mutationStages.has(value.stage) ||
          !milliseconds(value.elapsedMs),
      )
    )
      return null;
    return `Audio library mutation phase: variant=${row.mode}; stage=${row.stage}; elapsed=${row.elapsedMs}ms; completed=${row.completed.map((value) => `${value.stage}:${value.elapsedMs}ms`).join("|") || "none"}; open=${row.open}; closed=${row.closed}; failed=${row.failed}; last=${row.last}; heap=${row.heapMb}MiB; free=${row.freeMb}MiB.`;
  } catch {
    return null;
  }
}

const qcOwnerStages = new Set(["temp", "db", "rows", "owner", "done", "cleanup"]);
/** Closed ownership timing only. No database paths, digests or SQL. */
export function qcOwnerPhaseSummary(line) {
  const prefix = "CI_QC_OWNER_PHASE ";
  if (!line.startsWith(prefix) || line.length > 512) return null;
  try {
    const row = JSON.parse(line.slice(prefix.length));
    const object = (value) => value && typeof value === "object" && !Array.isArray(value);
    if (
      !object(row) ||
      Object.keys(row).sort().join() !== "elapsedMs,freeMb,heapMb,stage,v" ||
      row.v !== 1 ||
      !qcOwnerStages.has(row.stage) ||
      !Number.isInteger(row.elapsedMs) ||
      row.elapsedMs < 0 ||
      row.elapsedMs > 120000 ||
      !Number.isInteger(row.heapMb) ||
      row.heapMb < 0 ||
      row.heapMb > 65536 ||
      !Number.isInteger(row.freeMb) ||
      row.freeMb < 0 ||
      row.freeMb > 1048576
    )
      return null;
    return `Export ownership phase: stage=${row.stage}; elapsed=${row.elapsedMs}ms; heap=${row.heapMb}MiB; free=${row.freeMb}MiB.`;
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
  const libraryPhases = new Map();
  const ownerPhases = new Map();
  const mutationPhases = new Map();
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
    const libraryPhase = libraryWritePhaseSummary(diagnostic);
    if (libraryPhase && libraryPhases.size < 6)
      libraryPhases.set(libraryPhase, { phase: "TypeScript / desktop", message: libraryPhase });
    const ownerPhase = qcOwnerPhaseSummary(diagnostic);
    if (ownerPhase && ownerPhases.size < 6)
      ownerPhases.set(ownerPhase, { phase: "TypeScript / desktop", message: ownerPhase });
    const mutationPhase = libraryMutationPhaseSummary(diagnostic);
    if (mutationPhase && mutationPhases.size < 6)
      mutationPhases.set(mutationPhase, { phase: "TypeScript / desktop", message: mutationPhase });
    // Exact check_python_coverage.py output only; successful metrics are not failures.
    const pythonCoverage = text.match(
      /^Python coverage: line=(\d{1,3}\.\d{2})% \(min (\d{1,3}\.\d)%\), branch=(\d{1,3}\.\d{2})% \(min (\d{1,3}\.\d)%\)\r?$/u,
    );
    if (
      pythonCoverage?.[0] === text &&
      pythonCoverage.slice(1).every((value) => Number(value) <= 100)
    ) {
      phase = "Python";
      for (const [metric, actual, minimum] of [
        ["lines", pythonCoverage[1], pythonCoverage[2]],
        ["branches", pythonCoverage[3], pythonCoverage[4]],
      ]) {
        if (Number(actual) < Number(minimum)) {
          failureBlock = true;
          add(`Coverage ${metric}: ${actual}%, required ${minimum}%.`);
        }
      }
    }
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
    const recoveryIdentity = pytestFailures ? recoveryIdentitySummary(diagnostic) : null;
    if (recoveryIdentity) {
      phase = "Python";
      add(recoveryIdentity);
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
  return {
    line,
    entries: () =>
      failureBlock
        ? [
            ...libraryPhases.values(),
            ...ownerPhases.values(),
            ...mutationPhases.values(),
            ...entries.values(),
          ].slice(0, 6)
        : [...entries.values()],
    phase: () => phase,
  };
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
    if (
      process.argv[2] !== undefined &&
      ![
        "--self-test",
        "--check-launcher",
        "--speech-window-test",
        "--video-recovery-test",
        "--audio-library-write-test",
        "--delivery-manifest-test",
      ].includes(process.argv[2])
    )
      throw new Error("UNEXPECTED_TARGET_ARGUMENTS");
    if (
      [
        "--speech-window-test",
        "--video-recovery-test",
        "--audio-library-write-test",
        "--delivery-manifest-test",
      ].includes(process.argv[2]) &&
      process.argv.length !== 3
    )
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
          : process.argv[2] === "--video-recovery-test"
            ? {
                command: "uv",
                args: [
                  "run",
                  "pytest",
                  "services/api/tests/test_video_recovery.py",
                  "services/api/tests/test_video_recovery_routes.py",
                ],
                phase: "Python / video-recovery",
              }
            : process.argv[2] === "--audio-library-write-test"
              ? libraryWriteInvocation(process.env.npm_execpath)
              : process.argv[2] === "--delivery-manifest-test"
                ? deliveryManifestInvocation(process.env.npm_execpath)
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

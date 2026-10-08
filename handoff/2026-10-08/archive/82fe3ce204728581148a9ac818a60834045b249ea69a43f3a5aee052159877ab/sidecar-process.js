"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SidecarStartupError = void 0;
exports.startSidecar = startSidecar;
const node_child_process_1 = require("node:child_process");
const node_readline_1 = require("node:readline");
const sidecar_protocol_1 = require("./sidecar-protocol");
const sidecar_startup_diagnostic_1 = require("./sidecar-startup-diagnostic");
const DEFAULT_STARTUP_TIMEOUT_MS = 20_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000;
const PASSTHROUGH_ENVIRONMENT = new Set([
    "APPDATA",
    "HOME",
    "LANG",
    "LC_ALL",
    "LOCALAPPDATA",
    "PATH",
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "WINDIR",
]);
class SidecarStartupError extends Error {
    classification;
    constructor(classification) {
        super("Sidecar failed to start");
        this.classification = classification;
        this.name = "SidecarStartupError";
    }
}
exports.SidecarStartupError = SidecarStartupError;
function childEnvironment(overrides = {}) {
    const environment = {};
    for (const [key, value] of Object.entries(process.env)) {
        if (PASSTHROUGH_ENVIRONMENT.has(key.toUpperCase()) && value !== undefined) {
            environment[key] = value;
        }
    }
    return {
        ...environment,
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1",
        ...overrides,
    };
}
function positiveTimeout(value, fallback) {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}
async function settlesWithin(promise, timeoutMs) {
    let timeout;
    const timedOut = new Promise((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMs);
    });
    const settled = promise.then(() => true);
    const result = await Promise.race([settled, timedOut]);
    if (timeout !== undefined)
        clearTimeout(timeout);
    return result;
}
async function startSidecar(options) {
    const startupTimeoutMs = positiveTimeout(options.startupTimeoutMs, DEFAULT_STARTUP_TIMEOUT_MS);
    const shutdownTimeoutMs = positiveTimeout(options.shutdownTimeoutMs, DEFAULT_SHUTDOWN_TIMEOUT_MS);
    const child = (0, node_child_process_1.spawn)(options.command, options.args, {
        cwd: options.cwd,
        env: childEnvironment(options.env),
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
    });
    const diagnostic = (0, sidecar_startup_diagnostic_1.createSidecarStartupDiagnosticCollector)();
    const onStderrData = (chunk) => diagnostic.append(chunk);
    child.stderr.on("data", onStderrData);
    let exitResult;
    let spawnFailed = false;
    let timedOut = false;
    const exited = new Promise((resolve) => {
        child.once("close", (code, signal) => {
            exitResult = { code, signal };
            resolve(exitResult);
        });
    });
    const output = (0, node_readline_1.createInterface)({ input: child.stdout, crlfDelay: Infinity });
    let session;
    try {
        session = await new Promise((resolve, reject) => {
            const rejectStartup = () => reject(new Error("Sidecar failed to start"));
            const timer = setTimeout(() => {
                timedOut = true;
                rejectStartup();
            }, startupTimeoutMs);
            const onSpawnError = () => {
                spawnFailed = true;
                clearTimeout(timer);
                rejectStartup();
            };
            const onExit = () => {
                clearTimeout(timer);
                rejectStartup();
            };
            const cleanup = () => {
                clearTimeout(timer);
                child.off("error", onSpawnError);
                child.off("exit", onExit);
            };
            child.once("error", onSpawnError);
            child.once("exit", onExit);
            output.once("line", (line) => {
                cleanup();
                try {
                    resolve((0, sidecar_protocol_1.parseSidecarHandshake)(line));
                }
                catch {
                    rejectStartup();
                }
            });
        });
    }
    catch {
        output.close();
        child.stdout.resume();
        child.stdin.end();
        if (!(await settlesWithin(exited, shutdownTimeoutMs))) {
            timedOut = true;
            child.kill();
            await settlesWithin(exited, shutdownTimeoutMs);
        }
        child.stderr.off("data", onStderrData);
        child.stderr.resume();
        throw new SidecarStartupError(diagnostic.classify({
            code: exitResult?.code ?? null,
            signal: exitResult?.signal ?? null,
            spawn_failed: spawnFailed,
            timed_out: timedOut,
        }));
    }
    output.close();
    child.stdout.resume();
    child.stderr.off("data", onStderrData);
    child.stderr.resume();
    let stopping;
    const stop = () => {
        stopping ??= (async () => {
            if (exitResult !== undefined)
                return;
            child.stdin.end();
            if (await settlesWithin(exited, shutdownTimeoutMs))
                return;
            child.kill();
            if (!(await settlesWithin(exited, shutdownTimeoutMs))) {
                throw new Error("Sidecar failed to stop");
            }
        })();
        return stopping;
    };
    return { session, exited, stop };
}

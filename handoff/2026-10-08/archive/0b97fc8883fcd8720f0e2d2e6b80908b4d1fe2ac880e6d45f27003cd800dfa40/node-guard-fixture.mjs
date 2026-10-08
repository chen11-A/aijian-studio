// Preloaded with --import before the pinned stage-local openapi-typescript CLI.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerHooks, syncBuiltinESMExports } from "node:module";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import dgram from "node:dgram";

const SOURCE = String.raw`C:\Users\Administrator\Documents\Codex\2026-09-23\qa03-local-openapi-generation-packet-v3-20260929\qa-fixture-07\node-source`;
const CLI = path.join(SOURCE, "node_modules", ".pnpm", "openapi-typescript@7.13.0_typescript@5.9.3", "node_modules", "openapi-typescript", "bin", "cli.js");
const INPUT = path.join(SOURCE, "packages", "contracts", "openapi.json");
const OUTPUT = path.join(SOURCE, "packages", "contracts", "src", "generated.ts");
const OUTPUT_PARENT = path.dirname(OUTPUT);
const resolvedModules = new Set();
const denied = [];

function fail(code) {
  denied.push(code);
  throw new Error(`QA03_NODE_GUARD_${code}`);
}

function same(a, b) {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

function inside(p, root) {
  const relative = path.relative(root, p);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function asPath(value) {
  if (value instanceof URL) return fileURLToPath(value);
  if (typeof value === "string") return value;
  fail("NON_PATH_ARGUMENT");
}

function allowOnlyOutput(value) {
  const p = asPath(value);
  if (!same(p, OUTPUT)) fail(`WRITE_OUTSIDE_OUTPUT:${p}`);
}

if (!process.permission || !process.permission.has("fs.read", SOURCE) ||
    !process.permission.has("fs.write", OUTPUT) ||
    process.env.NODE_PATH || process.env.NODE_OPTIONS ||
    !same(process.cwd(), SOURCE) ||
    !same(fs.realpathSync.native(process.argv[1]), CLI) ||
    process.argv.length !== 5 || !same(process.argv[2], INPUT) ||
    process.argv[3] !== "-o" || !same(process.argv[4], OUTPUT)) {
  fail("STARTUP_IDENTITY");
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const result = nextResolve(specifier, context);
    if (result.url.startsWith("node:")) return result;
    if (!result.url.startsWith("file:")) fail(`NON_FILE_MODULE:${result.url}`);
    const real = fs.realpathSync.native(fileURLToPath(result.url));
    if (!inside(real, SOURCE)) fail(`MODULE_OUTSIDE_STAGE:${real}`);
    resolvedModules.add(real);
    return result;
  },
});

function blockNetwork() { fail("NETWORK"); }
net.Socket.prototype.connect = blockNetwork;
net.connect = blockNetwork;
net.createConnection = blockNetwork;
http.request = blockNetwork;
http.get = blockNetwork;
https.request = blockNetwork;
https.get = blockNetwork;
dns.lookup = blockNetwork;
dns.resolve = blockNetwork;
dgram.createSocket = blockNetwork;
globalThis.fetch = blockNetwork;

const originalWriteFileSync = fs.writeFileSync;
fs.writeFileSync = (file, ...args) => {
  allowOnlyOutput(file);
  return originalWriteFileSync(file, ...args);
};
const originalWriteFile = fs.writeFile;
fs.writeFile = (file, ...args) => {
  allowOnlyOutput(file);
  return originalWriteFile(file, ...args);
};
const originalPromiseWriteFile = fs.promises.writeFile.bind(fs.promises);
fs.promises.writeFile = (file, ...args) => {
  allowOnlyOutput(file);
  return originalPromiseWriteFile(file, ...args);
};
const originalOpenSync = fs.openSync;
function isWriting(flags) {
  return typeof flags === "number"
    ? Boolean(flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT |
                       fs.constants.O_TRUNC | fs.constants.O_APPEND))
    : /[wax+]/.test(flags);
}
fs.openSync = (file, flags, ...args) => {
  if (isWriting(flags)) allowOnlyOutput(file);
  return originalOpenSync(file, flags, ...args);
};
const originalOpen = fs.open;
fs.open = (file, flags, ...args) => {
  if (isWriting(flags)) allowOnlyOutput(file);
  return originalOpen(file, flags, ...args);
};
const originalPromiseOpen = fs.promises.open.bind(fs.promises);
fs.promises.open = (file, flags, ...args) => {
  if (isWriting(flags)) allowOnlyOutput(file);
  return originalPromiseOpen(file, flags, ...args);
};
const originalCreateWriteStream = fs.createWriteStream;
fs.createWriteStream = (file, ...args) => {
  allowOnlyOutput(file);
  return originalCreateWriteStream(file, ...args);
};
fs.mkdirSync = (directory) => {
  if (!same(asPath(directory), OUTPUT_PARENT) || !fs.statSync(OUTPUT_PARENT).isDirectory()) {
    fail(`MKDIR_OUTSIDE_OUTPUT_PARENT:${directory}`);
  }
  return undefined;
};
fs.promises.mkdir = async (directory) => {
  if (!same(asPath(directory), OUTPUT_PARENT) || !fs.statSync(OUTPUT_PARENT).isDirectory()) {
    fail(`MKDIR_OUTSIDE_OUTPUT_PARENT:${directory}`);
  }
  return undefined;
};
for (const method of ["renameSync", "unlinkSync", "rmSync", "rmdirSync", "copyFileSync",
                      "appendFileSync", "truncateSync"]) {
  fs[method] = () => fail(`FORBIDDEN_FS_METHOD:${method}`);
}
for (const method of ["rename", "unlink", "rm", "rmdir", "copyFile", "appendFile", "truncate"]) {
  fs.promises[method] = async () => fail(`FORBIDDEN_PROMISE_FS_METHOD:${method}`);
}
syncBuiltinESMExports();

process.on("exit", () => {
  console.error("QA03_NODE_AUDIT=" + JSON.stringify({
    module_realpaths: [...resolvedModules].sort(), denied,
    node_version: process.version, cli_realpath: CLI,
    output: OUTPUT, permission_model: Boolean(process.permission),
  }));
});

"use strict";

// QA03 W2-r2. This blocks common Node network APIs and external subprocesses;
// it is not an operating-system network sandbox.
const { createHash } = require("node:crypto");
const { readFileSync, realpathSync } = require("node:fs");
const { syncBuiltinESMExports } = require("node:module");
const path = require("node:path");

const selfPath = realpathSync(__filename);
const selfSha256 = createHash("sha256").update(readFileSync(selfPath)).digest("hex").toUpperCase();
if (process.env.QA03_NETWORK_DENY_SHA !== selfSha256)
  throw new Error("QA03_NETWORK_DENY_SHA_MISMATCH");

const allowedWorker = realpathSync(process.env.QA03_ALLOWED_WORKER || "");
const expectedNode = realpathSync(process.env.QA03_NODE_EXE || "");
if (realpathSync(process.execPath) !== expectedNode)
  throw new Error("QA03_UNEXPECTED_NODE_EXE");

function blocked(name) {
  return function () { throw new Error(`QA03_NETWORK_OR_CHILD_DENIED:${name}`); };
}
function replace(target, names, label) {
  for (const name of names) if (typeof target[name] === "function")
    target[name] = blocked(`${label}.${name}`);
}

const net = require("node:net");
replace(net, ["connect", "createConnection"], "net");
replace(net.Socket.prototype, ["connect"], "net.Socket");
replace(net.Server.prototype, ["listen"], "net.Server");
const tls = require("node:tls");
replace(tls, ["connect"], "tls");
const http = require("node:http");
replace(http, ["request", "get"], "http");
const https = require("node:https");
replace(https, ["request", "get"], "https");
const http2 = require("node:http2");
replace(http2, ["connect"], "http2");
const dgram = require("node:dgram");
replace(dgram.Socket.prototype, ["bind", "connect", "send"], "dgram.Socket");
const dns = require("node:dns");
const dnsCalls = ["lookup", "lookupService", "resolve", "resolve4", "resolve6", "resolveAny",
  "resolveCaa", "resolveCname", "resolveMx", "resolveNaptr", "resolveNs", "resolvePtr",
  "resolveSoa", "resolveSrv", "resolveTxt", "reverse"];
replace(dns, dnsCalls, "dns");
replace(dns.promises, dnsCalls, "dns.promises");

const child = require("node:child_process");
const originalFork = child.fork;
replace(child, ["spawn", "spawnSync", "execSync", "execFile", "execFileSync"], "child_process");
let viteNetUseProbeCount = 0;
child.exec = function (command, options, callback) {
  // Vite 8.2 probes Windows drive mappings once while resolving local paths.
  // A denied probe leaves Vite's local fs.realpathSync fallback in place.
  if (command !== "net use" || options?.windowsHide !== true ||
      typeof callback !== "function" || process.argv[1] !== process.env.QA03_VITE_ENTRY ||
      ++viteNetUseProbeCount !== 1)
    throw new Error("QA03_NETWORK_OR_CHILD_DENIED:child_process.exec");
  process.stderr.write("QA03_VITE_NET_USE_PROBE_SIMULATED_DENY\n");
  queueMicrotask(() => callback(new Error("QA03_NET_USE_PROBE_SIMULATED_DENY"), "", ""));
  return Object.freeze({ simulated: "VITE_NET_USE_PROBE_DENIED" });
};
child.fork = function (modulePath, args, options) {
  const target = realpathSync(path.resolve(String(modulePath)));
  const parentIsVitest = path.basename(process.argv[1] || "") === "vitest.mjs";
  const chosenNode = options?.execPath ? realpathSync(options.execPath) : realpathSync(process.execPath);
  if (!parentIsVitest || target !== allowedWorker || chosenNode !== expectedNode ||
      options?.env?.QA03_NETWORK_DENY_SHA !== selfSha256 ||
      !String(options?.env?.NODE_OPTIONS || "").includes(selfPath))
    throw new Error("QA03_EXTERNAL_CHILD_DENIED");
  return originalFork.apply(this, arguments);
};

globalThis.fetch = async () => { throw new Error("QA03_NETWORK_OR_CHILD_DENIED:fetch"); };
globalThis.WebSocket = blocked("WebSocket");
syncBuiltinESMExports();

const identity = Object.freeze({
  gate: "QA03_S1_NETWORK_DENY_V1", sha256: selfSha256, path: selfPath,
  pid: process.pid, entry: process.argv[1] || "", worker: process.argv[1] === allowedWorker,
});
Object.defineProperty(globalThis, "__QA03_NETWORK_DENY__", { value: identity, configurable: false });
process.stderr.write(`QA03_NETWORK_DENY_LOADED ${JSON.stringify(identity)}\n`);

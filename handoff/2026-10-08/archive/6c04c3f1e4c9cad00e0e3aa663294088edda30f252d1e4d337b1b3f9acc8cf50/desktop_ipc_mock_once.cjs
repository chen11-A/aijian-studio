"use strict";
// QA-only isolated TS/mock runner. Never loads source from an author tree.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const Module = require("node:module");
const root = __dirname;
const stage = path.join(root, "stage");
const src = path.join(stage, "apps", "desktop", "src");
const ts = require(path.join(stage, "node_modules", "typescript"));
const loaderPolicy = require("./qa_loader_policy.cjs");
const cache = new Map();
const loaded = [];
const ipcInvokes = [];
let exposed = null;
const electronMock = {
  contextBridge: { exposeInMainWorld: (name, value) => {
    assert.equal(name, "aijian");
    assert.equal(exposed, null);
    exposed = value;
  } },
  ipcRenderer: { invoke: async (channel, ...args) => {
    ipcInvokes.push({ channel, args });
    return { kind: "QA_IPC_MOCK" };
  } },
};
function loadTs(file) {
  const resolved = loaderPolicy.within(file);
  if (cache.has(resolved)) return cache.get(resolved).exports;
  const source = fs.readFileSync(resolved, "utf8");
  const output = ts.transpileModule(source, {
    fileName: resolved,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    reportDiagnostics: true,
  });
  assert.equal((output.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error).length, 0);
  const instance = new Module(resolved, module);
  cache.set(resolved, instance);
  instance.filename = resolved;
  instance.paths = [];
  instance.require = (specifier) => {
    const target = loaderPolicy.resolveRuntime(resolved, specifier);
    if (target.kind === "electron") return electronMock;
    if (target.kind === "builtin") return require(target.specifier);
    return loadTs(target.file);
  };
  instance._compile(output.outputText, resolved);
  loaded.push(resolved);
  return instance.exports;
}
const mainSource = fs.readFileSync(path.join(src, "main.ts"), "utf8");
const preloadSource = fs.readFileSync(path.join(src, "preload.ts"), "utf8");
assert.match(mainSource, /registerSub2APIConnectionMutationHandlers<IpcMainInvokeEvent>\(/);
assert.match(mainSource, /event\.senderFrame === mainWindow\.webContents\.mainFrame/);
assert.match(preloadSource, /providers:edit-sub2api-metadata/);
assert.match(preloadSource, /providers:rotate-sub2api-key/);
assert.match(preloadSource, /providers:read-sub2api-rotation/);
const contract = loadTs(path.join(src, "sub2api-connection-mutation-contract.ts"));
const ipc = loadTs(path.join(src, "sub2api-connection-mutation-ipc.ts"));
loadTs(path.join(src, "preload.ts"));
assert.ok(exposed);
const channels = contract.SUB2API_MUTATION_CHANNELS;
const connectionId = "pcn_" + "a".repeat(32);
const operationId = "pcop_" + "b".repeat(32);
const requestId = "12345678-1234-4123-8123-123456789abc";
const canary = "QA_CANARY_" + "K".repeat(32);
const metadata = {
  expected_revision: 3, display_name: "QA Sub2API", base_url: "https://example.com",
  enabled: true, models: [{ model_id: "qa-model", capabilities: ["TEXT"] }],
};
const rotation = { expected_revision: 3, operation_id: operationId, api_key: canary };
const handlers = new Map();
const called = [];
const fakeClient = {
  editSub2APIMetadata: async (...args) => { called.push("edit"); return { kind: "UPDATED", args: args.length }; },
  rotateSub2APIKey: async (...args) => { called.push("rotate"); return { kind: "UPDATED", args: args.length }; },
  readSub2APIKeyRotation: async (...args) => { called.push("read"); return { kind: "READ", args: args.length }; },
};
ipc.registerSub2APIConnectionMutationHandlers(
  (channel, handler) => { assert.ok(!handlers.has(channel)); handlers.set(channel, handler); },
  () => fakeClient, (event) => event.topLevel === true,
);
assert.deepEqual([...handlers.keys()], [channels.edit, channels.rotate, channels.readRotation]);
async function rejects(promise) { await assert.rejects(promise); }
async function checkIpc() {
  for (const channel of handlers.keys()) {
    await rejects(handlers.get(channel)({ topLevel: false }, connectionId, rotation));
  }
  assert.equal(called.length, 0);
  await rejects(handlers.get(channels.edit)({ topLevel: true }, connectionId, { ...metadata, unexpected: 1 }));
  await rejects(handlers.get(channels.rotate)({ topLevel: true }, connectionId, { ...rotation, operation_id: "bad" }));
  await rejects(handlers.get(channels.readRotation)({ topLevel: true }, connectionId, "bad"));
  assert.equal(called.length, 0);
  assert.equal((await handlers.get(channels.edit)({ topLevel: true }, connectionId, metadata)).kind, "UPDATED");
  assert.equal((await handlers.get(channels.rotate)({ topLevel: true }, connectionId, rotation)).kind, "UPDATED");
  assert.equal((await handlers.get(channels.readRotation)({ topLevel: true }, connectionId, operationId)).kind, "READ");
  assert.deepEqual(called, ["edit", "rotate", "read"]);
  await exposed.editSub2APIMetadata(connectionId, metadata);
  await exposed.rotateSub2APIKey(connectionId, rotation);
  await exposed.readSub2APIKeyRotation(connectionId, operationId);
  assert.deepEqual(ipcInvokes.map((item) => item.channel),
    [channels.edit, channels.rotate, channels.readRotation]);
  assert.equal(ipcInvokes[2].args[1], operationId);
}
function response(status, payload, headerId = requestId) {
  return new Response(JSON.stringify(payload), {
    status, headers: { "Content-Type": "application/json", "X-Request-ID": headerId },
  });
}
function connectionReceipt(command, credentialStatus = "CONFIGURED") {
  return { request_id: requestId, data: {
    id: connectionId, provider_kind: "SUB2API", display_name: command.display_name || "QA Sub2API",
    base_url: (command.base_url || "https://example.com").replace(/\/+$/, ""),
    enabled: command.enabled ?? true, models: command.models || metadata.models,
    credential_status: credentialStatus, revision: command.expected_revision + 1,
    created_at: "2026-09-29T00:00:00Z", updated_at: "2026-09-29T00:00:01Z",
  } };
}
const definite = (status, code) => response(status, {
  request_id: requestId,
  error: { code, message: "QA rejected", details: {}, retryable: false },
});
const calls = [];
let queued = [];
const fetcher = async (url, init) => {
  calls.push({ url, init });
  assert.ok(queued.length > 0, "unexpected fetch");
  const next = queued.shift();
  if (next instanceof Error) throw next;
  return next;
};
const client = loadTs(path.join(src, "api-client.ts")).createLocalApiClient(
  fetcher, { origin: "http://127.0.0.1:49123", token: "A".repeat(43) },
);
async function once(method, expectedKind, expectedHttpMethod, expectedSuffix) {
  const before = calls.length;
  const result = await method();
  assert.equal(result.kind, expectedKind);
  assert.equal(calls.length, before + 1);
  const call = calls.at(-1);
  assert.equal(call.init.method || "GET", expectedHttpMethod);
  assert.ok(call.url.endsWith(expectedSuffix));
  assert.equal(queued.length, 0);
  return result;
}
async function checkHttp() {
  const base = "/api/v1/provider-connections/" + connectionId;
  queued = [response(200, connectionReceipt(metadata))];
  await once(() => client.editSub2APIMetadata(connectionId, metadata),
    "UPDATED", "PATCH", base);
  assert.equal(JSON.parse(calls.at(-1).init.body).expected_revision, 3);
  const ipMetadata = { ...metadata, base_url: "https://8.8.8.8" };
  queued = [response(200, connectionReceipt(ipMetadata))];
  await once(() => client.editSub2APIMetadata(connectionId, ipMetadata),
    "UPDATED", "PATCH", base);
  const preflightCount = calls.length;
  await rejects(client.editSub2APIMetadata(connectionId, { ...metadata, base_url: "https://localhost" }));
  assert.equal(calls.length, preflightCount);
  queued = [definite(422, "PROVIDER_ORIGIN_NOT_PUBLIC")];
  await once(() => client.editSub2APIMetadata(connectionId, { ...metadata, base_url: "https://127.0.0.1" }),
    "DEFINITE_SERVER_ERROR", "PATCH", base);
  queued = [definite(409, "PROVIDER_REVISION_CONFLICT")];
  await once(() => client.editSub2APIMetadata(connectionId, metadata),
    "DEFINITE_SERVER_ERROR", "PATCH", base);
  for (const outcome of [new Error("qa transport"), response(503, {}),
                         response(200, { invalid: true }),
                         response(200, connectionReceipt(metadata), "00000000-0000-4000-8000-000000000000")]) {
    queued = [outcome];
    await once(() => client.editSub2APIMetadata(connectionId, metadata),
      "REMOTE_UNKNOWN", "PATCH", base);
  }
  queued = [response(200, connectionReceipt(rotation))];
  const rotated = await once(() => client.rotateSub2APIKey(connectionId, rotation),
    "UPDATED", "POST", base + "/credential-rotations");
  assert.equal(JSON.parse(calls.at(-1).init.body).operation_id, operationId);
  assert.ok(JSON.parse(calls.at(-1).init.body).api_key === canary,
    "rotation ingress canary mismatch");
  assert.ok(!JSON.stringify(rotated).includes(canary));
  queued = [new Error("qa ambiguous POST")];
  await once(() => client.rotateSub2APIKey(connectionId, rotation),
    "REMOTE_UNKNOWN", "POST", base + "/credential-rotations");
  const postCount = calls.filter((call) => call.init.method === "POST").length;
  const readReceipt = (status) => ({ request_id: requestId, data: {
    operation_id: operationId, connection_id: connectionId, expected_revision: 3,
    status, applied_revision: status === "APPLIED" ? 4 : null,
    created_at: "2026-09-29T00:00:00Z", updated_at: "2026-09-29T00:00:01Z",
  } });
  for (const status of ["PREPARED", "APPLIED", "CONFLICT", "UNKNOWN"]) {
    queued = [response(200, readReceipt(status))];
    const result = await once(() => client.readSub2APIKeyRotation(connectionId, operationId),
      "READ", "GET", base + "/credential-rotations/" + operationId);
    assert.equal(result.receipt.data.status, status);
  }
  assert.equal(calls.filter((call) => call.init.method === "POST").length, postCount);
  queued = [definite(409, "PROVIDER_ROTATION_OPERATION_EXISTS")];
  await once(() => client.rotateSub2APIKey(connectionId, rotation),
    "DEFINITE_SERVER_ERROR", "POST", base + "/credential-rotations");
  queued = [response(200, readReceipt("APPLIED"))];
  await once(() => client.readSub2APIKeyRotation(connectionId, operationId),
    "READ", "GET", base + "/credential-rotations/" + operationId);
  queued = [response(200, { invalid: true })];
  await once(() => client.readSub2APIKeyRotation(connectionId, operationId),
    "REMOTE_UNKNOWN", "GET", base + "/credential-rotations/" + operationId);
}
(async () => {
  await checkIpc();
  await checkHttp();
  const publicEvidence = {
    state: "DESKTOP_IPC_TS_MOCK_PASS_ONLY",
    channels: [...handlers.keys()],
    ipc_invocations: ipcInvokes.length,
    local_http_calls: calls.length,
    rotation_post_calls: calls.filter((call) => call.init.method === "POST").length,
    loaded_modules: loaded.map((file) => ({
      relative_path: path.relative(stage, file).replaceAll(path.sep, "/"),
      sha256: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").toUpperCase(),
    })),
    canary_leak_in_results: false,
    provider_called: false,
    electron_run: false,
    backend_called: false,
  };
  assert.ok(!JSON.stringify(publicEvidence).includes(canary));
  process.stdout.write(JSON.stringify(publicEvidence) + "\n");
})().catch((error) => {
  process.stderr.write(String(error && error.stack || error) + "\n");
  process.exitCode = 1;
});

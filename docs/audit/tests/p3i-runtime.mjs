// Audit-only reproduction. Reads the reviewed TypeScript; no production writes or live APIs.
// P3I_TYPESCRIPT may point to an installed TypeScript 5.9.3 module.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";
const require = createRequire(import.meta.url);
const ts = require(process.env.P3I_TYPESCRIPT || "/tmp/p3i-audit-deps/node_modules/typescript");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const cache = new Map();
function load(relative) {
  const file = resolve(root, relative);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  const js = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const localRequire = (name) =>
    name.startsWith(".") ? load(resolve(dirname(file), `${name}.ts`)) : require(name);
  vm.runInThisContext(`(function(require,module,exports){${js}\n})`, { filename: file })(
    localRequire,
    module,
    module.exports,
  );
  return module.exports;
}
const log = load("apps/desktop/src/agent-log.ts");
const http = load("apps/desktop/src/grok-auth-http.ts");
const library = load("apps/desktop/src/film-library.ts");
test("existing scrubber handles named token and bearer controls", () => {
  assert(!log.redactSecrets("access_token=FAKE_AUDIT_ONLY").includes("FAKE_AUDIT_ONLY"));
  assert(!log.redactSecrets("Bearer FAKE_AUDIT_ONLY").includes("FAKE_AUDIT_ONLY"));
});
test("REPRO: camelCase credentials, cookie, signed URL and novel text survive log scrubber", () => {
  for (const input of [
    '{"apiKey":"FAKE_AUDIT_ONLY"}',
    "Cookie: session=FAKE_AUDIT_ONLY",
    "https://example.invalid/media?X-Amz-Signature=FAKE_AUDIT_ONLY",
    "原创审计小说正文片段",
  ]) {
    assert.equal(log.redactSecrets(input), input);
  }
});
test("REPRO: text deadline does not cover waiting for response headers", async () => {
  let settle;
  const pending = http.completeGrokText(
    () =>
      new Promise((resolve) => {
        settle = resolve;
      }),
    {
      accessToken: "FAKE_AUDIT_ONLY",
      model: "audit-model",
      text: "audit",
      limits: { idleMs: 5, totalMs: 10 },
    },
  );
  let completed = false;
  pending.then(
    () => {
      completed = true;
    },
    () => {
      completed = true;
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(completed, false);
  settle(new Response(JSON.stringify({ output_text: "audit finished" }), { status: 200 }));
  assert.equal(await pending, "audit finished");
});
test("REPRO: Windows reserved device export names are accepted", () => {
  for (const name of ["CON", "NUL", "COM1", "LPT1"])
    assert.equal(library.safeExportName(name), `${name}.mp4`);
});
function sourceFunction(file, name) {
  const source = readFileSync(resolve(root, file), "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name)
      found = node.getText(ast).replace(/^export\s+/, "");
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert(found, `source function ${name} exists`);
  return ts.transpileModule(found, { compilerOptions: { target: ts.ScriptTarget.ES2022 } })
    .outputText;
}
test("REPRO: fillCast writes project A late reply into current project B", async () => {
  let resolveReply;
  const A = { id: "A", characters: [], locations: [], scenes: [{ text: "原创审计故事 A" }] };
  const B = { id: "B", characters: [], locations: [], scenes: [{ text: "原创审计故事 B" }] };
  const ref = { current: A };
  let applied;
  const ctx = vm.createContext({
    connected: true,
    noticeEpoch: { current: 0 },
    filmRef: ref,
    completeAgent: () =>
      new Promise((resolve) => {
        resolveReply = resolve;
      }),
    parseCastReply: () => ({
      characters: [{ name: "审计人物A", identity: "成年男性" }],
      locations: [],
    }),
    assignVoice: () => "audit-voice",
    setNotice: () => {},
    applyLive: (value) => {
      applied = value;
    },
  });
  vm.runInContext(
    sourceFunction("apps/studio-web/src/aivora/film/operations.ts", "mergeCast") +
      sourceFunction("apps/studio-web/src/aivora/pro/ProWorkspace.tsx", "fillCast"),
    ctx,
  );
  const pending = ctx.fillCast(A);
  ref.current = B;
  resolveReply({ text: "audit fixture", detail: "" });
  await pending;
  assert.equal(applied.id, "B");
  assert.equal(applied.characters[0].name, "审计人物A");
});
test("REPRO: failed performance enrichment silently returns original shots", async () => {
  let calls = 0;
  const ctx = vm.createContext({
    completeAgent: async () => {
      calls++;
      throw Error("audit provider failure");
    },
  });
  vm.runInContext(
    sourceFunction("apps/studio-web/src/aivora/pro/ProWorkspace.tsx", "fillPerformance"),
    ctx,
  );
  const shots = [
    { id: "s1", sceneId: "scene1", characters: ["审计人物"], picture: "audit", line: "审计台词" },
  ];
  const result = await ctx.fillPerformance(
    { scenes: [{ id: "scene1", title: "审计", text: "审计正文" }] },
    shots,
  );
  assert.equal(calls, 1);
  assert.equal(result, shots);
});
test("REPRO: rejected writer bridge call leaves asking state set", async () => {
  let asking = false;
  const ctx = vm.createContext({
    film: { scenes: [{ text: "审计正文" }], styleZh: "audit", title: "audit" },
    chat: "",
    connected: true,
    pushTurn: () => {
      asking = true;
      return "turn";
    },
    setPendingScenes: () => {},
    numberedScript: (x) => x,
    completeAgent: async () => {
      throw Error("audit IPC rejection");
    },
    finishTurn: () => {
      asking = false;
    },
  });
  vm.runInContext(
    sourceFunction("apps/studio-web/src/aivora/pro/ProWorkspace.tsx", "planWriter"),
    ctx,
  );
  await assert.rejects(ctx.planWriter("write"), /audit IPC rejection/);
  assert.equal(asking, true);
});

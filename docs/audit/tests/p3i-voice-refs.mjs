// Run: P3I_TYPESCRIPT=/tmp/p3i-audit-deps/node_modules/typescript/lib/typescript.js node --test docs/audit/tests/p3i-voice-refs.mjs
// Executes selected declarations from audited source; no application file is changed.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";
import { execFileSync } from "node:child_process";
const require = createRequire(import.meta.url);
const ts = require(
  process.env.P3I_TYPESCRIPT || "/tmp/p3i-audit-deps/node_modules/typescript/lib/typescript.js",
);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
function load(path, names, globals = {}) {
  const source = readFileSync(resolve(root, path), "utf8");
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const declarations = ast.statements.filter(
    (s) =>
      names.includes(s.name?.text) ||
      (ts.isVariableStatement(s) &&
        s.declarationList.declarations.some((d) => names.includes(d.name.text))),
  );
  const code = declarations.map((s) => s.getText(ast).replace(/^export\s+/, "")).join("\n");
  const js = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return vm.runInNewContext(`${js}\n({${names.join(",")}})`, globals);
}
const operations = "apps/studio-web/src/aivora/film/operations.ts";
const voices = load(operations, [
  "WOMAN",
  "MAN",
  "YOUNG_WOMAN",
  "YOUNG_MAN",
  "GIRL",
  "BOY",
  "ELDER_WOMAN",
  "ELDER_MAN",
  "CN_DIGIT",
  "ageYears",
  "voicePool",
  "assignVoice",
  "mergeCast",
]);
const film = () => ({ characters: [], locations: [], scenes: [] });
function voice(character) {
  return voices.mergeCast(film(), { characters: [character], locations: [] }).characters[0].voiceId;
}
test("REPRO: explicit male gender loses to female words in identity", () => {
  assert.equal(
    voice({ name: "周明", gender: "男", ageBand: "成年", identity: "女主角的丈夫" }),
    "ara",
  );
});
test("REPRO: explicit adult age loses to incidental child keyword", () => {
  assert.equal(
    voice({ name: "周明", gender: "男", ageBand: "成年", identity: "照看孩子的保安" }),
    "helios",
  );
  assert.ok(voices.BOY.includes("helios")); // Code's child pool, not an acoustic age assertion.
});
test("REPRO: exhausted male pool falls back to female pool", () => {
  assert.equal(voices.assignVoice("男 成年", "周明", new Set(voices.MAN)), "ara");
});
test("REPRO: exhausted adult pools fall back to young pool", () => {
  assert.equal(
    voices.assignVoice("男 成年", "周明", new Set([...voices.WOMAN, ...voices.MAN])),
    "iris",
  );
});
test("REPRO: existing cast without voice ignores explicit gender and ageBand", () => {
  const existing = {
    ...film(),
    characters: [{ name: "赵宁", identity: "西装", gender: "女", ageBand: "成年", voiceId: "" }],
  };
  assert.equal(
    voices.mergeCast(existing, { characters: [], locations: [] }).characters[0].voiceId,
    "leo",
  );
});
const references = load(operations, ["usableImage", "shotReference"]);
const shot = { poster: "/tmp/start.png", stills: [], characters: ["周明"], speaker: "周明" };
const cast = {
  characters: [
    {
      name: "周明",
      portraits: Array.from({ length: 20 }, (_, i) => ({
        url: `https://example.invalid/${i}.png`,
        view: "正面",
      })),
    },
  ],
};
test("PASS: reference selection retains thirteen references plus separate first frame", () => {
  const result = references.shotReference(shot, cast);
  assert.equal(result.still, "/tmp/start.png");
  assert.equal(result.references.length, 13);
});
test("REPRO: lone HTTPS portrait becomes still and is absent from references", () => {
  const result = references.shotReference(
    { ...shot, poster: "" },
    {
      characters: [
        { name: "周明", portraits: [{ url: "https://example.invalid/face.png", view: "正面" }] },
      ],
    },
  );
  assert.equal(result.still, "https://example.invalid/face.png");
  assert.equal(result.references.length, 0);
  // Backend _local_image rejects HTTPS; see separate static evidence in report.
});
const stills = load("apps/desktop/src/film-library.ts", [
  "IMAGE_MODEL",
  "IMAGE_URL",
  "maxStillBytes",
  "requestStill",
]);
test("REPRO: actual first-frame request body carries no reference image field", async () => {
  let body;
  await stills.requestStill({
    prompt: "测试首帧",
    token: "audit-fake-token",
    destination: "/unused",
    references: ["https://example.invalid/face.png"],
    fetcher: async (_url, options) => {
      body = JSON.parse(options.body);
      return { status: 400, ok: false };
    },
  });
  assert.deepEqual(Object.keys(body).sort(), [
    "model",
    "n",
    "prompt",
    "quality",
    "response_format",
  ]);
  assert.equal(body.reference_images, undefined);
  assert.equal(body.images, undefined);
});

test("REPRO: backend rejects chosen HTTPS still; model reference limits are 13/7/0", () => {
  const code = `import ast, pathlib
source = pathlib.Path('services/api/src/aijian_api/story_film.py').read_text()
tree = ast.parse(source)
names = {'_local_image', 'reference_cap', 'references_for_model'}
selected = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names]
module = ast.Module(body=[ast.ImportFrom(module='__future__', names=[ast.alias(name='annotations')], level=0), *selected], type_ignores=[])
ns = {}
exec(compile(ast.fix_missing_locations(module), '<audited declarations>', 'exec'), ns)
assert ns['_local_image']('https://example.invalid/face.png') is None
assert len(ns['references_for_model']('grok-imagine-video-1.5', tuple(range(20)))) == 13
assert len(ns['references_for_model']('grok-imagine-video', tuple(range(20)))) == 7
assert len(ns['references_for_model']('grok-imagine-video-lite', tuple(range(20)))) == 0
print('backend checks passed')`;
  assert.match(
    execFileSync("python", ["-c", code], { cwd: root, encoding: "utf8" }),
    /backend checks passed/,
  );
});

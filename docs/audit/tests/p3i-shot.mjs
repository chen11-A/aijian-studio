/** Run: node docs/audit/tests/p3i-shot.mjs
 * Uses TypeScript already in the repo, or P3I_TYPESCRIPT, or the isolated audit install.
 * Assertions document current behavior, including reproduced defects; PASS is not acceptance.
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
let ts;
for (const candidate of [
  process.env.P3I_TYPESCRIPT,
  "typescript",
  "/tmp/p3i-audit-deps/node_modules/typescript",
].filter(Boolean)) {
  try {
    ts = require(candidate);
    break;
  } catch {}
}
if (!ts) throw new Error("Set P3I_TYPESCRIPT to an installed TypeScript module path.");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const scope = vm.createContext({});
function load(relative, names) {
  const source = fs.readFileSync(path.join(root, relative), "utf8");
  const ast = ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true);
  const declarations = ast.statements.filter(
    (s) =>
      names.includes(s.name?.text) ||
      (ts.isVariableStatement(s) &&
        s.declarationList.declarations.some((d) => names.includes(d.name.getText(ast)))),
  );
  assert.equal(declarations.length, names.length, `All source declarations found: ${relative}`);
  const actual = declarations.map((s) => s.getText(ast).replace(/^export\s+/, "")).join("\n");
  const js = ts.transpileModule(actual, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInContext(js, scope, { filename: relative });
}
load("apps/studio-web/src/aivora/film/phase2.ts", [
  "SHOT_SIZES",
  "classifyShotSize",
  "spokenLine",
  "scriptDialogue",
  "attachScriptLines",
  "agentIssues",
  "actionText",
  "actionFromModel",
  "actionSentence",
  "plainCue",
]);
load("apps/studio-web/src/aivora/film/operations.ts", [
  "sliceNovel",
  "isFightScene",
  "beatsForShot",
]);
let count = 0;
function check(name, fn) {
  fn();
  console.log(`PASS ${++count} ${name}`);
}
const blank = () => [{ line: "", characters: ["林骁"], picture: "林骁站在门边" }];
check("positive: explicit known-speaker dialogue attaches, caption does not", () => {
  assert.equal(scope.attachScriptLines(blank(), "林骁说：“走吧。”", ["林骁"])[0].line, "走吧");
  assert.equal(scope.attachScriptLines(blank(), "纸条：明日再来。", ["林骁"])[0].line, "");
});
check("defect: narrator text after unquoted dialogue is voiced", () => {
  const result = scope.attachScriptLines(blank(), "林骁：走吧。随后他转身离开。", ["林骁"]);
  assert.equal(result[0].line, "走吧。随后他转身离开");
});
check("defect: existing invented dialogue is retained by attachScriptLines", () => {
  const shots = blank();
  shots[0].line = "凭空捏造的台词";
  assert.equal(
    scope.attachScriptLines(shots, "林骁站在门边。", ["林骁"])[0].line,
    "凭空捏造的台词",
  );
});
check("positive: standard next scene heading stays with next scene", () => {
  const parts = scope.sliceNovel("第一场 书店\n林骁看书。\n第二场 巷口\n林骁离开。", [
    "书店",
    "巷口",
  ]);
  assert.equal(parts[0], "第一场 书店\n林骁看书。");
  assert.ok(parts[1].startsWith("第二场"));
});
check("positive: 打烊 is not fighting and 打斗 is fighting", () => {
  assert.equal(scope.isFightScene("书店要打烊了。"), false);
  assert.equal(scope.isFightScene("巷内发生打斗。"), true);
});
check("positive: 中景 remains 中景", () =>
  assert.equal(scope.classifyShotSize("中景").size, "中景"),
);
const rows = scope.actionFromModel({
  shots: [{ shot_id: "scene-1-shot-1", nodes: [{ text: "甲抬手" }, { text: "甲后退" }] }],
});
check("positive: matching shot gets its own nodes", () =>
  assert.equal(scope.beatsForShot(rows, 1, "scene-1-shot-1"), "甲抬手。甲后退"),
);
check("defect: missing shot inherits another shot explicit node via positional fallback", () =>
  assert.equal(scope.beatsForShot(rows, 2, "scene-1-shot-2"), "甲后退"),
);
check("defect: manual action sentence merges nodes across different shot ids", () => {
  const parsed = scope.actionFromModel({
    shots: [
      { shot_id: "scene-1-shot-1", nodes: [{ text: "甲抬手" }] },
      { shot_id: "scene-1-shot-2", nodes: [{ text: "乙后退" }] },
    ],
  });
  const result = scope.actionSentence(parsed);
  assert.ok(result.includes("甲抬手") && result.includes("乙后退"));
});
check("positive: hold_seconds and bare hold_s rendered as prose", () => {
  assert.equal(scope.plainCue("hold_seconds: 1"), "停 1 秒");
  assert.equal(scope.plainCue("hold_s 1"), "停 1 秒");
});
check("defect: delimited hold_s leaks raw field into display text", () => {
  assert.equal(scope.plainCue("hold_s: 1"), "hold_s: 1");
  assert.equal(scope.plainCue("hold_s=1"), "hold_s=1");
});
console.log(
  `${count} checks passed (6 positive, 5 current-behavior defect checks). No network or application files written.`,
);

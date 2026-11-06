// Run: node --disable-warning=ExperimentalWarning docs/audit/tests/p3i-script-director.mjs
// Tests characterize audited defects: PASS means the stated defect was reproduced.
// Executes original function bodies extracted after Node's TypeScript erasure; no copied logic.
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const ctx = vm.createContext({});
function load(file, names, constants = []) {
  const js = stripTypeScriptTypes(readFileSync(root + file, "utf8")).replace(/^export /gm, "");
  for (const name of constants) {
    const declaration = js.match(new RegExp("^const " + name + " = [^;]+;", "m"))?.[0];
    assert.ok(declaration, name);
    vm.runInContext(declaration, ctx);
  }
  for (const name of names) {
    const declaration = js.match(new RegExp("^function " + name + "\\b[\\s\\S]*?^}", "m"))?.[0];
    assert.ok(declaration, name);
    vm.runInContext(declaration, ctx);
  }
}
const base = "apps/studio-web/src/aivora/film/";
load(
  base + "operations.ts",
  [
    "scene",
    "asText",
    "novelHeadingSlices",
    "quoteAt",
    "rowProbes",
    "sliceNovel",
    "subsplit",
    "numberParagraphs",
    "numberedScript",
    "quotedLines",
    "headingWhere",
    "listedParagraphs",
    "elementLines",
    "rebuildFromParagraphs",
    "parseWriterScenes",
  ],
  ["NOVEL_HEADING"],
);
load(base + "audio.ts", ["emptySoundPlan", "storedShotSeconds"], ["SHOT_SECONDS_MAX"]);
load(
  base + "phase2.ts",
  [
    "classifyShotSize",
    "lineInScript",
    "spokenLine",
    "scriptDialogue",
    "attachScriptLines",
    "plainCue",
    "soundFromDirector",
  ],
  ["SHOT_SIZES"],
);
load(base + "project.ts", ["placeName", "matchDirectorScene", "shotBudget", "parseDirectorShots"]);
const cases = [];
function test(name, fn) {
  fn();
  cases.push(name);
  console.log("PASS " + name);
}
const source = "甲说：“第一句。”\n乙说：“第二句。”\n丙说：“第三句。”";
const scene = (id, text) => ({ id, title: id, where: "", text });
const rows = (a, b) =>
  JSON.stringify({
    scenes: [
      { title: "甲地", text: "简述甲", source_paragraphs: a },
      { title: "乙地", text: "简述乙", source_paragraphs: b },
    ],
  });
test("normal P01/P02/P03 ownership reconstructs exact original paragraphs", () => {
  const out = ctx.parseWriterScenes(rows(["P01"], ["P02", "P03"]), source);
  assert.equal(out[0].text, source.split("\n")[0]);
  assert.equal(out[1].text, source.split("\n").slice(1).join("\n"));
});
test("P03 omitted by model is silently lost, including its original dialogue", () => {
  const out = ctx.parseWriterScenes(rows(["P01"], ["P02"]), source);
  assert.equal(
    out.some((s) => s.text.includes("第三句")),
    false,
  );
});
test("duplicate ownership leaves unowned scene containing the whole novel", () => {
  const reply = JSON.stringify({
    scenes: [
      { title: "甲地", text: "简述", source_paragraphs: ["P01", "P02", "P03"] },
      { title: "乙地", text: source, source_paragraphs: ["P01", "P02", "P03"] },
    ],
  });
  const out = ctx.parseWriterScenes(reply, source);
  assert.equal(out[0].text, source);
  assert.equal(out[1].text, source);
});
test("100th paragraph id is generated but rejected and paragraph is lost", () => {
  const text = Array.from({ length: 100 }, (_, i) => "第" + (i + 1) + "段原文。").join("\n");
  assert.equal(ctx.numberParagraphs(text)[99].id, "P100");
  const out = ctx.parseWriterScenes(
    rows(
      Array.from({ length: 99 }, (_, i) => "P" + String(i + 1).padStart(2, "0")),
      ["P100"],
    ),
    text,
  );
  assert.equal(
    out.some((s) => s.text.includes("第100段原文")),
    false,
  );
});
test("unknown scene IDs without location all map to requested scene, ignoring index", () => {
  const refs = [scene("scene-1", "短场一"), scene("scene-2", "短场二")];
  assert.equal(
    ctx.matchDirectorScene({ scene_id: "grok-new-2" }, refs, "scene-1", 1).id,
    "scene-1",
  );
});
const shot = { video_prompt: "站在窗前", blocking: [{ who: "甲甲", where: "画左" }], dialogue: [] };
test("video_prompt and blocking array parse correctly", () => {
  const out = ctx.parseDirectorShots(JSON.stringify({ shots: [shot] }), "scene-1", "短场");
  assert.equal(out[0].picture, "站在窗前");
  assert.equal(out[0].blocking, "甲甲画左");
});
test("short scene returns 20 shots despite 16-shot requirement", () => {
  const out = ctx.parseDirectorShots(
    JSON.stringify({ shots: Array.from({ length: 20 }, () => shot) }),
    "scene-1",
    "短场",
  );
  assert.equal(out.length, 20);
});
test("repeated blocks bypass scene budget and produce duplicate shot IDs", () => {
  const text = "原文".repeat(500);
  const block = { scene_id: "scene-1", shots: Array.from({ length: 16 }, () => shot) };
  const out = ctx.parseDirectorShots(JSON.stringify({ scenes: [block, block] }), "scene-1", text, [
    scene("scene-1", text),
  ]);
  assert.equal(out.length, 32);
  assert.equal(new Set(out.map((s) => s.id)).size, 16);
});
test("dialogue array keeps only first line when no empty shot exists", () => {
  const text = "甲甲说：“第一句。”\n乙乙说：“第二句。”";
  const out = ctx.parseDirectorShots(
    JSON.stringify({
      shots: [
        {
          ...shot,
          characters: ["甲甲", "乙乙"],
          dialogue: [
            { speaker: "甲甲", line: "第一句。" },
            { speaker: "乙乙", line: "第二句。" },
          ],
        },
      ],
    }),
    "scene-1",
    text,
  );
  assert.equal(out[0].line, "第一句。");
  assert.equal(
    out.some((s) => s.line.includes("第二句")),
    false,
  );
});
const writerPrompt = readFileSync(
  root + "services/api/src/aijian_api/agents/prompts/writer.md",
  "utf8",
);
vm.runInContext("const PROMPTS = " + JSON.stringify({ writer: writerPrompt }) + ";", ctx);
load(base + "project.ts", ["agentRequest"]);
// Only the exact production input guard is evaluated; provider/network auth is not mocked as a full end-to-end run.
const runtime = readFileSync(root + "apps/desktop/src/grok-auth-runtime.ts", "utf8");
const guard = runtime.match(/    if \(\n      input\.text\.length === 0[\s\S]*?^    }/m)?.[0];
assert.ok(guard, "production completeText input guard");
const validate = vm.runInContext(
  "(input) => { " + guard + '; return {kind:"ACCEPTED_BY_GUARD"}; }',
  ctx,
);
test("agentRequest retains long source but production completeText rejects prompt over 8000", () => {
  const context = "原".repeat(7500) + "尾部标记";
  const request = ctx.agentRequest("writer", context, "请分场");
  assert.ok(request.includes(context));
  assert.ok(request.length > 8000);
  assert.equal(validate({ text: request, model: "grok-model" }).code, "TEXT_REJECTED");
  assert.equal(
    validate({ text: "原".repeat(8000), model: "grok-model" }).kind,
    "ACCEPTED_BY_GUARD",
  );
  assert.equal(validate({ text: "原".repeat(8001), model: "grok-model" }).code, "TEXT_REJECTED");
});
console.log(`${cases.length}/${cases.length} characterization checks passed`);

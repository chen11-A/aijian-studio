// Run: node --test packages/aivora-prompts/scripts/
// Each test breaks one rule in a copy of the library and expects the validator to report it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkSchema, validate } from "./json-schema.mjs";
import { parseReply } from "./reply.mjs";
import { checkLibrary, loadLibrary } from "./validate.mjs";

const library = await loadLibrary();
const clone = (value) => JSON.parse(JSON.stringify(value));

function errorsAfter(mutate) {
  const copy = clone(library);
  mutate(copy.roles);
  const report = checkLibrary(copy);
  const lines = [...report.chain];
  for (const entry of report.roles) {
    lines.push(...entry.problems);
    for (const example of entry.examples) lines.push(...example.errors);
  }
  return { ok: report.ok, text: lines.join("\n") };
}

function expectError(mutate, pattern) {
  const result = errorsAfter(mutate);
  assert.equal(result.ok, false, "the broken copy should not pass");
  assert.match(result.text, pattern);
}

const shot = (roles, example, sceneIndex, shotIndex) =>
  roles.director.examples[example].output.scenes[sceneIndex].shots[shotIndex];

test("the shipped library passes", () => {
  const report = checkLibrary(clone(library));
  assert.equal(report.ok, true, JSON.stringify(report, null, 2));
  assert.equal(report.roles.length, 8);
  assert.ok(report.roles.every((entry) => entry.examples.length === 3));
});

test("a dropped line of dialogue is reported", () => {
  expectError((roles) => {
    const scene = roles.writer.examples[0].output.scenes[0];
    scene.elements = scene.elements.filter((element) => element.line !== "周烈？");
  }, /周烈？/u);
});

test("one changed character in a line is reported", () => {
  expectError((roles) => {
    const line = roles.writer.examples[0].output.scenes[0].elements.find(
      (e) => e.type === "dialogue",
    );
    line.line = line.line.replace("还在吗？", "还在吗");
  }, /还在吗/u);
});

test("a wrong dialogue count is reported", () => {
  expectError((roles) => {
    roles.writer.examples[1].output.dialogue_count += 1;
  }, /dialogue_count/u);
});

test("an extra reasoning field fails the output schema", () => {
  expectError((roles) => {
    roles.director.examples[0].output.reasoning = "先分析一下";
  }, /多出了没有定义的字段 reasoning/u);
});

test("a shot longer than 15 seconds fails the schema", () => {
  expectError((roles) => {
    shot(roles, 0, 0, 0).seconds = 16;
  }, /不大于 15/u);
});

test("<IMAGE_15> and <IMAGE_0> are rejected", () => {
  expectError((roles) => {
    shot(roles, 0, 0, 0).video_prompt += "<IMAGE_15>";
  }, /<IMAGE_15>/u);
  expectError((roles) => {
    shot(roles, 0, 0, 1).video_prompt += "<IMAGE_0>";
  }, /<IMAGE_0>/u);
});

test("a reference that is not listed, or a listed one that is unused, is reported", () => {
  expectError((roles) => {
    shot(roles, 1, 1, 0).video_prompt += "<IMAGE_9>";
  }, /没列出的 <IMAGE_9>/u);
  expectError((roles) => {
    const target = shot(roles, 1, 1, 0);
    target.video_prompt = target.video_prompt.replace("<IMAGE_2> 是", "");
  }, /没有用到 <IMAGE_2>/u);
});

test("more than 14 reference images fail the schema", () => {
  expectError((roles) => {
    const target = shot(roles, 0, 0, 0);
    target.reference_images = Array.from({ length: 15 }, (_, i) => ({
      token: `<IMAGE_${Math.min(i + 1, 14)}>`,
      asset_id: "img_loc_bookstore_inside",
    }));
  }, /最多 14 项/u);
});

test("a prompt without the identity lock is reported", () => {
  expectError((roles) => {
    const target = shot(roles, 0, 0, 1);
    const lock = roles.director.examples[0].input.cast.find(
      (row) => row.name === "沈砚",
    ).identity_lock;
    target.video_prompt = target.video_prompt.replace(lock, "");
  }, /identity_lock/u);
});

test("a line that does not fit in its shot is reported", () => {
  expectError((roles) => {
    shot(roles, 0, 0, 1).dialogue[1].at_seconds = 6.5;
  }, /放不下/u);
});

test("dialogue missing from the storyboard is reported", () => {
  expectError((roles) => {
    shot(roles, 0, 0, 4).dialogue.pop();
  }, /台词必须原样、按顺序全部放进镜头/u);
});

test("eyes for a back view are reported", () => {
  expectError((roles) => {
    const row = roles.performance.examples[0].output.shots.find(
      (item) => item.shot_id === "S01-02",
    );
    row.performances[0].eyes = { gaze: "看向画右", change: null, hold_seconds: null };
  }, /看不见脸/u);
});

test("a strong blow without a visible force cue is reported", () => {
  expectError((roles) => {
    const row = roles.action.examples[1].output.shots.find((item) => item.shot_id === "S04-08");
    row.nodes[0].force_cue = null;
  }, /要写 force_cue/u);
});

test("force on an injured arm is reported", () => {
  expectError((roles) => {
    const row = roles.action.examples[2].output.shots.find((item) => item.shot_id === "S06-05");
    row.nodes[1].force = 3;
    row.nodes[1].force_cue = "用力挥手";
  }, /只能做力度 1 的动作/u);
});

test("an attack that crosses the line is reported", () => {
  expectError((roles) => {
    const row = roles.action.examples[1].output.shots.find((item) => item.shot_id === "S04-06");
    row.nodes[1].direction = "画左→画右";
  }, /越轴/u);
});

test("a hit without a sound effect is reported", () => {
  expectError((roles) => {
    const scene = roles.sound.examples[1].output.scenes[1];
    scene.sfx = scene.sfx.filter((fx) => fx.from_node !== "S04-06-A3");
  }, /S04-06-A3 没有配音效/u);
});

test("a sound asset must exist in the library, sit on its lane and match the mood", () => {
  expectError((roles) => {
    roles.sound.examples[0].output.scenes[0].ambience[0].asset_id = "amb_dock_night";
  }, /素材库里没有的 amb_dock_night/u);
  expectError((roles) => {
    roles.sound.examples[0].input.library.find(
      (row) => row.asset_id === "amb_rain_shop_inside",
    ).lane = "音效";
  }, /是音效素材，不能放在环境音层/u);
  expectError((roles) => {
    roles.sound.examples[0].output.scenes[0].music.asset_id = "mus_suspense_pulse";
  }, /情绪是悬疑，和标签不安不一致/u);
});

test("a missing sound must be declared instead of invented", () => {
  expectError((roles) => {
    roles.sound.examples[1].output.scenes[1].missing = [];
  }, /没选素材，要在 missing 里写同样的 need/u);
});

test("continuity summary numbers must match the issues", () => {
  expectError((roles) => {
    roles.continuity.examples[0].output.summary.must_fix = 0;
  }, /summary 应为/u);
});

test("a continuity issue pointing backwards is reported", () => {
  expectError((roles) => {
    const issue = roles.continuity.examples[1].output.issues[1];
    issue.from_shot = "S04-06";
  }, /to_shot 要在 from_shot 后面/u);
});

test("a black or frozen stretch found by the app must be reported by the reviewer", () => {
  expectError((roles) => {
    const take = roles.review.examples[0].output.shots[0].takes[1];
    take.issues = [];
  }, /静帧 6.1–7.8 秒没有写进 issues/u);
});

test("recommending a take that must be redone is reported", () => {
  expectError((roles) => {
    roles.review.examples[2].output.shots[2].recommend.take_id = "S06-05-T1";
  }, /所有版本都必须重做时才不推荐/u);
});

test("the attached image count must match the frames", () => {
  expectError((roles) => {
    roles.review.examples[1].input.attached_images = 13;
  }, /attached_images 应为 14/u);
});

test("an ASCII double quote inside a string is reported", () => {
  expectError((roles) => {
    roles.review.examples[0].output.shots[0].recommend.reason = 'A 版"更好"';
  }, /英文双引号/u);
});

test("examples that feed each other must agree", () => {
  expectError((roles) => {
    shot(roles, 0, 0, 0).action = "林晚在画左锁门，沈砚推门进来。";
  }, /表演指导输入的 S01-01 和导演输出不一致/u);
});

test("parseReply accepts one bare JSON object only", () => {
  const schema = library.roles.review.output_format.schema;
  const value = library.roles.review.examples[0].output;
  assert.equal(parseReply(JSON.stringify(value), schema).ok, true);
  assert.equal(parseReply(`\`\`\`json\n${JSON.stringify(value)}\n\`\`\``, schema).ok, false);
  assert.equal(parseReply(`好的，结果如下：${JSON.stringify(value)}`, schema).ok, false);
  assert.equal(parseReply(`${JSON.stringify(value).slice(0, -1)},}`, schema).ok, false);
  assert.equal(parseReply(JSON.stringify({ ...value, thinking: "..." }), schema).ok, false);
});

test("checkSchema rejects keywords the checker would skip", () => {
  assert.match(
    checkSchema({ type: "string", format: "email" }).join("\n"),
    /不支持的关键字 format/u,
  );
  assert.match(
    checkSchema({
      type: "object",
      additionalProperties: false,
      required: ["a"],
      properties: {},
    }).join("\n"),
    /a 没有写在 properties 里/u,
  );
  assert.match(checkSchema({ $ref: "#/$defs/missing" }).join("\n"), /找不到/u);
});

test("validate follows JSON Schema for lengths, enums and oneOf", () => {
  assert.deepEqual(validate({ type: "string", maxLength: 2 }, "雨夜"), []);
  assert.equal(validate({ type: "string", maxLength: 1 }, "雨夜").length, 1);
  assert.equal(validate({ enum: ["稳", "难"] }, "看运气").length, 1);
  const union = {
    oneOf: [
      { type: "object", properties: { type: { const: "a" } }, required: ["type"] },
      {
        type: "object",
        properties: { type: { const: "b" }, n: { type: "integer" } },
        required: ["type", "n"],
      },
    ],
  };
  assert.deepEqual(validate(union, { type: "a" }), []);
  assert.match(validate(union, { type: "b", n: 1.5 })[0].message, /整数/u);
});

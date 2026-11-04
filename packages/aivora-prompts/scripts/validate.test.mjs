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

const shot = (roles, example, index) =>
  roles.director.examples[example].output.scenes[0].shots[index];
const findShot = (roles, example, id) =>
  roles.director.examples[example].output.scenes[0].shots.find((row) => row.id === id);
const writerScene = (roles, example) => roles.writer.examples[example].output.scenes[0];

test("the shipped library passes", () => {
  const report = checkLibrary(clone(library));
  assert.equal(report.ok, true, JSON.stringify(report, null, 2));
  assert.equal(report.roles.length, 8);
  assert.ok(report.roles.every((entry) => entry.examples.length === 3));
  assert.ok(report.roles.every((entry) => entry.prompt > 0 && entry.prompt <= 3000));
});

test("a dropped line of dialogue is reported", () => {
  expectError((roles) => {
    const scene = writerScene(roles, 0);
    scene.elements = scene.elements.filter((element) => element.line !== "我找林国栋。");
  }, /我找林国栋/u);
});

test("one changed character in a line is reported", () => {
  expectError((roles) => {
    const line = writerScene(roles, 0).elements.find((row) => row.line === "打烊了。");
    line.line = "打烊啦。";
  }, /打烊了/u);
});

test("a shop name in quotes is not a line", () => {
  expectError((roles) => {
    writerScene(roles, 0).elements.splice(1, 0, {
      type: "dialogue",
      speaker: "林晚",
      kind: "对白",
      line: "晚照书店",
      delivery: null,
      source: "P02",
    });
  }, /「晚照书店」是店名，不是台词/u);
});

test("a wrong dialogue count is reported", () => {
  expectError((roles) => {
    roles.writer.examples[1].output.dialogue_count += 1;
  }, /dialogue_count/u);
});

test("a place the app cannot find at the start of the scene is reported", () => {
  expectError((roles) => {
    writerScene(roles, 0).place = "晚照书店";
  }, /软件会切错原文/u);
});

test("gender and age come from the text", () => {
  expectError((roles) => {
    roles.writer.examples[1].output.characters[0].gender = "女";
  }, /周烈 的 gender 应为 男/u);
  expectError((roles) => {
    roles.writer.examples[1].output.characters[0].identity = "四十岁左右的男人，剃着寸头。";
  }, /年龄原文没写/u);
});

test("beats with a colon are reported, because the app reads lines out of them", () => {
  expectError((roles) => {
    writerScene(roles, 0).beats[0] = "林晚在装箱：书店月底停业。";
  }, /不能有引号或冒号/u);
});

test("an extra reasoning field fails the output schema", () => {
  expectError((roles) => {
    roles.director.examples[0].output.reasoning = "先分析一下";
  }, /多出了没有定义的字段 reasoning/u);
});

test("a shot longer than 15 seconds fails the schema", () => {
  expectError((roles) => {
    shot(roles, 0, 0).seconds = 16;
  }, /不大于 15/u);
});

test("<IMAGE_14> and <IMAGE_0> are rejected in a video prompt", () => {
  expectError((roles) => {
    shot(roles, 0, 0).video_prompt += "<IMAGE_14>";
  }, /<IMAGE_14>/u);
  expectError((roles) => {
    shot(roles, 0, 1).video_prompt += "<IMAGE_0>";
  }, /<IMAGE_0>/u);
});

test("more than 13 reference images fail the schema", () => {
  expectError((roles) => {
    const row = shot(roles, 1, 13);
    row.reference_images = Array.from({ length: 14 }, (_, i) => ({
      token: `<IMAGE_${i + 1}>`,
      asset_id: "img_loc_warehouse",
    }));
  }, /最多 13 项/u);
});

test("a reference that is not listed, or a listed one that is unused, is reported", () => {
  expectError((roles) => {
    shot(roles, 0, 1).video_prompt += "<IMAGE_9>";
  }, /用了没列出的 <IMAGE_9>/u);
  expectError((roles) => {
    const row = shot(roles, 0, 1);
    row.video_prompt = row.video_prompt.replace("<IMAGE_2> 是", "第二张是");
  }, /要先说明 <IMAGE_2> 是什么/u);
});

test("a portrait in the coat after the coat came off is reported", () => {
  expectError((roles) => {
    const row = findShot(roles, 1, "scene-2-shot-15");
    const ref = row.reference_images.find((item) => item.asset_id === "img_shenyan_shirt_front");
    ref.asset_id = "img_shenyan_coat_front";
  }, /沈砚 这时不穿这套/u);
});

test("a prompt without the identity sentence is reported", () => {
  expectError((roles) => {
    const row = shot(roles, 0, 1);
    row.start_frame_prompt = row.start_frame_prompt.replace("瓜子脸，", "");
  }, /原样写「林晚，identity」/u);
});

test("a line that does not fit in its shot is reported", () => {
  expectError((roles) => {
    findShot(roles, 0, "scene-1-shot-5").line_at = 2.0;
  }, /离镜头结束不到 0.6 秒/u);
});

test("a wide shot with crying in it is reported, because the app would make it a close shot", () => {
  expectError((roles) => {
    findShot(roles, 2, "scene-3-shot-9").performance = "沈砚看着她哭，没有碰她。";
  }, /软件会把它改成近景/u);
});

test("eyes for a back view are reported", () => {
  expectError((roles) => {
    const row = roles.performance.examples[2].output.find(
      (item) => item.shot_id === "scene-3-shot-8",
    );
    row.eyes = "看向窗外";
    row.gaze = "画右";
  }, /看不见脸/u);
});

test("crying in a wide shot's performance is reported", () => {
  expectError((roles) => {
    const row = roles.performance.examples[1].output.find(
      (item) => item.shot_id === "scene-2-shot-14",
    );
    row.face = ["眼泪直流"];
    row.face_at = [0.8];
  }, /软件会把它改成近景/u);
});

test("a strong blow without a visible force cue is reported", () => {
  expectError((roles) => {
    const node = roles.action.examples[1].output.shots.find(
      (row) => row.shot_id === "scene-2-shot-17",
    ).nodes[0];
    node.force_cue = null;
  }, /要写 force_cue/u);
});

test("force on an injured arm is reported", () => {
  expectError((roles) => {
    const node = roles.action.examples[1].output.shots.find(
      (row) => row.shot_id === "scene-2-shot-23",
    ).nodes[0];
    node.body_part = "左手";
  }, /受伤的左小臂，力度不能超过 1/u);
});

test("an attack that crosses the line is reported", () => {
  expectError((roles) => {
    const node = roles.action.examples[1].output.shots.find(
      (row) => row.shot_id === "scene-2-shot-17",
    ).nodes[0];
    node.direction = "画左→画右";
  }, /越轴了/u);
});

test("a hit without a sound effect is reported", () => {
  expectError((roles) => {
    const scene = roles.sound.examples[1].output.scenes[0];
    scene.sfx = scene.sfx.filter((row) => row.from_node !== "scene-2-shot-17-node-1");
  }, /scene-2-shot-17-node-1 碰到了东西/u);
});

test("a sound asset must exist in the library, sit on its lane and match the mood", () => {
  expectError((roles) => {
    roles.sound.examples[0].output.scenes[0].music.asset_id = "mus_dawn_strings";
  }, /和这一场的 不安 不一样/u);
  expectError((roles) => {
    roles.sound.examples[0].output.scenes[0].ambience[0].asset_id = "amb_made_up";
  }, /不在素材库的环境音里/u);
});

test("a missing sound must be declared instead of invented", () => {
  expectError((roles) => {
    roles.sound.examples[0].output.scenes[0].missing = [];
  }, /要在 missing 里写同样的 need/u);
});

test("a continuity problem in the state table must be reported", () => {
  expectError((roles) => {
    const output = roles.continuity.examples[1].output;
    output.issues = output.issues.filter((row) => row.kind !== "道具");
    output.summary.suggest = 0;
  }, /漏报：第 2 场第 16 个镜头 周烈 的道具问题/u);
});

test("continuity summary numbers must match the issues", () => {
  expectError((roles) => {
    roles.continuity.examples[0].output.summary.must_fix += 1;
  }, /summary 应为/u);
});

test("a black or frozen stretch found by the app must be reported by the reviewer", () => {
  expectError((roles) => {
    roles.review.examples[0].output.shots[1].takes[0].issues = [];
  }, /自动检查到的静帧/u);
});

test("recommending a take that must be redone is reported", () => {
  expectError((roles) => {
    const row = roles.review.examples[1].output.shots[0];
    row.recommend.take_id = row.takes[0].take_id;
  }, /推荐了必须重做的版本/u);
});

test("the attached image count must match the frames", () => {
  expectError((roles) => {
    roles.review.examples[2].input.attached_images += 1;
  }, /attached_images 应为/u);
});

test("an ASCII double quote inside a string is reported", () => {
  expectError((roles) => {
    roles.review.examples[0].output.shots[0].recommend.reason = 'A 版"更好"';
  }, /英文双引号/u);
});

test("examples that feed each other must agree", () => {
  expectError((roles) => {
    shot(roles, 0, 11).action = "沈砚把信封放在收银台上。";
  }, /表演指导输入的 scene-1-shot-12 要和导演输出一致/u);
  expectError((roles) => {
    roles.director.examples[1].input.cast[0].identity = "四十岁左右的男人，剃着寸头，嘴角带笑。";
  }, /导演 cast 里 周烈 要和美术的 identities 一致/u);
});

test("a prompt over 3000 characters, a placeholder or a wrong skeleton is reported", () => {
  expectError((roles) => {
    roles.writer.system_prompt.splice(1, 0, "很".repeat(1000));
  }, /超过 3000 字/u);
  expectError((roles) => {
    roles.art.system_prompt.push("{{OUTPUT_SCHEMA}}");
  }, /占位符/u);
  expectError((roles) => {
    const at = roles.director.system_prompt.indexOf("输出格式：") + 1;
    const skeleton = JSON.parse(roles.director.system_prompt[at]);
    delete skeleton.scenes[0].shots[0].line;
    roles.director.system_prompt[at] = JSON.stringify(skeleton);
  }, /骨架里少了这个字段/u);
});

test("a request longer than the app's 7500 characters is reported", () => {
  expectError((roles) => {
    roles.director.examples[1].input.scenes[0].paragraphs[0].text += "雨".repeat(300);
  }, /超过软件一次请求的 7500 字/u);
});

test("parseReply accepts one bare JSON value of the right type only", () => {
  const schema = library.roles.review.output_format.schema;
  const value = library.roles.review.examples[0].output;
  assert.equal(parseReply(JSON.stringify(value), schema).ok, true);
  assert.equal(parseReply(`\`\`\`json\n${JSON.stringify(value)}\n\`\`\``, schema).ok, false);
  assert.equal(parseReply(`好的，结果如下：${JSON.stringify(value)}`, schema).ok, false);
  assert.equal(parseReply(`${JSON.stringify(value).slice(0, -1)},}`, schema).ok, false);
  assert.equal(parseReply(JSON.stringify({ ...value, thinking: "..." }), schema).ok, false);
  const rows = library.roles.performance.examples[0].output;
  const rowSchema = library.roles.performance.output_format.schema;
  assert.equal(parseReply(JSON.stringify(rows), rowSchema).ok, true);
  assert.equal(parseReply(JSON.stringify({ shots: rows }), rowSchema).ok, false);
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

/**
 * Feeds every example output to the app's own parsers and checks what comes out:
 *   AIVORA_TYPESCRIPT=/path/to/node_modules/typescript \
 *     node packages/aivora-prompts/scripts/check-app-parsers.mjs
 *
 * The parsers live in apps/studio-web/src/aivora/film/*.ts. This script transpiles those files
 * with TypeScript into a temporary folder (nothing in the repo is written), imports them and runs
 * parseWriterScenes, parseCastReply, artFromModel, parseDirectorShots, assignPerformance,
 * voiceDirectionFromModel, actionFromModel and qcFromModel. A field the prompt library relies on
 * that the parser drops or changes is a failure. Adjacent merges are checked for content loss, and incomplete source
 * coverage is reported honestly as notes. Exits with 1 when anything fails.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import process from "node:process";
import console from "node:console";
import { loadLibrary } from "./validate.mjs";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const FILM = "apps/studio-web/src/aivora/film";
const ENTRIES = ["operations.ts", "phase2.ts", "project.ts", "director-continuity.ts"].map((name) =>
  join(REPO, FILM, name),
);

export function loadTypeScript() {
  const where = process.env.AIVORA_TYPESCRIPT;
  const base = where ? join(resolve(where), "package.json") : join(REPO, "package.json");
  const require = createRequire(base);
  try {
    return require(where ? resolve(where) : "typescript");
  } catch {
    throw new Error("找不到 TypeScript。请设置 AIVORA_TYPESCRIPT 指向 typescript 包所在的文件夹。");
  }
}

const IMPORT = /(from\s+|import\s+)(["'])([^"']+)\2/gu;

function resolveImport(from, spec) {
  if (spec.endsWith("?raw")) return { file: resolve(dirname(from), spec.slice(0, -4)), raw: true };
  if (!spec.startsWith(".")) return null;
  for (const candidate of [`${spec}.ts`, `${spec}/index.ts`, spec]) {
    const file = resolve(dirname(from), candidate);
    if (existsSync(file) && file.endsWith(".ts")) return { file, raw: false };
  }
  throw new Error(`找不到 ${from} 里引用的 ${spec}`);
}

/** Transpiles the parser files and everything they import into out/, keeping the folder layout. */
export async function transpile(ts, out) {
  const done = new Set();
  const target = (file, raw) =>
    join(out, relative(REPO, file)).replace(raw ? /$/u : /\.ts$/u, raw ? ".raw.mjs" : ".mjs");
  const visit = async (file, raw) => {
    if (done.has(file)) return;
    done.add(file);
    const text = await readFile(file, "utf8");
    const dest = target(file, raw);
    await mkdir(dirname(dest), { recursive: true });
    if (raw) {
      await writeFile(dest, `export default ${JSON.stringify(text)};\n`);
      return;
    }
    const js = ts.transpileModule(text, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const imports = [];
    const rewritten = js.replace(IMPORT, (whole, head, quote, spec) => {
      const found = resolveImport(file, spec);
      if (!found) return whole;
      imports.push(found);
      let path = relative(dirname(dest), target(found.file, found.raw)).replaceAll("\\", "/");
      if (!path.startsWith(".")) path = `./${path}`;
      return `${head}${quote}${path}${quote}`;
    });
    await writeFile(dest, rewritten);
    for (const next of imports) await visit(next.file, next.raw);
  };
  for (const entry of ENTRIES) await visit(entry, false);
  const load = async (name) => import(pathToFileURL(target(join(REPO, FILM, name), false)).href);
  return {
    ...(await load("operations.ts")),
    ...(await load("phase2.ts")),
    ...(await load("project.ts")),
    ...(await load("director-continuity.ts")),
  };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function checkWriter(app, library, example, report) {
  const { output, input } = example;
  const novel = input.paragraphs.map((row) => `[${row.id}] ${row.text}`).join("\n\n");
  const reply = JSON.stringify(output);
  const scenes = app.parseWriterScenes(reply, novel);
  const alone = app.parseWriterScenes(reply);
  if (!scenes || !alone) {
    report.fail(`${example.id}：parseWriterScenes 读不出场次`);
    return [];
  }
  output.scenes.forEach((scene, index) => {
    const parsed = scenes[index];
    const where = [scene.place, scene.time].join(" · ");
    if (parsed.title !== scene.title) report.fail(`${example.id}：title 变成了 ${parsed.title}`);
    if (parsed.where !== where)
      report.fail(`${example.id}：where 应为 ${where}，读成 ${parsed.where}`);
    for (const row of scene.elements.filter((item) => item.type === "dialogue")) {
      if (!parsed.text.includes(row.line))
        report.fail(`${example.id}：切出的原文里没有台词「${row.line}」，导演会读不到`);
      if (!alone[index].text.includes(row.line))
        report.fail(`${example.id}：不给原文时，剧本里没有台词「${row.line}」`);
    }
    if (parsed.id !== scene.id)
      report.note(
        `${example.id}：parseWriterScenes 按回复里的顺序重新编号，${scene.id} 读成了 ${parsed.id}`,
      );
  });
  const cast = app.parseCastReply(reply);
  const people = output.characters.map((row) => ({
    name: row.name,
    identity: row.identity,
    gender: row.gender === "未知" ? "" : (row.gender ?? ""),
    ageBand: row.age_band === "未知" ? "" : (row.age_band ?? ""),
  }));
  if (!cast || !same(cast.characters, people))
    report.fail(`${example.id}：parseCastReply 读出的人物和 characters 不一致`);
  const places = output.locations.map((row) => ({ name: row.name, prompt: row.prompt }));
  if (!cast || !same(cast.locations, places))
    report.fail(`${example.id}：parseCastReply 读出的地点和 locations 不一致`);
  return scenes;
}

export function checkArt(app, example, report) {
  const { output } = example;
  const art = app.artFromModel(output);
  if (!art) {
    report.fail(`${example.id}：artFromModel 读不出`);
    return;
  }
  if (art.styleZh !== output.prompt_block_zh) report.fail(`${example.id}：画风段落读错了`);
  const identities = output.identities.map((row) => ({
    name: row.name,
    identity: row.identity,
    ...(["男", "女"].includes(row.gender) ? { gender: row.gender } : {}),
    ...(["儿童", "少年", "青年", "中年", "老年"].includes(row.age_band)
      ? { ageBand: row.age_band }
      : {}),
  }));
  if (!same(art.identities, identities)) report.fail(`${example.id}：identities 读错了`);
  const places = output.locations.map((row) => ({
    name: row.name,
    prompt: row.prompt,
    ambience: row.ambience,
    ...(typeof row.layout === "string" ? { layout: row.layout } : {}),
  }));
  if (!same(art.places, places)) report.fail(`${example.id}：locations 读错了`);
  const props = output.props.map((row) => ({ name: row.name, note: row.note }));
  if (!same(art.props, props)) report.fail(`${example.id}：props 读错了`);
}

function checkDirector(app, example, writerScene, report) {
  const plan = example.output.scenes[0];
  const ref = {
    id: plan.scene_id,
    title: writerScene.title,
    where: writerScene.where,
    text: writerScene.text,
  };
  const shots = app.parseDirectorShots(JSON.stringify(example.output), plan.scene_id, ref.text, [
    ref,
  ]);
  const limit = app.shotBudget(ref.text);
  const kept = plan.shots;
  const raw = app.parseDirectorShots(
    JSON.stringify({ shots: plan.shots }),
    plan.scene_id,
    ref.text,
    [],
    false,
  );
  if (!shots || !raw || raw.length !== kept.length) {
    report.fail(`${example.id}：未能无损解析全部原始镜头`);
    return;
  }
  if (new Set(shots.map((shot) => shot.id)).size !== shots.length)
    report.fail(`${example.id}：出现重复镜头 id`);
  const compact = (text) => text.replace(/\s+/gu, "");
  const actions = (shot) => (shot.actionBeats?.length ? shot.actionBeats.join("\n") : shot.action);
  const represented = compact(
    shots.map((shot) => `${shot.picture}\n${actions(shot)}\n${shot.line}`).join("\n"),
  );
  for (const original of plan.shots) {
    for (const text of [original.picture, original.action, original.line].filter(Boolean))
      if (!represented.includes(compact(text))) report.fail(`${example.id}：合并丢失镜头内容`);
  }
  const status = app.directorPlanStatus(ref, shots);
  if (!status.coverage.ok)
    report.note(
      `${example.id}：真实示例覆盖检查尚缺 ${status.coverage.missingLines.length} 句台词，尾段${status.coverage.missingTail ? "未覆盖" : "已覆盖"}；软件须补尾，不自动伪造通过。`,
    );
  if (status.overBudget)
    report.note(`${example.id}：建议${limit}镜，保留${shots.length}镜，需核对。`);
  const absent = app.detectDirectorCoverage(ref, []);
  if (absent.ok || !absent.missingTail) report.fail(`${example.id}：空镜头不应通过覆盖校验`);
  const added = [];
  kept.forEach((shot, index) => {
    const got = raw[index];
    const where = `${example.id} ${shot.id}`;
    if (got.id !== shot.id || got.sceneId !== plan.scene_id)
      report.fail(`${where}：镜头 id 读成 ${got.id}`);
    for (const key of [
      "size",
      "angle",
      "move",
      "seconds",
      "picture",
      "performance",
      "blocking",
      "facing",
    ]) {
      if (got[key] !== shot[key])
        report.fail(`${where}：${key} 读成了 ${JSON.stringify(got[key])}`);
    }
    if (got.tag !== shot.tag) report.fail(`${where}：tag 读成了 ${got.tag}`);
    const action = shot.action !== shot.picture ? shot.action : "";
    if (compact(actions(got)) !== compact(action)) report.fail(`${where}：action 完整序列读错了`);
    if (got.actionBeats?.length && got.action !== got.actionBeats[0])
      report.fail(`${where}：主动作和完整序列不一致`);
    if (shot.line) {
      if (got.line !== shot.line)
        report.fail(`${where}：台词「${shot.line}」被读成「${got.line}」`);
      if (got.speaker !== shot.speaker) report.fail(`${where}：speaker 读成了 ${got.speaker}`);
      if (got.delivery !== shot.delivery) report.fail(`${where}：delivery 读成了 ${got.delivery}`);
      if (!same(got.characters, shot.characters)) report.fail(`${where}：characters 被改了`);
    } else if (got.line) {
      added.push(
        `${shot.id} 被软件加上「${got.line}」${got.speaker ? `（speaker 写成 ${got.speaker}）` : ""}`,
      );
    } else if (!same(got.characters, shot.characters)) {
      report.fail(`${where}：characters 被改了`);
    }
    const sfx = shot.sound.sfx.map((cue) => ({ atSeconds: cue.at_seconds, text: cue.text }));
    if (!same(got.sound.sfx, sfx)) report.fail(`${where}：音效读错了`);
    if (got.sound.musicMood !== shot.sound.musicMood) report.fail(`${where}：musicMood 读错了`);
    if (got.sound.ambience !== shot.sound.ambience)
      report.fail(`${where}：环境声读成了 ${got.sound.ambience}`);
  });
  for (const line of added) report.note(`${example.id}：${line}`);
}

function checkPerformance(app, example, report) {
  const targets = example.input.shots.map((shot) => ({ id: shot.shot_id }));
  const names = [...new Set(example.input.shots.flatMap((shot) => shot.characters))];
  const notes = app.assignPerformance(example.output, targets, names);
  example.output.forEach((row, index) => {
    const note = notes[index];
    const shot = example.input.shots[index];
    const where = `${example.id} ${row.shot_id}`;
    if (!note || note.id !== row.shot_id) {
      report.fail(`${where}：assignPerformance 没对上镜头`);
      return;
    }
    if (!note.performance) report.fail(`${where}：读出的表演是空的`);
    for (const part of [row.emotion, ...row.face, row.eyes, row.hands, row.breath].filter(
      Boolean,
    )) {
      if (!note.performance.includes(part)) report.fail(`${where}：表演里少了「${part}」`);
    }
    if (shot.line && !note.delivery.includes(`语气${row.voice.tone}`))
      report.fail(`${where}：配音提示里少了语气`);
  });
  if (!app.performanceFromModel(example.output, names))
    report.fail(`${example.id}：performanceFromModel 读不出`);
  if (!app.voiceDirectionFromModel(example.output))
    report.fail(`${example.id}：voiceDirectionFromModel 读不出`);
}

export function checkAction(app, example, report) {
  const rows = app.actionFromModel(example.output);
  // Nodes carry shot ownership and timing; beats enrich the matching node rather than
  // replacing its physical description. Check both sources independently for content loss.
  const nodes = (example.output.shots ?? []).flatMap((shot) =>
    (shot.nodes ?? []).map((node) => ({ shotId: shot.shot_id, node })),
  );
  const beats = example.output.beats ?? [];
  const extraBeats = beats.filter(
    (beat) => !nodes.some(({ node }) => node.node_id === beat.node_id),
  );
  const expected = [
    ...nodes.map(({ shotId, node }) => {
      const matched = beats.filter((beat) => beat.node_id === node.node_id);
      const last = matched.at(-1) ?? node;
      return {
        shotId,
        at: node.at_seconds,
        feasibility: last.feasibility ?? "稳",
        workaround: last.workaround ?? "",
        parts: [
          node.text,
          node.actor,
          node.move,
          node.target,
          node.body_part,
          node.direction,
          node.reaction,
          ...matched.map((beat) => beat.text),
        ].filter((part) => typeof part === "string" && part.trim()),
      };
    }),
    ...extraBeats.map((beat) => ({
      shotId: beat.shot_id || beat.id,
      at: beat.at_seconds,
      feasibility: beat.feasibility ?? "稳",
      workaround: beat.workaround ?? "",
      parts: [beat.text],
    })),
  ];
  if (!rows || rows.length !== expected.length) {
    report.fail(
      `${example.id}：actionFromModel 动作数量不一致，应为 ${expected.length}，实际 ${rows?.length ?? 0}`,
    );
    return;
  }
  expected.forEach((want, index) => {
    const got = rows[index];
    for (const key of ["shotId", "at", "feasibility", "workaround"])
      if (got[key] !== want[key]) report.fail(`${example.id} 动作 ${index + 1}：${key} 读错了`);
    for (const part of want.parts)
      if (!got.text.includes(part))
        report.fail(`${example.id} 动作 ${index + 1}：缺少原始内容「${part}」`);
  });
}

function checkReview(app, example, report) {
  const qc = app.qcFromModel(example.output);
  if (!qc || qc.verdict !== example.output.verdict) {
    report.fail(`${example.id}：qcFromModel 读不出 verdict`);
    return;
  }
  for (const line of example.output.issues) {
    if (!qc.lines.includes(line)) report.fail(`${example.id}：qcFromModel 少了「${line}」`);
  }
}

/** The app sends the whole novel to the writer at once; parse the three scenes together too. */
function checkWholeNovel(app, library, report) {
  const examples = library.roles.writer.examples;
  const reply = JSON.stringify({
    ...examples[0].output,
    scenes: examples.flatMap((row) => row.output.scenes),
  });
  const novel = library.novel.paragraphs.map((row) => row.text).join("\n\n");
  const scenes = app.parseWriterScenes(reply, novel);
  if (!scenes || scenes.length !== examples.length) {
    report.fail(
      `整本小说：parseWriterScenes 读出 ${scenes?.length ?? 0} 场，应为 ${examples.length} 场`,
    );
    return;
  }
  examples.forEach((example, index) => {
    const scene = example.output.scenes[0];
    const parsed = scenes[index];
    if (parsed.id !== scene.id) report.fail(`整本小说：第 ${index + 1} 场读成了 ${parsed.id}`);
    for (const row of scene.elements.filter((item) => item.type === "dialogue")) {
      if (!parsed.text.includes(row.line))
        report.fail(`整本小说：${scene.id} 切出的原文里没有「${row.line}」`);
    }
    for (const other of examples.filter((item) => item !== example)) {
      const line = other.output.scenes[0].elements.find((item) => item.type === "dialogue").line;
      if (parsed.text.includes(line))
        report.fail(`整本小说：${scene.id} 切进了别的场的台词「${line}」`);
    }
    const story = parsed.text.split("\n").filter((line) => !scene.beats.includes(line));
    const last = story.at(-1) ?? "";
    if (/^第[一二三四五六七八九十]+场$/u.test(last))
      report.note(
        `整本小说：${scene.id} 切出的原文最后多了一行「${last}」（sliceNovel 切在下一场标题的地点名上）`,
      );
  });
}

async function main() {
  const ts = loadTypeScript();
  const out = await mkdtemp(join(tmpdir(), "aivora-parsers-"));
  const failures = [];
  const notes = [];
  const report = { fail: (text) => failures.push(text), note: (text) => notes.push(text) };
  try {
    const app = await transpile(ts, out);
    const library = await loadLibrary();
    const { roles } = library;
    checkWholeNovel(app, library, report);
    const count = roles.writer.examples.length;
    for (const name of ["art", "director", "performance", "action", "review"])
      if (roles[name].examples.length !== count) report.fail(`${name}：示例数量与编剧场次不一致`);
    for (let i = 0; i < count; i += 1) {
      const scenes = checkWriter(app, library, roles.writer.examples[i], report);
      checkArt(app, roles.art.examples[i], report);
      if (scenes[0]) checkDirector(app, roles.director.examples[i], scenes[0], report);
      checkPerformance(app, roles.performance.examples[i], report);
      checkAction(app, roles.action.examples[i], report);
      checkReview(app, roles.review.examples[i], report);
    }
  } finally {
    await rm(out, { recursive: true, force: true });
  }
  console.log("软件现有解析器读示例输出：");
  for (const text of failures) console.log(`  ✘ ${text}`);
  for (const text of notes) console.log(`  · ${text}`);
  console.log(
    failures.length === 0
      ? "全部读对：编剧、美术、导演、表演指导、动作指导、审片的示例输出都被软件读出。导演合并不丢内容；原文覆盖风险单独列出，不代表自动补尾或供应商验收已完成。"
      : `有 ${failures.length} 处没读对。`,
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

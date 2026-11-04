/**
 * Rules the JSON Schemas cannot express. Each role rule receives one example plus the whole
 * library and returns messages; an empty list means the example follows the role's prompt.
 * Times are seconds. A spoken line lasts spokenLength(line) / 4 seconds.
 */
import { deepEqual } from "./json-schema.mjs";
import { quotedLines, spokenLength } from "./novel.mjs";

const EPS = 1e-6;
const CHARS_PER_SECOND = 4;
const LINE_HEAD = 0.4;
const LINE_TAIL = 0.6;
const LINE_GAP = 0.2;
const MAX_REFERENCES = 14;
const NO_LOCK = new Set(["只露手", "画外"]);
const NO_FACE = new Set(["背影", "只露手", "画外"]);
const SCREEN_DIRECTIONS = new Set(["画左→画右", "画右→画左"]);
const LIMB = /[臂手腕]/u;
const TOKEN = /<IMAGE_([0-9]+)>/gu;
const ANY_TOKEN = /<\s*image[^>]*>/giu;

const pad2 = (value) => String(value).padStart(2, "0");
const lineSeconds = (line) => spokenLength(line) / CHARS_PER_SECOND;

export function imageTokens(text) {
  return [...text.matchAll(TOKEN)].map((match) => match[0]);
}

function eachString(value, path, visit) {
  if (typeof value === "string") visit(value, path);
  else if (Array.isArray(value))
    value.forEach((item, i) => eachString(item, `${path}/${i}`, visit));
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) eachString(item, `${path}/${key}`, visit);
  }
}

/** Checks every example output: no ASCII double quotes and only <IMAGE_1>..<IMAGE_14>. */
function outputTextRules(output) {
  const errors = [];
  eachString(output, "", (text, path) => {
    if (text.includes('"')) errors.push(`${path}：字符串里有英文双引号`);
    for (const raw of text.match(ANY_TOKEN) ?? []) {
      const match = /^<IMAGE_([0-9]+)>$/u.exec(raw);
      const index = match ? Number(match[1]) : NaN;
      if (!match || !(index >= 1 && index <= MAX_REFERENCES)) {
        errors.push(
          `${path}：图片编号 ${raw} 不合法，只能用 <IMAGE_1> 到 <IMAGE_${MAX_REFERENCES}>`,
        );
      }
    }
  });
  return errors;
}

/**
 * Longest common subsequence of two line lists, compared by source paragraph and exact text.
 * Returns the matched indexes on both sides, so a dropped line is reported once.
 */
function commonLines(expected, actual) {
  const same = (a, b) => a.source === b.source && a.line === b.line;
  const rows = expected.length + 1;
  const cols = actual.length + 1;
  const table = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = expected.length - 1; i >= 0; i -= 1) {
    for (let j = actual.length - 1; j >= 0; j -= 1) {
      table[i][j] = same(expected[i], actual[j])
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const kept = { expected: new Set(), actual: new Set() };
  let i = 0;
  let j = 0;
  while (i < expected.length && j < actual.length) {
    if (same(expected[i], actual[j])) {
      kept.expected.add(i);
      kept.actual.add(j);
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) i += 1;
    else j += 1;
  }
  return kept;
}

function chapterOf(novel, chapterId) {
  return novel.find((chapter) => chapter.id === chapterId);
}

function writerRules(example, { novel }) {
  const errors = [];
  const { input, output } = example;
  const chapter = chapterOf(novel, input.chapter.id);
  if (!chapter) return [`测试小说里没有 ${input.chapter.id}`];
  if (!deepEqual(input.paragraphs, chapter.paragraphs)) {
    errors.push(`输入段落和测试小说 ${chapter.id} 不一致`);
  }
  if (output.chapter_id !== input.chapter.id) errors.push("chapter_id 和输入的章节不一致");

  const expected = input.paragraphs.flatMap((paragraph) =>
    quotedLines(paragraph.text).map((line) => ({ source: paragraph.id, line })),
  );
  const actual = output.scenes.flatMap((scene) =>
    scene.elements
      .filter((element) => element.type === "dialogue")
      .map((element) => ({ source: element.source, line: element.line })),
  );
  const kept = commonLines(expected, actual);
  expected.forEach((want, i) => {
    if (!kept.expected.has(i))
      errors.push(`漏了原文 ${want.source} 的台词，或者改了字：「${want.line}」`);
  });
  actual.forEach((got, i) => {
    if (!kept.actual.has(i))
      errors.push(`多出原文没有的台词，或者顺序不对：${got.source}「${got.line}」`);
  });
  if (output.dialogue_count !== expected.length) {
    errors.push(`dialogue_count 应为 ${expected.length}，实际是 ${output.dialogue_count}`);
  }

  const order = input.paragraphs.map((paragraph) => paragraph.id);
  const covered = output.scenes.flatMap((scene) => scene.source_paragraphs);
  if (!deepEqual(covered, order))
    errors.push("各场的 source_paragraphs 连起来必须正好是整章的段落顺序");

  const known = new Set(input.known_characters);
  const names = new Set([...known, ...output.new_characters.map((row) => row.name)]);
  for (const row of output.new_characters) {
    if (known.has(row.name)) errors.push(`${row.name} 已经在 known_characters 里，不是新人物`);
    if (!order.includes(row.first_paragraph))
      errors.push(`${row.name} 的 first_paragraph 不在这一章`);
  }
  output.scenes.forEach((scene, index) => {
    const no = input.scene_no_start + index;
    if (scene.no !== no || scene.scene_id !== `S${pad2(no)}`) {
      errors.push(`第 ${index + 1} 场应编为 S${pad2(no)}（no=${no}）`);
    }
    for (const name of scene.characters) {
      if (!names.has(name))
        errors.push(`${scene.scene_id} 的人物 ${name} 既不在已知人物里，也没写进 new_characters`);
    }
    let last = -1;
    for (const element of scene.elements) {
      const at = order.indexOf(element.source);
      if (!scene.source_paragraphs.includes(element.source)) {
        errors.push(
          `${scene.scene_id} 的内容来自 ${element.source}，但这一段不在本场的 source_paragraphs 里`,
        );
      }
      if (at < last) errors.push(`${scene.scene_id} 的内容没有按原文顺序排列（${element.source}）`);
      last = Math.max(last, at);
      if (element.type === "dialogue" && !scene.characters.includes(element.speaker)) {
        errors.push(
          `${scene.scene_id}「${element.line}」的 speaker ${element.speaker} 不在本场人物里`,
        );
      }
    }
  });
  return errors;
}

function artRules(example) {
  const errors = [];
  const { input, output } = example;
  const locked = input.locked;
  const { status, ...style } = output.style;
  if (locked.style) {
    if (status !== "沿用") errors.push("已经锁定画风时 style.status 必须是 沿用");
    if (!deepEqual(style, locked.style))
      errors.push("已经锁定画风时 style 必须和 locked.style 一字不差");
  } else {
    if (status !== "新建") errors.push("没有锁定画风时 style.status 必须是 新建");
    if (!style.prompt_block_zh.startsWith(input.work.preset_text)) {
      errors.push("新建画风的 prompt_block_zh 要以画风预设原文开头");
    }
  }

  const sceneIds = input.scenes.map((scene) => scene.scene_id);
  const wanted = [];
  for (const scene of input.scenes)
    for (const name of scene.characters) {
      if (!wanted.includes(name)) wanted.push(name);
    }
  const got = output.characters.map((row) => row.name);
  if (!deepEqual(got, wanted)) errors.push(`characters 应按出场先后写 ${wanted.join("、")}`);

  const lockedCostumes = locked.characters.flatMap((row) => row.costumes);
  const usedAssets = new Set(locked.asset_ids);
  const takeAsset = (assetId, where) => {
    if (usedAssets.has(assetId)) errors.push(`${where} 的 asset_id ${assetId} 重复或已被占用`);
    usedAssets.add(assetId);
  };
  const promptTexts = [];
  for (const person of output.characters) {
    const before = locked.characters.find((row) => row.name === person.name);
    if (before) {
      if (person.status !== "沿用") errors.push(`${person.name} 已锁定，status 应为 沿用`);
      if (person.char_id !== before.char_id || person.identity_lock !== before.identity_lock) {
        errors.push(`${person.name} 已锁定，char_id 和 identity_lock 不能改`);
      }
    } else if (person.status !== "新建") {
      errors.push(`${person.name} 是新人物，status 应为 新建`);
    }
    const appears = input.scenes.filter((scene) => scene.characters.includes(person.name));
    for (const scene of appears) {
      const count = person.costumes.filter((row) => row.scenes.includes(scene.scene_id)).length;
      if (count !== 1)
        errors.push(`${person.name} 在 ${scene.scene_id} 应正好有一套衣服，实际 ${count} 套`);
    }
    for (const costume of person.costumes) {
      for (const sceneId of costume.scenes) {
        if (!appears.some((scene) => scene.scene_id === sceneId)) {
          errors.push(`${costume.costume_id} 写了 ${sceneId}，但 ${person.name} 不在这一场`);
        }
      }
      const old = lockedCostumes.find((row) => row.costume_id === costume.costume_id);
      if (costume.status === "沿用" && (!old || old.description !== costume.description)) {
        errors.push(`${costume.costume_id} 标为沿用，但和锁定的衣服不一致`);
      }
      if (costume.status === "新建" && old)
        errors.push(`${costume.costume_id} 已经存在，不能标为新建`);
      const views = person.portraits
        .filter((row) => row.costume_id === costume.costume_id)
        .map((row) => row.view)
        .sort();
      const expectedViews = costume.status === "新建" ? ["侧面", "正面", "背面"].sort() : [];
      if (!deepEqual(views, expectedViews)) {
        errors.push(
          `${costume.costume_id} 的全身定妆照应为 ${expectedViews.join("、") || "不出图"}`,
        );
      }
    }
    const faces = person.portraits.filter((row) => row.view === "脸部");
    const wantFaces = person.status === "新建" ? 1 : 0;
    if (faces.length !== wantFaces || faces.some((row) => row.costume_id !== null)) {
      errors.push(`${person.name} 的脸部定妆照应为 ${wantFaces} 张，且 costume_id 为 null`);
    }
    for (const portrait of person.portraits) {
      takeAsset(portrait.asset_id, person.name);
      promptTexts.push(portrait.prompt);
      if (!portrait.prompt.includes(person.identity_lock)) {
        errors.push(`${portrait.asset_id} 的提示词没有原样包含 ${person.name} 的 identity_lock`);
      }
      if (portrait.costume_id !== null) {
        const costume = person.costumes.find((row) => row.costume_id === portrait.costume_id);
        if (!costume) errors.push(`${portrait.asset_id} 的 costume_id 不是 ${person.name} 的衣服`);
        else if (!portrait.prompt.includes(costume.description)) {
          errors.push(`${portrait.asset_id} 的提示词没有原样包含衣服描述`);
        }
      }
    }
  }

  const allNames = [...new Set([...got, ...locked.characters.map((row) => row.name)])];
  for (const sceneId of sceneIds) {
    const count = output.locations.filter((row) => row.scenes.includes(sceneId)).length;
    if (count !== 1) errors.push(`${sceneId} 应正好属于一个地点，实际 ${count} 个`);
  }
  const checkStatus = (row, lockedRows, key, asset, label) => {
    const known = lockedRows.some((item) => item[key] === row[key]);
    if (row.status === "沿用" && (!known || asset !== null)) {
      errors.push(`${row[key]} 标为沿用：必须是已锁定的${label}，且不再出图`);
    }
    if (row.status === "新建" && (known || asset === null)) {
      errors.push(`${row[key]} 标为新建：不能和已锁定的重复，而且要出图`);
    }
  };
  for (const location of output.locations) {
    checkStatus(location, locked.locations, "loc_id", location.plate, "地点");
    for (const sceneId of location.scenes) {
      if (!sceneIds.includes(sceneId))
        errors.push(`${location.loc_id} 写了不在这一批的 ${sceneId}`);
    }
    if (location.plate) {
      takeAsset(location.plate.asset_id, location.loc_id);
      promptTexts.push(location.plate.prompt);
      if (!location.plate.prompt.includes("空镜"))
        errors.push(`${location.loc_id} 的空镜提示词要写明是空镜`);
      for (const name of allNames) {
        if (location.plate.prompt.includes(name))
          errors.push(`${location.loc_id} 的空镜里出现了人物 ${name}`);
      }
    }
  }
  for (const prop of output.props) {
    checkStatus(prop, locked.props, "prop_id", prop.image, "道具");
    for (const sceneId of prop.scenes) {
      if (!sceneIds.includes(sceneId)) errors.push(`${prop.prop_id} 写了不在这一批的 ${sceneId}`);
    }
    if (prop.image) {
      takeAsset(prop.image.asset_id, prop.prop_id);
      promptTexts.push(prop.image.prompt);
      for (const name of allNames) {
        if (prop.image.prompt.includes(name))
          errors.push(`${prop.prop_id} 的道具图里出现了人物 ${name}`);
      }
    }
  }
  for (const text of promptTexts) {
    if (text.includes(output.style.prompt_block_zh)) {
      errors.push("图片提示词不要重复画风段落，软件会统一加");
      break;
    }
  }
  return errors;
}

function checkLineTiming(shot, errors) {
  let free = LINE_HEAD;
  for (const line of shot.dialogue) {
    const end = line.at_seconds + lineSeconds(line.line);
    if (line.at_seconds < free - EPS) {
      errors.push(`${shot.shot_id}「${line.line}」开始得太早，最早 ${free.toFixed(2)} 秒`);
    }
    if (end > shot.seconds - LINE_TAIL + EPS) {
      errors.push(
        `${shot.shot_id}「${line.line}」放不下：说完是 ${end.toFixed(2)} 秒，镜头只有 ${shot.seconds} 秒`,
      );
    }
    free = end + LINE_GAP;
  }
}

function checkReferences(shot, assets, costumesHere, errors) {
  const declared = shot.reference_images.map((row) => row.token);
  shot.reference_images.forEach((row, index) => {
    if (row.token !== `<IMAGE_${index + 1}>`) {
      errors.push(`${shot.shot_id} 的第 ${index + 1} 张参考图应编为 <IMAGE_${index + 1}>`);
    }
    const asset = assets.find((item) => item.asset_id === row.asset_id);
    if (!asset) {
      errors.push(`${shot.shot_id} 引用了不存在的图片 ${row.asset_id}`);
      return;
    }
    if (asset.kind === "定妆照" && asset.costume_id !== null) {
      const wear = costumesHere.find((item) => item.name === asset.subject);
      if (wear && wear.costume_id !== asset.costume_id) {
        errors.push(`${shot.shot_id} 用了 ${asset.subject} 另一套衣服的定妆照 ${asset.asset_id}`);
      }
    }
  });
  const ids = shot.reference_images.map((row) => row.asset_id);
  if (new Set(ids).size !== ids.length) errors.push(`${shot.shot_id} 的同一张参考图放了两次`);
  if (declared.length > MAX_REFERENCES)
    errors.push(`${shot.shot_id} 的参考图超过 ${MAX_REFERENCES} 张`);
  const used = new Set(imageTokens(shot.video_prompt));
  for (const token of used) {
    if (!declared.includes(token)) errors.push(`${shot.shot_id} 的视频提示词用了没列出的 ${token}`);
  }
  for (const token of declared) {
    if (!used.has(token)) errors.push(`${shot.shot_id} 的视频提示词没有用到 ${token}`);
  }
  if (imageTokens(shot.start_frame_prompt).length > 0) {
    errors.push(`${shot.shot_id} 的起始画面提示词不能写 <IMAGE_n>`);
  }
}

function directorRules(example) {
  const errors = [];
  const { input, output } = example;
  const inScenes = input.scenes.map((scene) => scene.scene_id);
  const outScenes = output.scenes.map((scene) => scene.scene_id);
  if (!deepEqual(inScenes, outScenes)) errors.push(`应按顺序输出 ${inScenes.join("、")} 这几场`);
  const lock = Object.fromEntries(input.cast.map((row) => [row.name, row.identity_lock]));
  let first = true;
  for (const scene of output.scenes) {
    const script = input.scenes.find((row) => row.scene_id === scene.scene_id);
    if (!script) continue;
    const total = scene.shots.reduce((sum, shot) => sum + shot.seconds, 0);
    if (total !== scene.total_seconds)
      errors.push(`${scene.scene_id} 的 total_seconds 应为 ${total}`);
    const wantLines = script.elements
      .filter((element) => element.type === "dialogue")
      .map((element) => ({ speaker: element.speaker, line: element.line }));
    const gotLines = scene.shots.flatMap((shot) =>
      shot.dialogue.map((line) => ({ speaker: line.speaker, line: line.line })),
    );
    if (!deepEqual(gotLines, wantLines)) {
      const missing = wantLines.filter((want) => !gotLines.some((got) => deepEqual(got, want)));
      const extra = gotLines.filter((got) => !wantLines.some((want) => deepEqual(got, want)));
      errors.push(
        `${scene.scene_id} 的台词必须原样、按顺序全部放进镜头` +
          (missing.length ? `；漏了：${missing.map((row) => row.line).join(" / ")}` : "") +
          (extra.length ? `；多了：${extra.map((row) => row.line).join(" / ")}` : ""),
      );
    }
    const costumesHere = input.costumes.filter((row) => row.scene_id === scene.scene_id);
    scene.shots.forEach((shot, index) => {
      if (shot.shot_id !== `${scene.scene_id}-${pad2(index + 1)}`) {
        errors.push(`${shot.shot_id} 应编为 ${scene.scene_id}-${pad2(index + 1)}`);
      }
      if (first && shot.continuity_from_prev && input.carry_over === null) {
        errors.push(`${shot.shot_id} 是这一批第一个镜头，没有 carry_over 时不能接上一镜`);
      }
      first = false;
      for (const name of shot.characters) {
        if (!script.characters.includes(name)) errors.push(`${shot.shot_id} 的 ${name} 不在这一场`);
      }
      for (const line of shot.dialogue) {
        if (!shot.characters.includes(line.speaker)) {
          errors.push(`${shot.shot_id}「${line.line}」的说话人不在镜头里`);
        }
        if (!shot.video_prompt.includes(`台词原句：「${line.line}」`)) {
          errors.push(`${shot.shot_id} 的视频提示词没有写台词原句「${line.line}」`);
        }
      }
      checkLineTiming(shot, errors);
      const placed = shot.blocking.map((row) => row.name);
      if (
        placed.length !== shot.characters.length ||
        !shot.characters.every((name) => placed.includes(name))
      ) {
        errors.push(`${shot.shot_id} 的 blocking 要给每个人物各写一条`);
      }
      if (shot.tag === "插入" && !["特写", "近景", "大特写"].includes(shot.size)) {
        errors.push(`${shot.shot_id} 是插入镜头，景别只能是特写、近景或大特写`);
      }
      checkReferences(shot, input.assets, costumesHere, errors);
      for (const person of shot.blocking) {
        if (NO_LOCK.has(person.visible)) continue;
        const sentence = lock[person.name];
        if (!sentence) {
          errors.push(`${shot.shot_id} 的 ${person.name} 不在 cast 里`);
          continue;
        }
        if (!shot.start_frame_prompt.includes(sentence) || !shot.video_prompt.includes(sentence)) {
          errors.push(`${shot.shot_id} 的两条提示词都要原样写上 ${person.name} 的 identity_lock`);
        }
        const wear = costumesHere.find((row) => row.name === person.name);
        if (wear && !shot.start_frame_prompt.includes(wear.description)) {
          errors.push(`${shot.shot_id} 的起始画面没有原样写上 ${person.name} 这一场的衣服`);
        }
      }
      if (input.work.video_sound === false && !shot.video_prompt.includes("视频不要自己出声。")) {
        errors.push(`${shot.shot_id} 的视频提示词要写「视频不要自己出声。」`);
      }
    });
  }
  return errors;
}

function performanceRules(example) {
  const errors = [];
  const { input, output } = example;
  const wanted = input.shots.filter((shot) => shot.characters.length > 0);
  const got = output.shots.map((shot) => shot.shot_id);
  if (
    !deepEqual(
      got,
      wanted.map((shot) => shot.shot_id),
    )
  ) {
    errors.push("应按顺序给每个有人物的镜头各写一条，没有人物的镜头不写");
  }
  for (const row of output.shots) {
    const shot = input.shots.find((item) => item.shot_id === row.shot_id);
    if (!shot) continue;
    const names = row.performances.map((person) => person.name);
    if (
      !deepEqual(
        names,
        shot.blocking.map((person) => person.name),
      )
    ) {
      errors.push(`${row.shot_id} 的 performances 要按 blocking 的顺序给每个人物各写一条`);
    }
    for (const person of row.performances) {
      const placed = shot.blocking.find((item) => item.name === person.name);
      if (!placed) continue;
      if (person.visible !== placed.visible)
        errors.push(`${row.shot_id} ${person.name} 的 visible 要照抄 blocking`);
      if (NO_FACE.has(person.visible)) {
        if (person.micro_expressions.length > 0 || person.eyes !== null) {
          errors.push(
            `${row.shot_id} ${person.name} 看不见脸，micro_expressions 应为 []，eyes 应为 null`,
          );
        }
      } else if (person.micro_expressions.length === 0 || person.eyes === null) {
        errors.push(`${row.shot_id} ${person.name} 看得见脸，要写微表情和眼神`);
      }
      for (const item of person.micro_expressions) {
        if (item.at_seconds > shot.seconds + EPS)
          errors.push(`${row.shot_id} 的微表情时间超过镜头长度`);
      }
      if (
        person.eyes &&
        person.eyes.hold_seconds !== null &&
        person.eyes.hold_seconds > shot.seconds + EPS
      ) {
        errors.push(`${row.shot_id} 的 hold_seconds 超过镜头长度`);
      }
      const lines = shot.dialogue
        .filter((line) => line.speaker === person.name)
        .map((line) => line.line);
      if (
        !deepEqual(
          person.voice.map((item) => item.line),
          lines,
        )
      ) {
        errors.push(
          `${row.shot_id} ${person.name} 的 voice 要按顺序原样对应这个人物在这一镜的每句台词`,
        );
      }
    }
    if (row.prompt_addon) {
      const declared = shot.reference_images.map((ref) => ref.token);
      for (const token of imageTokens(row.prompt_addon)) {
        if (!declared.includes(token))
          errors.push(`${row.shot_id} 的 prompt_addon 用了这个镜头没有的 ${token}`);
      }
    }
  }
  return errors;
}

function injuredSide(bodyPart) {
  return bodyPart.startsWith("左") || bodyPart.startsWith("右") ? bodyPart[0] : null;
}

function actionRules(example) {
  const errors = [];
  const { input, output } = example;
  const order = input.shots.map((shot) => shot.shot_id);
  if (
    !deepEqual(
      output.shots.map((shot) => shot.shot_id),
      order,
    )
  ) {
    errors.push("应按顺序给输入的每个镜头各写一条");
  }
  const injuries = [
    ...input.injuries_before.map((row) => ({
      name: row.name,
      side: injuredSide(row.body_part),
      from: -1,
    })),
    ...output.injuries.map((row) => ({
      name: row.name,
      side: row.side,
      from: order.indexOf(row.from_shot),
    })),
  ];
  for (const injury of output.injuries) {
    const shot = input.shots.find((row) => row.shot_id === injury.from_shot);
    if (!shot) errors.push(`受伤的 from_shot ${injury.from_shot} 不在这一批`);
    else if (!shot.characters.includes(injury.name))
      errors.push(`${injury.from_shot} 里没有 ${injury.name}`);
    if (!injury.body_part.includes(injury.side))
      errors.push(`${injury.name} 的 body_part 要写明是${injury.side}侧`);
  }
  const directions = new Map();
  output.shots.forEach((row) => {
    const shot = input.shots.find((item) => item.shot_id === row.shot_id);
    if (!shot) return;
    const position = order.indexOf(row.shot_id);
    if (row.feasibility === "难" && row.workaround === null)
      errors.push(`${row.shot_id} 标为难，要给 workaround`);
    const lastEnd = new Map();
    let lastStart = -1;
    row.nodes.forEach((node, index) => {
      if (node.node_id !== `${row.shot_id}-A${index + 1}`) {
        errors.push(`${node.node_id} 应编为 ${row.shot_id}-A${index + 1}`);
      }
      if (node.at_seconds < lastStart - EPS) errors.push(`${row.shot_id} 的节点没有按时间先后排列`);
      lastStart = node.at_seconds;
      const end = node.at_seconds + node.duration_seconds;
      if (end > shot.seconds + EPS)
        errors.push(`${node.node_id} 结束在 ${end.toFixed(2)} 秒，超过镜头长度`);
      if ((lastEnd.get(node.actor) ?? -1) > node.at_seconds + EPS) {
        errors.push(`${node.node_id} 和 ${node.actor} 的上一个动作重叠`);
      }
      lastEnd.set(node.actor, end);
      if (!shot.characters.includes(node.actor)) errors.push(`${node.node_id} 的 actor 不在镜头里`);
      if (
        node.target !== null &&
        (!shot.characters.includes(node.target) || node.target === node.actor)
      ) {
        errors.push(`${node.node_id} 的 target 要是镜头里的另一个人`);
      }
      if (node.force >= 3 && node.force_cue === null)
        errors.push(`${node.node_id} 力度 ${node.force}，要写 force_cue`);
      if (node.contact !== (node.reaction !== null)) {
        errors.push(`${node.node_id} 碰到了就写 reaction，没碰到 reaction 写 null`);
      }
      if (node.target !== null && SCREEN_DIRECTIONS.has(node.direction)) {
        const key = `${shot.scene_id}/${node.actor}`;
        const seen = directions.get(key);
        if (seen && seen !== node.direction) {
          errors.push(`${node.node_id}：${node.actor} 在 ${shot.scene_id} 出手的方向变了，越轴了`);
        }
        directions.set(key, seen ?? node.direction);
      }
      for (const injury of injuries) {
        if (injury.name !== node.actor || injury.side === null || position <= injury.from) continue;
        if (node.body_part.includes(injury.side) && LIMB.test(node.body_part) && node.force > 1) {
          errors.push(
            `${node.node_id}：${node.actor} 的${injury.side}侧受了伤，这个部位只能做力度 1 的动作`,
          );
        }
      }
    });
    if (row.prompt_addon) {
      const declared = shot.reference_images.map((ref) => ref.token);
      for (const token of imageTokens(row.prompt_addon)) {
        if (!declared.includes(token))
          errors.push(`${row.shot_id} 的 prompt_addon 用了这个镜头没有的 ${token}`);
      }
    }
  });
  const people = [...new Set(input.shots.flatMap((shot) => shot.characters))].sort();
  const after = output.props_after.map((row) => row.name).sort();
  if (!deepEqual(after, people)) errors.push(`props_after 要给 ${people.join("、")} 每人写一条`);
  return errors;
}

function soundRules(example) {
  const errors = [];
  const { input, output } = example;
  const library = new Map(input.library.map((row) => [row.asset_id, row]));
  const order = input.scenes.map((scene) => scene.scene_id);
  if (
    !deepEqual(
      output.scenes.map((scene) => scene.scene_id),
      order,
    )
  ) {
    errors.push(`应按顺序输出 ${order.join("、")} 这几场`);
  }
  const laneOf = (assetId, lane, where) => {
    if (assetId === null) return;
    const asset = library.get(assetId);
    if (!asset) errors.push(`${where} 用了素材库里没有的 ${assetId}`);
    else if (asset.lane !== lane)
      errors.push(`${where} 的 ${assetId} 是${asset.lane}素材，不能放在${lane}层`);
  };
  const missingFor = (scene, lane, need) =>
    scene.missing.some((row) => row.lane === lane && (need === null || row.need === need));
  for (const scene of output.scenes) {
    const plan = input.scenes.find((row) => row.scene_id === scene.scene_id);
    if (!plan) continue;
    const total = plan.total_seconds;
    const inside = (start, end, where) => {
      if (!(start >= 0 && start < end && end <= total + EPS))
        errors.push(`${where} 的时间要在 0 到 ${total} 秒之间，且开始早于结束`);
    };
    if (
      !scene.ambience.some(
        (row) => row.start_seconds === 0 && Math.abs(row.end_seconds - total) < EPS,
      )
    ) {
      errors.push(`${scene.scene_id} 要有一条铺满全场（0 到 ${total} 秒）的环境声`);
    }
    for (const row of scene.ambience) {
      laneOf(row.asset_id, "环境音", `${scene.scene_id} 环境声`);
      inside(row.start_seconds, row.end_seconds, `${scene.scene_id} 环境声`);
      if (row.asset_id === null && !missingFor(scene, "环境音", null)) {
        errors.push(`${scene.scene_id} 有一条环境声没选素材，要写进 missing`);
      }
    }
    const music = scene.music;
    laneOf(music.asset_id, "配乐", `${scene.scene_id} 配乐`);
    inside(music.start_seconds, music.end_seconds, `${scene.scene_id} 配乐`);
    if (
      music.fade_in_seconds + music.fade_out_seconds >
      music.end_seconds - music.start_seconds + EPS
    ) {
      errors.push(`${scene.scene_id} 配乐的淡入淡出比配乐本身还长`);
    }
    if (music.asset_id !== null) {
      const asset = library.get(music.asset_id);
      if (asset && asset.mood !== music.mood)
        errors.push(`${scene.scene_id} 选的配乐情绪是${asset.mood}，和标签${music.mood}不一致`);
    } else if (!missingFor(scene, "配乐", null)) {
      errors.push(`${scene.scene_id} 没选配乐，要写进 missing`);
    }
    for (const fx of scene.sfx) {
      const where = `${scene.scene_id} 音效「${fx.description}」`;
      laneOf(fx.asset_id, "音效", where);
      const shot = plan.shots.find((row) => row.shot_id === fx.shot_id);
      if (!shot) {
        errors.push(`${where} 的 ${fx.shot_id} 不在这一场`);
        continue;
      }
      if (fx.at_seconds > shot.seconds + EPS) errors.push(`${where} 的时间超过镜头长度`);
      if (fx.from_node !== null) {
        const node = shot.action_nodes.find((row) => row.node_id === fx.from_node);
        if (!node) errors.push(`${where} 对应的动作节点 ${fx.from_node} 不在这个镜头`);
        else if (
          fx.at_seconds < node.at_seconds - EPS ||
          fx.at_seconds > node.at_seconds + node.duration_seconds + EPS
        ) {
          errors.push(`${where} 没有落在动作节点 ${node.node_id} 的时间里`);
        }
      }
      if (fx.asset_id === null && !missingFor(scene, "音效", fx.description)) {
        errors.push(`${where} 没选素材，要在 missing 里写同样的 need`);
      }
    }
    for (const shot of plan.shots) {
      for (const node of shot.action_nodes) {
        if (node.contact && !scene.sfx.some((fx) => fx.from_node === node.node_id)) {
          errors.push(`${scene.scene_id} 的接触动作 ${node.node_id} 没有配音效`);
        }
      }
    }
  }
  return errors;
}

function continuityRules(example) {
  const errors = [];
  const { input, output } = example;
  const order = input.shots.map((shot) => shot.shot_id);
  const indexOf = (shotId) =>
    input.carry_in && shotId === input.carry_in.shot_id ? -1 : order.indexOf(shotId);
  if (!deepEqual(output.checked_shots, order))
    errors.push("checked_shots 要按顺序列出这一批的全部镜头");
  let lastTo = -1;
  output.issues.forEach((issue, index) => {
    if (issue.issue_id !== `CI-${pad2(index + 1)}`)
      errors.push(`第 ${index + 1} 条问题应编为 CI-${pad2(index + 1)}`);
    const from = indexOf(issue.from_shot);
    const to = order.indexOf(issue.to_shot);
    if (to < 0) errors.push(`${issue.issue_id} 的 to_shot 不在这一批`);
    if (from === -1 && !(input.carry_in && issue.from_shot === input.carry_in.shot_id)) {
      errors.push(`${issue.issue_id} 的 from_shot 不在这一批，也不是 carry_in 的镜头`);
    }
    if (to >= 0 && from >= to) errors.push(`${issue.issue_id} 的 to_shot 要在 from_shot 后面`);
    if (to < lastTo) errors.push(`${issue.issue_id} 没有按 to_shot 的先后排列`);
    lastTo = Math.max(lastTo, to);
    if (issue.fix.shot_id !== issue.to_shot || issue.jump_to.shot_id !== issue.to_shot) {
      errors.push(`${issue.issue_id} 的 fix 和 jump_to 都要指向 to_shot`);
    }
    const shot = input.shots.find((row) => row.shot_id === issue.to_shot);
    if (shot && issue.jump_to.at_seconds > shot.seconds + EPS)
      errors.push(`${issue.issue_id} 跳转的时间超过镜头长度`);
    if (shot && issue.who !== null && !shot.people.some((person) => person.name === issue.who)) {
      errors.push(`${issue.issue_id} 的 ${issue.who} 不在 ${issue.to_shot} 里`);
    }
  });
  const mustFix = output.issues.filter((row) => row.severity === "必须改").length;
  const suggest = output.issues.filter((row) => row.severity === "建议改").length;
  if (
    output.summary.checked !== order.length ||
    output.summary.must_fix !== mustFix ||
    output.summary.suggest !== suggest
  ) {
    errors.push(`summary 应为 检查 ${order.length}、必须改 ${mustFix}、建议改 ${suggest}`);
  }
  if (output.carry_out.shot_id !== order[order.length - 1])
    errors.push("carry_out.shot_id 要是这一批最后一个镜头");
  const seen = new Set([
    ...(input.carry_in ? input.carry_in.people.map((person) => person.name) : []),
    ...input.shots.flatMap((shot) => shot.people.map((person) => person.name)),
  ]);
  const handed = new Set(output.carry_out.people.map((person) => person.name));
  for (const name of seen) if (!handed.has(name)) errors.push(`carry_out 少了 ${name}`);
  return errors;
}

function reviewRules(example) {
  const errors = [];
  const { input, output } = example;
  const tokens = input.shots.flatMap((shot) =>
    shot.takes.flatMap((take) => take.frames.map((frame) => frame.image)),
  );
  tokens.forEach((token, index) => {
    if (token !== `<IMAGE_${index + 1}>`)
      errors.push(`第 ${index + 1} 张帧图应编为 <IMAGE_${index + 1}>`);
  });
  if (tokens.length !== input.attached_images) errors.push(`attached_images 应为 ${tokens.length}`);
  if (tokens.length > MAX_REFERENCES) errors.push(`一次最多附 ${MAX_REFERENCES} 张帧图`);
  if (
    !deepEqual(
      output.shots.map((shot) => shot.shot_id),
      input.shots.map((shot) => shot.shot_id),
    )
  ) {
    errors.push("应按顺序给输入的每个镜头各写一条");
  }
  for (const row of output.shots) {
    const shot = input.shots.find((item) => item.shot_id === row.shot_id);
    if (!shot) continue;
    if (
      !deepEqual(
        row.takes.map((take) => take.take_id),
        shot.takes.map((take) => take.take_id),
      )
    ) {
      errors.push(`${row.shot_id} 要按顺序给每个版本各写一条`);
    }
    for (const result of row.takes) {
      const take = shot.takes.find((item) => item.take_id === result.take_id);
      if (!take) continue;
      const checks = Object.values(result.checks);
      const seen = take.frames.length > 0;
      if (result.seen_frames !== seen) errors.push(`${result.take_id} 的 seen_frames 应为 ${seen}`);
      const visual = result.issues.filter((item) => item.source === "看画面");
      if (!seen) {
        if (
          checks.some((value) => value !== "没看到") ||
          result.verdict !== "建议重做" ||
          visual.length > 0
        ) {
          errors.push(
            `${result.take_id} 没有帧图：四项写没看到，verdict 写建议重做，不能写看画面的问题`,
          );
        }
        if (
          !result.issues.some((item) => item.kind === "没看到画面" && item.source === "没有帧图")
        ) {
          errors.push(`${result.take_id} 没有帧图，要写一条没看到画面的 issue`);
        }
      } else if (checks.includes("没看到")) {
        errors.push(`${result.take_id} 有帧图，四项都要给出过或不过`);
      }
      const failed = checks.includes("不过");
      if (failed !== (result.verdict === "必须重做")) {
        errors.push(`${result.take_id}：有一项不过就必须重做，四项都过就不能写必须重做`);
      }
      if (failed !== visual.length > 0) {
        errors.push(`${result.take_id}：写了不过就要有看画面的 issue，反过来也一样`);
      }
      for (const [kind, ranges] of [
        ["黑屏", take.auto_checks.black],
        ["静帧", take.auto_checks.frozen],
      ]) {
        for (const range of ranges) {
          const listed = result.issues.some(
            (item) =>
              item.kind === kind &&
              item.source === "自动检查" &&
              Math.abs(item.start_seconds - range.start_seconds) < EPS &&
              Math.abs(item.end_seconds - range.end_seconds) < EPS,
          );
          if (!listed)
            errors.push(
              `${result.take_id} 自动检查出的${kind} ${range.start_seconds}–${range.end_seconds} 秒没有写进 issues`,
            );
        }
      }
      for (const item of result.issues) {
        if (item.start_seconds > item.end_seconds + EPS || item.end_seconds > take.seconds + EPS) {
          errors.push(
            `${result.take_id} 的问题时间 ${item.start_seconds}–${item.end_seconds} 秒不对`,
          );
        }
      }
    }
    const allFail = row.takes.every((take) => take.verdict === "必须重做");
    if (allFail !== (row.recommend.take_id === null)) {
      errors.push(`${row.shot_id}：所有版本都必须重做时才不推荐，否则要推荐一版`);
    }
    if (row.recommend.take_id !== null) {
      const picked = row.takes.find((take) => take.take_id === row.recommend.take_id);
      if (!picked) errors.push(`${row.shot_id} 推荐的 ${row.recommend.take_id} 不是这一镜的版本`);
      else if (picked.verdict === "必须重做") errors.push(`${row.shot_id} 不能推荐必须重做的版本`);
    } else if (row.next_try === null) {
      errors.push(`${row.shot_id} 没有可推荐的版本，要写 next_try`);
    }
  }
  return errors;
}

export const ROLE_RULES = {
  writer: writerRules,
  art: artRules,
  director: directorRules,
  performance: performanceRules,
  action: actionRules,
  sound: soundRules,
  continuity: continuityRules,
  review: reviewRules,
};

/** Every example must show a batch: at least two scenes or two shots in one call. */
function batchSize(role, input) {
  if (role === "writer") return input.paragraphs.length;
  if (role === "art" || role === "director" || role === "sound") return input.scenes.length;
  return input.shots.length;
}

export function exampleRules(role, example, context) {
  const errors = [...outputTextRules(example.output), ...ROLE_RULES[role](example, context)];
  if (batchSize(role, example.input) < 2) errors.push("示例要一次处理多场或多个镜头");
  if (role === "writer" && example.output.scenes.length < 2) errors.push("示例要演示一次分出多场");
  return errors;
}

function project(shot, keys) {
  return Object.fromEntries(keys.map((key) => [key, shot[key]]));
}

function omit(value, key) {
  const copy = { ...value };
  delete copy[key];
  return copy;
}

/** Examples with the same number feed each other; this checks they carry the same data. */
export function chainRules(roles) {
  const errors = [];
  const add = (index, message) => errors.push(`示例 ${index + 1}：${message}`);
  for (let i = 0; i < 3; i += 1) {
    const writer = roles.writer.examples[i].output;
    const art = roles.art.examples[i];
    const director = roles.director.examples[i];
    if (!deepEqual(art.input.scenes, writer.scenes)) add(i, "美术输入的 scenes 要等于编剧输出");
    if (!deepEqual(director.input.scenes, writer.scenes))
      add(i, "导演输入的 scenes 要等于编剧输出");

    const artSoFar = roles.art.examples.slice(0, i + 1).map((row) => row.output);
    const people = artSoFar.flatMap((row) => row.characters);
    for (const member of director.input.cast) {
      const found = people.find((row) => row.name === member.name);
      if (!found || found.identity_lock !== member.identity_lock)
        add(i, `导演 cast 里 ${member.name} 的固定外貌和美术不一致`);
    }
    for (const wear of director.input.costumes) {
      const costume = art.output.characters
        .find((row) => row.name === wear.name)
        ?.costumes.find((row) => row.costume_id === wear.costume_id);
      if (
        !costume ||
        costume.description !== wear.description ||
        !costume.scenes.includes(wear.scene_id)
      ) {
        add(i, `导演的服装 ${wear.name}/${wear.scene_id} 和美术不一致`);
      }
    }
    const catalog = [
      ...people.flatMap((row) =>
        row.portraits.map((item) => ({
          asset_id: item.asset_id,
          kind: "定妆照",
          subject: row.name,
          view: item.view,
          costume_id: item.costume_id,
        })),
      ),
      ...artSoFar.flatMap((row) =>
        row.locations
          .filter((item) => item.plate)
          .map((item) => ({
            asset_id: item.plate.asset_id,
            kind: "场景图",
            subject: item.name,
            view: "空镜",
            costume_id: null,
          })),
      ),
      ...artSoFar.flatMap((row) =>
        row.props
          .filter((item) => item.image)
          .map((item) => ({
            asset_id: item.image.asset_id,
            kind: "道具图",
            subject: item.name,
            view: "道具",
            costume_id: null,
          })),
      ),
    ];
    for (const asset of director.input.assets) {
      const found = catalog.find((row) => row.asset_id === asset.asset_id);
      if (!found || !deepEqual(found, omit(asset, "note")))
        add(i, `导演的参考图 ${asset.asset_id} 不是美术已经出的图`);
    }

    const shots = director.output.scenes.flatMap((scene) =>
      scene.shots.map((shot) => ({ ...shot, scene_id: scene.scene_id })),
    );
    const byId = new Map(shots.map((shot) => [shot.shot_id, shot]));
    const moods = new Map(writer.scenes.map((scene) => [scene.scene_id, scene.mood]));
    const perfKeys = [
      "shot_id",
      "scene_id",
      "size",
      "seconds",
      "action",
      "characters",
      "dialogue",
      "blocking",
      "reference_images",
    ];
    const perf = roles.performance.examples[i].input.shots;
    if (
      !deepEqual(
        perf.map((shot) => shot.shot_id),
        shots.map((shot) => shot.shot_id),
      )
    ) {
      add(i, "表演指导输入要包含导演这一批的全部镜头");
    }
    for (const shot of perf) {
      const source = byId.get(shot.shot_id);
      if (
        !source ||
        !deepEqual(project(shot, perfKeys), project(source, perfKeys)) ||
        shot.scene_mood !== moods.get(shot.scene_id)
      ) {
        add(i, `表演指导输入的 ${shot.shot_id} 和导演输出不一致`);
      }
    }
    const actionKeys = [
      "shot_id",
      "scene_id",
      "seconds",
      "action",
      "characters",
      "blocking",
      "reference_images",
    ];
    for (const shot of roles.action.examples[i].input.shots) {
      const source = byId.get(shot.shot_id);
      if (!source || !deepEqual(project(shot, actionKeys), project(source, actionKeys))) {
        add(i, `动作指导输入的 ${shot.shot_id} 和导演输出不一致`);
      }
    }
    const nodes = new Map(
      roles.action.examples[i].output.shots.map((row) => [
        row.shot_id,
        row.nodes.map((node) =>
          project(node, [
            "node_id",
            "at_seconds",
            "duration_seconds",
            "move",
            "contact",
            "force",
            "sfx_cue",
          ]),
        ),
      ]),
    );
    const sound = roles.sound.examples[i].input;
    if (
      !deepEqual(
        sound.scenes.map((scene) => scene.scene_id),
        director.output.scenes.map((scene) => scene.scene_id),
      )
    ) {
      add(i, "声音设计输入的场次要和导演一致");
    }
    for (const scene of sound.scenes) {
      const source = director.output.scenes.find((row) => row.scene_id === scene.scene_id);
      if (
        !source ||
        scene.total_seconds !== source.total_seconds ||
        scene.shots.length !== source.shots.length
      ) {
        add(i, `声音设计输入的 ${scene.scene_id} 和导演输出不一致`);
        continue;
      }
      let start = 0;
      scene.shots.forEach((shot, index) => {
        const from = source.shots[index];
        const same =
          shot.shot_id === from.shot_id &&
          shot.seconds === from.seconds &&
          shot.action === from.action &&
          deepEqual(shot.dialogue, from.dialogue) &&
          Math.abs(shot.start_seconds - start) < EPS &&
          deepEqual(shot.action_nodes, nodes.get(shot.shot_id) ?? []);
        if (!same) add(i, `声音设计输入的 ${shot.shot_id} 和导演或动作指导不一致`);
        start += from.seconds;
      });
    }
    const continuity = roles.continuity.examples[i].input;
    if (
      !deepEqual(
        continuity.shots.map((shot) => [shot.shot_id, shot.scene_id, shot.seconds, shot.action]),
        shots.map((shot) => [shot.shot_id, shot.scene_id, shot.seconds, shot.action]),
      )
    ) {
      add(i, "场记输入的镜头要和导演这一批一致");
    }
    const carry = i === 0 ? null : roles.continuity.examples[i - 1].output.carry_out;
    if (!deepEqual(continuity.carry_in, carry)) add(i, "场记的 carry_in 要等于上一批的 carry_out");
    for (const shot of roles.review.examples[i].input.shots) {
      const source = byId.get(shot.shot_id);
      const intent = source && {
        size: source.size,
        seconds: source.seconds,
        action: source.action,
        characters: source.characters,
        dialogue_lines: source.dialogue.map((line) => line.line),
      };
      if (!source || !deepEqual(omit(shot.intent, "must_keep"), intent)) {
        add(i, `审片输入的 ${shot.shot_id} 和导演输出不一致`);
        continue;
      }
      for (const take of shot.takes) {
        if (Math.abs(take.seconds - source.seconds) > EPS)
          add(i, `${take.take_id} 的长度要等于镜头长度`);
      }
    }
  }
  return errors;
}

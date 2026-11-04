/**
 * Rules the JSON Schemas cannot express. Each role rule receives one example plus the context
 * (the parsed test novel and its notes) and returns messages; an empty list means the example
 * follows the role's prompt. Times are seconds. A spoken line lasts spokenLength(line) / 4 seconds.
 * Several rules mirror what the app's parsers do with a reply, so a reply that passes here is
 * read by the app the same way.
 */
import { deepEqual } from "./json-schema.mjs";
import { quotedLines, spokenLength } from "./novel.mjs";

const EPS = 1e-6;
const CHARS_PER_SECOND = 4;
const LINE_HEAD = 0.4;
const LINE_TAIL = 0.6;
const MAX_REFERENCES = 13;
const MAX_FRAMES = 14;
const NO_LOCK = new Set(["只露手", "画外"]);
const NO_FACE = new Set(["背影", "只露手", "画外"]);
const WIDE = new Set(["大远景", "远景", "全景", "中景"]);
// parseDirectorShots turns a wide shot into 近景 when purpose, emotion or performance match this.
const DIRECTOR_EMOTIONAL = /情绪|哭|泪|怒|发抖|心碎|质问/u;
// fillPerformance does the same with the performance note.
const PERFORMANCE_EMOTIONAL = /情绪|哭|泪|怒|发抖/u;
const TOKEN = /<IMAGE_([0-9]+)>/gu;
const ANY_TOKEN = /<\s*image[^>]*>/iu;
const ANY_TOKENS = /<\s*image[^>]*>/giu;
const QUOTE_OR_COLON = /[“”「」"'：:]/u;
const AGE_WORDS = /岁|年轻|青年|中年|老|少年|儿童|孩子|上下|左右|年纪/u;
const GENDER_WORDS = { 女: /女|婆|姑娘|太太/u, 男: /男|老头|小伙/u };
const SIDES = new Set(["画左", "画右"]);
const SCREEN_DIRECTIONS = { "画左→画右": ["画左", "画右"], "画右→画左": ["画右", "画左"] };
const STYLE_KEYS = [
  "preset",
  "era",
  "palette",
  "lighting",
  "lens",
  "grain",
  "contrast",
  "texture",
  "aspect",
  "prompt_block_en",
  "prompt_block_zh",
  "avoid",
];

const lineSeconds = (line) => spokenLength(line) / CHARS_PER_SECOND;
const paragraphNo = (id) => Number(id.slice(1));
const pick = (value, keys) => Object.fromEntries(keys.map((key) => [key, value[key]]));

/** 「第 2 场第 7 个镜头」 for scene-2-shot-7, the way the screens name a shot. */
export function shotLabel(shotId) {
  const match = /^scene-([0-9]+)-shot-([0-9]+)/u.exec(shotId);
  return match ? `第 ${match[1]} 场第 ${match[2]} 个镜头` : shotId;
}

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

/** No ASCII double quotes anywhere; <IMAGE_n> only in the director's reference list and video prompt. */
function outputTextRules(role, output) {
  const errors = [];
  eachString(output, "", (text, path) => {
    if (text.includes('"')) errors.push(`${path}：字符串里有英文双引号`);
    const tokens = text.match(ANY_TOKENS) ?? [];
    if (tokens.length === 0) return;
    const allowed =
      role === "director" &&
      (path.endsWith("/video_prompt") || /\/reference_images\/[0-9]+\/token$/u.test(path));
    if (!allowed) {
      errors.push(`${path}：这里不能写图片编号 ${tokens.join("、")}`);
      return;
    }
    for (const raw of tokens) {
      const match = /^<IMAGE_([0-9]+)>$/u.exec(raw);
      const index = match ? Number(match[1]) : NaN;
      if (!(index >= 1 && index <= MAX_REFERENCES)) {
        errors.push(
          `${path}：图片编号 ${raw} 不合法，只能用 <IMAGE_1> 到 <IMAGE_${MAX_REFERENCES}>`,
        );
      }
    }
  });
  return errors;
}

/** Longest common subsequence of two line lists, compared by source paragraph and exact text. */
function commonLines(expected, actual) {
  const same = (a, b) => a.source === b.source && a.line === b.line;
  const table = Array.from({ length: expected.length + 1 }, () =>
    new Array(actual.length + 1).fill(0),
  );
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

function writerDialogue(example, { notes }, errors) {
  const { input, output } = example;
  const here = new Set(input.paragraphs.map((row) => row.id));
  const quotes = input.paragraphs.flatMap((row) =>
    quotedLines(row.text).map((line) => ({ source: row.id, line })),
  );
  const notLines = notes.not_dialogue.filter((row) => here.has(row.paragraph));
  const expected = notes.speakers
    .filter((row) => here.has(row.paragraph))
    .map((row) => ({ source: row.paragraph, line: row.line, speaker: row.speaker }));
  for (const quote of quotes) {
    const covered =
      expected.some((row) => row.source === quote.source && row.line === quote.line) ||
      notLines.some((row) => row.paragraph === quote.source && row.text === quote.line);
    if (!covered) errors.push(`标准答案里没有 ${quote.source} 的引号「${quote.line}」`);
  }
  const actual = output.scenes.flatMap((scene) =>
    scene.elements
      .filter((element) => element.type === "dialogue")
      .map((element) => ({ source: element.source, line: element.line, speaker: element.speaker })),
  );
  const kept = commonLines(expected, actual);
  expected.forEach((want, i) => {
    if (!kept.expected.has(i))
      errors.push(`漏了原文 ${want.source} 的台词，或者改了字：「${want.line}」`);
  });
  actual.forEach((got, i) => {
    if (kept.actual.has(i)) {
      const want = expected.find((row) => row.source === got.source && row.line === got.line);
      if (want && want.speaker !== got.speaker)
        errors.push(`「${got.line}」是 ${want.speaker} 说的，不是 ${got.speaker}`);
      return;
    }
    const not = notLines.find((row) => row.paragraph === got.source && row.text === got.line);
    errors.push(
      not
        ? `「${got.line}」是${not.why}，不是台词`
        : `多出原文没有的台词，或者顺序不对：${got.source}「${got.line}」`,
    );
  });
  if (output.dialogue_count !== expected.length) {
    errors.push(`dialogue_count 应为 ${expected.length}，实际是 ${output.dialogue_count}`);
  }
}

function writerPeople(example, { notes }, errors) {
  const { input, output } = example;
  const here = new Set(input.paragraphs.map((row) => row.id));
  const known = new Set(input.known_characters.map((row) => row.name));
  for (const person of output.characters) {
    if (known.has(person.name))
      errors.push(`${person.name} 已经在 known_characters 里，不是新人物`);
    if (!here.has(person.first_paragraph))
      errors.push(`${person.name} 的 first_paragraph 不在这一批段落里`);
    const answer = notes.cast.find((row) => row.name === person.name);
    if (!answer) errors.push(`标准答案里没有人物 ${person.name}`);
    else {
      if (person.gender !== answer.gender)
        errors.push(`${person.name} 的 gender 应为 ${answer.gender}（${answer.why}）`);
      if (person.age_band !== answer.age_band)
        errors.push(`${person.name} 的 age_band 应为 ${answer.age_band}（${answer.why}）`);
    }
    const genderWord = GENDER_WORDS[person.gender];
    if (genderWord && !genderWord.test(person.identity))
      errors.push(`${person.name} 的 identity 要写明性别`);
    if (person.age_band === "未知" && AGE_WORDS.test(person.identity))
      errors.push(`${person.name} 的年龄原文没写，identity 里不能写年龄`);
    if (person.age_band !== "未知" && !AGE_WORDS.test(person.identity))
      errors.push(`${person.name} 的 identity 要写明年龄`);
  }
  const places = output.scenes.map((scene) => scene.place);
  for (const place of output.locations) {
    if (!places.includes(place.name))
      errors.push(`locations 里的 ${place.name} 不是哪一场的 place`);
  }
}

function writerRules(example, context) {
  const errors = [];
  const { input, output } = example;
  const { novel } = context;
  const byId = new Map(novel.paragraphs.map((row) => [row.id, row]));
  input.paragraphs.forEach((row, index) => {
    const source = byId.get(row.id);
    if (!source || source.text !== row.text) errors.push(`输入段落 ${row.id} 和测试小说不一致`);
    if (index > 0 && paragraphNo(row.id) !== paragraphNo(input.paragraphs[index - 1].id) + 1) {
      errors.push(`输入段落在 ${row.id} 处不连续`);
    }
  });
  const ids = input.paragraphs.map((row) => row.id);
  writerDialogue(example, context, errors);

  const covered = output.scenes.flatMap((scene) => scene.source_paragraphs);
  if (!deepEqual(covered, ids))
    errors.push("各场的 source_paragraphs 连起来必须正好是输入的全部段落");

  // sliceNovel in the app cuts the novel at the first occurrence of each scene's place.
  const joined = input.paragraphs.map((row) => row.text).join("\n");
  const offsets = new Map();
  let cursor = 0;
  for (const row of input.paragraphs) {
    offsets.set(row.id, [cursor, cursor + row.text.length]);
    cursor += row.text.length + 1;
  }
  const known = new Set(input.known_characters.map((row) => row.name));
  const fresh = new Set(output.characters.map((row) => row.name));
  output.scenes.forEach((scene, index) => {
    const no = input.scene_no_start + index;
    const name = `scene-${no}`;
    if (scene.no !== no || scene.id !== name)
      errors.push(`第 ${index + 1} 场应编为 ${name}（no=${no}）`);
    const first = byId.get(scene.source_paragraphs[0]);
    if (first?.heading) {
      const title = novel.scenes.find((row) => row.paragraphs[0].id === first.id)?.title;
      if (scene.title !== title) errors.push(`${name} 的 title 要照抄场次标题「${title}」`);
      if (scene.place !== title) errors.push(`${name} 的 place 要照抄场次标题「${title}」`);
    }
    const marker = (scene.place || scene.title).trim();
    const at = marker ? joined.indexOf(marker) : -1;
    const head = offsets.get(scene.source_paragraphs[0]);
    if (!head || at < head[0] || at >= head[1]) {
      errors.push(
        `${name} 的 place「${scene.place}」在原文里最先出现的地方不在这一场开头，软件会切错原文`,
      );
    }
    const body = scene.source_paragraphs
      .map((id) => byId.get(id))
      .filter((row) => row && !row.heading)
      .map((row) => row.text)
      .join("\n");
    if (scene.text !== body) errors.push(`${name} 的 text 要一字不改地照抄这一场的原文段落`);
    const lines = scene.elements
      .filter((element) => element.type === "dialogue")
      .map((element) => `${element.speaker}：${element.line}`)
      .join("\n");
    if (scene.dialogue !== lines)
      errors.push(`${name} 的 dialogue 要按顺序写成「说话人：台词」，一句一行`);
    for (const beat of [...scene.beats, scene.key_event]) {
      if (QUOTE_OR_COLON.test(beat))
        errors.push(`${name} 的 beats 和 key_event 不能有引号或冒号：「${beat}」`);
    }
    for (const person of scene.characters) {
      if (!known.has(person) && !fresh.has(person))
        errors.push(`${name} 的人物 ${person} 既不在 known_characters 里，也没写进 characters`);
    }
    let last = -1;
    for (const element of scene.elements) {
      const position = ids.indexOf(element.source);
      if (!scene.source_paragraphs.includes(element.source))
        errors.push(`${name} 的内容来自 ${element.source}，这一段不在本场`);
      if (position < last) errors.push(`${name} 的内容没有按原文顺序排列（${element.source}）`);
      last = Math.max(last, position);
      if (element.type === "dialogue" && !scene.characters.includes(element.speaker))
        errors.push(`${name}「${element.line}」的 speaker ${element.speaker} 不在本场人物里`);
    }
  });
  writerPeople(example, context, errors);
  return errors;
}

function artStyle(example, errors) {
  const { input, output } = example;
  if (input.locked.style) {
    if (output.style_status !== "沿用") errors.push("已经锁定画风时 style_status 必须是 沿用");
    for (const key of STYLE_KEYS) {
      if (!deepEqual(output[key], input.locked.style[key]))
        errors.push(`画风已锁定，${key} 要照抄`);
    }
  } else {
    if (output.style_status !== "新建") errors.push("没有锁定画风时 style_status 必须是 新建");
    if (!output.prompt_block_zh.startsWith(input.work.preset_text))
      errors.push("新建画风的 prompt_block_zh 要以画风预设原文开头");
  }
}

function artPeople(example, errors) {
  const { input, output } = example;
  const wanted = [];
  for (const scene of input.scenes)
    for (const name of scene.characters) if (!wanted.includes(name)) wanted.push(name);
  if (
    !deepEqual(
      output.identities.map((row) => row.name),
      wanted,
    )
  )
    errors.push(`identities 应按出场先后写 ${wanted.join("、")}`);
  const lockedIds = new Set(input.locked.identities.map((row) => row.char_id));
  for (const person of output.identities) {
    const before = input.locked.identities.find((row) => row.name === person.name);
    if (before) {
      if (person.status !== "沿用") errors.push(`${person.name} 已锁定，status 应为 沿用`);
      for (const key of ["identity", "char_id", "gender", "age_band", "role"]) {
        if (person[key] !== before[key]) errors.push(`${person.name} 已锁定，${key} 不能改`);
      }
      continue;
    }
    if (person.status !== "新建") errors.push(`${person.name} 是新人物，status 应为 新建`);
    if (lockedIds.has(person.char_id)) errors.push(`${person.name} 的 char_id 和已锁定的人物重复`);
    const fromWriter = input.characters.find((row) => row.name === person.name);
    if (!fromWriter) errors.push(`${person.name} 不在编剧给的新人物里`);
    else {
      if (fromWriter.gender !== "未知" && person.gender !== fromWriter.gender)
        errors.push(`${person.name} 的 gender 要和编剧一致（${fromWriter.gender}）`);
      if (fromWriter.age_band !== "未知" && person.age_band !== fromWriter.age_band)
        errors.push(`${person.name} 的 age_band 要和编剧一致（${fromWriter.age_band}）`);
    }
    if (!GENDER_WORDS[person.gender]?.test(person.identity))
      errors.push(`${person.name} 的 identity 要写明性别`);
    if (!AGE_WORDS.test(person.identity)) errors.push(`${person.name} 的 identity 要写明年龄`);
    if (/穿|衣|衫|裤|裙|外套|夹克/u.test(person.identity))
      errors.push(`${person.name} 的 identity 不写衣服，衣服写进 costumes`);
  }
}

function artCostumes(example, errors) {
  const { input, output } = example;
  const lockedCostumes = new Map(input.locked.costumes.map((row) => [row.costume_id, row]));
  for (const costume of output.costumes) {
    const before = lockedCostumes.get(costume.costume_id);
    if (before) {
      if (costume.status !== "沿用") errors.push(`${costume.costume_id} 以前有，status 应为 沿用`);
      if (costume.description !== before.description || costume.name !== before.name)
        errors.push(`${costume.costume_id} 沿用时 name 和 description 要照抄`);
    } else if (costume.status !== "新建") {
      errors.push(`${costume.costume_id} 是新衣服，status 应为 新建`);
    }
  }
  for (const scene of input.scenes) {
    const order = scene.source_paragraphs.map(paragraphNo);
    for (const name of scene.characters) {
      const ranges = output.costumes
        .filter((row) => row.name === name)
        .flatMap((row) => row.ranges.filter((range) => range.scene_id === scene.id))
        .map((range) => [paragraphNo(range.from), paragraphNo(range.to)])
        .sort((a, b) => a[0] - b[0]);
      let next = order[0];
      let ok = ranges.length > 0;
      for (const [from, to] of ranges) {
        if (from !== next || to < from) ok = false;
        next = to + 1;
      }
      if (!ok || next !== order.at(-1) + 1)
        errors.push(`${scene.id} 里 ${name} 的衣服段落范围要从头到尾正好接上，不重叠`);
    }
  }
}

function artImages(example, errors) {
  const { input, output } = example;
  const used = new Set(input.locked.asset_ids);
  const take = (assetId, where) => {
    if (used.has(assetId)) errors.push(`${where} 的 asset_id ${assetId} 重复或已被占用`);
    used.add(assetId);
  };
  const expected = [];
  for (const person of output.identities.filter((row) => row.status === "新建")) {
    if (person.role === "主要") expected.push(`${person.name}|脸部|null`);
  }
  for (const costume of output.costumes.filter((row) => row.status === "新建")) {
    const person = output.identities.find((row) => row.name === costume.name);
    const views = person?.role === "主要" ? ["正面", "侧面", "背面"] : ["正面"];
    for (const view of views) expected.push(`${costume.name}|${view}|${costume.costume_id}`);
  }
  const portraits = output.portraits.map((row) => `${row.name}|${row.view}|${row.costume_id}`);
  if (!deepEqual([...portraits].sort(), [...expected].sort()))
    errors.push(`定妆照应为 ${expected.join("，")}`);
  for (const portrait of output.portraits) {
    take(portrait.asset_id, `${portrait.name}${portrait.view}定妆照`);
    const person = output.identities.find((row) => row.name === portrait.name);
    if (person && !portrait.prompt.includes(person.identity))
      errors.push(`${portrait.asset_id} 的提示词要原样包含 ${portrait.name} 的 identity`);
    const costume = output.costumes.find((row) => row.costume_id === portrait.costume_id);
    if (portrait.costume_id && (!costume || !portrait.prompt.includes(costume.description)))
      errors.push(`${portrait.asset_id} 的提示词要原样包含这套衣服的 description`);
    if (!portrait.prompt.includes("纯灰色背景") || !portrait.prompt.includes("平光"))
      errors.push(`${portrait.asset_id} 要写纯灰色背景、平光`);
  }
  const names = output.identities.map((row) => row.name);
  const groups = [
    [
      "locations",
      "loc_id",
      ["name", "prompt", "ambience", "layout", "asset_id"],
      "空镜，没有人物。",
    ],
    ["props", "prop_id", ["name", "note", "prompt", "asset_id"], "道具图，纯灰背景，只拍道具。"],
  ];
  for (const [field, idKey, keys, opening] of groups) {
    const locked = new Map(input.locked[field].map((row) => [row[idKey], row]));
    for (const item of output[field]) {
      const before = locked.get(item[idKey]);
      if (before) {
        if (item.status !== "沿用") errors.push(`${item.name} 以前有，status 应为 沿用`);
        for (const key of keys) {
          if (item[key] !== before[key]) errors.push(`${item.name} 沿用时 ${key} 要照抄`);
        }
        continue;
      }
      if (item.status !== "新建") errors.push(`${item.name} 是新出的，status 应为 新建`);
      take(item.asset_id, item.name);
      if (!item.prompt.startsWith(opening))
        errors.push(`${item.name} 的提示词要以「${opening}」开头`);
      for (const name of names) {
        if (item.prompt.includes(name)) errors.push(`${item.name} 的提示词里不能写人物 ${name}`);
      }
    }
  }
}

function artRules(example) {
  const errors = [];
  artStyle(example, errors);
  artPeople(example, errors);
  artCostumes(example, errors);
  artImages(example, errors);
  return errors;
}

function costumeAt(costumes, name, paragraph) {
  const at = paragraphNo(paragraph);
  return costumes.filter(
    (row) => row.name === name && at >= paragraphNo(row.from) && at <= paragraphNo(row.to),
  );
}

function checkShotLine(shot, scene, paragraphs, where, errors) {
  if (!shot.line) {
    if (shot.speaker || shot.delivery || shot.line_at !== null)
      errors.push(`${where} 没有台词，speaker、delivery 写 ""，line_at 写 null`);
    return;
  }
  const original = scene.lines.find((row) => row.line === shot.line);
  if (!original) errors.push(`${where} 的台词「${shot.line}」不是剧本里的原句`);
  else {
    if (shot.speaker !== original.speaker)
      errors.push(`${where} 的 speaker 应为 ${original.speaker}`);
    if (shot.delivery !== (original.delivery ?? "")) errors.push(`${where} 的 delivery 要照抄剧本`);
  }
  if (!(paragraphs.get(shot.source) ?? "").includes(shot.line))
    errors.push(`${where} 的台词不在 source ${shot.source} 这一段里`);
  if (!shot.characters.includes(shot.speaker))
    errors.push(`${where} 说话的 ${shot.speaker} 不在 characters 里`);
  if (shot.line_at === null) {
    errors.push(`${where} 有台词，line_at 不能是 null`);
    return;
  }
  const end = shot.line_at + lineSeconds(shot.line);
  if (shot.line_at < LINE_HEAD - EPS) errors.push(`${where} 的台词开口早于 ${LINE_HEAD} 秒`);
  if (end > shot.seconds - LINE_TAIL + EPS)
    errors.push(`${where} 的台词到 ${end.toFixed(2)} 秒才说完，离镜头结束不到 ${LINE_TAIL} 秒`);
}

function checkShotReferences(shot, input, where, errors) {
  const portraits = new Map(input.assets.portraits.map((row) => [row.asset_id, row]));
  const assetIds = new Set([
    ...portraits.keys(),
    ...input.assets.plates.map((row) => row.asset_id),
    ...input.assets.props.map((row) => row.asset_id),
  ]);
  if (shot.reference_images.length > MAX_REFERENCES)
    errors.push(`${where} 的参考图超过 ${MAX_REFERENCES} 张`);
  const seen = new Set();
  shot.reference_images.forEach((ref, index) => {
    if (ref.token !== `<IMAGE_${index + 1}>`)
      errors.push(`${where} 的参考图要从 <IMAGE_1> 依次编号`);
    if (seen.has(ref.asset_id)) errors.push(`${where} 的 ${ref.asset_id} 放了两次`);
    seen.add(ref.asset_id);
    if (!assetIds.has(ref.asset_id)) {
      errors.push(`${where} 的 ${ref.asset_id} 不在 assets 里`);
      return;
    }
    const portrait = portraits.get(ref.asset_id);
    if (!portrait) return;
    if (!shot.characters.includes(portrait.name))
      errors.push(`${where} 用了 ${portrait.name} 的定妆照，但这个人不在镜头里`);
    if (!portrait.costume_id) return;
    const now = costumeAt(input.costumes, portrait.name, shot.source).map((row) => row.costume_id);
    const changing = input.costumes.some(
      (row) => row.name === portrait.name && row.to === shot.source,
    );
    const next = input.costumes.some(
      (row) =>
        row.name === portrait.name &&
        paragraphNo(row.from) === paragraphNo(shot.source) + 1 &&
        row.costume_id === portrait.costume_id,
    );
    if (!now.includes(portrait.costume_id) && !(changing && next))
      errors.push(
        `${where} 的 ${ref.asset_id} 是 ${portrait.costume_id}，${portrait.name} 这时不穿这套`,
      );
  });
  const tokens = imageTokens(shot.video_prompt);
  const listed = shot.reference_images.map((ref) => ref.token);
  for (const token of new Set(tokens)) {
    if (!listed.includes(token)) errors.push(`${where} 的 video_prompt 用了没列出的 ${token}`);
  }
  for (const token of listed) {
    if (!shot.video_prompt.includes(`${token} 是`))
      errors.push(`${where} 的 video_prompt 要先说明 ${token} 是什么`);
  }
}

function checkShotPrompts(shot, input, where, errors) {
  const cast = new Map(input.cast.map((row) => [row.name, row]));
  const frameHead = input.work.aspect === "16:9" ? "横屏构图。" : "竖屏构图。";
  if (ANY_TOKEN.test(shot.start_frame_prompt))
    errors.push(`${where} 的 start_frame_prompt 不能写图片编号`);
  if (!shot.start_frame_prompt.startsWith(frameHead))
    errors.push(`${where} 的起始画面要以「${frameHead}」开头`);
  if (!shot.start_frame_prompt.includes("画面：")) errors.push(`${where} 的起始画面要写「画面：」`);
  if (!shot.video_prompt.includes("从起始画面开始："))
    errors.push(`${where} 的 video_prompt 要写「从起始画面开始：」`);
  if (!input.work.video_sound && !shot.video_prompt.endsWith("视频不要自己出声。"))
    errors.push(`${where} 的 video_prompt 要以「视频不要自己出声。」结尾`);
  if (shot.line && !shot.video_prompt.includes(`台词原句：「${shot.line}」`))
    errors.push(`${where} 的 video_prompt 要写「台词原句：「${shot.line}」」`);
  const visible = shot.positions.filter((row) => !NO_LOCK.has(row.visible));
  for (const person of visible) {
    const identity = cast.get(person.name)?.identity ?? "";
    const wear = costumeAt(input.costumes, person.name, shot.source);
    if (wear.length !== 1) errors.push(`${where} 找不到 ${person.name} 此刻的衣服`);
    else if (!shot.start_frame_prompt.includes(`${person.name}，${identity}${wear[0].description}`))
      errors.push(`${where} 的起始画面要原样写「${person.name}，identity」再接上此刻的衣服`);
    if (!shot.video_prompt.includes(`${person.name}，${identity}`))
      errors.push(`${where} 的 video_prompt 要原样写「${person.name}，identity」`);
  }
  if (visible.length === 0 && shot.start_frame_prompt.includes("人物："))
    errors.push(`${where} 画面里看不到人物的脸和身形，不要写「人物：」`);
}

function directorRules(example) {
  const errors = [];
  const { input, output } = example;
  if (
    !deepEqual(
      output.scenes.map((row) => row.scene_id),
      input.scenes.map((row) => row.id),
    )
  )
    errors.push("输出的场次要和输入一一对应，顺序不变");
  output.scenes.forEach((plan, sceneIndex) => {
    const scene = input.scenes[sceneIndex];
    if (!scene) return;
    const name = plan.scene_id;
    if (plan.title !== scene.title) errors.push(`${name} 的 title 要照抄`);
    const total = plan.shots.reduce((sum, shot) => sum + shot.seconds, 0);
    if (plan.total_seconds !== total) errors.push(`${name} 的 total_seconds 应为 ${total}`);
    const paragraphs = new Map(scene.paragraphs.map((row) => [row.id, row.text]));
    const want = scene.lines.map((row) => `${row.speaker}：${row.line}`);
    const have = plan.shots
      .filter((shot) => shot.line)
      .map((shot) => `${shot.speaker}：${shot.line}`);
    if (!deepEqual(have, want))
      errors.push(`${name} 的台词要按顺序各占一个镜头，一句不少：${want.join(" / ")}`);
    let lastSource = 0;
    plan.shots.forEach((shot, index) => {
      const where = `${shotLabel(shot.id)}（${shot.id}）`;
      if (shot.id !== `${name}-shot-${index + 1}` || shot.no !== index + 1)
        errors.push(`${name} 第 ${index + 1} 个镜头应编为 ${name}-shot-${index + 1}`);
      if (!paragraphs.has(shot.source))
        errors.push(`${where} 的 source ${shot.source} 不是这一场的段落`);
      else if (paragraphNo(shot.source) < lastSource) errors.push(`${where} 的 source 往回跳了`);
      else lastSource = paragraphNo(shot.source);
      if (shot.tag === "插入" && !["特写", "近景", "大特写"].includes(shot.size))
        errors.push(`${where} 是插入镜头，size 要用特写或近景`);
      if (
        WIDE.has(shot.size) &&
        DIRECTOR_EMOTIONAL.test(`${shot.purpose}${shot.emotion}${shot.performance}`)
      )
        errors.push(`${where} 是${shot.size}，却写了情绪词，软件会把它改成近景`);
      for (const person of shot.characters) {
        if (!scene.characters.includes(person)) errors.push(`${where} 的人物 ${person} 不在这一场`);
        if (!shot.blocking.includes(person)) errors.push(`${where} 的 blocking 要写到 ${person}`);
      }
      if (
        !deepEqual(
          shot.positions.map((row) => row.name),
          shot.characters,
        )
      )
        errors.push(`${where} 的 positions 要按 characters 的顺序每人一条`);
      checkShotLine(shot, scene, paragraphs, where, errors);
      checkShotReferences(shot, input, where, errors);
      checkShotPrompts(shot, input, where, errors);
      if (shot.sound.musicMood !== scene.mood)
        errors.push(`${where} 的 musicMood 要照抄这一场的 mood`);
      for (const cue of shot.sound.sfx) {
        if (cue.at_seconds > shot.seconds + EPS)
          errors.push(`${where} 的音效「${cue.text}」超出镜头长度`);
      }
      if (index === 0 && sceneIndex === 0 && shot.continuity_from_prev && !input.carry_over)
        errors.push(
          `${where} 是这一批第一个镜头，没有 carry_over 时 continuity_from_prev 不能是 true`,
        );
    });
  });
  return errors;
}

function performanceRules(example) {
  const errors = [];
  const { input, output } = example;
  if (
    !deepEqual(
      output.map((row) => row.shot_id),
      input.shots.map((shot) => shot.shot_id),
    )
  )
    errors.push("每个输入镜头都要输出一行，顺序不变");
  for (const row of output) {
    const shot = input.shots.find((item) => item.shot_id === row.shot_id);
    if (!shot) continue;
    const where = `${shotLabel(shot.shot_id)}（${shot.shot_id}）`;
    const seat = (name) => shot.positions.find((item) => item.name === name);
    const main = seat(row.who);
    if (!main || main.visible === "画外") errors.push(`${where} 的 who 要是画面里看得到的人`);
    const hidden = !main || NO_FACE.has(main.visible);
    if (hidden && (row.face.length > 0 || row.eyes || row.gaze))
      errors.push(`${where} 的 ${row.who} 看不见脸，face 写 []，eyes 和 gaze 写 ""`);
    if (!hidden && row.face.length === 0)
      errors.push(`${where} 看得见 ${row.who} 的脸，face 要写 1 到 3 个动作`);
    if (!hidden && (!row.eyes || !row.gaze))
      errors.push(`${where} 要写 ${row.who} 的 eyes 和 gaze`);
    if (row.face_at.length !== row.face.length) errors.push(`${where} 的 face_at 要和 face 一样长`);
    row.face_at.forEach((at, i) => {
      if (at >= shot.seconds) errors.push(`${where} 的 face_at 超出镜头长度`);
      if (i > 0 && at < row.face_at[i - 1]) errors.push(`${where} 的 face_at 要从小到大`);
    });
    if (row.hold_s !== null && row.hold_s > shot.seconds)
      errors.push(`${where} 的 hold_s 超出镜头长度`);
    if (shot.line && !row.voice) errors.push(`${where} 有台词，要写 voice`);
    if (!shot.line && row.voice) errors.push(`${where} 没有台词，voice 写 null`);
    const others = shot.positions
      .filter((item) => item.name !== row.who && item.visible !== "画外")
      .map((item) => item.name);
    if (
      !deepEqual(
        row.others.map((item) => item.name),
        others,
      )
    )
      errors.push(`${where} 的 others 要按站位写 ${others.join("、") || "（没有）"}`);
    for (const other of row.others) {
      const place = seat(other.name);
      if (place && NO_FACE.has(place.visible) && (other.face.length > 0 || other.eyes))
        errors.push(`${where} 的 ${other.name} 看不见脸，face 写 []，eyes 写 ""`);
    }
    // noteFromRow joins these fields into the shot's performance; fillPerformance then
    // changes a wide shot to 近景 when the note matches its emotion words.
    const note = [row.emotion, row.face.join("、"), row.eyes, row.hands, row.breath].join("，");
    if (WIDE.has(shot.size) && PERFORMANCE_EMOTIONAL.test(note))
      errors.push(`${where} 是${shot.size}，表演里写了哭、泪、怒、发抖或情绪，软件会把它改成近景`);
    for (const wound of input.injuries_before) {
      if (wound.name !== row.who) continue;
      const strain = new RegExp(
        `${wound.side}(手|臂|小臂|胳膊)[^，。；]*(用力|抓|推|挥|拧|压|撑)`,
        "u",
      );
      if (strain.test(row.hands))
        errors.push(`${where} 的 ${row.who} ${wound.side}${wound.body_part}有伤，不能用力`);
    }
  }
  return errors;
}

function checkNode(node, k, row, shot, wounds, shotIndex, errors) {
  const where = `${shotLabel(shot.shot_id)}（${shot.shot_id}）`;
  const seat = (name) => shot.positions.find((item) => item.name === name);
  if (node.node_id !== `${shot.shot_id}-node-${k + 1}`)
    errors.push(`${where} 第 ${k + 1} 个节点应编为 ${shot.shot_id}-node-${k + 1}`);
  if (k > 0 && node.at_seconds < row.nodes[k - 1].at_seconds)
    errors.push(`${where} 的节点要按开始时间排`);
  if (node.at_seconds + node.duration_seconds > shot.seconds + EPS)
    errors.push(`${node.node_id} 超出镜头长度`);
  if (!shot.characters.includes(node.actor))
    errors.push(`${node.node_id} 的 actor ${node.actor} 不在镜头里`);
  if (node.target !== null && !shot.characters.includes(node.target))
    errors.push(`${node.node_id} 的 target ${node.target} 不在镜头里`);
  if (node.force >= 3 && !node.force_cue)
    errors.push(`${node.node_id} 力度 ${node.force}，要写 force_cue`);
  if (node.force <= 2 && node.force_cue)
    errors.push(`${node.node_id} 力度 ${node.force}，force_cue 写 null`);
  if (node.contact && !node.reaction) errors.push(`${node.node_id} 碰到了，要写 reaction`);
  if (!node.contact && node.reaction) errors.push(`${node.node_id} 没碰到，reaction 写 null`);
  const way = SCREEN_DIRECTIONS[node.direction];
  if (way && node.target) {
    const from = seat(node.actor)?.position;
    const to = seat(node.target)?.position;
    if (SIDES.has(from) && SIDES.has(to) && (from !== way[0] || to !== way[1]))
      errors.push(`${node.node_id} 从${from}打向${to}，direction 却写 ${node.direction}，越轴了`);
  }
  for (const wound of wounds) {
    if (wound.name !== node.actor || shotIndex <= wound.after) continue;
    if (node.body_part.includes(wound.side) && /手|臂/u.test(node.body_part) && node.force > 1)
      errors.push(`${node.node_id} 用的是受伤的${wound.side}${wound.body_part}，力度不能超过 1`);
  }
  for (const other of row.nodes.slice(0, k)) {
    if (
      other.actor === node.actor &&
      node.at_seconds < other.at_seconds + other.duration_seconds - EPS
    ) {
      errors.push(`${node.node_id} 和 ${other.node_id} 是同一个人，时间重叠了`);
    }
  }
}

function actionRules(example) {
  const errors = [];
  const { input, output } = example;
  if (output.scene_id !== input.scene.id) errors.push("scene_id 要照抄输入");
  if (
    !deepEqual(
      output.shots.map((row) => row.shot_id),
      input.shots.map((shot) => shot.shot_id),
    )
  )
    errors.push("每个输入镜头都要在 shots 里写一条，顺序不变");
  const wounds = input.injuries_before.map((row) => ({ ...row, after: -1 }));
  for (const injury of output.injuries) {
    const index = input.shots.findIndex((shot) => shot.shot_id === injury.from_shot);
    if (index < 0) errors.push(`新伤 ${injury.name} 的 from_shot 不在这一批里`);
    wounds.push({ ...injury, after: index });
  }
  const allNodes = [];
  output.shots.forEach((row, shotIndex) => {
    const shot = input.shots.find((item) => item.shot_id === row.shot_id);
    if (!shot) return;
    row.nodes.forEach((node, k) => {
      allNodes.push(node);
      checkNode(node, k, row, shot, wounds, shotIndex, errors);
    });
    if ((row.nodes.length === 0) !== (row.prompt_addon === ""))
      errors.push(`${shot.shot_id} 有节点时写 prompt_addon，没有节点写 ""`);
  });
  if (
    !deepEqual(
      output.beats.map((row) => row.node_id),
      allNodes.map((node) => node.node_id),
    )
  )
    errors.push("beats 要把全部节点按顺序各写一条");
  for (const beat of output.beats) {
    const node = allNodes.find((item) => item.node_id === beat.node_id);
    if (node && Math.abs(node.at_seconds - beat.at_seconds) > EPS)
      errors.push(`beat ${beat.node_id} 的 at_seconds 要和节点一致`);
    if (beat.feasibility === "难" && !beat.workaround)
      errors.push(`beat ${beat.node_id} 写了难，要给 workaround`);
  }
  for (const injury of output.injuries) {
    const shot = output.shots.find((row) => row.shot_id === injury.from_shot);
    if (!shot?.nodes.some((node) => node.target === injury.name && node.contact))
      errors.push(`${injury.name} 在 ${injury.from_shot} 受伤，这个镜头要有碰到这个人物的节点`);
  }
  const people = [...new Set(input.shots.flatMap((shot) => shot.characters))].sort();
  if (!deepEqual(output.props_after.map((row) => row.name).sort(), people))
    errors.push(`props_after 要写这一批出现过的每个人：${people.join("、")}`);
  return errors;
}

function soundMusic(plan, scene, library, errors) {
  const name = plan.scene_id;
  const music = plan.music;
  if (music.asset_id === null) {
    if (!plan.missing.some((row) => row.lane === "配乐"))
      errors.push(`${name} 没选配乐，要在 missing 里写缺什么`);
  } else {
    const asset = library.music.find((row) => row.asset_id === music.asset_id);
    if (!asset) errors.push(`${name} 的配乐 ${music.asset_id} 不在素材库的配乐里`);
    else {
      if (asset.mood !== plan.mood)
        errors.push(`${name} 的配乐情绪是 ${asset.mood}，和这一场的 ${plan.mood} 不一样`);
      if (!asset.loop && music.end_seconds - music.start_seconds > asset.seconds + EPS)
        errors.push(
          `${name} 的配乐只有 ${asset.seconds} 秒，放不满 ${music.start_seconds} 到 ${music.end_seconds} 秒`,
        );
    }
  }
  if (!(music.start_seconds < music.end_seconds) || music.end_seconds > scene.total_seconds + EPS)
    errors.push(`${name} 的配乐时间要在 0 到 ${scene.total_seconds} 秒之间`);
  if (music.fade_in_seconds + music.fade_out_seconds > music.end_seconds - music.start_seconds)
    errors.push(`${name} 的淡入淡出比配乐还长`);
  if (plan.lanes.music_under_dialogue >= plan.lanes.music)
    errors.push(`${name} 有人说话时配乐要降下来，music_under_dialogue 要小于 music`);
}

function soundAmbience(plan, scene, library, errors) {
  const name = plan.scene_id;
  const starts = new Map();
  let at = 0;
  for (const shot of scene.shots) {
    if (Math.abs(shot.start_seconds - at) > EPS)
      errors.push(`${shot.shot_id} 的 start_seconds 应为 ${at}`);
    starts.set(shot.shot_id, at);
    at += shot.seconds;
  }
  if (Math.abs(at - scene.total_seconds) > EPS)
    errors.push(`${name} 的 total_seconds 和镜头加起来不一致`);
  const switches = scene.places.slice(1).map((place) => starts.get(place.from_shot));
  let cursor = 0;
  const bounds = [];
  for (const bed of plan.ambience) {
    if (Math.abs(bed.start_seconds - cursor) > EPS)
      errors.push(`${name} 的环境声在 ${cursor} 秒处没接上`);
    if (!(bed.end_seconds > bed.start_seconds)) errors.push(`${name} 的环境声时间不对`);
    cursor = bed.end_seconds;
    bounds.push(bed.end_seconds);
    if (bed.asset_id !== null && !library.ambience.some((row) => row.asset_id === bed.asset_id))
      errors.push(`${name} 的环境声 ${bed.asset_id} 不在素材库的环境音里`);
  }
  if (Math.abs(cursor - scene.total_seconds) > EPS)
    errors.push(`${name} 的环境声要铺满到 ${scene.total_seconds} 秒`);
  if (!deepEqual(bounds.slice(0, -1), switches))
    errors.push(`${name} 的环境声要在换地点的镜头处换：${switches.join("、")} 秒`);
  const empty = plan.ambience.filter((bed) => bed.asset_id === null).length;
  if (empty > plan.missing.filter((row) => row.lane === "环境音").length)
    errors.push(`${name} 缺的环境声要写进 missing`);
}

function soundEffects(plan, scene, library, errors) {
  const name = plan.scene_id;
  const shots = new Map(scene.shots.map((shot) => [shot.shot_id, shot]));
  for (const cue of plan.sfx) {
    const shot = shots.get(cue.shot_id);
    if (!shot) {
      errors.push(`${name} 的音效「${cue.description}」的 shot_id 不在这一场`);
      continue;
    }
    if (cue.at_seconds > shot.seconds + EPS)
      errors.push(`${cue.shot_id} 的音效「${cue.description}」超出镜头长度`);
    if (cue.asset_id === null) {
      if (!plan.missing.some((row) => row.lane === "音效" && row.need === cue.description))
        errors.push(
          `${cue.shot_id} 的「${cue.description}」没有素材，要在 missing 里写同样的 need`,
        );
    } else if (!library.sfx.some((row) => row.asset_id === cue.asset_id)) {
      errors.push(`${cue.shot_id} 的音效 ${cue.asset_id} 不在素材库的音效里`);
    }
    if (cue.from_node === null) continue;
    const node = shot.nodes.find((item) => item.node_id === cue.from_node);
    if (!node) errors.push(`${cue.shot_id} 的音效 from_node ${cue.from_node} 不在这个镜头`);
    else if (
      cue.at_seconds < node.at_seconds - EPS ||
      cue.at_seconds > node.at_seconds + node.duration_seconds + EPS
    )
      errors.push(`${cue.shot_id} 的音效「${cue.description}」要落在节点 ${node.node_id} 的时间里`);
  }
  for (const shot of scene.shots) {
    const mine = plan.sfx.filter((cue) => cue.shot_id === shot.shot_id);
    for (const node of shot.nodes.filter((item) => item.contact)) {
      if (!mine.some((cue) => cue.from_node === node.node_id))
        errors.push(`${node.node_id} 碰到了东西，要有一条 from_node 是它的音效`);
    }
    for (const wanted of shot.sfx) {
      if (!mine.some((cue) => Math.abs(cue.at_seconds - wanted.at_seconds) <= 0.5 + EPS))
        errors.push(`${shot.shot_id} 导演写的音效「${wanted.text}」没有配上`);
    }
  }
}

function soundRules(example) {
  const errors = [];
  const { input, output } = example;
  if (
    !deepEqual(
      output.scenes.map((row) => row.scene_id),
      input.scenes.map((row) => row.scene_id),
    )
  )
    errors.push("输出的场次要和输入一一对应");
  output.scenes.forEach((plan, index) => {
    const scene = input.scenes[index];
    if (!scene) return;
    soundMusic(plan, scene, input.library, errors);
    soundAmbience(plan, scene, input.library, errors);
    soundEffects(plan, scene, input.library, errors);
  });
  return errors;
}

function personProblems(state, shot, ref, wear) {
  const found = [];
  if (wear && state.costume_id !== wear) found.push("服装");
  if (!ref) return found;
  const text = `${shot.picture}${shot.action}`;
  const changed = ref.state.costume_id !== wear;
  const lost = ref.state.marks.filter((mark) => !state.marks.includes(mark));
  if (lost.length > 0 && !changed && !/脱|擦干|擦掉|拆|换/u.test(text))
    found.push(lost.some((mark) => /伤|血|纱布/u.test(mark)) ? "伤妆" : "服装");
  const was = [ref.state.left, ref.state.right];
  const now = [state.left, state.right];
  // A prop may come or go when this shot or the last good one shows it.
  const why = (item) => text.includes(item.slice(-2)) || ref.text.includes(item.slice(-2));
  const swapped = was.some((item, side) => item && now[side] !== item && now[1 - side] === item);
  const gone = was.some((item) => item && !now.includes(item) && !why(item));
  const appeared = now.some((item) => item && !was.includes(item) && !why(item));
  if (swapped || gone || appeared) found.push("道具");
  return [...new Set(found)];
}

/**
 * Finds the continuity problems in a batch the way the prompt describes: each person is compared
 * with the last state that was right, and each pair keeps the left-right order it started with.
 * Returns [{ to_shot, who, kind, from_shot }].
 */
export function continuityProblems(input) {
  const problems = [];
  const reference = new Map(
    input.carry_in.people.map((row) => [
      row.name,
      { state: row, shot: input.carry_in.shot_id, text: "" },
    ]),
  );
  const pairs = new Map();
  for (const shot of input.shots) {
    for (const state of shot.state) {
      const wear = costumeAt(input.costumes, state.name, shot.source);
      const ref = reference.get(state.name);
      const found = personProblems(state, shot, ref, wear.length === 1 ? wear[0].costume_id : null);
      for (const kind of found) {
        problems.push({
          to_shot: shot.shot_id,
          who: state.name,
          kind,
          from_shot: ref?.shot ?? null,
        });
      }
      if (found.length === 0)
        reference.set(state.name, {
          state,
          shot: shot.shot_id,
          text: `${shot.picture}${shot.action}`,
        });
    }
    const placed = shot.state.filter((row) => SIDES.has(row.position));
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const [a, b] = [placed[i], placed[j]].sort((x, y) => x.name.localeCompare(y.name));
        if (a.position === b.position) continue;
        const key = `${a.name}|${b.name}`;
        const before = pairs.get(key);
        if (!before) pairs.set(key, { side: a.position, shot: shot.shot_id });
        else if (before.side !== a.position)
          problems.push({ to_shot: shot.shot_id, who: null, kind: "站位", from_shot: before.shot });
        else before.shot = shot.shot_id;
      }
    }
  }
  return problems;
}

function continuityRules(example) {
  const errors = [];
  const { input, output } = example;
  const order = input.shots.map((shot) => shot.shot_id);
  if (!deepEqual(output.checked_shots, order))
    errors.push("checked_shots 要按顺序列出这一批的全部镜头");
  const at = (id) => (id === input.carry_in.shot_id ? -1 : order.indexOf(id));
  output.issues.forEach((issue, index) => {
    const id = `CI-${String(index + 1).padStart(2, "0")}`;
    if (issue.issue_id !== id) errors.push(`第 ${index + 1} 个问题应编为 ${id}`);
    if (index > 0 && at(issue.to_shot) < at(output.issues[index - 1].to_shot))
      errors.push("issues 要按 to_shot 的先后排");
    if (
      at(issue.to_shot) < 0 ||
      (at(issue.from_shot) < 0 && issue.from_shot !== input.carry_in.shot_id)
    )
      errors.push(`${issue.issue_id} 的镜头不在这一批里`);
    else if (at(issue.from_shot) >= at(issue.to_shot))
      errors.push(`${issue.issue_id} 的 from_shot 要在 to_shot 前面`);
    if (issue.fix.shot_id !== issue.to_shot || issue.jump_to.shot_id !== issue.to_shot)
      errors.push(`${issue.issue_id} 的 fix 和 jump_to 要指向 to_shot`);
    const shot = input.shots.find((row) => row.shot_id === issue.to_shot);
    if (shot && issue.jump_to.at_seconds > shot.seconds)
      errors.push(`${issue.issue_id} 的 jump_to 超出镜头长度`);
    if (shot && issue.who !== null && !shot.characters.includes(issue.who))
      errors.push(`${issue.issue_id} 的 ${issue.who} 不在 ${issue.to_shot} 里`);
  });
  const key = (row) => `${row.to_shot}|${row.who ?? "-"}|${row.kind}`;
  const found = continuityProblems(input);
  for (const problem of found) {
    const issue = output.issues.find((row) => key(row) === key(problem));
    if (!issue) {
      errors.push(
        `漏报：${shotLabel(problem.to_shot)}${problem.who ? ` ${problem.who}` : ""} 的${problem.kind}问题`,
      );
    } else if (problem.from_shot && issue.from_shot !== problem.from_shot) {
      errors.push(`${issue.issue_id} 的 from_shot 应为状态还对的 ${problem.from_shot}`);
    }
  }
  const real = new Set(found.map(key));
  for (const issue of output.issues) {
    if (!real.has(key(issue)))
      errors.push(
        `${issue.issue_id} 在状态表里找不到对应的问题：${shotLabel(issue.to_shot)} ${issue.kind}`,
      );
  }
  const must = output.issues.filter((row) => row.severity === "必须改").length;
  const suggest = output.issues.filter((row) => row.severity === "建议改").length;
  const { summary } = output;
  if (summary.checked !== order.length || summary.must_fix !== must || summary.suggest !== suggest)
    errors.push(`summary 应为 checked ${order.length}、must_fix ${must}、suggest ${suggest}`);
  if (output.carry_out.shot_id !== order.at(-1))
    errors.push("carry_out 的 shot_id 要写这一批最后一个镜头");
  const names = [
    ...new Set([
      ...input.carry_in.people.map((row) => row.name),
      ...input.shots.flatMap((shot) => shot.characters),
    ]),
  ].sort();
  if (!deepEqual(output.carry_out.people.map((row) => row.name).sort(), names))
    errors.push(`carry_out 要写 ${names.join("、")}`);
  for (const person of output.carry_out.people) {
    const last = [...input.shots].reverse().find((shot) => shot.characters.includes(person.name));
    if (!last) continue;
    const wear = costumeAt(input.costumes, person.name, last.source);
    if (wear.length === 1 && wear[0].costume_id !== person.costume_id)
      errors.push(`carry_out 里 ${person.name} 应穿 ${wear[0].costume_id}`);
  }
  return errors;
}

function reviewTake(result, take, shot, errors) {
  const where = `${shotLabel(shot.shot_id)} ${take.label} 版`;
  const values = Object.values(result.checks);
  const seen = take.frames.length > 0;
  if (result.seen_frames !== seen) errors.push(`${where} 的 seen_frames 应为 ${seen}`);
  for (const issue of result.issues) {
    if (issue.start_seconds > issue.end_seconds || issue.end_seconds > take.seconds + EPS)
      errors.push(`${where} 的问题时间不对`);
  }
  const autos = [
    ...take.auto_checks.black.map((range) => ({ kind: "黑屏", ...range })),
    ...take.auto_checks.frozen.map((range) => ({ kind: "静帧", ...range })),
  ];
  for (const auto of autos) {
    const reported = result.issues.some(
      (issue) =>
        issue.kind === auto.kind &&
        issue.source === "自动检查" &&
        issue.start_seconds === auto.start_seconds &&
        issue.end_seconds === auto.end_seconds,
    );
    if (!reported)
      errors.push(
        `${where} 自动检查到的${auto.kind} ${auto.start_seconds}–${auto.end_seconds} 秒要写成一条 issue`,
      );
  }
  const looked = result.issues.filter((issue) => issue.source === "看画面");
  if (!seen) {
    if (values.some((value) => value !== "没看到"))
      errors.push(`${where} 没有帧图，四项都要写 没看到`);
    if (!result.issues.some((issue) => issue.kind === "没看到画面" && issue.source === "没有帧图"))
      errors.push(`${where} 没有帧图，要写一条 没看到画面 的 issue`);
    if (result.verdict !== "建议重做") errors.push(`${where} 没有帧图，verdict 要写 建议重做`);
    if (looked.length > 0) errors.push(`${where} 没有帧图，不能写看画面的问题`);
    return;
  }
  if (values.includes("没看到")) errors.push(`${where} 有帧图，四项不能写 没看到`);
  const failed = values.includes("不过");
  if (failed && result.verdict !== "必须重做")
    errors.push(`${where} 有一项不过，verdict 要写 必须重做`);
  if (failed && looked.length === 0)
    errors.push(`${where} 写了不过，要有一条看画面的 issue 说明原因`);
  if (failed) return;
  if (looked.length > 0) errors.push(`${where} 四项都过，却写了看画面的问题`);
  const middle = autos.some(
    (auto) => auto.start_seconds > EPS && auto.end_seconds < take.seconds - EPS,
  );
  if (autos.length === 0 && result.verdict !== "可用")
    errors.push(`${where} 没有问题，verdict 要写 可用`);
  if (middle && result.verdict !== "建议重做")
    errors.push(`${where} 中间有黑屏或静帧剪不掉，要写 建议重做`);
  if (result.verdict === "必须重做") errors.push(`${where} 四项都过，不能写 必须重做`);
}

function reviewRules(example) {
  const errors = [];
  const { input, output } = example;
  const frames = input.shots.flatMap((shot) => shot.takes.flatMap((take) => take.frames));
  frames.forEach((frame, index) => {
    if (frame.image !== `<IMAGE_${index + 1}>`)
      errors.push(`抽帧图要从 <IMAGE_1> 依次编号（第 ${index + 1} 张）`);
  });
  if (frames.length > MAX_FRAMES) errors.push(`抽帧图超过 ${MAX_FRAMES} 张`);
  if (input.attached_images !== frames.length) errors.push(`attached_images 应为 ${frames.length}`);
  if (
    !deepEqual(
      output.shots.map((row) => row.shot_id),
      input.shots.map((row) => row.shot_id),
    )
  )
    errors.push("输出的镜头要和输入一一对应");
  const notUsable = [];
  const rank = { 可用: 0, 建议重做: 1, 必须重做: 2 };
  for (const row of output.shots) {
    const shot = input.shots.find((item) => item.shot_id === row.shot_id);
    if (!shot) continue;
    if (
      !deepEqual(
        row.takes.map((take) => take.take_id),
        shot.takes.map((take) => take.take_id),
      )
    )
      errors.push(`${row.shot_id} 的版本要全部输出，顺序不变`);
    for (const result of row.takes) {
      const take = shot.takes.find((item) => item.take_id === result.take_id);
      if (!take) continue;
      reviewTake(result, take, shot, errors);
      if (result.verdict !== "可用") notUsable.push(`${shotLabel(shot.shot_id)} ${take.label} 版`);
    }
    const best = Math.min(...row.takes.map((take) => rank[take.verdict]));
    if (row.recommend.take_id === null) {
      if (best !== 2) errors.push(`${row.shot_id} 有能用的版本，recommend 不能写 null`);
      continue;
    }
    const chosen = row.takes.find((take) => take.take_id === row.recommend.take_id);
    if (!chosen) {
      errors.push(`${row.shot_id} 推荐的版本不在输入里`);
      continue;
    }
    if (chosen.verdict === "必须重做") errors.push(`${row.shot_id} 推荐了必须重做的版本`);
    else if (rank[chosen.verdict] !== best) errors.push(`${row.shot_id} 推荐的不是最好的版本`);
    const clean = chosen.verdict === "可用" && chosen.issues.length === 0;
    if (clean && row.next_try !== null)
      errors.push(`${row.shot_id} 推荐的版本可以直接用，next_try 写 null`);
    if (!clean && row.next_try === null)
      errors.push(`${row.shot_id} 推荐的版本还要剪或重做，要写 next_try`);
  }
  // qcFromModel shows the top-level verdict and issues, so they must name the shots.
  if (output.issues.length !== notUsable.length)
    errors.push(`顶层 issues 要给每个不能直接用的版本写一句（${notUsable.length} 句）`);
  for (const take of notUsable) {
    if (!output.issues.some((line) => line.startsWith(`${take}：`)))
      errors.push(`顶层 issues 里缺「${take}：」`);
  }
  for (const shot of input.shots) {
    if (!output.verdict.includes(shotLabel(shot.shot_id)))
      errors.push(`顶层 verdict 要提到${shotLabel(shot.shot_id)}`);
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

export function exampleRules(role, example, context) {
  return [...outputTextRules(role, example.output), ...ROLE_RULES[role](example, context)];
}

function chainArt(roles, i, add) {
  const writer = roles.writer.examples[i].output;
  const art = roles.art.examples[i];
  const sceneKeys = [
    "id",
    "title",
    "place",
    "time",
    "weather",
    "characters",
    "source_paragraphs",
    "text",
  ];
  if (
    !deepEqual(
      art.input.scenes.map((row) => pick(row, sceneKeys)),
      writer.scenes.map((row) => pick(row, sceneKeys)),
    )
  )
    add(i, "美术输入的 scenes 要来自编剧输出");
  const people = writer.characters.map((row) =>
    pick(row, ["name", "gender", "age_band", "identity", "brief"]),
  );
  if (!deepEqual(art.input.characters, people))
    add(i, "美术输入的 characters 要等于编剧输出的新人物");
  const before = roles.art.examples.slice(0, i).map((row) => row.output);
  const created = (field) =>
    before.flatMap((row) => row[field].filter((item) => item.status === "新建"));
  const lockedPeople = created("identities").map((row) =>
    pick(row, ["name", "identity", "char_id", "gender", "age_band", "role"]),
  );
  if (!deepEqual(art.input.locked.identities, lockedPeople))
    add(i, "美术输入的 locked.identities 要等于前面几次美术新建的人物");
  const lockedCostumes = created("costumes").map((row) =>
    pick(row, ["costume_id", "name", "title", "description"]),
  );
  if (!deepEqual(art.input.locked.costumes, lockedCostumes))
    add(i, "美术输入的 locked.costumes 要等于前面几次美术新建的衣服");
  const assets = [
    ...before.flatMap((row) => row.portraits.map((item) => item.asset_id)),
    ...created("locations").map((item) => item.asset_id),
    ...created("props").map((item) => item.asset_id),
  ];
  if (!deepEqual([...art.input.locked.asset_ids].sort(), assets.sort()))
    add(i, "美术输入的 locked.asset_ids 要等于前面已经出的图");
  const style = i === 0 ? null : pick(roles.art.examples[0].output, STYLE_KEYS);
  if (!deepEqual(art.input.locked.style, style))
    add(i, "美术输入的 locked.style 要等于第一次新建的画风");
}

function chainDirector(roles, i, add, novel) {
  const scene = roles.writer.examples[i].output.scenes[0];
  const art = roles.art.examples[i].output;
  const director = roles.director.examples[i].input;
  const identities = new Map(art.identities.map((row) => [row.name, row]));
  for (const member of director.cast) {
    const found = identities.get(member.name);
    if (!found || !deepEqual(member, pick(found, ["name", "gender", "age_band", "identity"])))
      add(i, `导演 cast 里 ${member.name} 要和美术的 identities 一致`);
  }
  const wear = art.costumes.flatMap((row) =>
    row.ranges
      .filter((range) => range.scene_id === scene.id)
      .map((range) => ({
        name: row.name,
        from: range.from,
        to: range.to,
        costume_id: row.costume_id,
        description: row.description,
      })),
  );
  const byPerson = (rows) =>
    [...rows].sort((a, b) => `${a.name}${a.from}`.localeCompare(`${b.name}${b.from}`));
  if (!deepEqual(byPerson(director.costumes), byPerson(wear)))
    add(i, "导演的 costumes 要等于美术这一场的衣服范围");
  const worn = new Set(wear.map((row) => row.costume_id));
  const portraits = roles.art.examples
    .slice(0, i + 1)
    .flatMap((row) => row.output.portraits)
    .filter(
      (row) => scene.characters.includes(row.name) && (!row.costume_id || worn.has(row.costume_id)),
    )
    .map((row) => pick(row, ["asset_id", "name", "view", "costume_id"]));
  const byAsset = (rows) => [...rows].sort((a, b) => a.asset_id.localeCompare(b.asset_id));
  if (!deepEqual(byAsset(director.assets.portraits), byAsset(portraits)))
    add(i, "导演的定妆照要等于美术已经出的、这一场用得上的定妆照");
  const plates = art.locations.map((row) => pick(row, ["asset_id", "name", "layout"]));
  if (!deepEqual(byAsset(director.assets.plates), byAsset(plates)))
    add(i, "导演的场景空镜要等于美术这一场的地点");
  const props = art.props.map((row) => pick(row, ["asset_id", "name", "note"]));
  if (!deepEqual(byAsset(director.assets.props), byAsset(props)))
    add(i, "导演的道具图要等于美术这一场的道具");
  const source = novel.scenes.find((row) => row.id === scene.id);
  const want = {
    id: scene.id,
    title: scene.title,
    mood: scene.mood,
    characters: scene.characters,
    paragraphs: source.paragraphs
      .filter((row) => !row.heading)
      .map((row) => ({ id: row.id, text: row.text })),
    lines: scene.elements
      .filter((row) => row.type === "dialogue")
      .map((row) => pick(row, ["speaker", "line", "delivery"])),
  };
  if (!deepEqual(director.scenes, [want])) add(i, "导演输入的 scenes 要来自编剧输出和原文");
}

function chainShots(roles, i, add) {
  const plan = roles.director.examples[i].output.scenes[0];
  const shots = new Map(plan.shots.map((shot) => [shot.id, shot]));
  const same = (role, value, keys) => {
    const shot = shots.get(value.shot_id);
    const body = value.intent ?? value;
    if (!shot || !deepEqual(pick(body, keys), pick(shot, keys)))
      add(i, `${role}输入的 ${value.shot_id} 要和导演输出一致`);
  };
  const performance = roles.performance.examples[i].input;
  for (const row of performance.shots) {
    same("表演指导", row, [
      "size",
      "seconds",
      "picture",
      "action",
      "characters",
      "positions",
      "line",
      "speaker",
      "delivery",
      "line_at",
    ]);
  }
  const mood = roles.writer.examples[i].output.scenes[0].mood;
  if (performance.scene.mood !== mood) add(i, "表演指导输入的 mood 要和编剧一致");
  for (const row of roles.action.examples[i].input.shots) {
    same("动作指导", row, ["size", "seconds", "picture", "action", "characters", "positions"]);
  }
  for (const row of roles.continuity.examples[i].input.shots) {
    same("场记", row, ["seconds", "source", "picture", "action", "characters"]);
  }
  for (const row of roles.review.examples[i].input.shots) {
    same("审片", row, ["size", "seconds", "picture", "action", "characters", "line"]);
  }
}

function chainSound(roles, i, add) {
  const plan = roles.director.examples[i].output.scenes[0];
  const mood = roles.writer.examples[i].output.scenes[0].mood;
  const sound = roles.sound.examples[i].input.scenes[0];
  const nodes = new Map(
    roles.action.examples[i].output.shots.map((row) => [row.shot_id, row.nodes]),
  );
  if (
    sound.scene_id !== plan.scene_id ||
    sound.total_seconds !== plan.total_seconds ||
    sound.mood_hint !== mood
  )
    add(i, "声音设计输入的场次要和导演一致");
  plan.shots.forEach((shot, index) => {
    const row = sound.shots[index];
    if (
      !row ||
      row.shot_id !== shot.id ||
      row.seconds !== shot.seconds ||
      !deepEqual(row.sfx, shot.sound.sfx)
    ) {
      add(i, `声音设计输入的 ${shot.id} 要和导演输出一致`);
      return;
    }
    const speech = shot.line
      ? { from: shot.line_at, to: Math.round((shot.line_at + lineSeconds(shot.line)) * 100) / 100 }
      : null;
    if (!deepEqual(row.speech, speech)) add(i, `声音设计输入的 ${shot.id} 的 speech 要按台词算`);
    const fromAction = (nodes.get(shot.id) ?? [])
      .filter((node) => node.contact || node.sfx_cue)
      .map((node) =>
        pick(node, ["node_id", "at_seconds", "duration_seconds", "contact", "sfx_cue"]),
      );
    if (!deepEqual(row.nodes, fromAction)) add(i, `声音设计输入的 ${shot.id} 的节点要来自动作指导`);
  });
  const places = plan.shots
    .filter(
      (shot, index) => index === 0 || shot.sound.ambience !== plan.shots[index - 1].sound.ambience,
    )
    .map((shot) => ({ from_shot: shot.id, ambience: shot.sound.ambience }));
  if (!deepEqual(sound.places, places)) add(i, "声音设计输入的 places 要按导演的环境声换");
}

/** Examples with the same number describe the same scene, so they must agree with each other. */
export function chainRules(roles, { novel }) {
  const errors = [];
  const add = (index, message) => errors.push(`示例 ${index + 1}：${message}`);
  for (let i = 0; i < 3; i += 1) {
    chainArt(roles, i, add);
    chainDirector(roles, i, add, novel);
    chainShots(roles, i, add);
    chainSound(roles, i, add);
  }
  const wound = (row) => pick(row, ["name", "body_part", "side", "kind", "from_shot"]);
  const wounds = roles.action.examples[1].output.injuries.map(wound);
  if (!deepEqual(roles.action.examples[2].input.injuries_before.map(wound), wounds))
    errors.push("动作指导第三个示例的 injuries_before 要接上第二个示例的 injuries");
  const side = (row) => pick(row, ["name", "body_part", "side"]);
  if (!deepEqual(roles.performance.examples[2].input.injuries_before.map(side), wounds.map(side)))
    errors.push("表演指导第三个示例的 injuries_before 要接上动作指导记下的伤");
  return errors;
}

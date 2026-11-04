/**
 * Validates the prompt library: node packages/aivora-prompts/scripts/validate.mjs
 *
 * For every file in roles/: the file matches schema/role-file.schema.json; the prompt has no
 * placeholders, stays within 3000 characters and carries an output skeleton whose fields match
 * the output schema; each example request fits the app's 100000-character request; its input and
 * output schemas only use keywords json-schema.mjs supports; each example input and output passes
 * those schemas, each output parses back through parseReply(), and the role rules in rules.mjs
 * hold. Then examples with the same number are checked against each other.
 * Prints one line per example and exits with 1 when anything fails.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import console from "node:console";
import { checkSchema, validate } from "./json-schema.mjs";
import { parseNovel } from "./novel.mjs";
import { parseReply } from "./reply.mjs";
import { chainRules, exampleRules } from "./rules.mjs";

export const ROLES = [
  "writer",
  "art",
  "director",
  "performance",
  "action",
  "sound",
  "continuity",
  "review",
];

export const PROMPT_LIMIT = 3000;
/** Desktop rejects requests beyond 100000 JS characters; source text is never truncated. */
export const REQUEST_LIMIT = 100000;
const REQUEST_WRAPPER = "\n\n上下文：\n\n\n用户：\n";
const USER_LINE_ALLOWANCE = 40;

const PACKAGE_ROOT = new URL("../", import.meta.url);

async function readJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

/** Loads the role files, the role-file schema, the test novel and its notes. */
export async function loadLibrary(root = PACKAGE_ROOT) {
  const roles = {};
  for (const role of ROLES) roles[role] = await readJson(new URL(`roles/${role}.json`, root));
  return {
    roles,
    metaSchema: await readJson(new URL("schema/role-file.schema.json", root)),
    novel: parseNovel(await readFile(new URL("fixtures/test-novel-2000.txt", root), "utf8")),
    notes: await readJson(new URL("fixtures/test-novel-2000.notes.json", root)),
  };
}

function formatErrors(errors) {
  return errors.map((error) => `${error.path || "/"}：${error.message}`);
}

const length = (text) => [...text].length;

function resolveRef(schema, root) {
  if (!schema || !schema.$ref) return schema;
  const name = schema.$ref.replace("#/$defs/", "");
  return root.$defs?.[name];
}

/**
 * Compares the skeleton in the prompt with the output schema: every object in the skeleton must
 * list exactly the schema's properties, and every array needs at least one sample item.
 */
export function skeletonProblems(schema, skeleton, root = schema, path = "") {
  const node = resolveRef(schema, root);
  if (!node) return [`${path || "/"}：结构里找不到定义`];
  if (node.oneOf) {
    const fits = node.oneOf.some(
      (option) => skeletonProblems(option, skeleton, root, path).length === 0,
    );
    return fits ? [] : [`${path || "/"}：骨架和任何一种写法都对不上`];
  }
  const types = [node.type].flat();
  if (node.properties) {
    if (skeleton === null && types.includes("null")) return [];
    if (!skeleton || typeof skeleton !== "object" || Array.isArray(skeleton))
      return [`${path || "/"}：骨架这里应是对象`];
    const want = Object.keys(node.properties);
    const have = Object.keys(skeleton);
    const problems = [];
    for (const key of want)
      if (!have.includes(key)) problems.push(`${path}/${key}：骨架里少了这个字段`);
    for (const key of have)
      if (!want.includes(key)) problems.push(`${path}/${key}：骨架里多了这个字段`);
    for (const key of want.filter((item) => have.includes(item))) {
      problems.push(
        ...skeletonProblems(node.properties[key], skeleton[key], root, `${path}/${key}`),
      );
    }
    return problems;
  }
  if (types.includes("array")) {
    if (!Array.isArray(skeleton) || skeleton.length === 0)
      return [`${path || "/"}：骨架这里应是至少有一项的数组`];
    return skeleton.flatMap((item, index) =>
      skeletonProblems(node.items, item, root, `${path}/${index}`),
    );
  }
  return [];
}

function promptProblems(file) {
  const problems = [];
  const prompt = file.system_prompt.join("\n");
  for (const name of prompt.match(/\{\{[^}]*\}\}/gu) ?? []) {
    problems.push(`system_prompt 里有占位符 ${name}，提示词要原样可用`);
  }
  if (length(prompt) > PROMPT_LIMIT)
    problems.push(`system_prompt 有 ${length(prompt)} 字，超过 ${PROMPT_LIMIT} 字`);
  const at = file.system_prompt.indexOf("输出格式：");
  if (at < 0 || at + 1 >= file.system_prompt.length) {
    problems.push("system_prompt 里要有一行「输出格式：」，下一行是输出的 JSON 骨架");
    return problems;
  }
  let skeleton;
  try {
    skeleton = JSON.parse(file.system_prompt[at + 1]);
  } catch (error) {
    problems.push(`「输出格式：」下一行不是 JSON：${error.message}`);
    return problems;
  }
  problems.push(
    ...skeletonProblems(file.output_format.schema, skeleton).map((text) => `输出骨架 ${text}`),
  );
  const start = Array.isArray(skeleton) ? "只输出一个 JSON 数组" : "只输出一个 JSON 对象";
  if (!file.system_prompt.some((line) => line.includes(start)))
    problems.push(`system_prompt 要写明「${start}」`);
  return problems;
}

/** Characters of the request the app would send for an example, as agentRequest builds it. */
export function requestLength(file, example) {
  return (
    file.system_prompt.join("\n").length +
    REQUEST_WRAPPER.length +
    JSON.stringify(example.input).length +
    USER_LINE_ALLOWANCE
  );
}

/**
 * Runs every check. Returns { roles: [{ role, name, prompt, longest, problems, examples }],
 * chain, ok }. problems are file-level messages; each example has its own errors list.
 */
export function checkLibrary(library) {
  const report = { roles: [], chain: [], ok: true };
  const context = { novel: library.novel, notes: library.notes };
  const metaProblems = checkSchema(library.metaSchema);
  let structured = metaProblems.length === 0;
  for (const role of ROLES) {
    const file = library.roles[role];
    const entry = {
      role,
      name: file?.name ?? role,
      prompt: 0,
      longest: 0,
      problems: [],
      examples: [],
    };
    report.roles.push(entry);
    if (metaProblems.length > 0) {
      entry.problems.push(...metaProblems.map((text) => `角色文件结构 Schema 有误：${text}`));
      continue;
    }
    entry.problems.push(...formatErrors(validate(library.metaSchema, file)));
    if (entry.problems.length > 0) {
      structured = false;
      continue;
    }
    if (file.role !== role) entry.problems.push(`文件 ${role}.json 里的 role 写成了 ${file.role}`);
    const inputProblems = checkSchema(file.input_format.schema);
    const outputProblems = checkSchema(file.output_format.schema);
    entry.problems.push(...inputProblems.map((text) => `输入 Schema：${text}`));
    entry.problems.push(...outputProblems.map((text) => `输出 Schema：${text}`));
    if (entry.problems.length > 0) {
      structured = false;
      continue;
    }
    entry.problems.push(...promptProblems(file));
    entry.prompt = length(file.system_prompt.join("\n"));
    file.examples.forEach((example, index) => {
      const errors = [
        ...formatErrors(validate(file.input_format.schema, example.input)).map(
          (text) => `输入 ${text}`,
        ),
        ...formatErrors(validate(file.output_format.schema, example.output)).map(
          (text) => `输出 ${text}`,
        ),
      ];
      if (example.id !== `${role}-${index + 1}`) errors.push(`示例编号应为 ${role}-${index + 1}`);
      const request = requestLength(file, example);
      entry.longest = Math.max(entry.longest, request);
      if (request > REQUEST_LIMIT)
        errors.push(`提示词加输入约 ${request} 字，超过软件一次请求的 ${REQUEST_LIMIT} 字`);
      if (errors.length === 0) {
        const reply = parseReply(JSON.stringify(example.output), file.output_format.schema);
        if (!reply.ok) errors.push(`输出不能一次解析：${reply.reason}`);
        try {
          errors.push(...exampleRules(role, example, context));
        } catch (error) {
          errors.push(`规则检查中断：${error.message}`);
        }
      } else {
        structured = false;
      }
      entry.examples.push({ id: example.id, title: example.title, errors });
    });
  }
  if (structured) {
    try {
      report.chain = chainRules(library.roles, context);
    } catch (error) {
      report.chain = [`串联检查中断：${error.message}`];
    }
  } else {
    report.chain = ["有文件或示例没通过 Schema，跳过示例之间的串联检查"];
  }
  report.ok =
    report.chain.length === 0 &&
    report.roles.every(
      (entry) =>
        entry.problems.length === 0 &&
        entry.examples.length === 3 &&
        entry.examples.every((example) => example.errors.length === 0),
    );
  return report;
}

export function printReport(report, write = (line) => console.log(line)) {
  let passed = 0;
  let total = 0;
  for (const entry of report.roles) {
    write(
      `${entry.name}（${entry.role}.json）提示词 ${entry.prompt} 字，最长一次请求约 ${entry.longest} 字`,
    );
    for (const problem of entry.problems) write(`  ✘ ${problem}`);
    for (const example of entry.examples) {
      total += 1;
      if (example.errors.length === 0) {
        passed += 1;
        write(`  ✔ ${example.id} ${example.title}`);
      } else {
        write(`  ✘ ${example.id} ${example.title}`);
        for (const error of example.errors) write(`      - ${error}`);
      }
    }
  }
  write(report.chain.length === 0 ? "示例串联：✔ 一致" : "示例串联：");
  for (const error of report.chain) write(`  ✘ ${error}`);
  write(
    report.ok
      ? `全部通过：${report.roles.length} 个角色，${passed} 个示例。`
      : `没有通过：${passed}/${total} 个示例通过。`,
  );
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const report = checkLibrary(await loadLibrary());
  printReport(report);
  process.exitCode = report.ok ? 0 : 1;
}

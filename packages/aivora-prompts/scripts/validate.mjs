/**
 * Validates the prompt library: node packages/aivora-prompts/scripts/validate.mjs
 *
 * For every file in roles/: the file matches schema/role-file.schema.json, its input and
 * output schemas only use keywords json-schema.mjs supports, each example input and output
 * passes those schemas, each output parses back through parseReply(), and the role rules in
 * rules.mjs hold. Then examples with the same number are checked against each other.
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

const PACKAGE_ROOT = new URL("../", import.meta.url);

async function readJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

/** Loads the role files, the role-file schema and the test novel from the package folder. */
export async function loadLibrary(root = PACKAGE_ROOT) {
  const roles = {};
  for (const role of ROLES) roles[role] = await readJson(new URL(`roles/${role}.json`, root));
  return {
    roles,
    metaSchema: await readJson(new URL("schema/role-file.schema.json", root)),
    novel: parseNovel(await readFile(new URL("fixtures/test-novel.md", root), "utf8")),
  };
}

function formatErrors(errors) {
  return errors.map((error) => `${error.path || "/"}：${error.message}`);
}

/**
 * Runs every check. Returns { roles: [{ role, name, problems, examples }], chain, ok }.
 * problems are file-level messages; each example has its own errors list.
 */
export function checkLibrary(library) {
  const report = { roles: [], chain: [], ok: true };
  const metaProblems = checkSchema(library.metaSchema);
  let structured = metaProblems.length === 0;
  for (const role of ROLES) {
    const file = library.roles[role];
    const entry = { role, name: file?.name ?? role, problems: [], examples: [] };
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
    const prompt = file.system_prompt.join("\n");
    if (prompt.split("{{OUTPUT_SCHEMA}}").length !== 2) {
      entry.problems.push("system_prompt 里要正好有一处 {{OUTPUT_SCHEMA}}");
    }
    const placeholders = prompt.match(/\{\{[^}]*\}\}/gu) ?? [];
    for (const name of placeholders) {
      if (name !== "{{OUTPUT_SCHEMA}}") entry.problems.push(`system_prompt 里有未知占位符 ${name}`);
    }
    const inputProblems = checkSchema(file.input_format.schema);
    const outputProblems = checkSchema(file.output_format.schema);
    entry.problems.push(...inputProblems.map((text) => `输入 Schema：${text}`));
    entry.problems.push(...outputProblems.map((text) => `输出 Schema：${text}`));
    if (entry.problems.length > 0) {
      structured = false;
      continue;
    }
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
      if (errors.length === 0) {
        const reply = parseReply(JSON.stringify(example.output), file.output_format.schema);
        if (!reply.ok) errors.push(`输出不能一次解析：${reply.reason}`);
        try {
          errors.push(...exampleRules(role, example, library));
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
      report.chain = chainRules(library.roles);
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
    write(`${entry.name}（${entry.role}.json）`);
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

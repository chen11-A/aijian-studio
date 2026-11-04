/**
 * JSON Schema 2020-12 checker for the prompt library, limited to the keywords below.
 *
 * checkSchema() rejects every other keyword, so a role file cannot rely on a rule
 * that validate() would skip. $ref only resolves "#" pointers inside the same schema.
 * String lengths count Unicode code points, the same way JSON Schema does.
 */

const ANNOTATION_KEYWORDS = new Set([
  "$schema",
  "$id",
  "$comment",
  "title",
  "description",
  "examples",
  "default",
]);

const ASSERTION_KEYWORDS = new Set([
  "$ref",
  "$defs",
  "type",
  "enum",
  "const",
  "minLength",
  "maxLength",
  "pattern",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "items",
  "minItems",
  "maxItems",
  "uniqueItems",
  "properties",
  "required",
  "additionalProperties",
  "minProperties",
  "maxProperties",
  "oneOf",
  "anyOf",
  "allOf",
]);

const TYPE_NAMES = new Set(["string", "number", "integer", "boolean", "object", "array", "null"]);

const COUNT_KEYWORDS = [
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "minProperties",
  "maxProperties",
];

const NUMBER_KEYWORDS = ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"];

const TYPE_LABELS = {
  string: "字符串",
  number: "数字",
  integer: "整数",
  boolean: "布尔值",
  object: "对象",
  array: "数组",
  null: "null",
};

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

function matchesType(expected, value) {
  const actual = typeOf(value);
  if (expected === actual) return true;
  return expected === "number" && actual === "integer";
}

export function codePointLength(text) {
  return [...text].length;
}

export function deepEqual(left, right) {
  if (left === right) return true;
  if (typeof left !== typeof right || left === null || right === null) return false;
  if (Array.isArray(left)) {
    if (!Array.isArray(right) || left.length !== right.length) return false;
    return left.every((item, index) => deepEqual(item, right[index]));
  }
  if (typeof left !== "object" || Array.isArray(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(
    (key) => Object.prototype.hasOwnProperty.call(right, key) && deepEqual(left[key], right[key]),
  );
}

function escapePointer(token) {
  return String(token).replaceAll("~", "~0").replaceAll("/", "~1");
}

function childPath(path, token) {
  return `${path}/${escapePointer(token)}`;
}

function resolveRef(root, ref) {
  if (typeof ref !== "string" || !ref.startsWith("#")) return undefined;
  if (ref === "#") return root;
  if (!ref.startsWith("#/")) return undefined;
  let node = root;
  for (const raw of ref.slice(2).split("/")) {
    const token = decodeURIComponent(raw).replaceAll("~1", "/").replaceAll("~0", "~");
    if (!isPlainObject(node) || !Object.prototype.hasOwnProperty.call(node, token)) {
      return undefined;
    }
    node = node[token];
  }
  return node;
}

/** Returns a list of problems in the schema itself. An empty list means it is usable. */
export function checkSchema(root) {
  const problems = [];

  function visit(schema, path) {
    if (typeof schema === "boolean") return;
    if (!isPlainObject(schema)) {
      problems.push(`${path}：子结构必须是对象或布尔值`);
      return;
    }
    for (const key of Object.keys(schema)) {
      if (!ANNOTATION_KEYWORDS.has(key) && !ASSERTION_KEYWORDS.has(key)) {
        problems.push(`${path}：不支持的关键字 ${key}`);
      }
    }
    if (schema.type !== undefined) {
      const types = Array.isArray(schema.type) ? schema.type : [schema.type];
      if (types.length === 0 || types.some((name) => !TYPE_NAMES.has(name))) {
        problems.push(`${path}/type：类型名不对`);
      }
    }
    if (schema.$ref !== undefined && resolveRef(root, schema.$ref) === undefined) {
      problems.push(`${path}/$ref：找不到 ${schema.$ref}`);
    }
    if (schema.enum !== undefined && (!Array.isArray(schema.enum) || schema.enum.length === 0)) {
      problems.push(`${path}/enum：必须是非空数组`);
    }
    if (schema.pattern !== undefined) {
      try {
        new RegExp(schema.pattern, "u");
      } catch {
        problems.push(`${path}/pattern：正则写错了`);
      }
    }
    for (const key of COUNT_KEYWORDS) {
      if (schema[key] !== undefined && !(Number.isInteger(schema[key]) && schema[key] >= 0)) {
        problems.push(`${path}/${key}：必须是非负整数`);
      }
    }
    for (const key of NUMBER_KEYWORDS) {
      if (schema[key] !== undefined && typeof schema[key] !== "number") {
        problems.push(`${path}/${key}：必须是数字`);
      }
    }
    if (schema.minItems !== undefined && schema.maxItems !== undefined) {
      if (schema.minItems > schema.maxItems) problems.push(`${path}：minItems 大于 maxItems`);
    }
    if (schema.minLength !== undefined && schema.maxLength !== undefined) {
      if (schema.minLength > schema.maxLength) problems.push(`${path}：minLength 大于 maxLength`);
    }
    if (schema.required !== undefined) {
      if (!Array.isArray(schema.required) || schema.required.some((n) => typeof n !== "string")) {
        problems.push(`${path}/required：必须是字符串数组`);
      } else if (schema.additionalProperties === false) {
        // With additionalProperties false a required name that is not declared can never pass.
        const declared = isPlainObject(schema.properties) ? schema.properties : {};
        for (const name of schema.required) {
          if (!Object.prototype.hasOwnProperty.call(declared, name)) {
            problems.push(`${path}/required：${name} 没有写在 properties 里`);
          }
        }
      }
    }
    if (schema.properties !== undefined) {
      if (!isPlainObject(schema.properties)) problems.push(`${path}/properties：必须是对象`);
      else {
        for (const [name, child] of Object.entries(schema.properties)) {
          visit(child, childPath(`${path}/properties`, name));
        }
      }
    }
    if (schema.$defs !== undefined) {
      if (!isPlainObject(schema.$defs)) problems.push(`${path}/$defs：必须是对象`);
      else {
        for (const [name, child] of Object.entries(schema.$defs)) {
          visit(child, childPath(`${path}/$defs`, name));
        }
      }
    }
    if (schema.items !== undefined) visit(schema.items, `${path}/items`);
    if (schema.additionalProperties !== undefined) {
      visit(schema.additionalProperties, `${path}/additionalProperties`);
    }
    for (const key of ["oneOf", "anyOf", "allOf"]) {
      if (schema[key] === undefined) continue;
      if (!Array.isArray(schema[key]) || schema[key].length === 0) {
        problems.push(`${path}/${key}：必须是非空数组`);
        continue;
      }
      schema[key].forEach((child, index) => visit(child, `${path}/${key}/${index}`));
    }
  }

  visit(root, "#");
  return problems;
}

/** Index of the single oneOf branch whose const-valued property matches the value, or -1. */
function discriminatedBranch(branches, value, root) {
  if (!isPlainObject(value)) return -1;
  const hits = [];
  branches.forEach((branch, index) => {
    const target = branch.$ref !== undefined ? resolveRef(root, branch.$ref) : branch;
    if (!isPlainObject(target) || !isPlainObject(target.properties)) return;
    for (const [name, rule] of Object.entries(target.properties)) {
      if (isPlainObject(rule) && rule.const !== undefined && deepEqual(rule.const, value[name])) {
        hits.push(index);
        return;
      }
    }
  });
  return hits.length === 1 ? hits[0] : -1;
}

function walk(schema, value, path, errors, root) {
  if (schema === true) return;
  if (schema === false) {
    errors.push({ path, message: "这里不允许出现内容" });
    return;
  }
  if (schema.$ref !== undefined) walk(resolveRef(root, schema.$ref), value, path, errors, root);

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((name) => matchesType(name, value))) {
      const wanted = types.map((name) => TYPE_LABELS[name]).join(" 或 ");
      errors.push({ path, message: `应为${wanted}，实际是${TYPE_LABELS[typeOf(value)]}` });
      return;
    }
  }
  if (schema.const !== undefined && !deepEqual(schema.const, value)) {
    errors.push({ path, message: `应为 ${JSON.stringify(schema.const)}` });
  }
  if (schema.enum !== undefined && !schema.enum.some((item) => deepEqual(item, value))) {
    errors.push({
      path,
      message: `只能是 ${schema.enum.map((v) => JSON.stringify(v)).join("、")}`,
    });
  }

  if (typeof value === "string") {
    const length = codePointLength(value);
    if (schema.minLength !== undefined && length < schema.minLength) {
      errors.push({ path, message: `至少 ${schema.minLength} 个字，实际 ${length} 个` });
    }
    if (schema.maxLength !== undefined && length > schema.maxLength) {
      errors.push({ path, message: `最多 ${schema.maxLength} 个字，实际 ${length} 个` });
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, "u").test(value)) {
      errors.push({ path, message: `格式不对，要符合 ${schema.pattern}` });
    }
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push({ path, message: `应不小于 ${schema.minimum}，实际 ${value}` });
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push({ path, message: `应不大于 ${schema.maximum}，实际 ${value}` });
    }
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) {
      errors.push({ path, message: `应大于 ${schema.exclusiveMinimum}，实际 ${value}` });
    }
    if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) {
      errors.push({ path, message: `应小于 ${schema.exclusiveMaximum}，实际 ${value}` });
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push({ path, message: `至少 ${schema.minItems} 项，实际 ${value.length} 项` });
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push({ path, message: `最多 ${schema.maxItems} 项，实际 ${value.length} 项` });
    }
    if (schema.uniqueItems === true) {
      for (let i = 0; i < value.length; i += 1) {
        for (let j = i + 1; j < value.length; j += 1) {
          if (deepEqual(value[i], value[j])) {
            errors.push({ path, message: `第 ${i + 1} 项和第 ${j + 1} 项重复` });
          }
        }
      }
    }
    if (schema.items !== undefined) {
      value.forEach((item, index) =>
        walk(schema.items, item, childPath(path, index), errors, root),
      );
    }
  }

  if (isPlainObject(value)) {
    const names = Object.keys(value);
    if (schema.minProperties !== undefined && names.length < schema.minProperties) {
      errors.push({ path, message: `至少 ${schema.minProperties} 个字段` });
    }
    if (schema.maxProperties !== undefined && names.length > schema.maxProperties) {
      errors.push({ path, message: `最多 ${schema.maxProperties} 个字段` });
    }
    for (const name of schema.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(value, name)) {
        errors.push({ path, message: `缺少字段 ${name}` });
      }
    }
    const declared = isPlainObject(schema.properties) ? schema.properties : {};
    for (const name of names) {
      const target = childPath(path, name);
      if (Object.prototype.hasOwnProperty.call(declared, name)) {
        walk(declared[name], value[name], target, errors, root);
      } else if (schema.additionalProperties === false) {
        errors.push({ path: target, message: `多出了没有定义的字段 ${name}` });
      } else if (schema.additionalProperties !== undefined) {
        walk(schema.additionalProperties, value[name], target, errors, root);
      }
    }
  }

  if (schema.allOf !== undefined) {
    for (const branch of schema.allOf) walk(branch, value, path, errors, root);
  }
  if (schema.anyOf !== undefined) {
    const results = schema.anyOf.map((branch) => {
      const branchErrors = [];
      walk(branch, value, path, branchErrors, root);
      return branchErrors;
    });
    if (!results.some((branchErrors) => branchErrors.length === 0)) {
      errors.push({ path, message: `不符合任何一种允许的结构（共 ${results.length} 种）` });
    }
  }
  if (schema.oneOf !== undefined) {
    const results = schema.oneOf.map((branch) => {
      const branchErrors = [];
      walk(branch, value, path, branchErrors, root);
      return branchErrors;
    });
    const passed = results.filter((branchErrors) => branchErrors.length === 0).length;
    if (passed > 1) {
      errors.push({ path, message: `同时符合 ${passed} 种结构，只能符合一种` });
    } else if (passed === 0) {
      const picked = discriminatedBranch(schema.oneOf, value, root);
      if (picked >= 0) errors.push(...results[picked]);
      else errors.push({ path, message: `不符合任何一种允许的结构（共 ${results.length} 种）` });
    }
  }
}

/**
 * Validates a JSON value. Returns [] when it passes, otherwise { path, message } items.
 * The path is a JSON pointer into the value, for example "/scenes/0/shots/2/seconds".
 */
export function validate(schema, value) {
  const errors = [];
  walk(schema, value, "", errors, schema);
  return errors;
}

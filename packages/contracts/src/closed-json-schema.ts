import { impactCanonical, impactUuid } from "./script-confirmation-impact.js";
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/** Bounded closed DTO validator; unsupported validation keywords fail closed. */
export function validateClosedModel(
  v: unknown,
  name: string,
  definitions: Readonly<Record<string, unknown>>,
  maxBytes = 16 * 1024 * 1024,
): boolean {
  let remaining = 1_000_000;
  const metadata = new Set(["title", "description", "default", "discriminator"]);
  const supported = new Set([
    "$ref",
    "anyOf",
    "oneOf",
    "type",
    "const",
    "enum",
    "properties",
    "required",
    "additionalProperties",
    "items",
    "minItems",
    "maxItems",
    "minLength",
    "maxLength",
    "pattern",
    "format",
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
  ]);
  function visit(value: unknown, schema: unknown, depth: number): boolean {
    if (--remaining < 0 || depth > 80 || !record(schema)) return false;
    if (Object.keys(schema).some((k) => !metadata.has(k) && !supported.has(k))) return false;
    if (typeof schema.$ref === "string") {
      if (!schema.$ref.startsWith("#/$defs/")) return false;
      return visit(value, definitions[schema.$ref.slice(8)], depth + 1);
    }
    for (const union of ["anyOf", "oneOf"] as const) {
      if (Array.isArray(schema[union])) {
        const valid = schema[union].filter((s) => visit(value, s, depth + 1)).length;
        return union === "oneOf" ? valid === 1 : valid >= 1;
      }
    }
    if ("const" in schema && value !== schema.const) return false;
    if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return false;
    if (schema.type === "null") return value === null;
    if (schema.type === "boolean") return typeof value === "boolean";
    if (schema.type === "string") {
      if (typeof value !== "string" || /\p{Surrogate}/u.test(value)) return false;
      const length = [...value].length;
      if (typeof schema.minLength === "number" && length < schema.minLength) return false;
      if (typeof schema.maxLength === "number" && length > schema.maxLength) return false;
      if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value))
        return false;
      if (schema.format === "uuid" && !impactUuid(value)) return false;
      if (
        schema.format === "date-time" &&
        (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value) ||
          !Number.isFinite(Date.parse(value)))
      )
        return false;
      if (schema.format !== undefined && schema.format !== "uuid" && schema.format !== "date-time")
        return false;
      return true;
    }
    if (schema.type === "integer" || schema.type === "number") {
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        (schema.type === "integer" && !Number.isSafeInteger(value))
      )
        return false;
      return !(
        (typeof schema.minimum === "number" && value < schema.minimum) ||
        (typeof schema.maximum === "number" && value > schema.maximum) ||
        (typeof schema.exclusiveMinimum === "number" && value <= schema.exclusiveMinimum) ||
        (typeof schema.exclusiveMaximum === "number" && value >= schema.exclusiveMaximum)
      );
    }
    if (schema.type === "array")
      return (
        Array.isArray(value) &&
        !(typeof schema.minItems === "number" && value.length < schema.minItems) &&
        !(typeof schema.maxItems === "number" && value.length > schema.maxItems) &&
        value.every((item) => visit(item, schema.items, depth + 1))
      );
    if (schema.type === "object") {
      if (
        !record(value) ||
        (schema.properties !== undefined && !record(schema.properties)) ||
        (schema.additionalProperties !== false && !record(schema.additionalProperties))
      )
        return false;
      const props = record(schema.properties) ? schema.properties : {};
      return (
        (!Array.isArray(schema.required) ||
          schema.required.every((k) => typeof k === "string" && Object.hasOwn(value, k))) &&
        Object.keys(value).every(
          (k) =>
            !/\p{Surrogate}/u.test(k) &&
            (Object.hasOwn(props, k)
              ? visit(value[k], props[k], depth + 1)
              : record(schema.additionalProperties) &&
                visit(value[k], schema.additionalProperties, depth + 1)),
        )
      );
    }
    return false;
  }
  try {
    return (
      new TextEncoder().encode(impactCanonical(v)).byteLength <= maxBytes &&
      visit(v, definitions[name], 0)
    );
  } catch {
    return false;
  }
}

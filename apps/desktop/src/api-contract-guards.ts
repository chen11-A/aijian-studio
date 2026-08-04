export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function isIdArray(value: unknown, pattern: RegExp): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string" && pattern.test(item))
  );
}

export function isNullableId(value: unknown, pattern: RegExp): boolean {
  return value === null || (typeof value === "string" && pattern.test(value));
}

export function isNullableString(value: unknown): boolean {
  return value === null || typeof value === "string";
}

export function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127;
  });
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function hasRequestId(value: Record<string, unknown>): boolean {
  return typeof value.request_id === "string" && UUID_PATTERN.test(value.request_id);
}

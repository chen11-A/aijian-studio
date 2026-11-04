/**
 * Arrow keys move the choice in a radio group and wrap at the ends. Returns null for any
 * other key, so the caller can leave the event alone.
 */
export function stepChoice<T>(items: readonly T[], current: T, key: string): T | null {
  const forward = key === "ArrowRight" || key === "ArrowDown";
  const back = key === "ArrowLeft" || key === "ArrowUp";
  if ((!forward && !back) || items.length === 0) return null;
  const index = items.indexOf(current);
  if (index < 0) return items[0] ?? null;
  const next = (index + (forward ? 1 : -1) + items.length) % items.length;
  return items[next] ?? null;
}

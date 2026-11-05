/** One line of what is there now or of what the assistant suggests: a shot or a scene. */
export type SuggestionItem = {
  id: string;
  /** The words that are compared: the shot's picture, or the scene's place and title. */
  text: string;
  /** Who is in it, shown before the text. */
  who?: string;
  /** Shown at the end of the line, like 「3s」. */
  tail?: string;
};

/** How one suggested line differs from what is there now. */
export type SuggestionRow =
  | { kind: "same"; item: SuggestionItem }
  | { kind: "changed"; item: SuggestionItem; before: SuggestionItem }
  | { kind: "added"; item: SuggestionItem }
  | { kind: "removed"; item: SuggestionItem };

export type SuggestionCounts = { added: number; changed: number; removed: number };

const keyOf = (item: SuggestionItem) =>
  `${item.who ?? ""}\u0000${item.text.replace(/\s+/g, " ").trim()}\u0000${item.tail ?? ""}`;

/** Pairs of characters in the words, without spaces or punctuation. */
function pairsOf(text: string): string[] {
  const plain = text.replace(/[\s\p{P}]+/gu, "");
  if (plain.length < 2) return plain ? [plain] : [];
  return Array.from({ length: plain.length - 1 }, (_, index) => plain.slice(index, index + 2));
}

/** How alike two lines read, 0 to 1 (Dice over character pairs), a little more for the same person. */
function alike(a: SuggestionItem, b: SuggestionItem): number {
  const left = pairsOf(a.text);
  const right = pairsOf(b.text);
  if (left.length === 0 || right.length === 0) return 0;
  const pool = new Map<string, number>();
  for (const pair of left) pool.set(pair, (pool.get(pair) ?? 0) + 1);
  let shared = 0;
  for (const pair of right) {
    const spare = pool.get(pair) ?? 0;
    if (spare > 0) {
      shared += 1;
      pool.set(pair, spare - 1);
    }
  }
  const words = (2 * shared) / (left.length + right.length);
  return words + (a.who && a.who === b.who ? 0.1 : 0);
}

/** Below this, a now-line and a suggested line are different lines, not one line changed. */
const ALIKE = 0.3;

/**
 * 4A-U11: what the assistant's suggestion changes, line by line, until GPT's 4A-B11 ④ hands
 * over its own diff. Lines with the same words keep their place (the longest run in order).
 * Between two such lines, a now-line and a suggested line that read alike count as changed
 * (the pairing that keeps the order and is most alike overall); the other now-lines are
 * removed and the other suggested lines added.
 */
export function suggestionDiff(
  current: readonly SuggestionItem[],
  proposed: readonly SuggestionItem[],
): SuggestionRow[] {
  const a = current.map(keyOf);
  const b = proposed.map(keyOf);
  // lcs[i][j]: the longest run of equal lines in a[i..] and b[j..].
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i]![j] =
        a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const rows: SuggestionRow[] = [];
  let gapA: SuggestionItem[] = [];
  let gapB: SuggestionItem[] = [];
  const flush = () => {
    const n = gapA.length;
    const m = gapB.length;
    const score = (x: number, y: number) => {
      const value = alike(gapA[x]!, gapB[y]!);
      return value >= ALIKE ? value : -1;
    };
    // best[x][y]: the most alike pairing of gapA[x..] with gapB[y..].
    const best = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
    for (let x = n - 1; x >= 0; x -= 1) {
      for (let y = m - 1; y >= 0; y -= 1) {
        const pair = score(x, y);
        best[x]![y] = Math.max(
          best[x + 1]![y]!,
          best[x]![y + 1]!,
          pair >= 0 ? pair + best[x + 1]![y + 1]! : 0,
        );
      }
    }
    let x = 0;
    let y = 0;
    while (x < n || y < m) {
      const pair = x < n && y < m ? score(x, y) : -1;
      if (pair >= 0 && best[x]![y] === pair + best[x + 1]![y + 1]!) {
        rows.push({ kind: "changed", item: gapB[y]!, before: gapA[x]! });
        x += 1;
        y += 1;
      } else if (x < n && (y >= m || best[x]![y] === best[x + 1]![y])) {
        rows.push({ kind: "removed", item: gapA[x]! });
        x += 1;
      } else {
        rows.push({ kind: "added", item: gapB[y]! });
        y += 1;
      }
    }
    gapA = [];
    gapB = [];
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      flush();
      rows.push({ kind: "same", item: proposed[j]! });
      i += 1;
      j += 1;
    } else if (j < b.length && (i >= a.length || lcs[i]![j + 1]! >= lcs[i + 1]![j]!)) {
      gapB.push(proposed[j]!);
      j += 1;
    } else {
      gapA.push(current[i]!);
      i += 1;
    }
  }
  flush();
  return rows;
}

export function suggestionCounts(rows: readonly SuggestionRow[]): SuggestionCounts {
  const counts: SuggestionCounts = { added: 0, changed: 0, removed: 0 };
  for (const row of rows) if (row.kind !== "same") counts[row.kind] += 1;
  return counts;
}

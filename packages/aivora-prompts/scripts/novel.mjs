/**
 * Reads fixtures/test-novel.md. Each "## " heading starts a chapter, numbered CH1, CH2, ...
 * in file order. Each "[P01] text" line is one paragraph of the current chapter.
 */
export function parseNovel(markdown) {
  const chapters = [];
  const seen = new Set();
  for (const raw of markdown.split(/\r?\n/u)) {
    const line = raw.trim();
    if (line.startsWith("## ")) {
      chapters.push({
        id: `CH${chapters.length + 1}`,
        title: line.slice(3).trim(),
        paragraphs: [],
      });
      continue;
    }
    const match = /^\[(P[0-9]{2})\] (.+)$/u.exec(line);
    if (!match) continue;
    if (chapters.length === 0) throw new Error(`段落 ${match[1]} 出现在第一章标题之前`);
    if (seen.has(match[1])) throw new Error(`段落编号 ${match[1]} 重复`);
    seen.add(match[1]);
    chapters[chapters.length - 1].paragraphs.push({ id: match[1], text: match[2] });
  }
  return chapters;
}

/** Spoken lines of a paragraph: the text inside each pair of Chinese double quotes, in order. */
export function quotedLines(text) {
  return [...text.matchAll(/“([^”]*)”/gu)].map((match) => match[1]);
}

/** Characters that take speaking time. Punctuation and spaces are not counted. */
export function spokenLength(line) {
  return [...line].filter((ch) => /[\p{L}\p{N}]/u.test(ch)).length;
}

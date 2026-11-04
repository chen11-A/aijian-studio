/**
 * Reads fixtures/test-novel-2000.txt. Every non-empty line is one paragraph, numbered P01, P02, ...
 * in file order; scene headings such as 「第一场 雨夜旧书店」 are paragraphs too and start
 * scene-1, scene-2, ... A heading may use a normal or a full-width space before the title.
 */
const SCENE_HEADING = /^第([一二三四五六七八九十百零〇两0-9０-９]+)场[\s\u3000]+(\S.*)$/u;

export function parseNovel(text) {
  const paragraphs = [];
  const scenes = [];
  for (const raw of text.replace(/^\uFEFF/u, "").split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line) continue;
    const id = `P${String(paragraphs.length + 1).padStart(2, "0")}`;
    const heading = SCENE_HEADING.exec(line);
    if (heading) {
      scenes.push({
        id: `scene-${scenes.length + 1}`,
        no: scenes.length + 1,
        title: heading[2].trim(),
        paragraphs: [],
      });
    }
    if (scenes.length === 0) throw new Error(`段落 ${id} 出现在第一个场次标题之前`);
    const paragraph = { id, text: line, heading: Boolean(heading) };
    paragraphs.push(paragraph);
    scenes[scenes.length - 1].paragraphs.push(paragraph);
  }
  return { paragraphs, scenes };
}

/** Text inside each pair of Chinese double quotes, in order. Not every quote is dialogue. */
export function quotedLines(text) {
  return [...text.matchAll(/“([^”]*)”/gu)].map((match) => match[1]);
}

/** Characters that take speaking time. Punctuation and spaces are not counted. */
export function spokenLength(line) {
  return [...line].filter((ch) => /[\p{L}\p{N}]/u.test(ch)).length;
}

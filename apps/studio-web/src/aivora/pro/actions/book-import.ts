import { extractBookText, splitNovel } from "../../film/operations";
import type { FilmProject, FilmScene } from "../../film/project";

export type BookImportFile = { name: string; arrayBuffer: () => Promise<ArrayBuffer> };
export type BookImportInput = { sourceVersion: string };
export type BookImportProposal = {
  kind: "proposal";
  sourceText: string;
  scenes: FilmScene[];
  notice: string;
};
export type BookImportResult = BookImportProposal | { kind: "notice"; notice: string };

/** Capture only the source and scene fields an import draft could supersede. */
export function captureBookImportInput(film: FilmProject | null): BookImportInput {
  return {
    sourceVersion: JSON.stringify(
      film
        ? {
            id: film.id,
            sourceText: film.sourceText ?? "",
            scenes: film.scenes.map(
              ({ id, no, title, where, text, userFields, paragraphCoverage }) => ({
                id,
                no,
                title,
                where,
                text,
                userFields,
                paragraphCoverage,
              }),
            ),
          }
        : null,
    ),
  };
}
export function bookImportInputUnchanged(
  input: BookImportInput,
  current: FilmProject | null,
): boolean {
  return input.sourceVersion === captureBookImportInput(current).sourceVersion;
}

/** Read/extraction failures stay failures. The full extracted text and splitter risks survive unchanged. */
export async function prepareBookImport(file: BookImportFile): Promise<BookImportResult> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const book = await extractBookText(file.name, bytes);
  if (!book.text.trim()) return { kind: "notice", notice: book.note };
  const split = splitNovel(book.text);
  if (!split.scenes.length) return { kind: "notice", notice: split.note || "没有读到场次。" };
  return {
    kind: "proposal",
    sourceText: book.text,
    scenes: split.scenes,
    notice: `${book.note}${split.note} 读到 ${split.scenes.length} 场。点「放进剧本」才会放进去。`,
  };
}

/** Apply source only; the user must still confirm the scene proposal. Unrelated live changes survive. */
export function applyBookImportSource(
  input: BookImportInput,
  proposal: BookImportProposal,
  current: FilmProject | null,
): { kind: "applied"; film: FilmProject | null } | { kind: "stale" } {
  if (!bookImportInputUnchanged(input, current)) return { kind: "stale" };
  return {
    kind: "applied",
    film: current ? { ...current, sourceText: proposal.sourceText } : null,
  };
}

import type { FilmProject } from "./project";

export const STYLE_BIBLE_TOO_LONG_NOTICE = {
  code: "STYLE_BIBLE_TOO_LONG",
  text: "画风说明太长，请精简后再生成。",
} as const;

export const MEDIA_DESCRIPTION_TOO_LONG_NOTICE = {
  code: "MEDIA_DESCRIPTION_TOO_LONG",
  text: "画面描述太长，请精简后再生成。",
} as const;

export function styleFailureNotice(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  return code === "STYLE_BIBLE_TOO_LONG"
    ? STYLE_BIBLE_TOO_LONG_NOTICE
    : code === "MEDIA_DESCRIPTION_TOO_LONG"
      ? MEDIA_DESCRIPTION_TOO_LONG_NOTICE
      : null;
}

/** styleZh is the existing persisted art prompt_block_zh, kept verbatim. */
export function withStyleBible(prompt: string, style: string, limit?: number): string {
  // Idempotent across builders and the final request boundary. Do not normalize the style.
  const body = prompt.replace(/(?:^|\n)【画风说明】\n[\s\S]*?\n【画风说明结束】(?=\n|$)/g, "");
  const description = style.trim()
    ? `${body}${body ? "\n" : ""}【画风说明】\n${style}\n【画风说明结束】`
    : body;
  if (limit !== undefined && style.trim() && style.length > limit)
    throw Object.assign(new Error(STYLE_BIBLE_TOO_LONG_NOTICE.text), STYLE_BIBLE_TOO_LONG_NOTICE);
  if (limit !== undefined && description.length > limit)
    throw Object.assign(
      new Error(MEDIA_DESCRIPTION_TOO_LONG_NOTICE.text),
      MEDIA_DESCRIPTION_TOO_LONG_NOTICE,
    );
  return description;
}

export function setFilmStyle(film: FilmProject, styleZh: string): FilmProject {
  if (film.styleZh === styleZh) return film;
  const revision = (film.styleRevision ?? 0) + 1;
  return {
    ...film,
    styleZh,
    styleRevision: revision,
    shots: film.shots.map((shot) => ({
      ...shot,
      regenerationRequired: { code: "STYLE_CHANGED" as const, styleRevision: revision },
    })),
  };
}

/** Safe audit data: no source, full style, or prompt text. */
export async function styleRequestMetadata(film: Pick<FilmProject, "styleZh" | "styleRevision">) {
  const bytes = new TextEncoder().encode(film.styleZh);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return {
    styleRevision: film.styleRevision ?? 0,
    styleCharacters: Array.from(film.styleZh).length,
    styleSha256: Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join(""),
  };
}

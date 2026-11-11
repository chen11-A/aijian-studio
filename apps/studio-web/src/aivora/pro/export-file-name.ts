const ILLEGAL = new Set(["\\", "/", ":", "*", "?", '"', "<", ">", "|"]);

/** Empty or illegal names cannot be exported. The check does not rewrite the text. */
export function exportFileIssue(name: string): string {
  if (!name.trim()) return "文件名还没写";
  for (const character of name) {
    if (character.charCodeAt(0) < 32 || ILLEGAL.has(character))
      return "文件名里有不能用于文件的字符";
  }
  return "";
}

export function writtenFileName(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

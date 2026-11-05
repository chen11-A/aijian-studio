import { createHash } from "node:crypto";

export type StyleDiagnostics = { styleCharacters: number; styleSha256?: string };

/** Digest only the dedicated style block of the actual request, never its story text. */
export function styleDiagnostics(prompt: string): StyleDiagnostics {
  const blocks = [
    ...prompt.matchAll(/(?:^|\n)【画风说明】\n([\s\S]*?)\n【画风说明结束】(?=\n|$)/g),
  ];
  if (blocks.length !== 1) return { styleCharacters: 0 };
  const style = blocks[0]![1]!;
  return {
    styleCharacters: Array.from(style).length,
    styleSha256: createHash("sha256").update(style, "utf8").digest("hex"),
  };
}

/** Header identity. A missing photo becomes a letter, never a broken image. */

export function accountMonogram(name: string): string {
  const trimmed = name.trim();
  const char = [...trimmed][0];
  if (!char) return "用";
  return /[a-z]/i.test(char) ? char.toUpperCase() : char;
}

export function shortAccountLabel(name: string): string {
  const trimmed = name.trim();
  const at = trimmed.indexOf("@");
  const local = at > 0 ? trimmed.slice(0, at) : trimmed;
  const chars = [...local];
  if (chars.length <= 18) return local || "本地用户";
  return `${chars.slice(0, 18).join("")}…`;
}

export function signedInLabel(input: {
  grokSignedIn: boolean;
  grokLabel: string | null;
  chatgptSignedIn: boolean;
  chatgptLabel: string | null;
  localName: string;
}): string {
  const grok = input.grokLabel?.trim() ?? "";
  const chatgpt = input.chatgptLabel?.trim() ?? "";
  if (input.grokSignedIn && grok) return grok;
  if (input.chatgptSignedIn && chatgpt) return chatgpt;
  const local = input.localName.trim();
  return local || "本地用户";
}

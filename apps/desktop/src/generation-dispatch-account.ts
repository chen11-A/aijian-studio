import { createHash, createHmac } from "node:crypto";

/** Main-only fresh-session pair. Never accepted from a renderer request. */
export type GenerationDispatchAccount = { bearer: string; accountSha256: string };
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export function stableGenerationAccount(subject: string, endpoint: string): string | null {
  if (
    !subject ||
    subject.trim().toLowerCase() === "unknown" ||
    !subject.trim() ||
    subject.length > 1024 ||
    Array.from(subject).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    return null;
  let origin: string;
  try {
    const url = new URL(endpoint);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    origin = url.origin;
  } catch {
    return null;
  }
  // Token, connection revision, scopes and equivalent API paths do not mint a new account.
  return digest(JSON.stringify(["aivora-grok-account-v1", origin, subject]));
}

export function attestGenerationAccount(input: {
  sessionKey: string;
  projectId: string;
  idempotencyKey: string;
  body: string;
  account: GenerationDispatchAccount;
  now?: number;
  preparedArmId?: string;
}): string {
  if (!/^[0-9a-f]{64}$/.test(input.account.accountSha256))
    throw new Error("Generation account unavailable");
  if (input.preparedArmId !== undefined && !/^[a-f0-9]{32}$/.test(input.preparedArmId))
    throw new Error("Generation context unavailable");
  const expires = Math.floor((input.now ?? Date.now()) / 1000) + 60;
  const message = [
    input.preparedArmId ? "aivora-video-account-v2" : "aivora-video-account-v1",
    input.projectId,
    input.idempotencyKey,
    digest(input.body),
    digest(input.account.bearer),
    input.account.accountSha256,
    String(expires),
    ...(input.preparedArmId ? [input.preparedArmId] : []),
  ].join("\n");
  const signature = createHmac("sha256", input.sessionKey).update(message).digest("hex");
  return Buffer.from(
    JSON.stringify({ account: input.account.accountSha256, expires, signature }),
  ).toString("base64url");
}

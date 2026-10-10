import { createPublicKey, verify } from "node:crypto";
import type { ChatGPTModel } from "@aijian/contracts/chatgpt-auth";
import {
  ChatGPTError,
  ISSUER,
  RESOURCE,
  TOKEN,
  equalSecret,
  isRecord,
  safeString,
} from "./chatgpt-auth-oauth";

export type Fetch = typeof globalThis.fetch;
export type Identity = { issuer: string; subject: string; email: string | null };
export type Tokens = {
  accessToken: string | null;
  refreshToken: string | null;
  idToken: string;
  scopes: string[];
  expiresAt: number;
  identity: Identity;
};
const DISCOVERY = `${ISSUER}/.well-known/openid-configuration`;
const MAX_JSON = 512 * 1024;
export async function boundedText(response: Response, limit = MAX_JSON): Promise<string> {
  if (!response.body || Number(response.headers.get("content-length") ?? 0) > limit)
    throw new ChatGPTError("RESPONSE_INVALID");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "";
  let bytes = 0;
  try {
    while (true) {
      const value = await reader.read();
      if (value.done) return text + decoder.decode();
      bytes += value.value.byteLength;
      if (bytes > limit) throw new ChatGPTError("RESPONSE_TOO_LARGE");
      text += decoder.decode(value.value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
export async function readJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    const code =
      response.status === 401
        ? "REAUTH_REQUIRED"
        : response.status === 429
          ? "USAGE_LIMIT"
          : "OPENAI_REQUEST_FAILED";
    // Never log the URL, headers, response body, credentials or account identity.
    console.warn("[chatgpt-http]", { status: response.status, code });
    throw new ChatGPTError(code);
  }
  if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
    throw new ChatGPTError("RESPONSE_INVALID");
  try {
    return JSON.parse(await boundedText(response));
  } catch (error) {
    if (error instanceof ChatGPTError) throw error;
    throw new ChatGPTError("RESPONSE_INVALID");
  }
}
function officialAuthUrl(value: unknown): string {
  if (!safeString(value, 500)) throw new ChatGPTError("DISCOVERY_INVALID");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ChatGPTError("DISCOVERY_INVALID");
  }
  if (url.origin !== ISSUER || url.username || url.password || url.hash || url.search)
    throw new ChatGPTError("DISCOVERY_INVALID");
  return url.href;
}
export async function discover(fetcher: Fetch, signal: AbortSignal) {
  const data = await readJson(
    await fetcher(DISCOVERY, {
      signal,
      redirect: "error",
      headers: { Accept: "application/json" },
    }),
  );
  if (
    !isRecord(data) ||
    data.issuer !== ISSUER ||
    data.authorization_endpoint !== `${ISSUER}/api/accounts/authorize` ||
    data.token_endpoint !== TOKEN
  )
    throw new ChatGPTError("DISCOVERY_INVALID");
  return {
    jwks: officialAuthUrl(data.jwks_uri),
    revocation: officialAuthUrl(data.revocation_endpoint),
  };
}
function jwtPart(part: string): Record<string, unknown> {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) throw new ChatGPTError("IDENTITY_INVALID");
  try {
    const value: unknown = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    if (isRecord(value)) return value;
  } catch {
    /* Never expose token parse errors. */
  }
  throw new ChatGPTError("IDENTITY_INVALID");
}
/** Strict RS256 allowlist; unsupported issuer algorithms fail closed instead of weakening verification. */
export async function verifyIdentity(
  token: string,
  clientId: string,
  nonce: string | null,
  fetcher: Fetch,
  signal: AbortSignal,
  now = Date.now(),
): Promise<Identity> {
  if (token.length > 32_768) throw new ChatGPTError("IDENTITY_INVALID");
  const parts = token.split(".");
  if (parts.length !== 3) throw new ChatGPTError("IDENTITY_INVALID");
  const [head = "", body = "", signature = ""] = parts;
  const header = jwtPart(head);
  const claims = jwtPart(body);
  if (
    header.alg !== "RS256" ||
    !safeString(header.kid) ||
    header.crit !== undefined ||
    header.jku !== undefined ||
    header.jwk !== undefined ||
    header.x5u !== undefined ||
    !/^[A-Za-z0-9_-]+$/.test(signature)
  )
    throw new ChatGPTError("IDENTITY_INVALID");
  const config = await discover(fetcher, signal);
  const jwks = await readJson(
    await fetcher(config.jwks, {
      signal,
      redirect: "error",
      headers: { Accept: "application/json" },
    }),
  );
  if (!isRecord(jwks) || !Array.isArray(jwks.keys)) throw new ChatGPTError("IDENTITY_INVALID");
  const keys = jwks.keys.filter(
    (key): key is Record<string, unknown> => isRecord(key) && key.kid === header.kid,
  );
  const key = keys[0];
  if (
    keys.length !== 1 ||
    !key ||
    key.kty !== "RSA" ||
    (key.alg !== undefined && key.alg !== "RS256") ||
    (key.use !== undefined && key.use !== "sig") ||
    !safeString(key.n, 4096) ||
    !safeString(key.e, 20)
  )
    throw new ChatGPTError("IDENTITY_INVALID");
  try {
    const publicKey = createPublicKey({ key: { kty: "RSA", n: key.n, e: key.e }, format: "jwk" });
    if (
      (publicKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048 ||
      !verify(
        "RSA-SHA256",
        Buffer.from(`${head}.${body}`),
        publicKey,
        Buffer.from(signature, "base64url"),
      )
    )
      throw new Error("invalid");
  } catch {
    throw new ChatGPTError("IDENTITY_INVALID");
  }
  const audience = claims.aud;
  const seconds = now / 1000;
  if (
    claims.iss !== ISSUER ||
    !(
      audience === clientId ||
      (Array.isArray(audience) &&
        audience.length > 0 &&
        audience.every((item) => typeof item === "string") &&
        audience.includes(clientId))
    ) ||
    (Array.isArray(audience) && audience.length > 1 && claims.azp !== clientId) ||
    (claims.azp !== undefined && claims.azp !== clientId) ||
    typeof claims.exp !== "number" ||
    !Number.isFinite(claims.exp) ||
    claims.exp <= seconds - 5 ||
    typeof claims.iat !== "number" ||
    !Number.isFinite(claims.iat) ||
    claims.iat > seconds + 5 ||
    (claims.nbf !== undefined &&
      (typeof claims.nbf !== "number" ||
        !Number.isFinite(claims.nbf) ||
        claims.nbf > seconds + 5)) ||
    !safeString(claims.sub, 500) ||
    (nonce !== null && (typeof claims.nonce !== "string" || !equalSecret(claims.nonce, nonce)))
  )
    throw new ChatGPTError("IDENTITY_INVALID");
  return {
    issuer: ISSUER,
    subject: claims.sub,
    email: safeString(claims.email, 254) ? claims.email : null,
  };
}
export async function requestTokens(
  form: URLSearchParams,
  fetcher: Fetch,
  signal: AbortSignal,
  expected: { clientId: string; nonce: string | null; previous?: Tokens },
  now = Date.now(),
): Promise<Tokens> {
  const value = await readJson(
    await fetcher(TOKEN, {
      method: "POST",
      body: form,
      redirect: "error",
      signal,
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    }),
  );
  if (
    !isRecord(value) ||
    (value.access_token !== undefined &&
      (!safeString(value.access_token, 32_768) ||
        value.token_type !== "Bearer" ||
        typeof value.expires_in !== "number" ||
        !Number.isSafeInteger(value.expires_in) ||
        value.expires_in <= 0 ||
        value.expires_in > 31_536_000)) ||
    typeof value.scope !== "string"
  )
    throw new ChatGPTError("TOKEN_RESPONSE_INVALID");
  const idToken = safeString(value.id_token, 32_768) ? value.id_token : expected.previous?.idToken;
  if (!idToken) throw new ChatGPTError("IDENTITY_INVALID");
  const identity =
    value.id_token === undefined && expected.previous
      ? expected.previous.identity
      : await verifyIdentity(idToken, expected.clientId, expected.nonce, fetcher, signal, now);
  if (
    expected.previous &&
    (identity.issuer !== expected.previous.identity.issuer ||
      identity.subject !== expected.previous.identity.subject)
  )
    throw new ChatGPTError("ACCOUNT_MISMATCH");
  const refreshToken =
    value.refresh_token === undefined
      ? (expected.previous?.refreshToken ?? null)
      : safeString(value.refresh_token, 32_768)
        ? value.refresh_token
        : null;
  if (value.refresh_token !== undefined && refreshToken === null)
    throw new ChatGPTError("TOKEN_RESPONSE_INVALID");
  return {
    accessToken: typeof value.access_token === "string" ? value.access_token : null,
    refreshToken,
    idToken,
    identity,
    scopes: value.scope.split(/\s+/).filter(Boolean),
    expiresAt: typeof value.expires_in === "number" ? now + value.expires_in * 1000 : 0,
  };
}
export async function listModels(
  token: string,
  fetcher: Fetch,
  signal: AbortSignal,
): Promise<ChatGPTModel[]> {
  const value = await readJson(
    await fetcher(`${RESOURCE}/models`, {
      signal,
      redirect: "error",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    }),
  );
  if (!isRecord(value) || !Array.isArray(value.models) || value.models.length > 1000)
    throw new ChatGPTError("MODEL_CATALOG_INVALID");
  const models: ChatGPTModel[] = [];
  for (const model of value.models) {
    if (!isRecord(model) || model.visibility !== "list") continue;
    if (
      !safeString(model.slug, 128) ||
      !safeString(model.display_name, 200) ||
      models.some((item) => item.slug === model.slug)
    )
      throw new ChatGPTError("MODEL_CATALOG_INVALID");
    models.push({ slug: model.slug, displayName: model.display_name });
  }
  return models;
}

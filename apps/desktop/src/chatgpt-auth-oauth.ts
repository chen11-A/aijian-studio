import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const ISSUER = "https://auth.openai.com";
export const RESOURCE = "https://api.openai.com/v1";
export const AUTHORIZE = `${ISSUER}/api/accounts/authorize`;
export const TOKEN = `${ISSUER}/api/accounts/oauth/token`;
export const SCOPES =
  "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
export const DYNAMIC_CLIENT = "dynamic_agent_client";
export const CALLBACK_PATH = "/auth/callback";
export const AUTH_TTL = 10 * 60 * 1000;
export class ChatGPTError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function safeString(value: unknown, max = 200): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    [...value].every((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 32 && code !== 127;
    })
  );
}
export function issuedClient(value: unknown): value is string {
  return safeString(value) && value !== DYNAMIC_CLIENT && /^[a-zA-Z0-9_-]+$/.test(value);
}
export function equalSecret(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export type AuthorizationAttempt = {
  url: string;
  consume(callback: string): {
    code: string;
    clientId: string;
    verifier: string;
    nonce: string;
    redirectUri: string;
  };
  cancel(): void;
};
/** Main process only. Constructing this value performs no network, persistence or grant. */
export function createAuthorizationAttempt(
  input: {
    hostId: string;
    redirectUri: string;
    clientId?: string;
    idTokenHint?: string;
  },
  now: () => number = Date.now,
): AuthorizationAttempt {
  if (
    !/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      input.hostId,
    )
  ) {
    throw new ChatGPTError("INVALID_HOST_ID");
  }
  if (!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}\/auth\/callback$/.test(input.redirectUri)) {
    throw new ChatGPTError("INVALID_CALLBACK_URI");
  }
  let redirect: URL;
  try {
    redirect = new URL(input.redirectUri);
  } catch {
    throw new ChatGPTError("INVALID_CALLBACK_URI");
  }
  if (redirect.href !== input.redirectUri || !redirect.port)
    throw new ChatGPTError("INVALID_CALLBACK_URI");
  if (input.clientId !== undefined && !issuedClient(input.clientId))
    throw new ChatGPTError("INVALID_CLIENT_ID");
  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const verifier = randomBytes(64).toString("base64url");
  const expires = now() + AUTH_TTL;
  let consumed = false;
  const url = new URL(AUTHORIZE);
  url.search = new URLSearchParams({
    client_id: input.clientId ?? DYNAMIC_CLIENT,
    ...(input.clientId ? {} : { agent_name_hint: "AIVORA" }),
    ext_agent_host_id: input.hostId,
    response_type: "code",
    redirect_uri: input.redirectUri,
    scope: SCOPES,
    resource: RESOURCE,
    state,
    nonce,
    code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    ...(input.clientId && input.idTokenHint ? { id_token_hint: input.idTokenHint } : {}),
  }).toString();
  return {
    url: url.href,
    cancel() {
      consumed = true;
    },
    consume(raw) {
      if (consumed || now() >= expires) throw new ChatGPTError("AUTH_ATTEMPT_EXPIRED");
      let callback: URL;
      try {
        callback = new URL(raw);
      } catch {
        throw new ChatGPTError("CALLBACK_REJECTED");
      }
      if (
        callback.origin !== redirect.origin ||
        callback.pathname !== redirect.pathname ||
        callback.hash ||
        callback.username ||
        callback.password
      ) {
        throw new ChatGPTError("CALLBACK_REJECTED");
      }
      for (const name of ["state", "code", "client_id", "error", "scope"]) {
        if (callback.searchParams.getAll(name).length > 1)
          throw new ChatGPTError("CALLBACK_REJECTED");
      }
      if (!equalSecret(callback.searchParams.get("state") ?? "", state))
        throw new ChatGPTError("AUTH_STATE_MISMATCH");
      consumed = true;
      if (callback.searchParams.has("error")) {
        throw new ChatGPTError(
          callback.searchParams.get("error") === "access_denied" ? "AUTH_DENIED" : "AUTH_FAILED",
        );
      }
      const clientId = callback.searchParams.get("client_id") ?? input.clientId;
      if (!issuedClient(clientId) || (input.clientId && input.clientId !== clientId))
        throw new ChatGPTError("REGISTRATION_MISMATCH");
      const code = callback.searchParams.get("code");
      if (!safeString(code, 4096)) throw new ChatGPTError("AUTH_CODE_MISSING");
      return { code, clientId, verifier, nonce, redirectUri: input.redirectUri };
    },
  };
}

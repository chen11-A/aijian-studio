import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Public OAuth endpoints from https://auth.x.ai/.well-known/openid-configuration
 * (authorization code + PKCE S256, device code, refresh, public clients).
 * The client id is the public Grok CLI client used by `grok login`, not a
 * scraped session. Loopback port 56121 matches that client's registered callback.
 */
export const GROK_ISSUER = "https://auth.x.ai";
export const GROK_AUTHORIZE = `${GROK_ISSUER}/oauth2/authorize`;
export const GROK_TOKEN = `${GROK_ISSUER}/oauth2/token`;
export const GROK_REVOKE = `${GROK_ISSUER}/oauth2/revoke`;
export const GROK_USERINFO = `${GROK_ISSUER}/oauth2/userinfo`;
export const GROK_API = "https://api.x.ai/v1";
export const GROK_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
export const GROK_SCOPE = "openid profile email offline_access grok-cli:access api:access";
export const GROK_LOOPBACK_PORT = 56121;
export const GROK_CALLBACK_PATH = "/callback";
export const GROK_AUTH_TTL = 10 * 60 * 1000;

export class GrokAuthError extends Error {
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

export function equalSecret(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export type GrokAuthorizationAttempt = {
  url: string;
  verifier: string;
  redirectUri: string;
  consume(callback: string): { code: string };
  cancel(): void;
};

export function createGrokAuthorizationAttempt(
  input: { redirectUri: string; authorizeEndpoint?: string },
  now: () => number = Date.now,
): GrokAuthorizationAttempt {
  if (!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}\/callback$/.test(input.redirectUri)) {
    throw new GrokAuthError("INVALID_CALLBACK_URI");
  }
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(64).toString("base64url");
  const expires = now() + GROK_AUTH_TTL;
  let consumed = false;
  const url = new URL(input.authorizeEndpoint ?? GROK_AUTHORIZE);
  url.search = new URLSearchParams({
    client_id: GROK_CLIENT_ID,
    response_type: "code",
    redirect_uri: input.redirectUri,
    scope: GROK_SCOPE,
    state,
    code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
  }).toString();
  return {
    url: url.href,
    verifier,
    redirectUri: input.redirectUri,
    cancel() {
      consumed = true;
    },
    consume(raw) {
      if (consumed || now() >= expires) throw new GrokAuthError("AUTH_ATTEMPT_EXPIRED");
      let callback: URL;
      try {
        callback = new URL(raw);
      } catch {
        throw new GrokAuthError("CALLBACK_REJECTED");
      }
      const redirect = new URL(input.redirectUri);
      if (
        callback.origin !== redirect.origin ||
        callback.pathname !== redirect.pathname ||
        callback.hash ||
        callback.username ||
        callback.password
      ) {
        throw new GrokAuthError("CALLBACK_REJECTED");
      }
      for (const name of ["state", "code", "error"]) {
        if (callback.searchParams.getAll(name).length > 1) throw new GrokAuthError("CALLBACK_REJECTED");
      }
      if (!equalSecret(callback.searchParams.get("state") ?? "", state)) {
        throw new GrokAuthError("AUTH_STATE_MISMATCH");
      }
      consumed = true;
      if (callback.searchParams.get("error") === "access_denied") throw new GrokAuthError("AUTH_DENIED");
      if (callback.searchParams.has("error")) throw new GrokAuthError("AUTH_FAILED");
      const code = callback.searchParams.get("code");
      if (!safeString(code, 4096)) throw new GrokAuthError("AUTH_CODE_MISSING");
      return { code };
    },
  };
}

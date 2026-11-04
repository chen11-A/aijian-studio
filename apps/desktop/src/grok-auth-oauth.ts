import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Public OAuth endpoints from https://auth.x.ai/.well-known/openid-configuration
 * (authorization code + PKCE S256, device code, refresh, public clients).
 * The client id matches the public Hermes constant XAI_OAUTH_CLIENT_ID.
 * Sign-in opens the system browser on the authorization endpoint and waits for
 * http://127.0.0.1:56121/callback. The OIDC document does not list redirect
 * URIs. A live authorize request accepts http://127.0.0.1:<port>/callback and
 * rejects non-loopback hosts; consent can still reject the callback. That
 * rejection fails closed, does not read browser cookies, and falls back to the
 * device-code grant: open verification_uri_complete (the code is already in
 * the link) and poll. The user never copies a code.
 */
export const GROK_ISSUER = "https://auth.x.ai";
export const GROK_AUTHORIZE = `${GROK_ISSUER}/oauth2/authorize`;
export const GROK_DEVICE_CODE = `${GROK_ISSUER}/oauth2/device/code`;
export const GROK_DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
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
  readonly httpStatus?: number;
  readonly detail?: string;
  constructor(
    readonly code: string,
    options?: { httpStatus?: number; detail?: string },
  ) {
    super(code);
    const status = options?.httpStatus;
    this.httpStatus =
      typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599
        ? status
        : undefined;
    this.detail =
      options?.detail && /^[a-z_]{1,40}$/.test(options.detail) ? options.detail : undefined;
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
        if (callback.searchParams.getAll(name).length > 1)
          throw new GrokAuthError("CALLBACK_REJECTED");
      }
      if (!equalSecret(callback.searchParams.get("state") ?? "", state)) {
        throw new GrokAuthError("AUTH_STATE_MISMATCH");
      }
      consumed = true;
      if (callback.searchParams.get("error") === "access_denied")
        throw new GrokAuthError("AUTH_DENIED");
      if (callback.searchParams.has("error")) throw new GrokAuthError("AUTH_FAILED");
      const code = callback.searchParams.get("code");
      if (!safeString(code, 4096)) throw new GrokAuthError("AUTH_CODE_MISSING");
      return { code };
    },
  };
}

/** Only an https://auth.x.ai link that already contains the one-time code may be opened. */
export function acceptedGrokVerificationLink(value: unknown, userCode: string): string {
  if (!safeString(value, 2000) || !safeString(userCode, 128)) {
    throw new GrokAuthError("DEVICE_CODE_LINK_MISSING");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new GrokAuthError("DEVICE_CODE_LINK_MISSING");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "auth.x.ai" ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new GrokAuthError("DEVICE_CODE_LINK_MISSING");
  }
  const embedded = [...url.searchParams.values()];
  if (!embedded.includes(userCode) && !url.pathname.includes(userCode)) {
    throw new GrokAuthError("DEVICE_CODE_LINK_MISSING");
  }
  return url.href;
}

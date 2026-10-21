import type { GrokLoginModel } from "@aijian/contracts/grok-auth";
import {
  GROK_API,
  GROK_CLIENT_ID,
  GROK_DEVICE_CODE,
  GROK_DEVICE_GRANT,
  GROK_REVOKE,
  GROK_SCOPE,
  GROK_TOKEN,
  GROK_USERINFO,
  GrokAuthError,
  acceptedGrokVerificationLink,
  isRecord,
  safeString,
} from "./grok-auth-oauth";

export type Fetch = typeof globalThis.fetch;
export type GrokEndpoints = {
  token: string;
  revoke: string;
  userinfo: string;
  api: string;
};
export const OFFICIAL_GROK_ENDPOINTS: GrokEndpoints = {
  token: GROK_TOKEN,
  revoke: GROK_REVOKE,
  userinfo: GROK_USERINFO,
  api: GROK_API,
};
export type GrokTokens = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  scopes: string[];
};
export type GrokAccount = { subject: string; email: string | null; name: string | null };

const MAX_JSON = 512 * 1024;
const USER_AGENT = "AIVORA/0.1 GrokOAuth";

async function readJson(response: Response): Promise<unknown> {
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_JSON) throw new GrokAuthError("RESPONSE_TOO_LARGE");
  try {
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new GrokAuthError("RESPONSE_INVALID");
  }
}

function form(body: Record<string, string>): RequestInit {
  return {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
      "user-agent": USER_AGENT,
    },
    body: new URLSearchParams(body).toString(),
  };
}

export function parseTokenResponse(value: unknown, now: number): GrokTokens {
  if (!isRecord(value) || !safeString(value.access_token, 32_768)) {
    throw new GrokAuthError("TOKEN_RESPONSE_INVALID");
  }
  const refresh = safeString(value.refresh_token, 32_768) ? value.refresh_token : null;
  const expiresIn = value.expires_in;
  const lifetime =
    typeof expiresIn === "number" && Number.isFinite(expiresIn) && expiresIn > 0
      ? expiresIn * 1000
      : 6 * 60 * 60 * 1000;
  const scope = typeof value.scope === "string" ? value.scope.split(" ").filter(Boolean) : [];
  return {
    accessToken: value.access_token,
    refreshToken: refresh,
    expiresAt: now + lifetime,
    scopes: scope,
  };
}

export async function exchangeAuthorizationCode(
  fetch: Fetch,
  input: { code: string; verifier: string; redirectUri: string; endpoints?: GrokEndpoints },
  now = Date.now(),
): Promise<GrokTokens> {
  const endpoints = input.endpoints ?? OFFICIAL_GROK_ENDPOINTS;
  const response = await fetch(
    endpoints.token,
    form({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: GROK_CLIENT_ID,
      code_verifier: input.verifier,
    }),
  );
  if (!response.ok)
    throw new GrokAuthError(
      response.status === 403 ? "ENTITLEMENT_DENIED" : "TOKEN_EXCHANGE_FAILED",
      { httpStatus: response.status },
    );
  const tokens = parseTokenResponse(await readJson(response), now);
  if (!tokens.refreshToken) throw new GrokAuthError("TOKEN_RESPONSE_INVALID");
  return tokens;
}

export async function refreshGrokTokens(
  fetch: Fetch,
  refreshToken: string,
  endpoints: GrokEndpoints = OFFICIAL_GROK_ENDPOINTS,
  now = Date.now(),
): Promise<GrokTokens> {
  const response = await fetch(
    endpoints.token,
    form({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: GROK_CLIENT_ID,
    }),
  );
  if (response.status === 403) throw new GrokAuthError("ENTITLEMENT_DENIED");
  if (!response.ok) throw new GrokAuthError("REAUTH_REQUIRED");
  const tokens = parseTokenResponse(await readJson(response), now);
  return { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken };
}

export async function revokeGrokToken(
  fetch: Fetch,
  token: string,
  endpoints: GrokEndpoints = OFFICIAL_GROK_ENDPOINTS,
): Promise<void> {
  const response = await fetch(
    endpoints.revoke,
    form({ token, token_type_hint: "refresh_token", client_id: GROK_CLIENT_ID }),
  );
  if (!response.ok && response.status !== 400) throw new GrokAuthError("REVOKE_UNCONFIRMED");
}

export async function readGrokAccount(
  fetch: Fetch,
  accessToken: string,
  endpoints: GrokEndpoints = OFFICIAL_GROK_ENDPOINTS,
): Promise<GrokAccount> {
  const response = await fetch(endpoints.userinfo, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
      "user-agent": USER_AGENT,
    },
  });
  if (!response.ok) throw new GrokAuthError("USERINFO_FAILED");
  const value = await readJson(response);
  if (!isRecord(value) || !safeString(value.sub, 500)) throw new GrokAuthError("USERINFO_FAILED");
  return {
    subject: value.sub,
    email: safeString(value.email, 254) ? value.email : null,
    name: safeString(value.name, 200) ? value.name : null,
  };
}

export async function listGrokModels(
  fetch: Fetch,
  accessToken: string,
  endpoints: GrokEndpoints = OFFICIAL_GROK_ENDPOINTS,
): Promise<GrokLoginModel[]> {
  const response = await fetch(`${endpoints.api}/models`, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
      "user-agent": USER_AGENT,
    },
  });
  if (response.status === 403) throw new GrokAuthError("ENTITLEMENT_DENIED");
  if (response.status === 401) throw new GrokAuthError("REAUTH_REQUIRED");
  if (!response.ok) throw new GrokAuthError("MODELS_FAILED");
  const value = await readJson(response);
  if (!isRecord(value) || !Array.isArray(value.data)) throw new GrokAuthError("MODELS_FAILED");
  const models: GrokLoginModel[] = [];
  for (const item of value.data) {
    if (!isRecord(item) || !safeString(item.id, 200)) continue;
    models.push({ id: item.id, label: safeString(item.name, 200) ? item.name : item.id });
    if (models.length >= 100) break;
  }
  return models;
}

export async function completeGrokText(
  fetch: Fetch,
  input: { accessToken: string; model: string; text: string; endpoints?: GrokEndpoints },
): Promise<string> {
  const endpoints = input.endpoints ?? OFFICIAL_GROK_ENDPOINTS;
  const response = await fetch(`${endpoints.api}/responses`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      "content-type": "application/json",
      accept: "application/json",
      "user-agent": USER_AGENT,
    },
    body: JSON.stringify({ model: input.model, input: input.text, store: false }),
  });
  if (response.status === 403) throw new GrokAuthError("ENTITLEMENT_DENIED");
  if (response.status === 401) throw new GrokAuthError("REAUTH_REQUIRED");
  if (!response.ok) throw new GrokAuthError("TEXT_FAILED");
  const value = await readJson(response);
  if (!isRecord(value) || !safeString(value.output_text, 100_000))
    throw new GrokAuthError("TEXT_FAILED");
  return value.output_text;
}

export type GrokDeviceLogin = {
  deviceCode: string;
  verificationUrl: string;
  expiresIn: number;
  intervalSeconds: number;
};

function finite(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const whole = Math.floor(value);
  if (whole < min || whole > max) return null;
  return whole;
}

async function oauthErrorName(response: Response): Promise<string> {
  try {
    const value = await readJson(response);
    if (isRecord(value) && typeof value.error === "string" && /^[a-z_]{1,40}$/.test(value.error)) {
      return value.error;
    }
  } catch {
    return "";
  }
  return "";
}

export async function requestGrokDeviceCode(
  fetch: Fetch,
  endpoint = GROK_DEVICE_CODE,
): Promise<GrokDeviceLogin> {
  const response = await fetch(endpoint, form({ client_id: GROK_CLIENT_ID, scope: GROK_SCOPE }));
  if (!response.ok) throw new GrokAuthError("DEVICE_CODE_FAILED", { httpStatus: response.status });
  const value = await readJson(response);
  if (
    !isRecord(value) ||
    !safeString(value.device_code, 2048) ||
    !safeString(value.user_code, 128)
  ) {
    throw new GrokAuthError("DEVICE_CODE_FAILED");
  }
  const expiresIn = finite(value.expires_in, 1, 1800);
  const intervalSeconds = finite(value.interval, 1, 60);
  if (expiresIn === null || intervalSeconds === null) throw new GrokAuthError("DEVICE_CODE_FAILED");
  return {
    deviceCode: value.device_code,
    verificationUrl: acceptedGrokVerificationLink(value.verification_uri_complete, value.user_code),
    expiresIn,
    intervalSeconds,
  };
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new GrokAuthError("AUTH_CANCELLED"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new GrokAuthError("AUTH_CANCELLED"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function pollGrokDeviceToken(
  fetch: Fetch,
  input: {
    deviceCode: string;
    expiresIn: number;
    intervalSeconds: number;
    endpoints?: GrokEndpoints;
    signal: AbortSignal;
    now?: () => number;
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  },
): Promise<GrokTokens> {
  const endpoints = input.endpoints ?? OFFICIAL_GROK_ENDPOINTS;
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? defaultSleep;
  let interval = Math.min(60, Math.max(1, Math.floor(input.intervalSeconds)));
  const expires = Math.min(1800, Math.max(1, Math.floor(input.expiresIn)));
  const deadline = now() + expires * 1000;
  for (let attempt = 0; attempt < expires; attempt += 1) {
    if (input.signal.aborted) throw new GrokAuthError("AUTH_CANCELLED");
    if (now() >= deadline) break;
    await sleep(interval * 1000, input.signal);
    const response = await fetch(
      endpoints.token,
      form({
        grant_type: GROK_DEVICE_GRANT,
        client_id: GROK_CLIENT_ID,
        device_code: input.deviceCode,
      }),
    );
    if (response.ok) {
      const tokens = parseTokenResponse(await readJson(response), now());
      if (!tokens.refreshToken) throw new GrokAuthError("TOKEN_RESPONSE_INVALID");
      return tokens;
    }
    const detail = await oauthErrorName(response);
    if (detail === "authorization_pending") continue;
    if (detail === "slow_down") {
      interval = Math.min(60, interval + 5);
      continue;
    }
    if (detail === "access_denied") {
      throw new GrokAuthError("AUTH_DENIED", { httpStatus: response.status, detail });
    }
    if (detail === "expired_token") {
      throw new GrokAuthError("AUTH_ATTEMPT_EXPIRED", { httpStatus: response.status, detail });
    }
    throw new GrokAuthError("DEVICE_CODE_FAILED", { httpStatus: response.status, detail });
  }
  throw new GrokAuthError("AUTH_ATTEMPT_EXPIRED");
}

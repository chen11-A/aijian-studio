import type {
  GrokCatalogNotice,
  GrokLoginActionResult,
  GrokLoginBridge,
  GrokLoginModel,
  GrokLoginStatus,
  GrokLoginTextResult,
  GrokSpeechResult,
} from "@aijian/contracts/grok-auth";
import { authorizeGrokInBrowser } from "./grok-auth-callback";
import type { AgentLog } from "./agent-log";
import {
  completeGrokText,
  speakGrokLine,
  exchangeAuthorizationCode,
  GrokTextFailure,
  listGrokCatalog,
  listGrokModels,
  OFFICIAL_GROK_ENDPOINTS,
  pollGrokDeviceToken,
  readGrokAccount,
  refreshGrokTokens,
  requestGrokDeviceCode,
  revokeGrokToken,
  type Fetch,
  type GrokEndpoints,
  type GrokTokens,
} from "./grok-auth-http";
import { GrokAuthError } from "./grok-auth-oauth";
import type { GrokLoginLog } from "./grok-login-log";
import type { GrokSession, GrokStore } from "./grok-auth-storage";
import type { createSubscriptionLedger } from "./desktop-subscription-ledger";

type SubscriptionLedger = ReturnType<typeof createSubscriptionLedger>;

const REFRESH_SKEW_MS = 120_000;

const DEVICE_FALLBACK = new Set([
  "CALLBACK_REJECTED",
  "CALLBACK_LISTENER_UNAVAILABLE",
  "INVALID_CALLBACK_URI",
  "TOKEN_EXCHANGE_FAILED",
  "AUTH_FAILED",
]);

const CATALOG_LOG_CODE = {
  ok: "OK",
  denied: "DENIED",
  missing: "MISSING",
  unavailable: "UNAVAILABLE",
  empty: "EMPTY",
  voices: "VOICES",
} as const;

type Dependencies = {
  store: GrokStore;
  fetch: Fetch;
  openBrowser(url: string): Promise<void>;
  confirmSignIn(signal: AbortSignal): Promise<boolean>;
  endpoints?: GrokEndpoints;
  authorizeEndpoint?: string;
  deviceCodeEndpoint?: string;
  /** Tests pin this. Production tries the browser callback, then device code. */
  signInMethod?: "loopback" | "device" | "loopback-then-device";
  loopbackPort?: number;
  authorize?: typeof authorizeGrokInBrowser;
  /** Called after the browser returns the login to this app. */
  onBrowserReturned?: () => void;
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Status codes only. Never pass a token, code, or URL. */
  log?: GrokLoginLog;
  /** Text-call failures. The writer redacts tokens before they reach disk. */
  agentLog?: AgentLog;
  /** When set, provider HTTP waits until this ledger has a billing row. No token is passed. */
  ledger?: SubscriptionLedger;
};

export type GrokRuntime = GrokLoginBridge & {
  restore(): Promise<void>;
  /** Main-process only. Never send this value across IPC. */
  mediaAccessToken(): Promise<string | null>;
  cancelWork(): void;
};

export function createGrokRuntime(dependencies: Dependencies): GrokRuntime {
  const endpoints = dependencies.endpoints ?? OFFICIAL_GROK_ENDPOINTS;
  const now = dependencies.now ?? Date.now;
  const authorize = dependencies.authorize ?? authorizeGrokInBrowser;
  let session: GrokSession | null = null;
  let attempt: AbortController | null = null;
  let busy = false;
  let lastError: string | null = null;
  let restored: Promise<void> | null = null;
  let refreshing: Promise<void> | null = null;

  function restore() {
    restored ??= dependencies.store
      .read()
      .then(async (saved) => {
        session = saved;
        if (saved) await dependencies.log?.event("session_restored");
      })
      .catch((error: unknown) => {
        restored = null;
        if (error instanceof GrokAuthError && error.code === "SECURE_STORAGE_UNAVAILABLE") return;
        throw error;
      });
    return restored;
  }

  function status(): GrokLoginStatus {
    const storage = dependencies.store.available() ? "AVAILABLE" : "UNAVAILABLE";
    return {
      provider: "GROK_LOGIN",
      runtime: "DESKTOP",
      state: attempt
        ? "AWAITING_BROWSER"
        : !session
          ? "NOT_CONNECTED"
          : lastError === "REAUTH_REQUIRED"
            ? "REAUTH_REQUIRED"
            : session.inferenceDenied
              ? "ENTITLEMENT_DENIED"
              : "CONNECTED",
      secureStorage: storage,
      accountLabel: session?.email ?? session?.name ?? null,
      lastError,
    };
  }

  async function persist(next: GrokSession | null) {
    session = next;
    if (next) await dependencies.store.write(next);
    else await dependencies.store.clear();
  }

  async function ensureFresh() {
    if (!session) throw new GrokAuthError("NOT_CONNECTED");
    if (session.expiresAt - now() > REFRESH_SKEW_MS) return;
    if (!refreshing) {
      const current = session;
      refreshing = refreshGrokTokens(dependencies.fetch, current.refreshToken, endpoints, now())
        .then(async (tokens) => {
          if (!session) return;
          await persist({
            ...session,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken ?? session.refreshToken,
            expiresAt: tokens.expiresAt,
            scopes: tokens.scopes.length > 0 ? tokens.scopes : session.scopes,
          });
          lastError = null;
        })
        .catch(async (error: unknown) => {
          const code = error instanceof GrokAuthError ? error.code : "REAUTH_REQUIRED";
          if (code === "ENTITLEMENT_DENIED" && session) {
            await persist({ ...session, inferenceDenied: true });
            lastError = code;
          } else {
            lastError = "REAUTH_REQUIRED";
          }
          throw new GrokAuthError(lastError);
        })
        .finally(() => {
          refreshing = null;
        });
    }
    await refreshing;
  }

  async function acceptTokens(tokens: GrokTokens): Promise<GrokLoginActionResult> {
    if (!tokens.refreshToken) throw new GrokAuthError("TOKEN_RESPONSE_INVALID");
    const account = await readGrokAccount(dependencies.fetch, tokens.accessToken, endpoints).catch(
      () => ({
        subject: "unknown",
        email: null,
        name: null,
      }),
    );
    let inferenceDenied = false;
    try {
      await listGrokModels(dependencies.fetch, tokens.accessToken, endpoints);
    } catch (error) {
      if (error instanceof GrokAuthError && error.code === "ENTITLEMENT_DENIED")
        inferenceDenied = true;
      else throw error;
    }
    await persist({
      version: 1,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      scopes: tokens.scopes,
      subject: account.subject,
      email: account.email,
      name: account.name,
      inferenceDenied,
    });
    attempt = null;
    lastError = inferenceDenied ? "ENTITLEMENT_DENIED" : null;
    await dependencies.log?.event("sign_in_ok", {
      code: inferenceDenied ? "ENTITLEMENT_DENIED" : "CONNECTED",
    });
    return { kind: "OK", status: status() };
  }

  async function loginWithDevice(signal: AbortSignal): Promise<GrokTokens> {
    const pending = await requestGrokDeviceCode(
      dependencies.fetch,
      dependencies.deviceCodeEndpoint,
    );
    try {
      await dependencies.openBrowser(pending.verificationUrl);
    } catch {
      throw new GrokAuthError("BROWSER_OPEN_FAILED");
    }
    await dependencies.log?.event("browser_opened", { code: "DEVICE" });
    return pollGrokDeviceToken(dependencies.fetch, {
      deviceCode: pending.deviceCode,
      expiresIn: pending.expiresIn,
      intervalSeconds: pending.intervalSeconds,
      endpoints,
      signal,
      now,
      sleep: dependencies.sleep,
    });
  }

  async function loginWithLoopback(signal: AbortSignal): Promise<GrokTokens> {
    await dependencies.log?.event("browser_opened", { code: "LOOPBACK" });
    const callback = await authorize(
      { authorizeEndpoint: dependencies.authorizeEndpoint, port: dependencies.loopbackPort },
      dependencies.openBrowser,
      signal,
      dependencies.onBrowserReturned,
    );
    return exchangeAuthorizationCode(dependencies.fetch, { ...callback, endpoints }, now());
  }

  async function signIn(): Promise<GrokLoginActionResult> {
    if (busy) return { kind: "ERROR", code: "AUTH_IN_PROGRESS", status: status() };
    busy = true;
    const controller = new AbortController();
    attempt = controller;
    const method =
      dependencies.signInMethod ??
      (dependencies.authorizeEndpoint ? "loopback" : "loopback-then-device");
    try {
      await restore();
      if (!dependencies.store.available()) throw new GrokAuthError("SECURE_STORAGE_UNAVAILABLE");
      if (!(await dependencies.confirmSignIn(controller.signal))) {
        attempt = null;
        await dependencies.log?.event("sign_in_cancelled");
        return { kind: "CANCELLED", status: status() };
      }
      await dependencies.log?.event("sign_in_started", {
        code: method === "device" ? "DEVICE" : "LOOPBACK",
      });
      if (method === "device") return await acceptTokens(await loginWithDevice(controller.signal));
      try {
        return await acceptTokens(await loginWithLoopback(controller.signal));
      } catch (error) {
        const code = error instanceof GrokAuthError ? error.code : "CONNECTION_UNAVAILABLE";
        if (
          method === "loopback-then-device" &&
          DEVICE_FALLBACK.has(code) &&
          !controller.signal.aborted
        ) {
          await dependencies.log?.event("loopback_failed", {
            code,
            httpStatus: error instanceof GrokAuthError ? error.httpStatus : undefined,
          });
          return await acceptTokens(await loginWithDevice(controller.signal));
        }
        throw error;
      }
    } catch (error) {
      attempt = null;
      const code = error instanceof GrokAuthError ? error.code : "CONNECTION_UNAVAILABLE";
      if (code === "AUTH_CANCELLED") {
        await dependencies.log?.event("sign_in_cancelled");
        return { kind: "CANCELLED", status: status() };
      }
      lastError = code;
      await dependencies.log?.event("sign_in_error", {
        code,
        httpStatus: error instanceof GrokAuthError ? error.httpStatus : undefined,
      });
      return { kind: "ERROR", code, status: status() };
    } finally {
      attempt = null;
      busy = false;
    }
  }

  let work: AbortController | null = null;

  function beginWork(): AbortSignal {
    work?.abort();
    work = new AbortController();
    return work.signal;
  }

  async function cancel(): Promise<GrokLoginActionResult> {
    attempt?.abort(new GrokAuthError("AUTH_CANCELLED"));
    work?.abort();
    return { kind: "CANCELLED", status: status() };
  }

  function cancelWork(): void {
    work?.abort();
  }

  async function signOut(): Promise<GrokLoginActionResult> {
    await restore();
    const refresh = session?.refreshToken;
    if (refresh)
      await revokeGrokToken(dependencies.fetch, refresh, endpoints).catch(() => undefined);
    await persist(null);
    lastError = null;
    await dependencies.log?.event("session_cleared");
    return { kind: "OK", status: status() };
  }

  async function models(): Promise<
    | { kind: "OK"; models: GrokLoginModel[]; notices?: GrokCatalogNotice[] }
    | { kind: "ERROR"; code: string }
  > {
    try {
      await restore();
      await ensureFresh();
      if (!session) throw new GrokAuthError("NOT_CONNECTED");
      const listed = await listGrokCatalog(dependencies.fetch, session.accessToken, endpoints);
      for (const report of listed.reports) {
        await dependencies.log?.event(`catalog_${report.capability.toLowerCase()}`, {
          code: CATALOG_LOG_CODE[report.outcome],
          httpStatus: report.httpStatus,
        });
      }
      return listed.notices.length > 0
        ? { kind: "OK", models: listed.models, notices: listed.notices }
        : { kind: "OK", models: listed.models };
    } catch (error) {
      const code = error instanceof GrokAuthError ? error.code : "MODELS_FAILED";
      if (code === "ENTITLEMENT_DENIED" && session) {
        await persist({ ...session, inferenceDenied: true });
        lastError = code;
      }
      return { kind: "ERROR", code };
    }
  }

  async function completeText(input: {
    model: string;
    text: string;
    projectId?: string;
    idempotencyKey?: string;
    agent?: string;
    onProgress?: (update: { chars: number; shots: number }) => void;
  }): Promise<GrokLoginTextResult> {
    if (
      input.text.length === 0 ||
      input.text.length > 8000 ||
      input.model.length === 0 ||
      input.model.length > 200
    ) {
      return { kind: "ERROR", code: "TEXT_REJECTED", billingAccountKind: "grok_login" };
    }
    const ledger = dependencies.ledger;
    let dispatchId: string | null = null;
    const started = Date.now();
    try {
      await restore();
      await ensureFresh();
      if (!session) throw new GrokAuthError("NOT_CONNECTED");
      if (ledger) {
        if (!input.projectId || !input.idempotencyKey)
          throw new GrokAuthError("BILLING_PROJECT_REQUIRED");
        const recorded = await ledger.record({
          projectId: input.projectId,
          accountKind: "grok_login",
          model: input.model,
          text: input.text,
          idempotencyKey: input.idempotencyKey,
          connected: true,
        });
        dispatchId = recorded.dispatchId;
        if (!recorded.created && recorded.outcome !== "RECORDED") {
          throw new GrokAuthError("DISPATCH_ALREADY_FINISHED");
        }
      }
      const text = await completeGrokText(dependencies.fetch, {
        accessToken: session.accessToken,
        model: input.model,
        text: input.text,
        endpoints,
        signal: beginWork(),
        onProgress: (partial) =>
          input.onProgress?.({
            chars: partial.length,
            shots: (partial.match(/"picture"/g) ?? []).length,
          }),
      });
      dependencies.agentLog?.write({
        agent: input.agent ?? "",
        model: input.model,
        endpoint: "responses",
        httpStatus: 200,
        durationMs: Date.now() - started,
        parsed: "text",
        body: text,
      });
      if (ledger && dispatchId && input.projectId) {
        await ledger.finish({
          projectId: input.projectId,
          dispatchId,
          outcome: "COMPLETED",
        });
      }
      if (session.inferenceDenied) await persist({ ...session, inferenceDenied: false });
      lastError = null;
      return { kind: "OK", text, billingAccountKind: "grok_login", model: input.model };
    } catch (error) {
      const code =
        error instanceof GrokAuthError
          ? error.code
          : error instanceof Error
            ? error.message
            : "TEXT_FAILED";
      const safe = [
        "ENTITLEMENT_DENIED",
        "REAUTH_REQUIRED",
        "NOT_CONNECTED",
        "BILLING_NOT_RECORDED",
        "BILLING_PROJECT_REQUIRED",
        "DISPATCH_ALREADY_FINISHED",
        "DISCONNECTED",
        "QUOTA_UNAVAILABLE",
        "RATE_UNAVAILABLE",
        "TEXT_FAILED",
      ].includes(code)
        ? code
        : "TEXT_FAILED";
      if (ledger && dispatchId && input.projectId && safe !== "DISPATCH_ALREADY_FINISHED") {
        await ledger
          .finish({
            projectId: input.projectId,
            dispatchId,
            outcome: "FAILED",
            failureCode: safe,
          })
          .catch(() => undefined);
      }
      if (error instanceof GrokTextFailure) {
        for (const attempt of error.attempts) {
          dependencies.agentLog?.write({
            agent: input.agent ?? "",
            model: input.model,
            endpoint: attempt.endpoint,
            httpStatus: attempt.httpStatus,
            durationMs: Date.now() - started,
            parsed: "error",
            body: attempt.body,
          });
        }
      } else {
        dependencies.agentLog?.write({
          agent: input.agent ?? "",
          model: input.model,
          endpoint: "text",
          httpStatus: 0,
          durationMs: Date.now() - started,
          parsed: "error",
          body: safe,
        });
      }
      if (safe === "ENTITLEMENT_DENIED" && session) {
        await persist({ ...session, inferenceDenied: true });
        lastError = safe;
      } else if (safe === "REAUTH_REQUIRED") {
        lastError = safe;
      }
      if (safe === "TEXT_FAILED" && error instanceof GrokTextFailure) {
        const last = error.attempts[error.attempts.length - 1];
        const waited =
          last?.body.startsWith("很久") ||
          last?.body.startsWith("这次") ||
          last?.body.startsWith("已取消");
        const status = waited
          ? (last?.body ?? "文本接口没有返回正文")
          : last?.httpStatus
            ? `文本接口返回 ${last.httpStatus}`
            : "文本接口没有返回正文";
        const tried =
          !waited && error.attempts.some((item) => item.endpoint === "chat")
            ? "。已改用普通对话再试过"
            : "";
        return {
          kind: "ERROR",
          code: safe,
          billingAccountKind: "grok_login",
          ...(last?.httpStatus ? { httpStatus: last.httpStatus } : {}),
          detail: `${status}${tried}。`,
        };
      }
      return { kind: "ERROR", code: safe, billingAccountKind: "grok_login" };
    }
  }

  async function speak(input: {
    voiceId: string;
    text: string;
    projectId?: string;
    idempotencyKey?: string;
  }): Promise<GrokSpeechResult> {
    const line = input.text.trim();
    if (!line || line.length > 2000 || !input.voiceId.trim() || input.voiceId.length > 80) {
      return {
        kind: "ERROR",
        code: "TEXT_REJECTED",
        detail: "先写下要听的台词。",
        billingAccountKind: "grok_login",
      };
    }
    const ledger = dependencies.ledger;
    let dispatchId: string | null = null;
    let timedOut = false;
    try {
      await restore();
      await ensureFresh();
      if (!session) throw new GrokAuthError("NOT_CONNECTED");
      if (ledger) {
        if (!input.projectId || !input.idempotencyKey) {
          return {
            kind: "ERROR",
            code: "BILLING_PROJECT_REQUIRED",
            detail: "这一次没有记到作品上。",
            billingAccountKind: "grok_login",
          };
        }
        const recorded = await ledger.record({
          projectId: input.projectId,
          accountKind: "grok_login",
          model: "grok-tts",
          text: line,
          idempotencyKey: input.idempotencyKey,
          connected: true,
        });
        dispatchId = recorded.dispatchId;
      }
      const signal = beginWork();
      const timeout = setTimeout(() => {
        timedOut = true;
        work?.abort();
      }, 5 * 60_000);
      let audio: Awaited<ReturnType<typeof speakGrokLine>>;
      try {
        audio = await speakGrokLine(dependencies.fetch, {
          accessToken: session.accessToken,
          voiceId: input.voiceId.trim(),
          text: line,
          endpoints,
          signal,
        });
      } finally {
        clearTimeout(timeout);
      }
      if (ledger && dispatchId && input.projectId) {
        await ledger.finish({ projectId: input.projectId, dispatchId, outcome: "COMPLETED" });
      }
      return { kind: "OK", ...audio, billingAccountKind: "grok_login" };
    } catch (error) {
      const code = error instanceof GrokAuthError ? error.code : "TEXT_FAILED";
      if (ledger && dispatchId && input.projectId) {
        await ledger.finish({
          projectId: input.projectId,
          dispatchId,
          outcome: "FAILED",
          failureCode: code,
        });
      }
      const aborted = work?.signal.aborted === true;
      const detail = timedOut
        ? "配音等太久，已停止。"
        : aborted
          ? "已取消配音。"
          : code === "ENTITLEMENT_DENIED"
            ? "当前账号不能用配音。"
            : code === "REAUTH_REQUIRED"
              ? "需要重新登录。"
              : code === "NOT_CONNECTED"
                ? "没有登录。"
                : "配音没有成功。配音等太久时会自己停。";
      return { kind: "ERROR", code, detail, billingAccountKind: "grok_login" };
    }
  }

  async function mediaAccessToken(): Promise<string | null> {
    await restore();
    if (!session) return null;
    try {
      await ensureFresh();
    } catch {
      return null;
    }
    const token = session?.accessToken;
    const unsafe =
      !token ||
      token.length > 8192 ||
      Array.from(token).some((character) => {
        const code = character.charCodeAt(0);
        return code < 32 || code === 127;
      });
    if (unsafe || !token) return null;
    return token;
  }

  return {
    restore,
    status: async () => (await restore(), status()),
    signIn,
    cancel,
    cancelWork,
    signOut,
    models,
    completeText,
    speak,
    async recordAgent(input: {
      agent: string;
      model: string;
      status: string;
      parsed: string;
      detail: string;
    }) {
      dependencies.agentLog?.write({
        agent: input.agent,
        model: input.model,
        endpoint: "parse",
        httpStatus: input.status === "ok" ? 200 : 0,
        parsed: input.parsed,
        body: input.detail,
      });
    },
    mediaAccessToken,
  };
}

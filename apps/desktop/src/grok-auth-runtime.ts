import type {
  GrokLoginActionResult,
  GrokLoginBridge,
  GrokLoginModel,
  GrokLoginStatus,
  GrokLoginTextResult,
} from "@aijian/contracts/grok-auth";
import { authorizeGrokInBrowser } from "./grok-auth-callback";
import {
  completeGrokText,
  exchangeAuthorizationCode,
  listGrokModels,
  OFFICIAL_GROK_ENDPOINTS,
  readGrokAccount,
  refreshGrokTokens,
  revokeGrokToken,
  type Fetch,
  type GrokEndpoints,
} from "./grok-auth-http";
import { GrokAuthError } from "./grok-auth-oauth";
import type { GrokSession, GrokStore } from "./grok-auth-storage";
import type { createSubscriptionLedger } from "./desktop-subscription-ledger";

type SubscriptionLedger = ReturnType<typeof createSubscriptionLedger>;

const REFRESH_SKEW_MS = 120_000;

type Dependencies = {
  store: GrokStore;
  fetch: Fetch;
  openBrowser(url: string): Promise<void>;
  confirmSignIn(signal: AbortSignal): Promise<boolean>;
  endpoints?: GrokEndpoints;
  authorizeEndpoint?: string;
  loopbackPort?: number;
  authorize?: typeof authorizeGrokInBrowser;
  now?: () => number;
  /** When set, provider HTTP waits until this ledger has a billing row. No token is passed. */
  ledger?: SubscriptionLedger;
};

export type GrokRuntime = GrokLoginBridge & {
  restore(): Promise<void>;
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
      .then((saved) => {
        session = saved;
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

  async function signIn(): Promise<GrokLoginActionResult> {
    if (busy) return { kind: "ERROR", code: "AUTH_IN_PROGRESS", status: status() };
    busy = true;
    const controller = new AbortController();
    attempt = controller;
    try {
      await restore();
      if (!dependencies.store.available()) throw new GrokAuthError("SECURE_STORAGE_UNAVAILABLE");
      if (!(await dependencies.confirmSignIn(controller.signal))) {
        attempt = null;
        return { kind: "CANCELLED", status: status() };
      }
      const callback = await authorize(
        { authorizeEndpoint: dependencies.authorizeEndpoint, port: dependencies.loopbackPort },
        dependencies.openBrowser,
        controller.signal,
      );
      const tokens = await exchangeAuthorizationCode(
        dependencies.fetch,
        { ...callback, endpoints },
        now(),
      );
      if (!tokens.refreshToken) throw new GrokAuthError("TOKEN_RESPONSE_INVALID");
      const account = await readGrokAccount(dependencies.fetch, tokens.accessToken, endpoints).catch(() => ({
        subject: "unknown",
        email: null,
        name: null,
      }));
      let inferenceDenied = false;
      try {
        await listGrokModels(dependencies.fetch, tokens.accessToken, endpoints);
      } catch (error) {
        if (error instanceof GrokAuthError && error.code === "ENTITLEMENT_DENIED") inferenceDenied = true;
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
      return { kind: "OK", status: status() };
    } catch (error) {
      attempt = null;
      const code = error instanceof GrokAuthError ? error.code : "CONNECTION_UNAVAILABLE";
      if (code === "AUTH_CANCELLED") return { kind: "CANCELLED", status: status() };
      lastError = code;
      return { kind: "ERROR", code, status: status() };
    } finally {
      attempt = null;
      busy = false;
    }
  }

  async function cancel(): Promise<GrokLoginActionResult> {
    attempt?.abort(new GrokAuthError("AUTH_CANCELLED"));
    return { kind: "CANCELLED", status: status() };
  }

  async function signOut(): Promise<GrokLoginActionResult> {
    await restore();
    const refresh = session?.refreshToken;
    if (refresh) await revokeGrokToken(dependencies.fetch, refresh, endpoints).catch(() => undefined);
    await persist(null);
    lastError = null;
    return { kind: "OK", status: status() };
  }

  async function models(): Promise<{ kind: "OK"; models: GrokLoginModel[] } | { kind: "ERROR"; code: string }> {
    try {
      await restore();
      await ensureFresh();
      if (!session) throw new GrokAuthError("NOT_CONNECTED");
      const listed = await listGrokModels(dependencies.fetch, session.accessToken, endpoints);
      return { kind: "OK", models: listed };
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
  }): Promise<GrokLoginTextResult> {
    if (input.text.length === 0 || input.text.length > 8000 || input.model.length === 0 || input.model.length > 200) {
      return { kind: "ERROR", code: "TEXT_REJECTED", billingAccountKind: "grok_login" };
    }
    const ledger = dependencies.ledger;
    let dispatchId: string | null = null;
    try {
      await restore();
      await ensureFresh();
      if (!session) throw new GrokAuthError("NOT_CONNECTED");
      if (ledger) {
        if (!input.projectId || !input.idempotencyKey) throw new GrokAuthError("BILLING_PROJECT_REQUIRED");
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
      const code = error instanceof GrokAuthError ? error.code : error instanceof Error ? error.message : "TEXT_FAILED";
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
      if (safe === "ENTITLEMENT_DENIED" && session) {
        await persist({ ...session, inferenceDenied: true });
        lastError = safe;
      } else if (safe === "REAUTH_REQUIRED") {
        lastError = safe;
      }
      return { kind: "ERROR", code: safe, billingAccountKind: "grok_login" };
    }
  }

  return { restore, status: async () => (await restore(), status()), signIn, cancel, signOut, models, completeText };
}

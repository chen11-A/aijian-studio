import { completeText } from "./chatgpt-auth-inference";
import {
  textRequestHash,
  validateTextCommand,
  type ChatGPTTextCommand,
  type ChatGPTTextOptions,
  type ChatGPTTextResult,
  type ChatGPTTextApproval,
} from "./chatgpt-auth-generation";
import { randomUUID } from "node:crypto";
import type {
  ChatGPTActionResult,
  ChatGPTBridge,
  ChatGPTStatus,
  ChatGPTUseScope,
} from "@aijian/contracts/chatgpt-auth";
import { AUTH_TTL, ChatGPTError, RESOURCE } from "./chatgpt-auth-oauth";
import { discover, listModels, requestTokens, type Fetch } from "./chatgpt-auth-http";
import { authorizeInBrowser } from "./chatgpt-auth-callback";
import type { AuthData, Profile, ProtectedStore } from "./chatgpt-auth-storage";

type Dependencies = {
  store: ProtectedStore;
  fetch: Fetch;
  openBrowser(url: string): Promise<void>;
  confirmSignIn(scope: ChatGPTUseScope, signal: AbortSignal): Promise<boolean>;
  authorize?: typeof authorizeInBrowser;
  confirmText?(request: ChatGPTTextApproval): Promise<boolean>;
};
const errorCode = (error: unknown) =>
  error instanceof ChatGPTError ? error.code : "CONNECTION_UNAVAILABLE";
const planEnabled = (profile: Profile | undefined) =>
  Boolean(
    profile?.tokens?.accessToken &&
    profile.tokens.scopes.includes("resource.invoke") &&
    profile.tokens.scopes.includes("chatgpt.tokens.use.direct"),
  );

/** Tokens never leave this closure. Status only reads a previously protected local record. */
export type ChatGPTRuntime = ChatGPTBridge & {
  generateText(input: ChatGPTTextCommand, options: ChatGPTTextOptions): Promise<ChatGPTTextResult>;
};
export function createChatGPTRuntime(dependencies: Dependencies): ChatGPTRuntime {
  let data: AuthData | null = null;
  let attempt: AbortController | null = null;
  let busy = false;
  let lastError: string | null = null;
  let needsReauth = false;
  const generations = new Map<string, { hash: string; result: ChatGPTTextResult }>();
  let restored: Promise<void> | null = null;
  function restore() {
    restored ??= dependencies.store
      .read()
      .then((saved) => {
        data = saved;
      })
      .catch((error: unknown) => {
        restored = null;
        throw error;
      });
    return restored;
  }
  const active = () => data?.profiles.find((profile) => profile.id === data?.activeId);
  function status(): ChatGPTStatus {
    const profile = active();
    return {
      provider: "CHATGPT_OFFICIAL",
      runtime: "DESKTOP",
      state: attempt
        ? "AWAITING_BROWSER"
        : needsReauth
          ? "REAUTH_REQUIRED"
          : profile?.tokens
            ? planEnabled(profile)
              ? "CONNECTED"
              : "IDENTITY_ONLY"
            : "NOT_CONNECTED",
      useScope: data?.scope ?? null,
      secureStorage: dependencies.store.available() ? "AVAILABLE" : "UNAVAILABLE",
      activeProfileId: data?.activeId ?? null,
      profiles:
        data?.profiles.map((item, index) => ({
          id: item.id,
          label: `ChatGPT ${index + 1}`,
          email: item.identity?.email ?? null,
          connected: item.tokens !== null,
          planUsage: planEnabled(item),
        })) ?? [],
      lastError,
      liveVerified: false,
    };
  }
  const errorResult = (error: unknown): ChatGPTActionResult => {
    lastError = errorCode(error);
    return {
      kind: lastError === "AUTH_CANCELLED" || lastError === "AUTH_DENIED" ? "CANCELLED" : "ERROR",
      code: lastError,
      status: status(),
    };
  };
  async function persist() {
    if (data) await dependencies.store.write(data);
  }
  async function validTokens(signal: AbortSignal) {
    const profile = active();
    if (!profile?.tokens || !planEnabled(profile))
      throw new ChatGPTError("PLAN_USAGE_NOT_AUTHORIZED");
    if (needsReauth) throw new ChatGPTError("REAUTH_REQUIRED");
    if (profile.tokens.expiresAt > Date.now() + 60_000) return profile.tokens;
    if (!profile.tokens.refreshToken) {
      needsReauth = true;
      throw new ChatGPTError("REAUTH_REQUIRED");
    }
    try {
      const updated = await requestTokens(
        new URLSearchParams({
          grant_type: "refresh_token",
          client_id: profile.clientId,
          refresh_token: profile.tokens.refreshToken,
          resource: RESOURCE,
        }),
        dependencies.fetch,
        signal,
        { clientId: profile.clientId, nonce: null, previous: profile.tokens },
      );
      profile.tokens = updated;
      await persist();
      if (!planEnabled(profile)) throw new ChatGPTError("PLAN_USAGE_NOT_AUTHORIZED");
      return updated;
    } catch (error) {
      // A rotating refresh may have been accepted. Do not reuse its old token on a retry.
      profile.tokens = null;
      needsReauth = true;
      await persist().catch(() => undefined);
      throw error;
    }
  }
  return {
    async status() {
      if (dependencies.store.available()) {
        try {
          await restore();
          if (
            lastError?.startsWith("SECURE_STORAGE_") &&
            lastError !== "SECURE_STORAGE_WRITE_FAILED"
          )
            lastError = null;
        } catch (error) {
          lastError = errorCode(error);
        }
      }
      return status();
    },
    async signIn(scope, profileId) {
      if (busy) return { kind: "ERROR", code: "OPERATION_IN_PROGRESS", status: status() };
      busy = true;
      lastError = null;
      const controller = new AbortController();
      attempt = controller;
      const timer = setTimeout(
        () => controller.abort(new ChatGPTError("AUTH_ATTEMPT_EXPIRED")),
        AUTH_TTL,
      );
      try {
        if (!dependencies.store.available()) throw new ChatGPTError("SECURE_STORAGE_UNAVAILABLE");
        if (
          !(await dependencies.confirmSignIn(scope, controller.signal)) ||
          controller.signal.aborted
        )
          throw new ChatGPTError("AUTH_CANCELLED");
        await restore();
        if (!data)
          data = {
            version: 1,
            hostId: `urn:uuid:${randomUUID()}`,
            scope,
            activeId: null,
            profiles: [],
          };
        data.scope = scope;
        // Host metadata is stable before the first browser authorization.
        await persist();
        const selected =
          profileId === null
            ? undefined
            : profileId === undefined
              ? active()
              : data.profiles.find((profile) => profile.id === profileId);
        if (profileId && !selected) throw new ChatGPTError("PROFILE_NOT_FOUND");
        if (!selected && data.profiles.length >= 20) throw new ChatGPTError("PROFILE_LIMIT");
        const callback = await (dependencies.authorize ?? authorizeInBrowser)(
          {
            hostId: data.hostId,
            ...(selected
              ? {
                  clientId: selected.clientId,
                  ...(selected.tokens ? { idTokenHint: selected.tokens.idToken } : {}),
                }
              : {}),
          },
          dependencies.openBrowser,
          controller.signal,
        );
        if (controller.signal.aborted) throw new ChatGPTError("AUTH_CANCELLED");
        let profile = selected;
        if (!profile) {
          if (data.profiles.some((item) => item.clientId === callback.clientId))
            throw new ChatGPTError("REGISTRATION_MISMATCH");
          profile = { id: randomUUID(), clientId: callback.clientId, identity: null, tokens: null };
          data.profiles.push(profile);
        }
        // Retain the issued registration even if code exchange fails; never exchange using dynamic_agent_client.
        await persist();
        const tokens = await requestTokens(
          new URLSearchParams({
            grant_type: "authorization_code",
            client_id: callback.clientId,
            code: callback.code,
            code_verifier: callback.verifier,
            redirect_uri: callback.redirectUri,
            resource: RESOURCE,
          }),
          dependencies.fetch,
          controller.signal,
          { clientId: callback.clientId, nonce: callback.nonce },
        );
        if (controller.signal.aborted) throw new ChatGPTError("AUTH_CANCELLED");
        if (
          profile.identity &&
          (profile.identity.issuer !== tokens.identity.issuer ||
            profile.identity.subject !== tokens.identity.subject)
        )
          throw new ChatGPTError("ACCOUNT_MISMATCH");
        const previous = {
          identity: profile.identity,
          tokens: profile.tokens,
          activeId: data.activeId,
        };
        profile.identity = tokens.identity;
        profile.tokens = tokens;
        data.activeId = profile.id;
        try {
          await persist();
        } catch (error) {
          profile.identity = previous.identity;
          profile.tokens = previous.tokens;
          data.activeId = previous.activeId;
          throw error;
        }
        needsReauth = false;
        attempt = null;
        return { kind: "OK", status: status() };
      } catch (error) {
        attempt = null;
        return errorResult(
          controller.signal.aborted && controller.signal.reason instanceof ChatGPTError
            ? controller.signal.reason
            : error,
        );
      } finally {
        clearTimeout(timer);
        attempt = null;
        busy = false;
      }
    },
    async cancel() {
      attempt?.abort(new ChatGPTError("AUTH_CANCELLED"));
      return { kind: "CANCELLED", status: status() };
    },
    async selectProfile(profileId) {
      if (busy) return { kind: "ERROR", code: "OPERATION_IN_PROGRESS", status: status() };
      if (
        !data?.profiles.some(
          (profile) => profile.id === profileId && profile.identity && profile.tokens,
        )
      )
        return errorResult(new ChatGPTError("PROFILE_NOT_FOUND"));
      busy = true;
      const previous = data.activeId;
      try {
        data.activeId = profileId;
        await persist();
        needsReauth = false;
        lastError = null;
        return { kind: "OK", status: status() };
      } catch (error) {
        data.activeId = previous;
        return errorResult(error);
      } finally {
        busy = false;
      }
    },
    async signOut() {
      if (busy) return { kind: "ERROR", code: "OPERATION_IN_PROGRESS", status: status() };
      busy = true;
      try {
        if (!dependencies.store.available()) throw new ChatGPTError("SECURE_STORAGE_UNAVAILABLE");
        // Join any cold-start read before selecting the profile; it must not restore tokens later.
        await restore();
        const profile = active();
        let remoteConfirmed = !profile?.tokens?.refreshToken;
        if (profile?.tokens?.refreshToken) {
          try {
            const signal = AbortSignal.timeout(15_000);
            const config = await discover(dependencies.fetch, signal);
            const response = await dependencies.fetch(config.revocation, {
              method: "POST",
              redirect: "error",
              signal,
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                token: profile.tokens.refreshToken,
                token_type_hint: "refresh_token",
                client_id: profile.clientId,
              }),
            });
            remoteConfirmed = response.status === 200;
            await response.body?.cancel();
          } catch {
            remoteConfirmed = false;
          }
        }
        if (data) {
          const signedOut: AuthData = {
            ...data,
            profiles: data.profiles.map((item) =>
              item === profile ? { ...item, tokens: null } : item,
            ),
          };
          try {
            // Report local deletion only after the protected write has been confirmed.
            await dependencies.store.write(signedOut);
          } catch (error) {
            // Revocation may have succeeded even when local deletion could not be confirmed.
            if (profile?.tokens) needsReauth = true;
            throw error;
          }
          data = signedOut;
        }
        needsReauth = false;
        lastError = remoteConfirmed ? null : "REMOTE_REVOCATION_UNCONFIRMED";
        return { kind: "OK", status: status() };
      } catch (error) {
        return errorResult(error);
      } finally {
        busy = false;
      }
    },
    async generateText(input, options) {
      const hash = textRequestHash(input);
      const prior = generations.get(input.operationId);
      if (prior)
        return prior.hash === hash
          ? prior.result
          : { kind: "NOT_SENT", operationId: input.operationId, code: "OPERATION_MISMATCH" };
      if (busy)
        return { kind: "NOT_SENT", operationId: input.operationId, code: "OPERATION_IN_PROGRESS" };
      if (generations.size >= 200)
        return { kind: "NOT_SENT", operationId: input.operationId, code: "OPERATION_LIMIT" };
      busy = true;
      let sent = false;
      try {
        await restore();
        const profile = active();
        if (!profile?.tokens || !planEnabled(profile))
          throw new ChatGPTError("PLAN_USAGE_NOT_AUTHORIZED");
        const signal = AbortSignal.timeout(120_000);
        const tokens = await validTokens(signal);
        if (!tokens.accessToken) throw new ChatGPTError("PLAN_USAGE_NOT_AUTHORIZED");
        const catalog = await listModels(tokens.accessToken, dependencies.fetch, signal);
        validateTextCommand(input, catalog);
        const model = catalog.find((entry) => entry.slug === input.model);
        if (
          !model ||
          !(await dependencies.confirmText?.({
            ...input,
            profileLabel: profile.identity?.email ?? "ChatGPT",
            modelLabel: model.displayName,
          }))
        )
          throw new ChatGPTError("REQUEST_NOT_APPROVED");
        if (signal.aborted) throw new ChatGPTError("REQUEST_TIMED_OUT");
        const metadata = {
          operationId: input.operationId,
          profileId: profile.id,
          model: input.model,
          requestHash: hash,
        };
        await options.beforeSend(metadata);
        const pending: ChatGPTTextResult = {
          kind: "REMOTE_UNKNOWN",
          operationId: input.operationId,
          code: "REQUEST_IN_PROGRESS",
        };
        generations.set(input.operationId, { hash, result: pending });
        const fetcher: Fetch = async (url, init) => {
          sent = true;
          return dependencies.fetch(url, init);
        };
        const text = await completeText(
          { ...input, catalog, accessToken: tokens.accessToken },
          fetcher,
          signal,
        );
        const result: ChatGPTTextResult = {
          kind: "COMPLETED",
          ...metadata,
          text,
          completedAt: new Date().toISOString(),
        };
        generations.set(input.operationId, { hash, result });
        return result;
      } catch (error) {
        const result: ChatGPTTextResult = {
          kind: sent ? "REMOTE_UNKNOWN" : "NOT_SENT",
          operationId: input.operationId,
          code: errorCode(error),
        };
        generations.set(input.operationId, { hash, result });
        return result;
      } finally {
        busy = false;
      }
    },
    async models() {
      if (busy) return { kind: "ERROR", code: "OPERATION_IN_PROGRESS" };
      busy = true;
      try {
        const signal = AbortSignal.timeout(30_000);
        const tokens = await validTokens(signal);
        if (!tokens.accessToken) throw new ChatGPTError("PLAN_USAGE_NOT_AUTHORIZED");
        return {
          kind: "OK",
          models: await listModels(tokens.accessToken, dependencies.fetch, signal),
        };
      } catch (error) {
        lastError = errorCode(error);
        if (lastError === "REAUTH_REQUIRED") needsReauth = true;
        return { kind: "ERROR", code: lastError };
      } finally {
        busy = false;
      }
    },
  };
}

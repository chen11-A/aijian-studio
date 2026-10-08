import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatGPTError, ISSUER } from "./chatgpt-auth-oauth";
import { createChatGPTRuntime } from "./chatgpt-auth-runtime";
import { createProtectedStore, type AuthData, type Encryption } from "./chatgpt-auth-storage";
import { fixtureFetch } from "./chatgpt-auth-test-fixture";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
const identity = { issuer: ISSUER, subject: "synthetic-only", email: "synthetic@example.invalid" };
const savedAuth: AuthData = {
  version: 1,
  hostId: "urn:uuid:11111111-1111-4111-8111-111111111111",
  scope: "LOCAL_PERSONAL",
  activeId: "22222222-2222-4222-8222-222222222222",
  profiles: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      clientId: "oaiapp_synthetic",
      identity,
      tokens: {
        accessToken: "synthetic-access-only",
        refreshToken: "synthetic-refresh-only",
        idToken: "synthetic-id-only",
        expiresAt: Date.now() + 3_600_000,
        scopes: ["openid", "resource.invoke", "chatgpt.tokens.use.direct"],
        identity,
      },
    },
  ],
};
function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function setup(seed: AuthData | null = savedAuth) {
  const directory = await mkdtemp(join(tmpdir(), "aivora-signout-synthetic-"));
  directories.push(directory);
  // An ephemeral fixture key encrypts synthetic records; no OS vault or real account is used.
  const key = randomBytes(32);
  const encryption: Encryption = {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "synthetic-only",
    encryptString(text) {
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, nonce);
      const bytes = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
      return Buffer.concat([nonce, cipher.getAuthTag(), bytes]);
    },
    decryptString(bytes) {
      const cipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
      cipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString("utf8");
    },
  };
  const protectedStore = createProtectedStore(directory, encryption);
  if (seed) await protectedStore.write(structuredClone(seed));
  const store = {
    available: vi.fn(() => protectedStore.available()),
    read: vi.fn(() => protectedStore.read()),
    write: vi.fn((data: AuthData) => protectedStore.write(data)),
  };
  const fetcher = fixtureFetch();
  const confirm = vi.fn(async () => false);
  const openBrowser = vi.fn();
  const runtime = createChatGPTRuntime({
    store,
    fetch: fetcher,
    confirmSignIn: confirm,
    openBrowser,
  });
  const restart = () =>
    createChatGPTRuntime({
      store: protectedStore,
      fetch: fetcher,
      confirmSignIn: confirm,
      openBrowser,
    });
  return { directory, protectedStore, store, fetcher, confirm, openBrowser, runtime, restart };
}

describe("durable cold-start signout with synthetic encrypted profiles", () => {
  it("restores before clearing only the active tokens and stays signed out after restart", async () => {
    const seed = structuredClone(savedAuth);
    const profile = seed.profiles[0];
    if (!profile) throw new Error("missing synthetic profile");
    seed.profiles.push({
      ...structuredClone(profile),
      id: "33333333-3333-4333-8333-333333333333",
      clientId: "oaiapp_synthetic_other",
    });
    const { runtime, protectedStore, store, directory, fetcher, confirm, openBrowser, restart } =
      await setup(seed);
    expect(await runtime.signOut()).toMatchObject({
      kind: "OK",
      status: { state: "NOT_CONNECTED", lastError: null, activeProfileId: seed.activeId },
    });
    const cleared = structuredClone(seed);
    if (cleared.profiles[0]) cleared.profiles[0].tokens = null;
    expect(await protectedStore.read()).toEqual(cleared);
    expect(store.read).toHaveBeenCalledOnce();
    expect(store.write).toHaveBeenCalledOnce();
    expect(String(fetcher.mock.calls[1]?.[1]?.body)).toContain("token=synthetic-refresh-only");
    expect((await restart().status()).state).toBe("NOT_CONNECTED");
    const ciphertext = await readFile(join(directory, "profiles.enc"));
    expect(ciphertext.toString()).not.toContain("synthetic-refresh-only");
    expect(JSON.stringify(await runtime.status())).not.toMatch(/accessToken|refreshToken|idToken/);
    expect(confirm).not.toHaveBeenCalled();
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it.each(["status-first", "signout-first"])(
    "awaits a pending protected read with %s and prevents late restoration or concurrent mutations",
    async (ordering) => {
      const { runtime, store, protectedStore, fetcher, confirm, restart } = await setup();
      const gate = deferred();
      store.read.mockImplementationOnce(async () => {
        const snapshot = await protectedStore.read();
        await gate.promise;
        return snapshot;
      });
      const restoring = ordering === "status-first" ? runtime.status() : null;
      let finished = false;
      const signingOut = runtime.signOut().then((result) => {
        finished = true;
        return result;
      });
      const overlappingStatus = runtime.status();
      expect(store.read).toHaveBeenCalledOnce();
      expect(store.write).not.toHaveBeenCalled();
      expect(fetcher).not.toHaveBeenCalled();
      expect(finished).toBe(false);
      expect(await runtime.signOut()).toMatchObject({ code: "OPERATION_IN_PROGRESS" });
      expect(await runtime.selectProfile(savedAuth.activeId ?? "")).toMatchObject({
        code: "OPERATION_IN_PROGRESS",
      });
      expect(await runtime.signIn("LOCAL_PERSONAL")).toMatchObject({
        code: "OPERATION_IN_PROGRESS",
      });
      expect(await runtime.models()).toMatchObject({ code: "OPERATION_IN_PROGRESS" });
      expect(
        await runtime.generateText(
          {
            operationId: "44444444-4444-4444-8444-444444444444",
            model: "fixture-text",
            text: "Synthetic text only",
            approvalContext: "Synthetic fixture",
          },
          { beforeSend: vi.fn() },
        ),
      ).toMatchObject({ kind: "NOT_SENT", code: "OPERATION_IN_PROGRESS" });
      expect(confirm).not.toHaveBeenCalled();
      gate.resolve();
      await restoring;
      await overlappingStatus;
      expect(await signingOut).toMatchObject({ kind: "OK", status: { state: "NOT_CONNECTED" } });
      expect((await runtime.status()).state).toBe("NOT_CONNECTED");
      expect((await restart().status()).state).toBe("NOT_CONNECTED");
      expect((await protectedStore.read())?.profiles[0]?.tokens).toBeNull();
      expect(store.read).toHaveBeenCalledOnce();
    },
  );

  it.each(["SECURE_STORAGE_INVALID", "SECURE_STORAGE_UNAVAILABLE"])(
    "does not claim a successful cold signout after %s and permits a safe retry",
    async (code) => {
      const { runtime, store, protectedStore, fetcher } = await setup();
      store.read.mockRejectedValueOnce(new ChatGPTError(code));
      expect(await runtime.signOut()).toMatchObject({ kind: "ERROR", code });
      expect(store.write).not.toHaveBeenCalled();
      expect(fetcher).not.toHaveBeenCalled();
      expect(await protectedStore.read()).toEqual(savedAuth);
      expect(await runtime.signOut()).toMatchObject({
        kind: "OK",
        status: { state: "NOT_CONNECTED" },
      });
      expect(store.read).toHaveBeenCalledTimes(2);
    },
  );

  it("fails closed when storage is unavailable before reading or revoking", async () => {
    const { runtime, store, fetcher } = await setup();
    store.available.mockReturnValue(false);
    expect(await runtime.signOut()).toMatchObject({
      kind: "ERROR",
      code: "SECURE_STORAGE_UNAVAILABLE",
    });
    expect(store.read).not.toHaveBeenCalled();
    expect(store.write).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("reports a failed local clear, blocks cached token use, and retries durable deletion", async () => {
    const { runtime, store, protectedStore, fetcher, restart } = await setup();
    store.write.mockRejectedValueOnce(new ChatGPTError("SECURE_STORAGE_WRITE_FAILED"));
    expect(await runtime.signOut()).toMatchObject({
      kind: "ERROR",
      code: "SECURE_STORAGE_WRITE_FAILED",
      status: { state: "REAUTH_REQUIRED", lastError: "SECURE_STORAGE_WRITE_FAILED" },
    });
    expect(await protectedStore.read()).toEqual(savedAuth);
    expect((await restart().status()).state).toBe("CONNECTED");
    expect(await runtime.status()).toMatchObject({
      state: "REAUTH_REQUIRED",
      lastError: "SECURE_STORAGE_WRITE_FAILED",
    });
    const calls = fetcher.mock.calls.length;
    expect(await runtime.models()).toMatchObject({ kind: "ERROR", code: "REAUTH_REQUIRED" });
    expect(fetcher).toHaveBeenCalledTimes(calls);
    expect(await runtime.signOut()).toMatchObject({
      kind: "OK",
      status: { state: "NOT_CONNECTED" },
    });
    expect((await protectedStore.read())?.profiles[0]?.tokens).toBeNull();
    expect((await restart().status()).state).toBe("NOT_CONNECTED");
  });

  it("waits for protected write confirmation before presenting a locally disconnected state", async () => {
    const { runtime, store, protectedStore } = await setup();
    const gate = deferred();
    const started = deferred();
    store.write.mockImplementationOnce(async (value) => {
      started.resolve();
      await gate.promise;
      await protectedStore.write(value);
    });
    const signingOut = runtime.signOut();
    await started.promise;
    expect((await runtime.status()).state).toBe("CONNECTED");
    expect(await protectedStore.read()).toEqual(savedAuth);
    gate.resolve();
    expect(await signingOut).toMatchObject({ kind: "OK", status: { state: "NOT_CONNECTED" } });
    expect((await protectedStore.read())?.profiles[0]?.tokens).toBeNull();
  });

  it("separates remote outage from durable local signout and tolerates repeated signout", async () => {
    const { runtime, fetcher, protectedStore, restart } = await setup();
    fetcher.mockRejectedValue(new Error("synthetic remote outage; no network"));
    expect(await runtime.signOut()).toMatchObject({
      kind: "OK",
      status: { state: "NOT_CONNECTED", lastError: "REMOTE_REVOCATION_UNCONFIRMED" },
    });
    expect((await protectedStore.read())?.profiles[0]?.tokens).toBeNull();
    expect((await restart().status()).state).toBe("NOT_CONNECTED");
    const calls = fetcher.mock.calls.length;
    expect(await runtime.signOut()).toMatchObject({
      kind: "OK",
      status: { state: "NOT_CONNECTED" },
    });
    expect(fetcher).toHaveBeenCalledTimes(calls);
  });

  it("allows a cold signout after confirming no protected record exists", async () => {
    const { runtime, store, fetcher } = await setup(null);
    expect(await runtime.signOut()).toMatchObject({
      kind: "OK",
      status: { state: "NOT_CONNECTED" },
    });
    expect(store.read).toHaveBeenCalledOnce();
    expect(store.write).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createProtectedStore, validAuthData, type AuthData } from "./chatgpt-auth-storage";
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
const data: AuthData = {
  version: 1,
  hostId: "urn:uuid:11111111-1111-4111-8111-111111111111",
  activeId: null,
  scope: "LOCAL_PERSONAL",
  profiles: [],
};
const fixtureEncryption = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => "fixture-keychain",
  encryptString: (text: string) => Buffer.from([...text].reverse().join("")),
  decryptString: (bytes: Buffer) => [...bytes.toString()].reverse().join(""),
};
async function folder() {
  const root = await mkdtemp(join(tmpdir(), "aivora-auth-fixture-"));
  directories.push(root);
  return join(root, "auth");
}
describe("protected local credential boundary", () => {
  it("atomically round-trips an encrypted fixture and never writes a plaintext record", async () => {
    const path = await folder();
    const store = createProtectedStore(path, fixtureEncryption);
    expect(await store.read()).toBeNull();
    await store.write(data);
    expect(await store.read()).toEqual(data);
    const bytes = await readFile(join(path, "profiles.enc"), "utf8");
    expect(bytes).not.toContain(data.hostId);
  });
  it("refuses basic_text fallback and unavailable encryption", async () => {
    for (const encryption of [
      { ...fixtureEncryption, isEncryptionAvailable: () => false },
      { ...fixtureEncryption, getSelectedStorageBackend: () => "basic_text" },
    ]) {
      const store = createProtectedStore(await folder(), encryption);
      expect(store.available()).toBe(false);
      await expect(store.write(data)).rejects.toThrow("SECURE_STORAGE_UNAVAILABLE");
      await expect(store.read()).rejects.toThrow("SECURE_STORAGE_UNAVAILABLE");
    }
  });
  it("rejects symbolic-link credential files", async () => {
    const path = await folder();
    const store = createProtectedStore(path, fixtureEncryption);
    await store.read();
    await symlink("/does-not-exist", join(path, "profiles.enc"));
    await expect(store.read()).rejects.toThrow("SECURE_STORAGE_UNAVAILABLE");
  });
  it("rejects wrong versions, invalid scopes and incoherent active profiles", () => {
    expect(validAuthData(data)).toBe(true);
    expect(validAuthData({ ...data, version: 2 })).toBe(false);
    expect(validAuthData({ ...data, scope: "ANY_COMMERCIAL_APP" })).toBe(false);
    expect(validAuthData({ ...data, activeId: "11111111-1111-4111-8111-111111111111" })).toBe(
      false,
    );
  });
});

it("checks every saved registration/token relationship before accepting a protected record", () => {
  const identity = { issuer: "https://auth.openai.com", subject: "fixture", email: null };
  const tokens = {
    identity,
    accessToken: "fixture-access",
    refreshToken: "fixture-refresh",
    idToken: "fixture-id",
    scopes: ["openid"],
    expiresAt: 1000,
  };
  const profile = {
    id: "11111111-1111-4111-8111-111111111111",
    clientId: "oaiapp_fixture",
    identity,
    tokens,
  };
  const full = { ...data, activeId: profile.id, profiles: [profile] };
  expect(validAuthData(full)).toBe(true);
  expect(
    validAuthData({
      ...full,
      profiles: [{ ...profile, identity: { ...identity, email: "fixture@example.test" } }],
    }),
  ).toBe(true);
  expect(
    validAuthData({
      ...full,
      profiles: [{ ...profile, tokens: { ...tokens, accessToken: null, refreshToken: null } }],
    }),
  ).toBe(true);
  for (const replacement of [
    null,
    { ...profile, id: "bad" },
    { ...profile, clientId: "dynamic_agent_client" },
    { ...profile, identity: null },
    { ...profile, identity: { ...identity, issuer: "wrong" } },
    { ...profile, identity: { ...identity, subject: "wrong" } },
    { ...profile, tokens: {} },
    { ...profile, tokens: { ...tokens, accessToken: "" } },
    { ...profile, tokens: { ...tokens, refreshToken: "" } },
    { ...profile, tokens: { ...tokens, scopes: [null] } },
    { ...profile, tokens: { ...tokens, expiresAt: "1" } },
    { ...profile, tokens: { ...tokens, identity: { ...identity, issuer: "wrong" } } },
  ])
    expect(validAuthData({ ...full, profiles: [replacement] })).toBe(false);
  expect(validAuthData({ ...full, profiles: [profile, profile] })).toBe(false);
  expect(validAuthData({ ...data, hostId: "urn:uuid:wrong" })).toBe(false);
});

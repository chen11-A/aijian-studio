import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GROK_AUTHORIZE, GROK_LOOPBACK_PORT } from "./grok-auth-oauth";
import { createGrokStore, type GrokEncryption, type GrokSession } from "./grok-auth-storage";
import { createFileKeyEncryption, selectGrokEncryption } from "./grok-linux-storage";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function tempDir(): string {
  const directory = mkdtempSync(join(tmpdir(), "grok-linux-"));
  directories.push(directory);
  return directory;
}

function system(backend: string, available = true): GrokEncryption {
  return {
    isEncryptionAvailable: () => available,
    getSelectedStorageBackend: () => backend,
    encryptString: (value) => Buffer.from(value),
    decryptString: (value) => value.toString("utf8"),
  };
}

const session: GrokSession = {
  version: 1,
  accessToken: "a".repeat(40),
  refreshToken: "b".repeat(40),
  expiresAt: 1_800_000_000_000,
  scopes: ["openid"],
  subject: "subject",
  email: "person@example.test",
  name: "Person",
  inferenceDenied: false,
};

describe("Linux Grok token storage", () => {
  it("keeps the public loopback callback on 127.0.0.1:56121", () => {
    expect(GROK_LOOPBACK_PORT).toBe(56121);
    expect(GROK_AUTHORIZE).toBe("https://auth.x.ai/oauth2/authorize");
  });

  it("uses libsecret when Electron selected gnome_libsecret", () => {
    const secret = system("gnome_libsecret");
    const choice = selectGrokEncryption("linux", secret, createFileKeyEncryption(tempDir()));
    expect(choice).toMatchObject({ encryption: secret, backend: "gnome_libsecret" });
  });

  it("uses the file-key fallback when Linux would store basic_text", async () => {
    const directory = tempDir();
    const choice = selectGrokEncryption(
      "linux",
      system("basic_text"),
      createFileKeyEncryption(directory),
    );
    expect(choice.backend).toBe("file_key");
    const store = createGrokStore(directory, choice.encryption);
    expect(store.available()).toBe(true);
    await store.write(session);
    expect(await store.read()).toEqual(session);
  });

  it("leaves Windows on the operating-system store", () => {
    const secret = system("dpapi");
    expect(selectGrokEncryption("win32", secret, createFileKeyEncryption(tempDir()))).toEqual({
      encryption: secret,
      backend: "dpapi",
    });
  });
});

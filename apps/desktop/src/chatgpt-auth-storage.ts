import { constants } from "node:fs";
import { lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ChatGPTUseScope } from "@aijian/contracts/chatgpt-auth";
import { ChatGPTError, ISSUER, isRecord, issuedClient, safeString } from "./chatgpt-auth-oauth";
import type { Identity, Tokens } from "./chatgpt-auth-http";

export type Profile = {
  id: string;
  clientId: string;
  identity: Identity | null;
  tokens: Tokens | null;
};
export type AuthData = {
  version: 1;
  hostId: string;
  scope: ChatGPTUseScope;
  activeId: string | null;
  profiles: Profile[];
};
export interface ProtectedStore {
  available(): boolean;
  read(): Promise<AuthData | null>;
  write(data: AuthData): Promise<void>;
}
export interface Encryption {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend?(): string;
  encryptString(text: string): Buffer;
  decryptString(buffer: Buffer): string;
}
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
export function useScope(value: unknown): value is ChatGPTUseScope {
  return value === "LOCAL_PERSONAL" || value === "OPEN_SOURCE" || value === "APPROVED_PRIVATE";
}
function identity(value: unknown): value is Identity {
  return (
    isRecord(value) &&
    value.issuer === ISSUER &&
    safeString(value.subject, 500) &&
    (value.email === null || safeString(value.email, 254))
  );
}
function tokens(value: unknown): value is Tokens {
  return (
    isRecord(value) &&
    (value.accessToken === null || safeString(value.accessToken, 32_768)) &&
    safeString(value.idToken, 32_768) &&
    (value.refreshToken === null || safeString(value.refreshToken, 32_768)) &&
    Array.isArray(value.scopes) &&
    value.scopes.length <= 30 &&
    value.scopes.every((scope) => safeString(scope, 100)) &&
    typeof value.expiresAt === "number" &&
    Number.isFinite(value.expiresAt) &&
    identity(value.identity)
  );
}
export function validAuthData(value: unknown): value is AuthData {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.hostId !== "string" ||
    !value.hostId.startsWith("urn:uuid:") ||
    !uuid(value.hostId.slice(9)) ||
    !useScope(value.scope) ||
    !Array.isArray(value.profiles) ||
    value.profiles.length > 20 ||
    (value.activeId !== null && !uuid(value.activeId))
  )
    return false;
  const ids = new Set<string>();
  const clients = new Set<string>();
  for (const profile of value.profiles) {
    if (
      !isRecord(profile) ||
      !uuid(profile.id) ||
      !issuedClient(profile.clientId) ||
      ids.has(profile.id) ||
      clients.has(profile.clientId) ||
      (profile.identity !== null && !identity(profile.identity)) ||
      (profile.tokens !== null && !tokens(profile.tokens))
    )
      return false;
    if (
      profile.tokens !== null &&
      (!profile.identity ||
        profile.tokens.identity.issuer !== profile.identity.issuer ||
        profile.tokens.identity.subject !== profile.identity.subject)
    )
      return false;
    ids.add(profile.id);
    clients.add(profile.clientId);
  }
  return value.activeId === null || ids.has(value.activeId);
}
/** Independent credential domain. No file or encryption operation occurs in this constructor. */
export function createProtectedStore(directory: string, encryption: Encryption): ProtectedStore {
  const path = join(directory, "profiles.enc");
  const available = () =>
    encryption.isEncryptionAvailable() && encryption.getSelectedStorageBackend?.() !== "basic_text";
  async function checkDirectory() {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const stat = await lstat(directory);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (process.platform !== "win32" &&
        ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()))
    )
      throw new ChatGPTError("SECURE_STORAGE_UNAVAILABLE");
  }
  return {
    available,
    async read() {
      if (!available()) throw new ChatGPTError("SECURE_STORAGE_UNAVAILABLE");
      await checkDirectory();
      let expected;
      try {
        expected = await lstat(path);
      } catch (error) {
        if (isRecord(error) && error.code === "ENOENT") return null;
        throw new ChatGPTError("SECURE_STORAGE_UNAVAILABLE");
      }
      // O_NOFOLLOW is not available on every platform, including Windows.
      if (expected.isSymbolicLink()) throw new ChatGPTError("SECURE_STORAGE_UNAVAILABLE");
      let file;
      try {
        file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      } catch {
        throw new ChatGPTError("SECURE_STORAGE_UNAVAILABLE");
      }
      try {
        const stat = await file.stat();
        const current = await lstat(path);
        if (
          !stat.isFile() ||
          current.isSymbolicLink() ||
          stat.dev !== expected.dev ||
          stat.ino !== expected.ino ||
          stat.dev !== current.dev ||
          stat.ino !== current.ino ||
          stat.size > 2 * 1024 * 1024 ||
          (process.platform !== "win32" &&
            ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()))
        )
          throw new ChatGPTError("SECURE_STORAGE_INVALID");
        const value: unknown = JSON.parse(encryption.decryptString(await file.readFile()));
        if (!validAuthData(value)) throw new ChatGPTError("SECURE_STORAGE_INVALID");
        return value;
      } catch {
        throw new ChatGPTError("SECURE_STORAGE_INVALID");
      } finally {
        await file.close();
      }
    },
    async write(data) {
      if (!available() || !validAuthData(data))
        throw new ChatGPTError("SECURE_STORAGE_UNAVAILABLE");
      await checkDirectory();
      const temp = join(directory, `.profiles-${randomUUID()}.tmp`);
      try {
        const bytes = encryption.encryptString(JSON.stringify(data));
        const file = await open(
          temp,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
          0o600,
        );
        try {
          await file.writeFile(bytes);
          await file.sync();
        } finally {
          await file.close();
        }
        await rename(temp, path);
      } catch {
        throw new ChatGPTError("SECURE_STORAGE_WRITE_FAILED");
      } finally {
        await unlink(temp).catch(() => undefined);
      }
    },
  };
}

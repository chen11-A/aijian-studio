import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { GrokAuthError, isRecord, safeString } from "./grok-auth-oauth";

export type GrokSession = {
  version: 1;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
  subject: string;
  email: string | null;
  name: string | null;
  inferenceDenied: boolean;
};

export interface GrokStore {
  available(): boolean;
  read(): Promise<GrokSession | null>;
  write(session: GrokSession): Promise<void>;
  clear(): Promise<void>;
}

export interface GrokEncryption {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend?(): string;
  encryptString(text: string): Buffer;
  decryptString(buffer: Buffer): string;
}

export function validGrokSession(value: unknown): value is GrokSession {
  if (!isRecord(value) || value.version !== 1) return false;
  return (
    safeString(value.accessToken, 32_768) &&
    safeString(value.refreshToken, 32_768) &&
    typeof value.expiresAt === "number" &&
    Number.isFinite(value.expiresAt) &&
    Array.isArray(value.scopes) &&
    value.scopes.every((scope) => safeString(scope, 100)) &&
    safeString(value.subject, 500) &&
    (value.email === null || safeString(value.email, 254)) &&
    (value.name === null || safeString(value.name, 200)) &&
    typeof value.inferenceDenied === "boolean"
  );
}

export function createGrokStore(directory: string, encryption: GrokEncryption): GrokStore {
  const path = join(directory, "session.enc");
  const available = () =>
    encryption.isEncryptionAvailable() && encryption.getSelectedStorageBackend?.() !== "basic_text";
  async function directoryOk() {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") await chmod(directory, 0o700);
    const stat = await lstat(directory);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (process.platform !== "win32" && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()))
    ) {
      throw new GrokAuthError("SECURE_STORAGE_UNAVAILABLE");
    }
  }
  return {
    available,
    async read() {
      if (!available()) throw new GrokAuthError("SECURE_STORAGE_UNAVAILABLE");
      await directoryOk();
      let expected;
      try {
        expected = await lstat(path);
      } catch (error) {
        if (isRecord(error) && error.code === "ENOENT") return null;
        throw new GrokAuthError("SECURE_STORAGE_UNAVAILABLE");
      }
      if (expected.isSymbolicLink()) throw new GrokAuthError("SECURE_STORAGE_UNAVAILABLE");
      const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size > 1024 * 1024) throw new GrokAuthError("SECURE_STORAGE_INVALID");
        const value: unknown = JSON.parse(encryption.decryptString(await file.readFile()));
        if (!validGrokSession(value)) throw new GrokAuthError("SECURE_STORAGE_INVALID");
        return value;
      } finally {
        await file.close();
      }
    },
    async write(session) {
      if (!available() || !validGrokSession(session)) throw new GrokAuthError("SECURE_STORAGE_UNAVAILABLE");
      await directoryOk();
      const temp = join(directory, `.session-${randomUUID()}.tmp`);
      const file = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try {
        await file.writeFile(encryption.encryptString(JSON.stringify(session)));
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temp, path);
    },
    async clear() {
      await unlink(path).catch(() => undefined);
    },
  };
}

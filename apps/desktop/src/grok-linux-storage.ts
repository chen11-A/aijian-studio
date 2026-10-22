import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GrokEncryption } from "./grok-auth-storage";

const IV_BYTES = 12;
const TAG_BYTES = 16;

/** AES-256-GCM key kept in the profile directory when the desktop has no secret service. */
export function createFileKeyEncryption(directory: string): GrokEncryption {
  const keyPath = join(directory, "fallback.key");
  function key(): Buffer {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    try {
      const info = lstatSync(keyPath);
      if (!info.isFile() || info.isSymbolicLink() || info.size !== 32) {
        throw new Error("Grok file-key fallback is unusable");
      }
      const existing = readFileSync(keyPath);
      if (existing.length !== 32) throw new Error("Grok file-key fallback is unusable");
      return existing;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
      const created = randomBytes(32);
      writeFileSync(keyPath, created, { flag: "wx", mode: 0o600 });
      chmodSync(keyPath, 0o600);
      return created;
    }
  }
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "file_key",
    encryptString(text) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", key(), iv);
      const body = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]);
    },
    decryptString(buffer) {
      if (buffer.length < IV_BYTES + TAG_BYTES + 1) {
        throw new Error("Grok file-key payload is truncated");
      }
      const iv = buffer.subarray(0, IV_BYTES);
      const tag = buffer.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
      const body = buffer.subarray(IV_BYTES + TAG_BYTES);
      const decipher = createDecipheriv("aes-256-gcm", key(), iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
    },
  };
}

/**
 * Linux uses Electron safeStorage when the backend is libsecret (gnome_libsecret)
 * or KWallet. basic_text is not encrypted, so the file-key fallback is used instead.
 * Other platforms keep the operating-system store unchanged.
 */
export function selectGrokEncryption(
  platform: NodeJS.Platform,
  system: GrokEncryption,
  fileKey: GrokEncryption,
): { encryption: GrokEncryption; backend: string } {
  const reported = system.getSelectedStorageBackend?.() ?? "";
  const secure = system.isEncryptionAvailable() && reported !== "" && reported !== "basic_text";
  if (platform === "linux" && !secure) return { encryption: fileKey, backend: "file_key" };
  return { encryption: system, backend: reported || "os" };
}

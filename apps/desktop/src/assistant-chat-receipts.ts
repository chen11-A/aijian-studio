import { randomUUID } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, mkdir, open, readdir, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { AssistantChatScope } from "@aijian/contracts/official-text";

export type AssistantReceipt = {
  operationId: string;
  profileId: string;
  projectId: string | null;
  episodeId: string | null;
  inputHash: string;
  contextHash: string;
  status: "REMOTE_UNKNOWN" | "NOT_SENT" | "COMPLETED";
  responseHash: string | null;
};
export type AssistantReceiptStore = {
  reserve(receipt: AssistantReceipt): Promise<void>;
  finish(
    operationId: string,
    status: "NOT_SENT" | "COMPLETED",
    responseHash: string | null,
  ): Promise<void>;
  get(operationId: string): Promise<AssistantReceipt | null>;
  pending(scope: AssistantChatScope, profileId: string): Promise<string[]>;
};
type ReceiptIO = {
  lstat: (path: string) => Promise<BigIntStats>;
  mkdir: typeof mkdir;
  open: typeof open;
  readdir: typeof readdir;
  rename: typeof rename;
  unlink: typeof unlink;
};
const defaultIO: ReceiptIO = {
  lstat: (path) => lstat(path, { bigint: true }),
  mkdir,
  open,
  readdir,
  rename,
  unlink,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PROJECT = /^prj_[0-9a-f]{32}$/;
const EPISODE = /^ep_(?:prj_)?[0-9a-f]{32}$/;
const HASH = /^sha256:[0-9a-f]{64}$/;
const NAME = /^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.json$/;
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function valid(value: unknown): value is AssistantReceipt {
  if (!record(value) || Object.keys(value).length !== 8) return false;
  return (
    typeof value.operationId === "string" &&
    UUID.test(value.operationId) &&
    typeof value.profileId === "string" &&
    UUID.test(value.profileId) &&
    (value.projectId === null ||
      (typeof value.projectId === "string" && PROJECT.test(value.projectId))) &&
    (value.episodeId === null ||
      (typeof value.episodeId === "string" && EPISODE.test(value.episodeId))) &&
    (value.projectId !== null || value.episodeId === null) &&
    typeof value.inputHash === "string" &&
    HASH.test(value.inputHash) &&
    typeof value.contextHash === "string" &&
    HASH.test(value.contextHash) &&
    (value.status === "REMOTE_UNKNOWN" ||
      value.status === "NOT_SENT" ||
      value.status === "COMPLETED") &&
    (value.responseHash === null ||
      (typeof value.responseHash === "string" && HASH.test(value.responseHash)))
  );
}
function failure(): Error {
  return new Error("ASSISTANT_RECEIPT_UNAVAILABLE");
}
function missing(error: unknown): boolean {
  return record(error) && error.code === "ENOENT";
}

/** Each operation has one reserved file. A partial/corrupt file blocks sends rather than disappearing. */
export function createAssistantReceiptStore(
  directory: string,
  io: ReceiptIO = defaultIO,
): AssistantReceiptStore {
  async function checkDirectory(): Promise<void> {
    await io.mkdir(directory, { recursive: true, mode: 0o700 });
    const stat = await io.lstat(directory);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (process.platform !== "win32" &&
        ((stat.mode & 0o077n) !== 0n || stat.uid !== BigInt(process.getuid?.() ?? -1)))
    )
      throw failure();
  }
  function pathFor(operationId: string): string {
    if (!UUID.test(operationId)) throw failure();
    return join(directory, `${operationId}.json`);
  }
  async function read(operationId: string): Promise<AssistantReceipt | null> {
    await checkDirectory();
    const path = pathFor(operationId);
    let expected;
    try {
      expected = await io.lstat(path);
    } catch (error) {
      if (missing(error)) return null;
      throw failure();
    }
    if (
      !expected.isFile() ||
      expected.isSymbolicLink() ||
      expected.nlink !== 1n ||
      expected.size > 4096n ||
      (process.platform !== "win32" &&
        ((expected.mode & 0o077n) !== 0n || expected.uid !== BigInt(process.getuid?.() ?? -1)))
    )
      throw failure();
    let file;
    try {
      file = await io.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch {
      throw failure();
    }
    try {
      const stat = await file.stat({ bigint: true });
      const current = await io.lstat(path);
      if (
        !stat.isFile() ||
        stat.nlink !== 1n ||
        current.isSymbolicLink() ||
        stat.dev !== expected.dev ||
        stat.ino !== expected.ino ||
        stat.dev !== current.dev ||
        stat.ino !== current.ino ||
        stat.size > 4096n
      )
        throw failure();
      const parsed: unknown = JSON.parse(await file.readFile("utf8"));
      if (!valid(parsed) || parsed.operationId !== operationId) throw failure();
      return parsed;
    } catch {
      throw failure();
    } finally {
      await file.close();
    }
  }
  async function all(): Promise<AssistantReceipt[]> {
    await checkDirectory();
    const names = await io.readdir(directory);
    if (names.length > 5000) throw failure();
    const files = names.filter((name) => name.endsWith(".json"));
    if (files.some((name) => !NAME.test(name))) throw failure();
    const receipts = await Promise.all(files.map(async (name) => read(name.slice(0, -5))));
    if (receipts.some((item) => item === null)) throw failure();
    return receipts as AssistantReceipt[];
  }
  async function writeNew(receipt: AssistantReceipt): Promise<void> {
    if (!valid(receipt) || receipt.status !== "REMOTE_UNKNOWN" || receipt.responseHash !== null)
      throw failure();
    await checkDirectory();
    const file = await io.open(
      pathFor(receipt.operationId),
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await file.writeFile(JSON.stringify(receipt));
      await file.sync();
    } finally {
      await file.close();
    }
    const saved = await read(receipt.operationId);
    if (JSON.stringify(saved) !== JSON.stringify(receipt)) throw failure();
  }
  return {
    async reserve(receipt) {
      await all(); // Any corrupt record fails closed, including another operation's record.
      await writeNew(receipt);
    },
    async finish(operationId, status, responseHash) {
      const prior = await read(operationId);
      if (
        !prior ||
        prior.status !== "REMOTE_UNKNOWN" ||
        (status === "COMPLETED" && (!responseHash || !HASH.test(responseHash))) ||
        (status === "NOT_SENT" && responseHash !== null)
      )
        throw failure();
      const next: AssistantReceipt = { ...prior, status, responseHash };
      const temp = join(directory, `.${operationId}-${randomUUID()}.tmp`);
      try {
        const file = await io.open(
          temp,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
          0o600,
        );
        try {
          await file.writeFile(JSON.stringify(next));
          await file.sync();
        } finally {
          await file.close();
        }
        await io.rename(temp, pathFor(operationId));
        if (JSON.stringify(await read(operationId)) !== JSON.stringify(next)) throw failure();
      } catch {
        throw failure();
      } finally {
        await io.unlink(temp).catch(() => undefined);
      }
    },
    get: read,
    async pending(scope, profileId) {
      const receipts = await all();
      return receipts
        .filter(
          (item) =>
            item.status === "REMOTE_UNKNOWN" &&
            item.profileId === profileId &&
            item.projectId === scope.projectId &&
            item.episodeId === scope.episodeId,
        )
        .map((item) => item.operationId);
    },
  };
}

import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, symlink, link, writeFile } from "node:fs/promises";
import * as filesystem from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createAssistantReceiptStore, type AssistantReceipt } from "./assistant-chat-receipts";
import type { BigIntStats } from "node:fs";
const bigintLstat = (path: string) => filesystem.lstat(path, { bigint: true });

const id = "11111111-1111-4111-8111-111111111111";
const profile = "22222222-2222-4222-8222-222222222222";
const scope = {
  projectId: "prj_" + "a".repeat(32),
  episodeId: "ep_" + "b".repeat(32),
  page: "storyboard",
};
const receipt: AssistantReceipt = {
  operationId: id,
  profileId: profile,
  projectId: scope.projectId,
  episodeId: scope.episodeId,
  inputHash: "sha256:" + "c".repeat(64),
  contextHash: "sha256:" + "d".repeat(64),
  status: "REMOTE_UNKNOWN",
  responseHash: null,
};
const directories: string[] = [];
async function directory() {
  const root = await mkdtemp(join(tmpdir(), "aivora-assistant-test-"));
  directories.push(root);
  return root;
}
afterEach(async () => {
  for (const path of directories.splice(0)) {
    if (!resolve(path).startsWith(resolve(tmpdir(), "aivora-assistant-test-")))
      throw new Error("Unexpected test cleanup path");
    await rm(path, { recursive: true, force: true });
  }
});

describe("assistant metadata receipt", () => {
  it("retains unknown through reconstruction and finishes without storing text", async () => {
    const root = await directory();
    const first = createAssistantReceiptStore(root);
    await first.reserve(receipt);
    await expect(first.pending({ ...scope, page: "review" }, profile)).resolves.toEqual([id]);
    const reopened = createAssistantReceiptStore(root);
    await expect(reopened.get(id)).resolves.toEqual(receipt);
    await expect(reopened.reserve(receipt)).rejects.toThrow();
    await reopened.finish(id, "COMPLETED", "sha256:" + "e".repeat(64));
    await expect(reopened.pending(scope, profile)).resolves.toEqual([]);
    expect(await readFile(join(root, `${id}.json`), "utf8")).not.toContain("private manuscript");
  });

  it("fails closed for malformed metadata, symlinks and hardlinks", async () => {
    const root = await directory();
    const path = join(root, `${id}.json`);
    const store = createAssistantReceiptStore(root);
    await writeFile(path, JSON.stringify({ ...receipt, profileId: [profile] }));
    await expect(store.pending(scope, profile)).rejects.toThrow();
    await rm(path);
    const outside = join(root, "outside");
    await writeFile(outside, JSON.stringify(receipt));
    await symlink(outside, path);
    await expect(store.get(id)).rejects.toThrow();
    await rm(path);
    await link(outside, path);
    await expect(store.get(id)).rejects.toThrow();
  });

  it("fails closed on directory substitution, file access errors and inode races", async () => {
    const root = await directory();
    const store = createAssistantReceiptStore(root);
    await store.reserve(receipt);
    const base = {
      lstat: bigintLstat,
      mkdir: filesystem.mkdir,
      open: filesystem.open,
      readdir: filesystem.readdir,
      rename: filesystem.rename,
      unlink: filesystem.unlink,
    };
    const directoryLink = createAssistantReceiptStore(root, {
      ...base,
      lstat: async (path) => {
        const stat = await bigintLstat(path);
        return path === root
          ? (Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, {
              isSymbolicLink: () => true,
            }) as typeof stat)
          : stat;
      },
    });
    await expect(directoryLink.get(id)).rejects.toThrow();
    const inaccessible = createAssistantReceiptStore(root, {
      ...base,
      lstat: async (path) => {
        if (path.endsWith(`${id}.json`))
          throw Object.assign(new Error("denied"), { code: "EACCES" });
        return bigintLstat(path);
      },
    });
    await expect(inaccessible.get(id)).rejects.toThrow();
    let seen = 0;
    const replaced = createAssistantReceiptStore(root, {
      ...base,
      lstat: async (path) => {
        const stat = await bigintLstat(path);
        if (path.endsWith(`${id}.json`) && ++seen === 2)
          return Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, {
            ino: stat.ino + 1n,
          }) as typeof stat;
        return stat;
      },
    });
    await expect(replaced.get(id)).rejects.toThrow();
    const vanished = createAssistantReceiptStore(root, {
      ...base,
      lstat: async (path) => {
        if (path.endsWith(`${id}.json`)) throw Object.assign(new Error("gone"), { code: "ENOENT" });
        return bigintLstat(path);
      },
    });
    await expect(vanished.pending(scope, profile)).rejects.toThrow();
  });

  it("rejects invalid completion metadata", async () => {
    const store = createAssistantReceiptStore(await directory());
    await expect(store.reserve({ ...receipt, status: "COMPLETED" })).rejects.toThrow();
    await expect(store.finish(id, "COMPLETED", null)).rejects.toThrow();
    await store.reserve(receipt);
    await expect(store.finish(id, "COMPLETED", null)).rejects.toThrow();
    await expect(store.finish(id, "NOT_SENT", "sha256:" + "a".repeat(64))).rejects.toThrow();
  });

  it("fails closed when an existing receipt cannot open or finish atomically", async () => {
    const root = await directory();
    const store = createAssistantReceiptStore(root);
    await store.reserve(receipt);
    const base = {
      lstat: bigintLstat,
      mkdir: filesystem.mkdir,
      open: filesystem.open,
      readdir: filesystem.readdir,
      rename: filesystem.rename,
      unlink: filesystem.unlink,
    };
    const unreadable = createAssistantReceiptStore(root, {
      ...base,
      open: async (...args) => {
        if (String(args[0]).endsWith(`${id}.json`)) throw new Error("denied");
        return filesystem.open(...args);
      },
    });
    await expect(unreadable.get(id)).rejects.toThrow();
    const cannotFinish = createAssistantReceiptStore(root, {
      ...base,
      rename: async () => {
        throw new Error("rename failed");
      },
    });
    await expect(cannotFinish.finish(id, "NOT_SENT", null)).rejects.toThrow();
    expect((await store.get(id))?.status).toBe("REMOTE_UNKNOWN");
  });

  it("reads a matching receipt with exact bigint file identities", async () => {
    const root = await directory();
    const store = createAssistantReceiptStore(root);
    await store.reserve(receipt);
    const bigintReads = createAssistantReceiptStore(root, {
      lstat: bigintLstat,
      mkdir: filesystem.mkdir,
      open: filesystem.open,
      readdir: filesystem.readdir,
      rename: filesystem.rename,
      unlink: filesystem.unlink,
    });
    await expect(bigintReads.get(id)).resolves.toEqual(receipt);
  });

  it("rejects adjacent inode identities above Number.MAX_SAFE_INTEGER", async () => {
    const root = await directory();
    const store = createAssistantReceiptStore(root);
    await store.reserve(receipt);
    const huge = BigInt(Number.MAX_SAFE_INTEGER) + 100n;
    const withInode = (stat: BigIntStats, ino: bigint): BigIntStats =>
      Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, { ino }) as BigIntStats;
    let seen = 0;
    let changeAtSecond = false;
    const simulated = createAssistantReceiptStore(root, {
      lstat: async (path) => {
        const stat = await bigintLstat(path);
        if (!path.endsWith(`${id}.json`)) return stat;
        seen++;
        return withInode(stat, changeAtSecond && seen === 2 ? huge + 1n : huge);
      },
      mkdir: filesystem.mkdir,
      open: async (...args) => {
        const file = await filesystem.open(...args);
        if (!String(args[0]).endsWith(`${id}.json`)) return file;
        return new Proxy(file, {
          get(target, property) {
            if (property === "stat")
              return async () => withInode(await target.stat({ bigint: true }), huge);
            const value: unknown = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      },
      readdir: filesystem.readdir,
      rename: filesystem.rename,
      unlink: filesystem.unlink,
    });
    await expect(simulated.get(id)).resolves.toEqual(receipt);
    seen = 0;
    changeAtSecond = true;
    await expect(simulated.get(id)).rejects.toThrow("ASSISTANT_RECEIPT_UNAVAILABLE");
  });
});

import { createHash } from "node:crypto";
import { mkdtemp, writeFile, appendFile, open, rm } from "node:fs/promises";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { readMedia } from "./film-library";
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof fs>();
  return { ...actual, open: vi.fn(actual.open) };
});
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(bytes = Buffer.from("trusted audio bytes")) {
  const root = await mkdtemp(join(tmpdir(), "bounded-media-"));
  roots.push(root);
  const path = join(root, "声 音.wav");
  await writeFile(path, bytes);
  return { root, path, bytes };
}
it("keeps old bytes and supports stricter hash-bound reads", async () => {
  const { root, path, bytes } = await fixture();
  expect(await readMedia([root], path)).toEqual(new Uint8Array(bytes));
  expect(
    await readMedia([root], path, {
      maxBytes: bytes.length,
      expectedSha256: createHash("sha256").update(bytes).digest("hex"),
    }),
  ).toEqual(new Uint8Array(bytes));
  await expect(readMedia([root], path, { expectedSha256: "0".repeat(64) })).rejects.toThrow(
    "Invalid film path",
  );
  for (const options of [
    { maxBytes: 80 * 1024 * 1024 + 1 },
    { maxBytes: 0 },
    { expectedSha256: "not-a-hash" },
    { extra: true },
  ]) {
    await expect(readMedia([root], path, options)).rejects.toThrow("Invalid film path");
  }
});
it("rejects oversize before file-sized allocation or reads and closes the fd", async () => {
  const { root, path } = await fixture(Buffer.alloc(1024 * 1024));
  const handle = await open(path, "r");
  const read = vi.spyOn(handle, "read");
  const close = vi.spyOn(handle, "close");
  vi.mocked(fs.open).mockResolvedValueOnce(handle);
  const allocate = vi.spyOn(Buffer, "alloc");
  await expect(readMedia([root], path, { maxBytes: 16 })).rejects.toThrow(
    "Film media is too large",
  );
  expect(read).not.toHaveBeenCalled();
  expect(allocate.mock.calls.some(([size]) => size === 1024 * 1024)).toBe(false);
  expect(close).toHaveBeenCalledOnce();
});
it("rejects mutation during same-fd reading and always closes it", async () => {
  const { root, path } = await fixture(Buffer.alloc(128 * 1024, 1));
  const handle = await open(path, "r");
  const original = handle.read.bind(handle);
  let mutated = false;
  vi.spyOn(handle, "read").mockImplementation(async (...args: Parameters<typeof original>) => {
    const result = await original(...args);
    if (!mutated) {
      mutated = true;
      await appendFile(path, "changed");
    }
    return result;
  });
  const close = vi.spyOn(handle, "close");
  vi.mocked(fs.open).mockResolvedValueOnce(handle);
  await expect(readMedia([root], path)).rejects.toThrow("Invalid film path");
  expect(mutated).toBe(true);
  expect(close).toHaveBeenCalledOnce();
});

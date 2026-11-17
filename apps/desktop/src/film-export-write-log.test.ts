import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { INTERRUPTED_EXPORT_MESSAGE } from "@aijian/contracts/film-export-qc";
import { createExportWriteLog, recoverInterruptedExports } from "./film-export-write-log";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function place() {
  const root = await mkdtemp(join(tmpdir(), "export-writes-"));
  roots.push(root);
  const directory = join(root, "chosen");
  const journal = join(root, "journals");
  await mkdir(directory);
  await mkdir(journal);
  return { directory, journal, log: createExportWriteLog(journal) };
}

it("removes an interrupted file and a temp directory, and leaves a file this export did not write", async () => {
  const { directory, journal, log } = await place();
  const ours = join(directory, "half.mp4");
  const userFile = join(directory, "用户原有.mp4");
  const temp = join(directory, ".aivora-qc-dead");
  await writeFile(ours, "partial");
  await writeFile(userFile, "keep me");
  await mkdir(temp);
  await writeFile(join(temp, "film.mp4"), "temp");
  const id = await log.begin(directory);
  await log.noteFile(id, { path: ours, aspectRatio: "16:9" });
  await log.noteTemp(id, temp);
  const result = await recoverInterruptedExports(journal);
  expect(result).toEqual({
    kind: "CLEARED",
    message: INTERRUPTED_EXPORT_MESSAGE,
    kept: [],
  });
  await expect(readFile(ours)).rejects.toThrow();
  expect(await readFile(userFile, "utf8")).toBe("keep me");
  await expect(readFile(join(temp, "film.mp4"))).rejects.toThrow();
});

it("keeps a finished aspect and removes only the unfinished one after a crash", async () => {
  const { directory, journal, log } = await place();
  const first = join(directory, "片-16x9.mp4");
  const sameName = join(directory, "片-16x9.mp4.user");
  const second = join(directory, "片-9x16.mp4");
  await writeFile(first, "done");
  await writeFile(sameName, "user-owned");
  await writeFile(second, "torn");
  const id = await log.begin(directory);
  await log.noteFile(id, { path: first, aspectRatio: "16:9" });
  await log.completeAspect(id, "16:9");
  await log.noteFile(id, { path: second, aspectRatio: "9:16" });
  const result = await recoverInterruptedExports(journal);
  expect(result).toEqual({
    kind: "CLEARED",
    message: INTERRUPTED_EXPORT_MESSAGE,
    kept: [{ aspectRatio: "16:9" }],
  });
  expect(await readFile(first, "utf8")).toBe("done");
  expect(await readFile(sameName, "utf8")).toBe("user-owned");
  await expect(readFile(second)).rejects.toThrow();
});

it("does not follow a journal path that leaves the chosen folder", async () => {
  const { directory, journal } = await place();
  const outside = join(journal, "outside.mp4");
  await writeFile(outside, "outside");
  const id = "escape";
  await writeFile(
    join(journal, `${id}.json`),
    JSON.stringify({
      schemaVersion: 1,
      id,
      directory,
      files: [{ path: outside, aspectRatio: "16:9", complete: false }],
      temps: [join(journal, ".aivora-qc-escaped")],
    }),
  );
  const escaped = join(journal, ".aivora-qc-escaped");
  await mkdir(escaped);
  await writeFile(join(escaped, "film.mp4"), "no");
  const result = await recoverInterruptedExports(journal);
  expect(result.kind).toBe("CLEARED");
  expect(await readFile(outside, "utf8")).toBe("outside");
  expect(await readFile(join(escaped, "film.mp4"), "utf8")).toBe("no");
});

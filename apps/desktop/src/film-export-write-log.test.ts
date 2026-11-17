import { lstat, mkdtemp, mkdir, readFile, readdir, symlink, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { constants } from "node:fs";
import { afterEach, expect, it } from "vitest";
import { INTERRUPTED_EXPORT_MESSAGE } from "@aijian/contracts/film-export-qc";
import {
  createExportWriteLog,
  directorySyncMaySkip,
  ExportJournalError,
  recoverInterruptedExports,
  writeOwnerMarker,
} from "./film-export-write-log";

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

it("clears the whole set when the first aspect was written and the process died during the second", async () => {
  const { directory, journal, log } = await place();
  const first = join(directory, "片-16x9.mp4");
  const sameName = join(directory, "片-16x9.mp4.user");
  const second = join(directory, "片-9x16.mp4");
  await writeFile(first, "done");
  await writeFile(sameName, "user-owned");
  await writeFile(second, "torn");
  const id = await log.begin(directory);
  await log.noteFile(id, { path: first, aspectRatio: "16:9" });
  await log.noteFile(id, { path: second, aspectRatio: "9:16" });
  const result = await recoverInterruptedExports(journal);
  expect(result).toEqual({
    kind: "CLEARED",
    message: INTERRUPTED_EXPORT_MESSAGE,
    kept: [],
  });
  await expect(readFile(first)).rejects.toThrow();
  expect(await readFile(sameName, "utf8")).toBe("user-owned");
  await expect(readFile(second)).rejects.toThrow();
});

it("keeps the first aspect after a committed partial result, including across a restart", async () => {
  const { directory, journal, log } = await place();
  const first = join(directory, "片-16x9.mp4");
  const second = join(directory, "片-9x16.mp4");
  await writeFile(first, "kept");
  await writeFile(second, "torn");
  const id = await log.begin(directory);
  await log.noteFile(id, { path: first, aspectRatio: "16:9" });
  await log.noteFile(id, { path: second, aspectRatio: "9:16" });
  await rm(second);
  await log.commit(id, "partial");
  const result = await recoverInterruptedExports(journal);
  expect(result).toEqual({ kind: "NONE" });
  expect(await readFile(first, "utf8")).toBe("kept");
  expect(await readdir(journal)).toEqual([]);
});

it("leaves both files after a committed published result", async () => {
  const { directory, journal, log } = await place();
  const first = join(directory, "片-16x9.mp4");
  const second = join(directory, "片-9x16.mp4");
  await writeFile(first, "wide");
  await writeFile(second, "tall");
  const id = await log.begin(directory);
  await log.noteFile(id, { path: first, aspectRatio: "16:9" });
  await log.noteFile(id, { path: second, aspectRatio: "9:16" });
  await log.commit(id, "published");
  expect(await recoverInterruptedExports(journal)).toEqual({ kind: "NONE" });
  expect(await readFile(first, "utf8")).toBe("wide");
  expect(await readFile(second, "utf8")).toBe("tall");
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

it("does not delete a same-path file replaced after the journal was written", async () => {
  const { directory, journal, log } = await place();
  const ours = join(directory, "half.mp4");
  await writeFile(ours, "partial");
  const id = await log.begin(directory);
  await log.noteFile(id, { path: ours, aspectRatio: "16:9" });
  await rm(ours);
  await writeFile(ours, "user replacement");
  const result = await recoverInterruptedExports(journal);
  expect(result.kind).toBe("CLEARED");
  expect(await readFile(ours, "utf8")).toBe("user replacement");
});

it("does not delete an in-place overwrite of an unfinished export file", async () => {
  const { directory, journal, log } = await place();
  const ours = join(directory, "half.mp4");
  await writeFile(ours, "partial");
  const id = await log.begin(directory);
  await log.noteFile(id, { path: ours, aspectRatio: "16:9" });
  await writeFile(ours, "user overwrite");
  await recoverInterruptedExports(journal);
  expect(await readFile(ours, "utf8")).toBe("user overwrite");
});

it("does not follow a symlink that replaced an unfinished export file", async () => {
  const { directory, journal, log } = await place();
  const ours = join(directory, "half.mp4");
  const outside = join(journal, "precious.mp4");
  await writeFile(ours, "partial");
  await writeFile(outside, "keep");
  const id = await log.begin(directory);
  await log.noteFile(id, { path: ours, aspectRatio: "16:9" });
  await rm(ours);
  await symlink(outside, ours);
  await recoverInterruptedExports(journal);
  expect(await readFile(outside, "utf8")).toBe("keep");
  expect((await lstat(ours)).isSymbolicLink()).toBe(true);
});

it("does not remove an outside directory through a temp path that became a symlink", async () => {
  const { directory, journal, log } = await place();
  const temp = join(directory, ".aivora-qc-dead");
  const outside = join(journal, "outside-dir");
  await mkdir(temp);
  await mkdir(outside);
  await writeFile(join(outside, "keep.txt"), "keep");
  const id = await log.begin(directory);
  await log.noteTemp(id, temp);
  await rm(temp, { recursive: true });
  await symlink(outside, temp, "dir");
  await recoverInterruptedExports(journal);
  expect(await readFile(join(outside, "keep.txt"), "utf8")).toBe("keep");
  expect((await lstat(temp)).isSymbolicLink()).toBe(true);
});

it("does not delete a user directory that appears at a reserved temp path before this export creates it", async () => {
  const { directory, journal, log } = await place();
  const id = await log.begin(directory);
  const reserved = await log.reserveTemp(id);
  if (!reserved) throw new Error("reservation required");
  await mkdir(reserved.path);
  await writeFile(join(reserved.path, "user.txt"), "mine");
  const result = await recoverInterruptedExports(journal);
  expect(result.kind).toBe("CLEARED");
  expect(await readFile(join(reserved.path, "user.txt"), "utf8")).toBe("mine");
});

it("removes a temp directory whose owner marker was written before the claim was saved", async () => {
  const { directory, journal, log } = await place();
  const id = await log.begin(directory);
  const reserved = await log.reserveTemp(id);
  if (!reserved) throw new Error("reservation required");
  await mkdir(reserved.path);
  await writeOwnerMarker(reserved.path, reserved.nonce);
  await writeFile(join(reserved.path, "film.mp4"), "temp");
  const result = await recoverInterruptedExports(journal);
  expect(result.kind).toBe("CLEARED");
  await expect(readFile(join(reserved.path, "film.mp4"))).rejects.toThrow();
});

it("does not delete a different file that occupies a planned link path", async () => {
  const { directory, journal, log } = await place();
  const source = join(directory, "staged.mp4");
  const destination = join(directory, "final.mp4");
  await writeFile(source, "ours");
  await writeFile(destination, "user already here");
  const id = await log.begin(directory);
  await log.planLink(id, { path: destination, aspectRatio: "16:9", sourcePath: source });
  const result = await recoverInterruptedExports(journal);
  expect(result.kind).toBe("CLEARED");
  expect(await readFile(destination, "utf8")).toBe("user already here");
});

it("deletes a hardlink that was created after the plan and before the claim", async () => {
  const { directory, journal, log } = await place();
  const source = join(directory, "staged.mp4");
  const destination = join(directory, "final.mp4");
  await writeFile(source, "ours");
  const id = await log.begin(directory);
  await log.planLink(id, { path: destination, aspectRatio: "16:9", sourcePath: source });
  const { link } = await import("node:fs/promises");
  await link(source, destination);
  const result = await recoverInterruptedExports(journal);
  expect(result.kind).toBe("CLEARED");
  await expect(readFile(destination)).rejects.toThrow();
  expect(await readFile(source, "utf8")).toBe("ours");
});

it("keeps the open journal and the first file when committing partial cannot be stored", async () => {
  const { directory, journal } = await place();
  let armed = false;
  const log = createExportWriteLog(journal, {
    fault: (stored) => (armed && stored.outcome === "partial" ? "fsync" : undefined),
  });
  const first = join(directory, "片-16x9.mp4");
  await writeFile(first, "kept");
  const id = await log.begin(directory);
  await log.noteFile(id, { path: first, aspectRatio: "16:9" });
  armed = true;
  await expect(log.commit(id, "partial")).rejects.toMatchObject({
    name: "ExportJournalError",
    code: "ENOSPC",
  });
  const stored = JSON.parse(await readFile(join(journal, `${id}.json`), "utf8")) as {
    outcome: string;
  };
  expect(stored.outcome).toBe("open");
  expect(await readFile(first, "utf8")).toBe("kept");
});

it("rejects a rename failure without marking the export partial", async () => {
  const { directory, journal } = await place();
  const log = createExportWriteLog(journal, { fault: () => "rename" });
  await expect(log.begin(directory)).rejects.toMatchObject({
    name: "ExportJournalError",
    code: "ENOSPC",
  });
  expect(await readdir(journal)).toEqual([]);
});

it("rejects a directory sync failure without treating the in-memory journal as committed", async () => {
  const { directory, journal } = await place();
  let armed = false;
  const log = createExportWriteLog(journal, {
    fault: (stored) => (armed && stored.outcome === "published" ? "dirsync" : undefined),
  });
  const file = join(directory, "片.mp4");
  await writeFile(file, "done");
  const id = await log.begin(directory);
  await log.noteFile(id, { path: file, aspectRatio: "16:9" });
  armed = true;
  await expect(log.commit(id, "published")).rejects.toBeInstanceOf(ExportJournalError);
  expect(await recoverInterruptedExports(journal)).toEqual({ kind: "NONE" });
  expect(await readFile(file, "utf8")).toBe("done");
});

it("does not follow a symlink that replaced the chosen directory", async () => {
  const { directory, journal, log } = await place();
  const file = join(directory, "half.mp4");
  const outside = join(journal, "outside-dir");
  await writeFile(file, "partial");
  await mkdir(outside);
  await writeFile(join(outside, "keep.txt"), "keep");
  const id = await log.begin(directory);
  await log.noteFile(id, { path: file, aspectRatio: "16:9" });
  await rm(directory, { recursive: true });
  await symlink(outside, directory, "dir");
  const result = await recoverInterruptedExports(journal);
  expect(result.kind).toBe("RETRY");
  expect(await readFile(join(outside, "keep.txt"), "utf8")).toBe("keep");
});

it("does not delete a temp directory the user replaced at the same path", async () => {
  const { directory, journal, log } = await place();
  const temp = join(directory, ".aivora-qc-dead");
  await mkdir(temp);
  const id = await log.begin(directory);
  await log.noteTemp(id, temp);
  await rm(temp, { recursive: true });
  await mkdir(temp);
  await writeFile(join(temp, "user.txt"), "keep");
  await recoverInterruptedExports(journal);
  expect(await readFile(join(temp, "user.txt"), "utf8")).toBe("keep");
});

it("puts a file back when its bytes change while the hash is being checked", async () => {
  const { directory, journal, log } = await place();
  const file = join(directory, "half.mp4");
  await writeFile(file, "partial");
  const id = await log.begin(directory);
  await log.noteFile(id, { path: file, aspectRatio: "16:9" });
  const result = await recoverInterruptedExports(journal, {
    beforeHash: async (claim) => {
      await writeFile(claim, "user replaced during hash");
    },
  });
  expect(result.kind).toBe("CLEARED");
  expect(await readFile(file, "utf8")).toBe("user replaced during hash");
});

it("keeps the journal when an injected read of the chosen directory fails", async () => {
  const { directory, journal, log } = await place();
  const file = join(directory, "half.mp4");
  await writeFile(file, "partial");
  const id = await log.begin(directory);
  await log.noteFile(id, { path: file, aspectRatio: "16:9" });
  const readError = Object.assign(new Error("read EIO"), { code: "EIO", syscall: "stat" });
  const result = await recoverInterruptedExports(journal, {
    readChosenDirectory: () => Promise.reject(readError),
  });
  expect(result.kind).toBe("RETRY");
  expect(await readdir(journal)).toContain(`${id}.json`);
  expect(await readFile(file, "utf8")).toBe("partial");
});

it("does not report a cleared export when deleting the file is denied", async () => {
  const { directory, journal, log } = await place();
  const file = join(directory, "half.mp4");
  await writeFile(file, "partial");
  const id = await log.begin(directory);
  await log.noteFile(id, { path: file, aspectRatio: "16:9" });
  await expect(
    recoverInterruptedExports(journal, {
      afterVerifiedFile: () => Promise.reject(Object.assign(new Error("rm EIO"), { code: "EIO" })),
    }),
  ).resolves.toMatchObject({ kind: "RETRY" });
  expect(await readdir(journal)).toContain(`${id}.json`);
  expect(await readFile(file, "utf8")).toBe("partial");
});

it("reports retry instead of none when the journal directory itself cannot be listed", async () => {
  const root = await mkdtemp(join(tmpdir(), "export-writes-"));
  roots.push(root);
  const blocked = join(root, "not-a-directory");
  await writeFile(blocked, "file");
  await expect(recoverInterruptedExports(blocked)).resolves.toMatchObject({ kind: "RETRY" });
});

it.each(["mkdir", "open", "write", "fsync", "close", "rename"] as const)(
  "does not commit when %s fails with ENOSPC",
  async (step) => {
    const { directory, journal } = await place();
    let armed = false;
    const log = createExportWriteLog(journal, {
      fault: (stored) => (armed && stored.outcome === "partial" ? step : undefined),
    });
    const first = join(directory, "片-16x9.mp4");
    await writeFile(first, "kept");
    const id = await log.begin(directory);
    await log.noteFile(id, { path: first, aspectRatio: "16:9" });
    armed = true;
    const error = await log.commit(id, "partial").then(
      () => {
        throw new Error("commit should fail");
      },
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({ name: "ExportJournalError", code: "ENOSPC" });
    expect((error as { cause?: { code?: string; syscall?: string } }).cause).toMatchObject({
      code: "ENOSPC",
      syscall: step,
    });
    expect(JSON.parse(await readFile(join(journal, `${id}.json`), "utf8")).outcome).toBe("open");
    expect(await readFile(first, "utf8")).toBe("kept");
  },
);

it("does not treat a directory sync failure as a committed partial", async () => {
  const { directory, journal } = await place();
  let armed = false;
  const log = createExportWriteLog(journal, {
    fault: (stored) => (armed && stored.outcome === "partial" ? "dirsync" : undefined),
  });
  const first = join(directory, "片-16x9.mp4");
  await writeFile(first, "kept");
  const id = await log.begin(directory);
  await log.noteFile(id, { path: first, aspectRatio: "16:9" });
  armed = true;
  const error = await log.commit(id, "partial").then(
    () => {
      throw new Error("commit should fail");
    },
    (caught: unknown) => caught,
  );
  expect(error).toMatchObject({ name: "ExportJournalError", code: "EIO" });
  expect((error as { cause?: { syscall?: string } }).cause).toMatchObject({ syscall: "fsync" });
  expect(await readFile(first, "utf8")).toBe("kept");
});

it("treats only unsupported Windows directory codes as skippable", async () => {
  expect(directorySyncMaySkip("win32", "EINVAL")).toBe(true);
  expect(directorySyncMaySkip("win32", "EISDIR")).toBe(true);
  expect(directorySyncMaySkip("win32", "ENOTSUP")).toBe(true);
  expect(directorySyncMaySkip("win32", "EACCES")).toBe(false);
  expect(directorySyncMaySkip("win32", "EPERM")).toBe(false);
  expect(directorySyncMaySkip("win32", "EIO")).toBe(false);
  expect(directorySyncMaySkip("win32", "ENOSPC")).toBe(false);
  expect(directorySyncMaySkip("linux", "EINVAL")).toBe(false);
  const { directory, journal } = await place();
  const log = createExportWriteLog(journal, { fault: () => "diropen" });
  await expect(log.begin(directory)).rejects.toMatchObject({ code: "EACCES" });
});

it("runs directory flush through writable open, narrow fallback, and fail-closed errors", async () => {
  const unsupported = ["EISDIR", "EINVAL", "ENOTSUP", "EOPNOTSUPP"] as const;
  const failClosed = ["EPERM", "EACCES", "EIO", "ENOSPC"] as const;
  function ioError(code: string, syscall: string) {
    return Object.assign(new Error(`${syscall} ${code}`), { code, syscall });
  }
  async function drive(
    platform: string,
    behavior: {
      failOpen?: (flags: string | number) => string | undefined;
      failSync?: string;
    } = {},
  ) {
    const flags: Array<string | number> = [];
    let closes = 0;
    const { directory, journal } = await place();
    const log = createExportWriteLog(journal, {
      directorySync: {
        platform,
        open: async (_path, flag) => {
          flags.push(flag);
          const code = behavior.failOpen?.(flag);
          if (code) throw ioError(code, "open");
          return {
            async sync() {
              if (behavior.failSync) throw ioError(behavior.failSync, "fsync");
            },
            async close() {
              closes += 1;
            },
          };
        },
      },
    });
    return {
      flags,
      closed: () => closes,
      directory,
      journal,
      log,
    };
  }
  async function keptOpen(journal: string) {
    const names = (await readdir(journal)).filter((name) => name.endsWith(".json"));
    expect(names).toHaveLength(1);
    expect(JSON.parse(await readFile(join(journal, names[0]!), "utf8")).outcome).toBe("open");
  }

  const real = await place();
  const realId = await real.log.begin(real.directory);
  expect(JSON.parse(await readFile(join(real.journal, `${realId}.json`), "utf8")).outcome).toBe(
    "open",
  );

  const writable = await drive("win32");
  await writable.log.begin(writable.directory);
  expect(writable.flags).toEqual([constants.O_RDWR]);
  expect(writable.closed()).toBe(1);
  await keptOpen(writable.journal);

  for (const code of unsupported) {
    const fallback = await drive("win32", {
      failOpen: (flags) => (flags === constants.O_RDWR ? code : undefined),
    });
    await fallback.log.begin(fallback.directory);
    expect(fallback.flags).toEqual([constants.O_RDWR, "r"]);
    expect(fallback.closed()).toBe(1);
    await keptOpen(fallback.journal);
  }

  for (const code of failClosed) {
    const denied = await drive("win32", { failOpen: () => code });
    await expect(denied.log.begin(denied.directory)).rejects.toMatchObject({
      name: "ExportJournalError",
      code,
    });
    expect(denied.flags).toEqual([constants.O_RDWR]);
    expect(denied.closed()).toBe(0);
    await keptOpen(denied.journal);

    const synced = await drive("win32", { failSync: code });
    await expect(synced.log.begin(synced.directory)).rejects.toMatchObject({
      name: "ExportJournalError",
      code,
    });
    expect(synced.flags).toEqual([constants.O_RDWR]);
    expect(synced.closed()).toBe(1);
    await keptOpen(synced.journal);
  }

  const afterFallback = await drive("win32", {
    failOpen: (flags) => (flags === constants.O_RDWR ? "EISDIR" : undefined),
    failSync: "EPERM",
  });
  await expect(afterFallback.log.begin(afterFallback.directory)).rejects.toMatchObject({
    name: "ExportJournalError",
    code: "EPERM",
  });
  expect(afterFallback.flags).toEqual([constants.O_RDWR, "r"]);
  expect(afterFallback.closed()).toBe(1);
  await keptOpen(afterFallback.journal);

  const skipped = await drive("win32", { failSync: "EINVAL" });
  await skipped.log.begin(skipped.directory);
  expect(skipped.flags).toEqual([constants.O_RDWR]);
  expect(skipped.closed()).toBe(1);
  await keptOpen(skipped.journal);

  const linux = await drive("linux", { failSync: "EINVAL" });
  await expect(linux.log.begin(linux.directory)).rejects.toMatchObject({
    name: "ExportJournalError",
    code: "EINVAL",
  });
  expect(linux.flags).toEqual(["r"]);
  expect(linux.closed()).toBe(1);
  await keptOpen(linux.journal);
});

it("keeps the journal when a planned link or temp has not been cleaned", async () => {
  const { directory, journal, log } = await place();
  const source = join(directory, "staged.mp4");
  const destination = join(directory, "final.mp4");
  const temp = join(directory, ".aivora-qc-live");
  await writeFile(source, "ours");
  await mkdir(temp);
  const id = await log.begin(directory);
  await log.planLink(id, { path: destination, aspectRatio: "16:9", sourcePath: source });
  const { link } = await import("node:fs/promises");
  await link(source, destination);
  await log.noteTemp(id, temp);
  await log.finish(id);
  expect(await readdir(journal)).toContain(`${id}.json`);
});

it("drops the journal only after the owned file and temp are confirmed gone", async () => {
  const { directory, journal, log } = await place();
  const file = join(directory, "half.mp4");
  await writeFile(file, "partial");
  const id = await log.begin(directory);
  await log.noteFile(id, { path: file, aspectRatio: "16:9" });
  await rm(file);
  await log.finish(id);
  expect(await readdir(journal)).toEqual([]);
});

it("deletes a claim left when recovery itself stops after the rename", async () => {
  const { directory, journal, log } = await place();
  const source = join(directory, "staged.mp4");
  const destination = join(directory, "final.mp4");
  await writeFile(source, "ours");
  const id = await log.begin(directory);
  await log.planLink(id, { path: destination, aspectRatio: "16:9", sourcePath: source });
  const { link } = await import("node:fs/promises");
  await link(source, destination);
  const first = await recoverInterruptedExports(journal, { crashAfterClaim: true });
  expect(first.kind).toBe("RETRY");
  expect(await readdir(journal)).toContain(`${id}.json`);
  const names = await readdir(directory);
  expect(names.some((name) => name.startsWith(".aivora-claim-"))).toBe(true);
  expect(names).not.toContain("final.mp4");
  const second = await recoverInterruptedExports(journal);
  expect(second.kind).toBe("CLEARED");
  const after = await readdir(directory);
  expect(after.some((name) => name.startsWith(".aivora-claim-"))).toBe(false);
  expect(after).not.toContain("final.mp4");
  expect(await readFile(source, "utf8")).toBe("ours");
});

it("removes its claim when the user has taken the original path before the next recovery", async () => {
  const { directory, journal, log } = await place();
  const source = join(directory, "staged.mp4");
  const destination = join(directory, "final.mp4");
  await writeFile(source, "ours");
  const id = await log.begin(directory);
  await log.planLink(id, { path: destination, aspectRatio: "16:9", sourcePath: source });
  const { link } = await import("node:fs/promises");
  await link(source, destination);
  expect((await recoverInterruptedExports(journal, { crashAfterClaim: true })).kind).toBe("RETRY");
  await writeFile(destination, "user now");
  const second = await recoverInterruptedExports(journal);
  expect(second.kind).toBe("CLEARED");
  expect(await readFile(destination, "utf8")).toBe("user now");
  expect((await readdir(directory)).some((name) => name.startsWith(".aivora-claim-"))).toBe(false);
  expect(await readdir(journal)).toEqual([]);
});

it("does not move a claim onto a user file that appeared at the original path", async () => {
  const { directory, journal, log } = await place();
  const file = join(directory, "half.mp4");
  await writeFile(file, "partial");
  const id = await log.begin(directory);
  await log.noteFile(id, { path: file, aspectRatio: "16:9" });
  const result = await recoverInterruptedExports(journal, {
    beforeHash: async (claim) => {
      await writeFile(claim, "changed isolated bytes");
    },
    beforeRestore: async (original) => {
      await writeFile(original, "user arrived");
    },
  });
  expect(result.kind).toBe("RETRY");
  expect(await readFile(file, "utf8")).toBe("user arrived");
  expect(await readdir(journal)).toContain(`${id}.json`);
  expect((await readdir(directory)).some((name) => name.startsWith(".aivora-claim-"))).toBe(true);
});

it("does not delete a file swapped in after the identity check", async () => {
  const { directory, journal, log } = await place();
  const file = join(directory, "half.mp4");
  await writeFile(file, "partial");
  const id = await log.begin(directory);
  await log.noteFile(id, { path: file, aspectRatio: "16:9" });
  const result = await recoverInterruptedExports(journal, {
    afterVerifiedFile: async (claim) => {
      await rm(claim);
      await writeFile(claim, "user after check");
    },
  });
  expect(result.kind).toBe("RETRY");
  const claim = (await readdir(directory)).find((name) => name.startsWith(".aivora-claim-"));
  expect(claim).toBeTruthy();
  expect(await readFile(join(directory, claim!), "utf8")).toBe("user after check");
});

it("does not recursively delete a temp directory swapped in after the marker check", async () => {
  const { directory, journal, log } = await place();
  const temp = join(directory, ".aivora-qc-live");
  await mkdir(temp);
  const id = await log.begin(directory);
  await log.noteTemp(id, temp);
  const result = await recoverInterruptedExports(journal, {
    afterVerifiedTemp: async (found) => {
      await rm(found, { recursive: true });
      await mkdir(found);
      await writeFile(join(found, "user.txt"), "keep");
    },
  });
  expect(result.kind).toBe("RETRY");
  expect(await readFile(join(temp, "user.txt"), "utf8")).toBe("keep");
  expect(await readdir(journal)).toContain(`${id}.json`);
});

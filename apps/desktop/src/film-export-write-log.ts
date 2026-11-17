import { createHash, randomUUID } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import {
  lstat,
  open,
  readdir,
  readFile,
  rename,
  rm,
  mkdir,
  writeFile,
  link,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  INTERRUPTED_EXPORT_MESSAGE,
  INTERRUPTED_EXPORT_RETRY_MESSAGE,
  type FilmExportRecovery,
} from "@aijian/contracts/film-export-qc";

type FileIdentity = { dev: string; ino: string; size: string; mtimeNs: string; sha256: string };
type DirIdentity = { dev: string; ino: string };
type NotedFile = {
  path: string;
  aspectRatio: "16:9" | "9:16";
  /** linking: planned before link. owned: inode matched after link. */
  phase?: "linking" | "owned";
  source?: FileIdentity;
  identity?: FileIdentity;
};
type TempRecord = {
  path: string;
  nonce: string;
  /** creating: name reserved. owned: directory inode and marker recorded. legacy: unidentifiable. */
  phase: "creating" | "owned" | "legacy";
  identity?: DirIdentity;
};
/** open: the process died before a final result. partial/published: the running process committed one. */
type Outcome = "open" | "partial" | "published";
type Journal = {
  schemaVersion: 1;
  id: string;
  directory: string;
  directoryIdentity?: DirIdentity;
  outcome: Outcome;
  files: NotedFile[];
  temps: TempRecord[];
};
type Step = "deleted" | "skipped" | "retry";
export type ExportWriteFault =
  "mkdir" | "open" | "write" | "fsync" | "close" | "rename" | "dirsync" | "diropen" | "finish";
type WriteLogOptions = {
  fault?: (journal: { outcome: string }) => ExportWriteFault | undefined;
  /** Test hook. Runs after the file is claimed and before its hash is trusted. */
  beforeHash?: (path: string) => Promise<void>;
  /** Runs after identity and hash match, immediately before delete. */
  afterVerifiedFile?: (path: string) => Promise<void>;
  /** Runs after a temp marker matches, immediately before the directory is removed. */
  afterVerifiedTemp?: (path: string) => Promise<void>;
  /** Plants a file at the original path before a claim is moved back. */
  beforeRestore?: (path: string) => Promise<void>;
  /** Stops recovery after the claim rename, leaving that claim for the next start. */
  crashAfterClaim?: boolean;
  /**
   * Test seam for directory flush. Absent means the real filesystem and this process.
   * Production writes do not set it.
   */
  directorySync?: DirectorySyncIO;
  /**
   * Test seam for the chosen-directory read. Absent means the real lstat.
   * Production recovery does not set it.
   */
  readChosenDirectory?: (directory: string) => Promise<void>;
};

type DirectorySyncHandle = {
  sync: () => Promise<void>;
  close: () => Promise<void>;
};
type DirectorySyncIO = {
  platform: string;
  open: (path: string, flags: string | number) => Promise<DirectorySyncHandle>;
};

/**
 * Windows can reject the directory-flush call shape itself. A real access or disk
 * error is not that shape: EPERM, EACCES, EIO and ENOSPC stay fail-closed, including
 * when they come from the file write, file fsync, or rename.
 */
export function directorySyncMaySkip(platform: string, code: string | undefined) {
  return (
    platform === "win32" &&
    (code === "EINVAL" || code === "ENOTSUP" || code === "EOPNOTSUPP" || code === "EISDIR")
  );
}

/**
 * FlushFileBuffers requires GENERIC_WRITE. libuv maps "r" to FILE_GENERIC_READ and
 * still sets FILE_FLAG_BACKUP_SEMANTICS, so syncing that handle returns EPERM even
 * when this process can rename into the directory. A writable open is the documented
 * call. If Windows rejects FILE_WRITE_DATA on a directory as an invalid open, fall
 * back to the read handle and still require the flush to succeed.
 */
const directorySyncReadFlags = "r";
function realDirectorySync(): DirectorySyncIO {
  return { platform: process.platform, open };
}
async function openDirectoryForSync(dir: string, io: DirectorySyncIO) {
  if (io.platform !== "win32") return io.open(dir, directorySyncReadFlags);
  try {
    return await io.open(dir, constants.O_RDWR);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EISDIR" || code === "EINVAL" || code === "ENOTSUP" || code === "EOPNOTSUPP")
      return io.open(dir, directorySyncReadFlags);
    throw error;
  }
}

function rawIo(code: string, syscall: string) {
  return Object.assign(new Error(`${syscall} ${code}`), { code, syscall });
}

const MARKER = ".aivora-owner";

export class ExportJournalError extends Error {
  readonly code: string;
  constructor(code = "JOURNAL_FAILED", cause?: unknown) {
    super("导出记录没有写稳");
    this.name = "ExportJournalError";
    this.code = code;
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

function persistError(error: unknown) {
  if (error instanceof ExportJournalError) return error;
  return new ExportJournalError((error as NodeJS.ErrnoException).code || "JOURNAL_FAILED", error);
}

function contained(directory: string, target: string) {
  const root = resolve(directory);
  const path = resolve(target);
  const part = relative(root, path);
  return !!part && !isAbsolute(part) && part !== ".." && !part.startsWith("..");
}

function ioStep(error: unknown): Step {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ENOENT") return "skipped";
  return "retry";
}

async function digest(path: string) {
  const hash = createHash("sha256");
  await new Promise<void>((resolveHash, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolveHash());
  });
  return hash.digest("hex");
}

async function fileIdentity(path: string): Promise<FileIdentity | undefined> {
  const info = await lstat(path, { bigint: true });
  if (info.isSymbolicLink() || !info.isFile()) return undefined;
  return {
    dev: info.dev.toString(),
    ino: info.ino.toString(),
    size: info.size.toString(),
    mtimeNs: info.mtimeNs.toString(),
    sha256: await digest(path),
  };
}

function sameFile(
  info: {
    dev: bigint;
    ino: bigint;
    size: bigint;
    mtimeNs: bigint;
    isSymbolicLink: () => boolean;
    isFile: () => boolean;
  },
  identity: FileIdentity | undefined,
) {
  return (
    !!identity &&
    !info.isSymbolicLink() &&
    info.isFile() &&
    info.dev.toString() === identity.dev &&
    info.ino.toString() === identity.ino &&
    info.size.toString() === identity.size &&
    info.mtimeNs.toString() === identity.mtimeNs
  );
}

function sameDir(
  info: { dev: bigint; ino: bigint; isSymbolicLink: () => boolean; isDirectory: () => boolean },
  identity: DirIdentity | undefined,
) {
  return (
    !!identity &&
    !info.isSymbolicLink() &&
    info.isDirectory() &&
    info.dev.toString() === identity.dev &&
    info.ino.toString() === identity.ino
  );
}

/** Directory fsync makes the rename durable where the platform allows it. It is not a power-loss proof. */
async function syncDirectory(
  dir: string,
  fault: ExportWriteFault | undefined,
  io: DirectorySyncIO,
) {
  if (fault === "diropen") throw rawIo("EACCES", "open");
  let opened: DirectorySyncHandle;
  try {
    opened = await openDirectoryForSync(dir, io);
  } catch (error) {
    if (directorySyncMaySkip(io.platform, (error as NodeJS.ErrnoException).code)) return;
    throw error;
  }
  try {
    if (fault === "dirsync") throw rawIo("EIO", "fsync");
    await opened.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (directorySyncMaySkip(io.platform, code)) return;
    throw error;
  } finally {
    await opened.close();
  }
}

async function ancestorsReal(
  directory: string,
  target: string,
  root: DirIdentity | undefined,
  readChosenDirectory?: (directory: string) => Promise<void>,
) {
  if (!contained(directory, target)) return "skipped" as const;
  if (readChosenDirectory) {
    try {
      await readChosenDirectory(directory);
    } catch (error) {
      return ioStep(error);
    }
  }
  let current;
  try {
    current = await lstat(directory, { bigint: true });
  } catch (error) {
    return ioStep(error);
  }
  if (current.isSymbolicLink() || !current.isDirectory()) return "retry" as const;
  if (root && (current.dev.toString() !== root.dev || current.ino.toString() !== root.ino))
    return "retry" as const;
  let cursor = resolve(target);
  const stop = resolve(directory);
  const seen = new Set<string>();
  while (cursor !== stop) {
    const parent = dirname(cursor);
    if (parent === cursor || seen.has(parent)) return "retry" as const;
    seen.add(parent);
    let info;
    try {
      info = await lstat(parent, { bigint: true });
    } catch (error) {
      return ioStep(error);
    }
    if (info.isSymbolicLink() || !info.isDirectory()) return "retry" as const;
    cursor = parent;
  }
  return "ok" as const;
}

/** Link back only when the original path is absent. A new file there stays, and so does the claim. */
async function restore(claim: string, path: string): Promise<"restored" | "conflict" | "retry"> {
  try {
    await lstat(path);
    return "conflict";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return "retry";
  }
  try {
    await link(claim, path);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EEXIST" ? "conflict" : "retry";
  }
  try {
    await rm(claim, { force: true });
  } catch {
    return "retry";
  }
  return "restored";
}

/** Durable list of one export. Startup deletes an open set, and leaves a committed one. */
export function createExportWriteLog(root: string, options: WriteLogOptions = {}) {
  const live = new Map<string, Journal>();
  async function save(journal: Journal) {
    const fault = options.fault?.(journal);
    let temporary = "";
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      // mkdir, open, write, fsync, close, rename, and directory sync share one boundary.
      if (fault === "mkdir") throw rawIo("ENOSPC", "mkdir");
      await mkdir(root, { recursive: true });
      const finalPath = join(root, `${journal.id}.json`);
      temporary = `${finalPath}.${process.pid}.${randomUUID()}.tmp`;
      if (fault === "open") throw rawIo("ENOSPC", "open");
      handle = await open(temporary, "w");
      if (fault === "write") throw rawIo("ENOSPC", "write");
      await handle.writeFile(JSON.stringify(journal));
      if (fault === "fsync") throw rawIo("ENOSPC", "fsync");
      await handle.sync();
      if (fault === "close") throw rawIo("ENOSPC", "close");
      await handle.close();
      handle = undefined;
      if (fault === "rename") throw rawIo("ENOSPC", "rename");
      await rename(temporary, finalPath);
      temporary = "";
      await syncDirectory(root, fault, options.directorySync ?? realDirectorySync());
    } catch (error) {
      if (handle) await handle.close().catch(() => undefined);
      if (temporary) await rm(temporary, { force: true }).catch(() => undefined);
      throw persistError(error);
    }
  }
  function adopt(journal: Journal, next: Journal) {
    journal.outcome = next.outcome;
    journal.files = next.files;
    journal.temps = next.temps;
    journal.directoryIdentity = next.directoryIdentity;
  }
  return {
    async begin(directory: string) {
      const resolved = resolve(directory);
      const info = await lstat(resolved, { bigint: true });
      if (info.isSymbolicLink() || !info.isDirectory()) throw new ExportJournalError();
      const journal: Journal = {
        schemaVersion: 1,
        id: randomUUID(),
        directory: resolved,
        directoryIdentity: { dev: info.dev.toString(), ino: info.ino.toString() },
        outcome: "open",
        files: [],
        temps: [],
      };
      await save(journal);
      live.set(journal.id, journal);
      return journal.id;
    },
    /** Persist the temp path before creating it. A crash here deletes nothing that we did not mark. */
    async reserveTemp(id: string) {
      const journal = live.get(id);
      if (!journal || journal.outcome !== "open") return undefined;
      const nonce = randomUUID();
      const path = join(journal.directory, `.aivora-qc-${nonce}`);
      const next = structuredClone(journal);
      next.temps.push({ path, nonce, phase: "creating" });
      await save(next);
      adopt(journal, next);
      return { path, nonce };
    },
    async claimTemp(id: string, path: string) {
      const journal = live.get(id);
      const entry = journal?.temps.find((item) => item.path === resolve(path));
      if (!journal || journal.outcome !== "open" || !entry || entry.phase !== "creating")
        throw new ExportJournalError();
      const info = await lstat(entry.path, { bigint: true });
      if (info.isSymbolicLink() || !info.isDirectory()) throw new ExportJournalError();
      const marker = await readFile(join(entry.path, MARKER), "utf8");
      if (marker !== entry.nonce) throw new ExportJournalError();
      const next = structuredClone(journal);
      const saved = next.temps.find((item) => item.path === entry.path);
      if (!saved) throw new ExportJournalError();
      saved.phase = "owned";
      saved.identity = { dev: info.dev.toString(), ino: info.ino.toString() };
      await save(next);
      adopt(journal, next);
    },
    async noteTemp(id: string, path: string) {
      const journal = live.get(id);
      if (!journal || journal.outcome !== "open" || !contained(journal.directory, path)) return;
      const info = await lstat(path, { bigint: true });
      if (info.isSymbolicLink() || !info.isDirectory()) return;
      const nonce = randomUUID();
      await writeFile(join(path, MARKER), nonce, { flag: "wx" });
      const next = structuredClone(journal);
      next.temps.push({
        path: resolve(path),
        nonce,
        phase: "owned",
        identity: { dev: info.dev.toString(), ino: info.ino.toString() },
      });
      await save(next);
      adopt(journal, next);
    },
    /** Persist the destination plan and the staged file's identity before link. */
    async planLink(
      id: string,
      file: { path: string; aspectRatio: "16:9" | "9:16"; sourcePath: string },
    ) {
      const journal = live.get(id);
      if (!journal || journal.outcome !== "open" || !contained(journal.directory, file.path))
        throw new ExportJournalError();
      const source = await fileIdentity(file.sourcePath);
      if (!source) throw new ExportJournalError();
      const next = structuredClone(journal);
      next.files.push({
        path: resolve(file.path),
        aspectRatio: file.aspectRatio,
        phase: "linking",
        source,
      });
      await save(next);
      adopt(journal, next);
    },
    /** Record the hardlink only after its inode is the staged file. */
    async claimLink(id: string, path: string) {
      const journal = live.get(id);
      const target = resolve(path);
      const entry = journal?.files.find((item) => item.path === target && item.phase === "linking");
      if (!journal || journal.outcome !== "open" || !entry?.source) throw new ExportJournalError();
      const info = await lstat(target, { bigint: true });
      if (
        info.isSymbolicLink() ||
        !info.isFile() ||
        info.dev.toString() !== entry.source.dev ||
        info.ino.toString() !== entry.source.ino
      )
        throw new ExportJournalError();
      const next = structuredClone(journal);
      const saved = next.files.find((item) => item.path === target && item.phase === "linking");
      if (!saved) throw new ExportJournalError();
      saved.phase = "owned";
      saved.identity = entry.source;
      await save(next);
      adopt(journal, next);
    },
    async noteFile(id: string, file: { path: string; aspectRatio: "16:9" | "9:16" }) {
      const journal = live.get(id);
      if (!journal || journal.outcome !== "open" || !contained(journal.directory, file.path))
        return;
      const identity = await fileIdentity(file.path).catch(() => undefined);
      if (!identity) return;
      const next = structuredClone(journal);
      next.files.push({
        path: resolve(file.path),
        aspectRatio: file.aspectRatio,
        phase: "owned",
        source: identity,
        identity,
      });
      await save(next);
      adopt(journal, next);
    },
    /** The outcome changes only after the new journal is on disk. */
    async commit(id: string, outcome: "partial" | "published") {
      const journal = live.get(id);
      if (!journal || journal.outcome !== "open") return;
      const next = structuredClone(journal);
      next.outcome = outcome;
      await save(next);
      adopt(journal, next);
    },
    async finish(id: string) {
      const journal = live.get(id);
      if (options.fault?.(journal ?? { outcome: "open" }) === "finish")
        throw new ExportJournalError("finish");
      live.delete(id);
      if (!journal || journal.outcome !== "open") return;
      if (await cleanupUnconfirmed(journal)) return;
      await rm(join(root, `${id}.json`), { force: true });
    },
  };
}

async function claimStillThere(directory: string, identity: FileIdentity) {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    return ioStep(error) === "retry";
  }
  for (const name of names) {
    if (!name.startsWith(".aivora-claim-")) continue;
    try {
      const info = await lstat(join(directory, name), { bigint: true });
      if (sameFile(info, identity)) return true;
    } catch (error) {
      if (ioStep(error) === "retry") return true;
    }
  }
  return false;
}

/** True when a plan, claim, or temp is still ours, or when we could not check. */
async function cleanupUnconfirmed(journal: Journal) {
  for (const file of journal.files) {
    if (!file?.path || !contained(journal.directory, file.path)) continue;
    const identity = file.phase === "linking" ? file.source : file.identity;
    if (!identity) continue;
    try {
      const info = await lstat(file.path, { bigint: true });
      if (!info.isSymbolicLink() && info.isFile()) {
        if (
          file.phase === "linking" &&
          info.dev.toString() === identity.dev &&
          info.ino.toString() === identity.ino
        )
          return true;
        if (file.phase !== "linking" && sameFile(info, identity)) return true;
      }
    } catch (error) {
      if (ioStep(error) === "retry") return true;
    }
    if (await claimStillThere(journal.directory, identity)) return true;
  }
  for (const temp of journal.temps) {
    if (!temp?.path || temp.phase === "legacy" || !contained(journal.directory, temp.path))
      continue;
    try {
      const info = await lstat(temp.path, { bigint: true });
      if (info.isSymbolicLink() || !info.isDirectory()) continue;
      if (temp.phase === "owned" && temp.identity && !sameDir(info, temp.identity)) continue;
      const marker = await readFile(join(temp.path, MARKER), "utf8");
      if (temp.nonce && marker === temp.nonce) return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      return true;
    }
  }
  return false;
}

async function safeDeleteFile(
  path: string,
  identity: FileIdentity,
  options: WriteLogOptions,
): Promise<Step> {
  let info;
  try {
    info = await lstat(path, { bigint: true });
  } catch (error) {
    return ioStep(error);
  }
  if (!sameFile(info, identity)) return "skipped";
  const claim = join(dirname(path), `.aivora-claim-${randomUUID()}`);
  try {
    await rename(path, claim);
  } catch (error) {
    return ioStep(error);
  }
  if (options.crashAfterClaim) {
    options.crashAfterClaim = false;
    return "retry";
  }
  try {
    const claimed = await lstat(claim, { bigint: true });
    if (
      claimed.isSymbolicLink() ||
      claimed.dev.toString() !== identity.dev ||
      claimed.ino.toString() !== identity.ino
    )
      return "retry";
    if (options.beforeHash) await options.beforeHash(claim);
    const hash = await digest(claim);
    const after = await lstat(claim, { bigint: true });
    if (
      after.dev.toString() !== identity.dev ||
      after.ino.toString() !== identity.ino ||
      hash !== identity.sha256 ||
      !sameFile(after, identity)
    ) {
      if (after.dev.toString() !== identity.dev || after.ino.toString() !== identity.ino)
        return "retry";
      if (options.beforeRestore) await options.beforeRestore(path);
      const restored = await restore(claim, path);
      return restored === "restored" ? "skipped" : "retry";
    }
    if (options.afterVerifiedFile) await options.afterVerifiedFile(claim);
    const finalInfo = await lstat(claim, { bigint: true });
    if (!sameFile(finalInfo, identity)) return "retry";
    await rm(claim, { force: true });
    return "deleted";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "retry";
    const restored = await restore(claim, path);
    return restored === "restored" ? ioStep(error) : "retry";
  }
}

/** Deletes only a `.aivora-claim-` file whose recorded identity still matches. Not a scan of unknown user contents, and not an atomic guarantee against a replacement in the last unlink. */
async function deleteClaimedCopy(
  directory: string,
  identity: FileIdentity,
  options: WriteLogOptions,
): Promise<Step> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    return ioStep(error);
  }
  for (const name of names) {
    if (!name.startsWith(".aivora-claim-")) continue;
    const path = join(directory, name);
    let info;
    try {
      info = await lstat(path, { bigint: true });
    } catch (error) {
      return ioStep(error);
    }
    if (!sameFile(info, identity)) continue;
    try {
      if ((await digest(path)) !== identity.sha256) continue;
      if (options.afterVerifiedFile) await options.afterVerifiedFile(path);
      const again = await lstat(path, { bigint: true });
      if (!sameFile(again, identity)) return "retry";
      await rm(path, { force: true });
      return "deleted";
    } catch (error) {
      return ioStep(error);
    }
  }
  return "skipped";
}

async function removeTemp(
  journal: Journal,
  temp: TempRecord,
  options: WriteLogOptions,
): Promise<Step> {
  const gate = await ancestorsReal(
    journal.directory,
    temp.path,
    journal.directoryIdentity,
    options.readChosenDirectory,
  );
  if (gate !== "ok") return gate === "skipped" ? "skipped" : "retry";
  let info;
  try {
    info = await lstat(temp.path, { bigint: true });
  } catch (error) {
    return ioStep(error);
  }
  if (info.isSymbolicLink()) return "skipped";
  if (temp.phase === "owned") {
    if (!sameDir(info, temp.identity)) return "skipped";
    let marker: string;
    try {
      marker = await readFile(join(temp.path, MARKER), "utf8");
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ENOENT" ? "skipped" : ioStep(error);
    }
    if (marker !== temp.nonce) return "skipped";
    if (options.afterVerifiedTemp) await options.afterVerifiedTemp(temp.path);
    let again;
    try {
      again = await lstat(temp.path, { bigint: true });
    } catch (error) {
      return ioStep(error);
    }
    if (!sameDir(again, temp.identity)) return "retry";
    try {
      if ((await readFile(join(temp.path, MARKER), "utf8")) !== temp.nonce) return "retry";
      await rm(temp.path, { recursive: true, force: true });
      return "deleted";
    } catch {
      return "retry";
    }
  }
  if (temp.phase !== "creating" || !info.isDirectory()) return "skipped";
  let marker: string;
  try {
    marker = await readFile(join(temp.path, MARKER), "utf8");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? "skipped" : ioStep(error);
  }
  if (marker !== temp.nonce) return "skipped";
  if (options.afterVerifiedTemp) await options.afterVerifiedTemp(temp.path);
  try {
    if ((await readFile(join(temp.path, MARKER), "utf8")) !== temp.nonce) return "retry";
    const again = await lstat(temp.path, { bigint: true });
    if (again.isSymbolicLink() || !again.isDirectory()) return "retry";
    await rm(temp.path, { recursive: true, force: true });
    return "deleted";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? "retry" : ioStep(error);
  }
}

function normalize(raw: Journal): Journal {
  const temps = (raw.temps ?? []).map((item) =>
    typeof item === "string" ? { path: item, nonce: "", phase: "legacy" as const } : item,
  );
  return { ...raw, files: raw.files ?? [], temps };
}

export async function recoverInterruptedExports(
  root: string,
  options: WriteLogOptions = {},
): Promise<FilmExportRecovery> {
  let names: string[];
  try {
    names = await readdir(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "NONE" };
    return { kind: "RETRY", message: INTERRUPTED_EXPORT_RETRY_MESSAGE };
  }
  let interrupted = false;
  let retry = false;
  for (const name of names) {
    if (!name.endsWith(".json") || name.includes(".tmp")) continue;
    let journal: Journal;
    try {
      journal = normalize(JSON.parse(await readFile(join(root, name), "utf8")) as Journal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      retry = true;
      continue;
    }
    if (journal?.schemaVersion !== 1 || typeof journal.directory !== "string") continue;
    const outcome = journal.outcome ?? "open";
    if (outcome === "partial" || outcome === "published") {
      let failed = false;
      for (const temp of journal.temps) {
        if ((await removeTemp(journal, temp, options)) === "retry") failed = true;
      }
      if (failed) {
        retry = true;
        continue;
      }
      try {
        await rm(join(root, name), { force: true });
      } catch {
        retry = true;
      }
      continue;
    }
    if (outcome !== "open") continue;
    interrupted = true;
    let failed = false;
    const gate = await ancestorsReal(
      journal.directory,
      join(journal.directory, "x"),
      journal.directoryIdentity,
      options.readChosenDirectory,
    );
    if (gate === "retry") {
      retry = true;
      continue;
    }
    for (const file of journal.files) {
      if (!file?.path) continue;
      const ancestry = await ancestorsReal(
        journal.directory,
        file.path,
        journal.directoryIdentity,
        options.readChosenDirectory,
      );
      if (ancestry === "retry") {
        failed = true;
        continue;
      }
      if (ancestry === "skipped") continue;
      const identity = file.phase === "linking" ? undefined : file.identity;
      const recorded = file.phase === "linking" ? file.source : identity;
      if (!recorded) continue;
      // Claims are ours even when the original path now belongs to the user.
      // Only names this export created are considered, and only when the identity matches.
      const claim = await deleteClaimedCopy(journal.directory, recorded, options);
      if (claim === "retry") failed = true;
      let info;
      try {
        info = await lstat(file.path, { bigint: true });
      } catch (error) {
        if (ioStep(error) === "retry") failed = true;
        continue;
      }
      const ours =
        !info.isSymbolicLink() &&
        info.isFile() &&
        info.dev.toString() === recorded.dev &&
        info.ino.toString() === recorded.ino &&
        (file.phase === "linking" || sameFile(info, recorded));
      if (!ours) continue;
      const step = await safeDeleteFile(file.path, recorded, options);
      if (step === "retry") failed = true;
    }
    for (const temp of journal.temps) {
      if ((await removeTemp(journal, temp, options)) === "retry") failed = true;
    }
    if (failed) {
      retry = true;
      continue;
    }
    try {
      await rm(join(root, name), { force: true });
    } catch {
      retry = true;
    }
  }
  if (retry) return { kind: "RETRY", message: INTERRUPTED_EXPORT_RETRY_MESSAGE };
  if (!interrupted) return { kind: "NONE" };
  return { kind: "CLEARED", message: INTERRUPTED_EXPORT_MESSAGE, kept: [] };
}

export async function writeOwnerMarker(directory: string, nonce: string) {
  await writeFile(join(directory, MARKER), nonce, { flag: "wx" });
}

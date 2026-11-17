import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, open, readdir, readFile, rename, rm, mkdir, writeFile } from "node:fs/promises";
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
export type ExportWriteFault = "fsync" | "rename" | "dirsync" | "finish";
type WriteLogOptions = {
  fault?: (journal: { outcome: string }) => ExportWriteFault | undefined;
  /** Test hook. Runs after the file is claimed and before its hash is trusted. */
  beforeHash?: (path: string) => Promise<void>;
};

const MARKER = ".aivora-owner";

export class ExportJournalError extends Error {
  readonly code = "JOURNAL_FAILED";
  constructor(message = "导出记录没有写稳") {
    super(message);
    this.name = "ExportJournalError";
  }
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

/** Directory fsync makes the rename durable where the platform allows it. Windows often rejects it. */
async function syncDirectory(dir: string) {
  let handle;
  try {
    handle = await open(dir, "r");
  } catch (error) {
    if (process.platform === "win32") return;
    throw error;
  }
  try {
    await handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // A directory handle on Windows commonly fails here. File fsync plus rename
    // is what this process can do; it is not a power-loss proof.
    if (
      process.platform === "win32" &&
      (code === "EPERM" || code === "EINVAL" || code === "ENOTSUP" || code === "EISDIR")
    )
      return;
    throw error;
  } finally {
    await handle.close();
  }
}

async function ancestorsReal(directory: string, target: string, root: DirIdentity | undefined) {
  if (!contained(directory, target)) return "skipped" as const;
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

async function restore(claim: string, path: string) {
  try {
    await rename(claim, path);
  } catch {
    /* The claim file stays. A later start matches it by identity and does not delete a different file. */
  }
}

/** Durable list of one export. Startup deletes an open set, and leaves a committed one. */
export function createExportWriteLog(root: string, options: WriteLogOptions = {}) {
  const live = new Map<string, Journal>();
  async function save(journal: Journal) {
    await mkdir(root, { recursive: true });
    const finalPath = join(root, `${journal.id}.json`);
    const temporary = `${finalPath}.${process.pid}.${randomUUID()}.tmp`;
    const fault = options.fault?.(journal);
    const handle = await open(temporary, "w");
    try {
      await handle.writeFile(JSON.stringify(journal));
      if (fault === "fsync")
        throw Object.assign(new ExportJournalError("fsync"), { code: "ENOSPC" });
      await handle.sync();
    } catch (error) {
      await handle.close().catch(() => undefined);
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
    await handle.close();
    if (fault === "rename") {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw Object.assign(new ExportJournalError("rename"), { code: "ENOSPC" });
    }
    await rename(temporary, finalPath);
    if (fault === "dirsync")
      throw Object.assign(new ExportJournalError("dirsync"), { code: "EIO" });
    await syncDirectory(root);
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
      for (const file of journal.files) {
        if (file.phase !== "owned" || !file.identity || !contained(journal.directory, file.path))
          continue;
        try {
          const info = await lstat(file.path, { bigint: true });
          if (!sameFile(info, file.identity)) continue;
          if ((await digest(file.path)) === file.identity.sha256) return;
        } catch (error) {
          if (ioStep(error) === "retry") return;
        }
      }
      await rm(join(root, `${id}.json`), { force: true });
    },
  };
}

async function safeDeleteFile(
  path: string,
  identity: FileIdentity,
  beforeHash?: (path: string) => Promise<void>,
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
  try {
    const claimed = await lstat(claim, { bigint: true });
    if (!sameFile(claimed, identity)) {
      await restore(claim, path);
      return "skipped";
    }
    if (beforeHash) await beforeHash(claim);
    const hash = await digest(claim);
    const after = await lstat(claim, { bigint: true });
    if (hash !== identity.sha256 || !sameFile(after, identity)) {
      await restore(claim, path);
      return "skipped";
    }
    await rm(claim, { force: true });
    return "deleted";
  } catch (error) {
    await restore(claim, path);
    return ioStep(error);
  }
}

async function deleteClaimedCopy(directory: string, identity: FileIdentity): Promise<Step> {
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
      await rm(path, { force: true });
      return "deleted";
    } catch (error) {
      return ioStep(error);
    }
  }
  return "skipped";
}

async function removeTemp(journal: Journal, temp: TempRecord): Promise<Step> {
  const gate = await ancestorsReal(journal.directory, temp.path, journal.directoryIdentity);
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
    try {
      await rm(temp.path, { recursive: true, force: true });
      return "deleted";
    } catch (error) {
      return ioStep(error);
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
  try {
    await rm(temp.path, { recursive: true, force: true });
    return "deleted";
  } catch (error) {
    return ioStep(error);
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
        if ((await removeTemp(journal, temp)) === "retry") failed = true;
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
    );
    if (gate === "retry") {
      retry = true;
      continue;
    }
    for (const file of journal.files) {
      if (!file?.path) continue;
      const ancestry = await ancestorsReal(journal.directory, file.path, journal.directoryIdentity);
      if (ancestry === "retry") {
        failed = true;
        continue;
      }
      if (ancestry === "skipped") continue;
      const identity = file.phase === "linking" ? undefined : file.identity;
      if (file.phase === "linking" && file.source) {
        let info;
        try {
          info = await lstat(file.path, { bigint: true });
        } catch (error) {
          if (ioStep(error) === "retry") failed = true;
          continue;
        }
        if (
          info.isSymbolicLink() ||
          !info.isFile() ||
          info.dev.toString() !== file.source.dev ||
          info.ino.toString() !== file.source.ino
        )
          continue;
        const step = await safeDeleteFile(file.path, file.source, options.beforeHash);
        if (step === "retry") failed = true;
        continue;
      }
      if (!identity) continue;
      let present: Step;
      try {
        await lstat(file.path, { bigint: true });
        present = await safeDeleteFile(file.path, identity, options.beforeHash);
      } catch (error) {
        present = ioStep(error);
      }
      if (present === "skipped") {
        const claim = await deleteClaimedCopy(journal.directory, identity);
        if (claim === "retry") failed = true;
      } else if (present === "retry") failed = true;
    }
    for (const temp of journal.temps) {
      if ((await removeTemp(journal, temp)) === "retry") failed = true;
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

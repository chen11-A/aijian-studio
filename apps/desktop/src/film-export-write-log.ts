import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, open, readdir, readFile, rename, rm, mkdir } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import {
  INTERRUPTED_EXPORT_MESSAGE,
  type FilmExportRecovery,
} from "@aijian/contracts/film-export-qc";

type FileIdentity = { dev: string; ino: string; size: string; mtimeNs: string; sha256: string };
type NotedFile = {
  path: string;
  aspectRatio: "16:9" | "9:16";
  identity?: FileIdentity;
};
/** open: the process died before a final result. partial/published: the running process committed one. */
type Outcome = "open" | "partial" | "published";
type Journal = {
  schemaVersion: 1;
  id: string;
  directory: string;
  outcome: Outcome;
  files: NotedFile[];
  temps: string[];
};

function contained(directory: string, target: string) {
  const root = resolve(directory);
  const path = resolve(target);
  const part = relative(root, path);
  return !!part && !isAbsolute(part) && part !== ".." && !part.startsWith("..");
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

function sameIdentity(
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

/** Durable list of one export. Startup deletes an open set, and leaves a committed one. */
export function createExportWriteLog(root: string) {
  const live = new Map<string, Journal>();
  async function save(journal: Journal) {
    await mkdir(root, { recursive: true });
    const finalPath = join(root, `${journal.id}.json`);
    const temporary = `${finalPath}.${process.pid}.tmp`;
    const handle = await open(temporary, "w");
    try {
      await handle.writeFile(JSON.stringify(journal));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, finalPath);
  }
  return {
    async begin(directory: string) {
      const journal: Journal = {
        schemaVersion: 1,
        id: randomUUID(),
        directory: resolve(directory),
        outcome: "open",
        files: [],
        temps: [],
      };
      await save(journal);
      live.set(journal.id, journal);
      return journal.id;
    },
    async noteTemp(id: string, path: string) {
      const journal = live.get(id);
      if (!journal || journal.outcome !== "open" || !contained(journal.directory, path)) return;
      journal.temps.push(resolve(path));
      await save(journal);
    },
    async noteFile(id: string, file: { path: string; aspectRatio: "16:9" | "9:16" }) {
      const journal = live.get(id);
      if (!journal || journal.outcome !== "open" || !contained(journal.directory, file.path))
        return;
      const identity = await fileIdentity(file.path).catch(() => undefined);
      if (!identity) return;
      journal.files.push({ ...file, path: resolve(file.path), identity });
      await save(journal);
    },
    /** Persist the running process's final result. An open journal is still a crash. */
    async commit(id: string, outcome: "partial" | "published") {
      const journal = live.get(id);
      if (!journal || journal.outcome !== "open") return;
      journal.outcome = outcome;
      await save(journal);
    },
    async finish(id: string) {
      const journal = live.get(id);
      live.delete(id);
      if (!journal || journal.outcome !== "open") return;
      // A handled rollback already removed its files. Leave a journal that still
      // matches files on disk, so a death before this call is cleaned next start.
      for (const file of journal.files) {
        if (!file.identity || !contained(journal.directory, file.path)) continue;
        try {
          const info = await lstat(file.path, { bigint: true });
          if (!sameIdentity(info, file.identity)) continue;
          if ((await digest(file.path)) === file.identity.sha256) return;
        } catch {
          /* Already gone. */
        }
      }
      await rm(join(root, `${id}.json`), { force: true });
    },
  };
}

async function removeTemps(journal: Journal) {
  for (const temp of journal.temps ?? []) {
    if (typeof temp !== "string" || !basename(temp).startsWith(".aivora-qc-")) continue;
    let info;
    try {
      info = await lstat(temp);
    } catch {
      continue;
    }
    if (info.isSymbolicLink() || !contained(journal.directory, temp)) continue;
    await rm(temp, { recursive: true, force: true });
  }
}

export async function recoverInterruptedExports(root: string): Promise<FilmExportRecovery> {
  let names: string[];
  try {
    names = await readdir(root);
  } catch {
    return { kind: "NONE" };
  }
  let interrupted = false;
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    let journal: Journal;
    try {
      journal = JSON.parse(await readFile(join(root, name), "utf8")) as Journal;
    } catch {
      continue;
    }
    if (journal?.schemaVersion !== 1 || typeof journal.directory !== "string") continue;
    const outcome = journal.outcome ?? "open";
    if (outcome === "partial" || outcome === "published") {
      await removeTemps(journal);
      await rm(join(root, name), { force: true });
      continue;
    }
    if (outcome !== "open") continue;
    interrupted = true;
    for (const file of journal.files ?? []) {
      if (!file?.path || !contained(journal.directory, file.path)) continue;
      let info;
      try {
        info = await lstat(file.path, { bigint: true });
      } catch {
        continue;
      }
      // A symlink, a replacement at the same path, or a content change is the
      // user's file now. Leave it, and do not follow a link out of the folder.
      if (!sameIdentity(info, file.identity)) continue;
      try {
        if ((await digest(file.path)) !== file.identity?.sha256) continue;
      } catch {
        continue;
      }
      await rm(file.path, { force: true });
    }
    await removeTemps(journal);
    await rm(join(root, name), { force: true });
  }
  if (!interrupted) return { kind: "NONE" };
  return {
    kind: "CLEARED",
    message: INTERRUPTED_EXPORT_MESSAGE,
    kept: [],
  };
}

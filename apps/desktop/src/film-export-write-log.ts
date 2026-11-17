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
  complete: boolean;
  identity?: FileIdentity;
};
type Journal = {
  schemaVersion: 1;
  id: string;
  directory: string;
  files: NotedFile[];
  temps: string[];
};

function contained(directory: string, target: string) {
  const root = resolve(directory);
  const path = resolve(target);
  const part = relative(root, path);
  return !!part && !isAbsolute(part) && part !== ".." && !part.startsWith("..");
}

async function fileIdentity(path: string): Promise<FileIdentity | undefined> {
  const info = await lstat(path, { bigint: true });
  if (info.isSymbolicLink() || !info.isFile()) return undefined;
  const hash = createHash("sha256");
  await new Promise<void>((resolveHash, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolveHash());
  });
  return {
    dev: info.dev.toString(),
    ino: info.ino.toString(),
    size: info.size.toString(),
    mtimeNs: info.mtimeNs.toString(),
    sha256: hash.digest("hex"),
  };
}

/** Durable list of files this export created. Startup deletes only the unfinished ones. */
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
        files: [],
        temps: [],
      };
      await save(journal);
      live.set(journal.id, journal);
      return journal.id;
    },
    async noteTemp(id: string, path: string) {
      const journal = live.get(id);
      if (!journal || !contained(journal.directory, path)) return;
      journal.temps.push(resolve(path));
      await save(journal);
    },
    async noteFile(id: string, file: { path: string; aspectRatio: "16:9" | "9:16" }) {
      const journal = live.get(id);
      if (!journal || !contained(journal.directory, file.path)) return;
      const identity = await fileIdentity(file.path).catch(() => undefined);
      if (!identity) return;
      journal.files.push({ ...file, path: resolve(file.path), complete: false, identity });
      await save(journal);
    },
    async completeAspect(id: string, aspectRatio: "16:9" | "9:16") {
      const journal = live.get(id);
      if (!journal) return;
      for (const file of journal.files) if (file.aspectRatio === aspectRatio) file.complete = true;
      await save(journal);
    },
    async finish(id: string) {
      live.delete(id);
      await rm(join(root, `${id}.json`), { force: true });
    },
  };
}

export async function recoverInterruptedExports(root: string): Promise<FilmExportRecovery> {
  let names: string[];
  try {
    names = await readdir(root);
  } catch {
    return { kind: "NONE" };
  }
  const kept = new Set<"16:9" | "9:16">();
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
    interrupted = true;
    for (const file of journal.files ?? []) {
      if (!file?.path || !contained(journal.directory, file.path)) continue;
      if (file.complete) {
        if (file.aspectRatio === "16:9" || file.aspectRatio === "9:16") kept.add(file.aspectRatio);
        continue;
      }
      let info;
      try {
        info = await lstat(file.path, { bigint: true });
      } catch {
        continue;
      }
      // A symlink, a replacement at the same path, or a content change is the
      // user's file now. Leave it, and do not follow a link out of the folder.
      if (
        info.isSymbolicLink() ||
        !info.isFile() ||
        !file.identity ||
        info.dev.toString() !== file.identity.dev ||
        info.ino.toString() !== file.identity.ino ||
        info.size.toString() !== file.identity.size ||
        info.mtimeNs.toString() !== file.identity.mtimeNs
      )
        continue;
      const hash = createHash("sha256");
      try {
        await new Promise<void>((resolveHash, reject) => {
          const stream = createReadStream(file.path);
          stream.on("data", (chunk) => hash.update(chunk));
          stream.on("error", reject);
          stream.on("end", () => resolveHash());
        });
      } catch {
        continue;
      }
      if (hash.digest("hex") !== file.identity.sha256) continue;
      await rm(file.path, { force: true });
    }
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
    await rm(join(root, name), { force: true });
  }
  if (!interrupted) return { kind: "NONE" };
  return {
    kind: "CLEARED",
    message: INTERRUPTED_EXPORT_MESSAGE,
    kept: [...kept].map((aspectRatio) => ({ aspectRatio })),
  };
}
